import "server-only";
import { imageJobConfigSchema } from "@/lib/domain/schemas";
import { buildProductShotPrompt, type ReferenceImageLabel } from "@/lib/domain/prompts";
import { ProviderError } from "@/lib/domain/jobs";
import type { TokenUsage } from "@/lib/domain/costs";
import { qualityReviewEnabled } from "@/lib/env";
import { getImageProvider } from "@/lib/providers/registry";
import type { LabelledImage } from "@/lib/providers/types";
import type { JobRow } from "@/lib/types";
import type { JobHandler } from "../worker";
import { enqueueSystemJob } from "../insert";
import { recordUsage, tokenCost } from "../usage";
import {
  downloadReferences,
  loadModelAssets,
  loadModelProfile,
  loadProduct,
  loadProductAssets,
  modelContext,
  permanent,
  productContext,
  storeGeneratedImage,
} from "./shared";

export const imageGenerationHandler: JobHandler = {
  async run(job, ctx) {
    const parsed = imageJobConfigSchema.safeParse(job.config);
    if (!parsed.success) throw permanent("Job configuration is invalid.", "invalid_config");
    const config = parsed.data;

    const product = await loadProduct(ctx.admin, job);
    const productAssets = await loadProductAssets(ctx.admin, job, product.id, config.productReferenceAssetIds);
    const profile = await loadModelProfile(ctx.admin, job, job.model_profile_id);
    const modelAssets = profile ? await loadModelAssets(ctx.admin, job, profile.id, config.modelReferenceAssetIds) : [];

    const [productImages, modelImages] = await Promise.all([
      downloadReferences(ctx.admin, productAssets.map((a) => a.storage_path)),
      downloadReferences(ctx.admin, modelAssets.map((a) => a.storage_path)),
    ]);
    await ctx.progress(20);

    const labels: ReferenceImageLabel[] = [
      ...productAssets.map((a, i) => ({ index: i + 1, kind: "product" as const, role: a.role })),
      ...modelAssets.map((_, i) => ({ index: productAssets.length + i + 1, kind: "model" as const, role: "model" as const })),
    ];
    const references: LabelledImage[] = [
      ...productImages.map((img, i) => ({ ...img, label: `product reference, ${productAssets[i]?.role ?? "other"} view` })),
      ...modelImages.map((img) => ({ ...img, label: "model identity reference" })),
    ];
    const prompt = buildProductShotPrompt({
      product: productContext(product),
      model: profile ? modelContext(profile) : null,
      style: config.style,
      refs: labels,
      regenerationNote: config.regenerationNote,
    });

    const provider = getImageProvider();
    let result;
    try {
      result = await provider.generateImage({
        prompt,
        references,
        aspectRatio: config.style.aspectRatio,
        imageSize: config.style.imageSize,
        signal: ctx.signal,
      });
    } catch (error) {
      await recordFailedCall(ctx.admin, job, provider.name, provider.model, error);
      throw error;
    }
    await ctx.progress(70);

    await recordUsage(ctx.admin, {
      job,
      provider: result.provider,
      model: result.resolvedModel ?? result.model,
      requestId: result.requestId,
      usage: result.usage,
      units: { images: result.images.length },
      cost: tokenCost(result.model, result.resolvedModel, result.usage),
      succeeded: true,
    });

    // Honour a cancellation that arrived during the provider call. The call
    // itself was billed (recorded above) but the output is discarded.
    if (await ctx.isCancelRequested()) {
      return { status: "cancelled", reason: "Cancelled by user during generation; output discarded" };
    }

    for (const image of result.images.slice(0, 1)) {
      const saved = await storeGeneratedImage(ctx.admin, job, image, {
        product_id: product.id,
        model_profile_id: profile?.id ?? null,
        parent_result_id: job.source_result_id,
        shot_type: config.style.shotType,
        prompt,
        settings: {
          style: config.style,
          presetId: config.presetId,
          productReferenceAssetIds: config.productReferenceAssetIds,
          modelReferenceAssetIds: config.modelReferenceAssetIds,
          finishReason: result.finishReason,
          resolvedModel: result.resolvedModel,
          latencyMs: result.latencyMs,
        },
        provider: result.provider,
        model: result.resolvedModel ?? result.model,
        provider_text: result.text,
        qc_status: qualityReviewEnabled() ? "queued" : "not_run",
      });
      if (qualityReviewEnabled()) {
        await enqueueSystemJob(ctx.admin, job.organization_id, job.created_by, {
          jobType: "quality_review",
          provider: "gemini",
          model: process.env.GEMINI_ANALYSIS_MODEL || "gemini-flash-latest",
          idempotencyKey: `qc:${saved.id}`,
          productId: product.id,
          modelProfileId: profile?.id ?? null,
          parentJobId: job.id,
          sourceResultId: saved.id,
          batchId: job.batch_id,
          inputAssetRefs: [
            ...config.productReferenceAssetIds.map((id) => ({ kind: "product_asset", id })),
            ...config.modelReferenceAssetIds.map((id) => ({ kind: "model_asset", id })),
          ],
          config: { resultId: saved.id },
        });
      }
    }

    await markProductCompletedIfIdle(ctx.admin, job);
    return { status: "succeeded", requestId: result.requestId };
  },

  async onTerminalFailure(job, { admin }) {
    await markProductCompletedIfIdle(admin, job);
  },
};

async function recordFailedCall(
  admin: Parameters<typeof recordUsage>[0],
  job: JobRow,
  provider: string,
  model: string,
  error: unknown,
) {
  // Record the attempt; cost is known only when the provider returned usage.
  const details = error instanceof ProviderError ? error.details : {};
  const usage = (details.usage as TokenUsage | undefined) ?? null;
  const resolved = (details.resolvedModel as string | null | undefined) ?? null;
  await recordUsage(admin, {
    job,
    provider,
    model: resolved ?? model,
    requestId: (details.requestId as string | null | undefined) ?? null,
    usage,
    units: { images: 0 },
    cost: usage ? tokenCost(model, resolved, usage) : { amount: null, currency: "USD", source: "unknown", pricingRef: null },
    succeeded: false,
  });
}

/** When no image jobs remain for a product, move it from processing to completed. */
async function markProductCompletedIfIdle(admin: Parameters<typeof recordUsage>[0], job: JobRow) {
  if (!job.product_id) return;
  const { count } = await admin
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", job.organization_id)
    .eq("product_id", job.product_id)
    .eq("job_type", "image_generation")
    .in("status", ["queued", "processing"])
    .neq("id", job.id);
  if ((count ?? 0) === 0) {
    await admin
      .from("products")
      .update({ status: "completed" })
      .eq("id", job.product_id)
      .eq("organization_id", job.organization_id)
      .eq("status", "processing");
  }
}
