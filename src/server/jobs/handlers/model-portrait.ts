import "server-only";
import { modelPortraitJobConfigSchema } from "@/lib/domain/schemas";
import { buildModelPortraitPrompt } from "@/lib/domain/prompts";
import { ProviderError } from "@/lib/domain/jobs";
import type { TokenUsage } from "@/lib/domain/costs";
import { getImageProvider } from "@/lib/providers/registry";
import type { JobHandler } from "../worker";
import { recordUsage, tokenCost } from "../usage";
import { downloadReferences, loadModelAssets, loadModelProfile, modelContext, permanent, storeGeneratedImage } from "./shared";

/** Generates a reference portrait for a model profile (casting / identity). */
export const modelPortraitHandler: JobHandler = {
  async run(job, ctx) {
    const parsed = modelPortraitJobConfigSchema.safeParse(job.config);
    if (!parsed.success) throw permanent("Job configuration is invalid.", "invalid_config");
    const config = parsed.data;
    const profile = await loadModelProfile(ctx.admin, job, job.model_profile_id);
    if (!profile) throw permanent("Model profile is required.", "invalid_job");
    const assets = await loadModelAssets(ctx.admin, job, profile.id, config.modelReferenceAssetIds);
    const images = await downloadReferences(ctx.admin, assets.map((a) => a.storage_path));
    const prompt = buildModelPortraitPrompt(modelContext(profile), config.instructions, images.length > 0);

    const provider = getImageProvider();
    let result;
    try {
      result = await provider.generateImage({
        prompt,
        references: images.map((img) => ({ ...img, label: "model identity reference" })),
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
        signal: ctx.signal,
      });
    } catch (error) {
      const details = error instanceof ProviderError ? error.details : {};
      const usage = (details.usage as TokenUsage | undefined) ?? null;
      await recordUsage(ctx.admin, {
        job,
        provider: provider.name,
        model: provider.model,
        requestId: (details.requestId as string | undefined) ?? null,
        usage,
        units: { images: 0 },
        cost: usage
          ? tokenCost(provider.model, null, usage)
          : { amount: null, currency: "USD", source: "unknown", pricingRef: null },
        succeeded: false,
      });
      throw error;
    }
    await recordUsage(ctx.admin, {
      job,
      provider: result.provider,
      model: result.resolvedModel ?? result.model,
      requestId: result.requestId,
      usage: result.usage,
      units: { images: result.images.length },
      cost: result.cost ?? tokenCost(result.model, result.resolvedModel, result.usage),
      succeeded: true,
    });
    if (await ctx.isCancelRequested()) {
      return { status: "cancelled", reason: "Cancelled by user during generation; output discarded" };
    }
    const first = result.images[0];
    if (first) {
      await storeGeneratedImage(ctx.admin, job, first, {
        model_profile_id: profile.id,
        shot_type: "portrait",
        prompt,
        settings: { aspectRatio: config.aspectRatio, imageSize: config.imageSize, modelReferenceAssetIds: config.modelReferenceAssetIds },
        provider: result.provider,
        model: result.resolvedModel ?? result.model,
        provider_text: result.text,
      });
    }
    return { status: "succeeded", requestId: result.requestId };
  },
};
