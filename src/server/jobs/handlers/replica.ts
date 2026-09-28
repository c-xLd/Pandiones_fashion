import "server-only";
import { replicaJobConfigSchema } from "@/lib/domain/schemas";
import { buildReplicaPrompt } from "@/lib/domain/prompts";
import { getImageProvider } from "@/lib/providers/registry";
import type { LabelledImage } from "@/lib/providers/types";
import type { JobHandler } from "../worker";
import { recordUsage, tokenCost } from "../usage";
import { recordFailedCall } from "./image-generation";
import {
  downloadReferences,
  faceCloseUp,
  loadModelAssets,
  loadModelProfile,
  loadProduct,
  loadProductAssets,
  permanent,
  productContext,
  storeGeneratedImage,
  upscaleIfNeeded,
} from "./shared";

/**
 * Recreates one reference photo 1:1 (pose, framing, background, light) with
 * the chosen model wearing the chosen product. Inputs, in order: the scene,
 * the garment view(s), the model reference (+ a face close-up if there is room).
 */
export const replicaHandler: JobHandler = {
  async run(job, ctx) {
    const parsed = replicaJobConfigSchema.safeParse(job.config);
    if (!parsed.success) throw permanent("Job configuration is invalid.", "invalid_config");
    const config = parsed.data;
    if (!config.scenePath.startsWith(`${job.organization_id}/references/`)) throw permanent("Reference is not in this organization.", "invalid_job");

    const provider = getImageProvider(job.model);
    const limit = provider.maxReferenceImages ?? Number.POSITIVE_INFINITY;
    const product = await loadProduct(ctx.admin, job);
    const profile = await loadModelProfile(ctx.admin, job, job.model_profile_id);
    const modelRefIds = profile ? config.modelReferenceAssetIds.slice(0, 1) : [];
    const productRefIds = config.productReferenceAssetIds.slice(0, Math.max(1, Math.min(2, limit - 1 - modelRefIds.length)));
    const productAssets = await loadProductAssets(ctx.admin, job, product.id, productRefIds);
    const modelAssets = profile ? await loadModelAssets(ctx.admin, job, profile.id, modelRefIds) : [];

    const [[scene], garments, models] = await Promise.all([
      downloadReferences(ctx.admin, [config.scenePath]),
      downloadReferences(ctx.admin, productAssets.map((a) => a.storage_path)),
      downloadReferences(ctx.admin, modelAssets.map((a) => a.storage_path)),
    ]);
    if (!scene) throw permanent("Reference photo is missing.", "reference_missing");
    const face = models[0] && 1 + garments.length + models.length < limit ? await faceCloseUp(models[0]) : null;
    const modelImages = face ? [...models, face] : models;
    await ctx.progress(20);

    const references: LabelledImage[] = [
      { ...scene, label: "reference photo to recreate" },
      ...garments.map((img, i) => ({ ...img, label: `product reference, ${productAssets[i]?.role ?? "other"} view` })),
      ...modelImages.map((img, i) => ({ ...img, label: face && i === modelImages.length - 1 ? "model face close-up" : "model identity reference" })),
    ];
    const prompt = buildReplicaPrompt({
      product: productContext(product),
      scene: 1,
      garments: garments.map((_, i) => 2 + i),
      models: modelImages.map((_, i) => 2 + garments.length + i),
      format: provider.promptFormat ?? "detailed",
      instructions: config.instructions,
    });

    let result;
    try {
      result = await provider.generateImage({ prompt, references, aspectRatio: config.aspectRatio, imageSize: config.imageSize, signal: ctx.signal });
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
      cost: result.cost ?? tokenCost(result.model, result.resolvedModel, result.usage),
      succeeded: true,
    });
    if (await ctx.isCancelRequested()) {
      return { status: "cancelled", reason: "Cancelled by user during generation; output discarded" };
    }
    const generated = result.images[0];
    if (!generated) throw permanent("The provider returned no image.", "no_image");
    const { image, upscaled } = await upscaleIfNeeded(generated, config.imageSize);
    await storeGeneratedImage(ctx.admin, job, image, {
      product_id: product.id,
      model_profile_id: profile?.id ?? null,
      shot_type: "replica",
      prompt,
      settings: {
        kind: "replica",
        scenePath: config.scenePath,
        sceneThumbnailPath: config.sceneThumbnailPath,
        aspectRatio: config.aspectRatio,
        imageSize: config.imageSize,
        productReferenceAssetIds: productRefIds,
        modelReferenceAssetIds: modelRefIds,
        upscaled,
        latencyMs: result.latencyMs,
      },
      provider: result.provider,
      model: result.resolvedModel ?? result.model,
      provider_text: result.text,
    });
    return { status: "succeeded", requestId: result.requestId };
  },
};
