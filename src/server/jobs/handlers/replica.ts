import "server-only";
import { replicaJobConfigSchema } from "@/lib/domain/schemas";
import { buildReplicaPrompt } from "@/lib/domain/prompts";
import { parseStructuredOutput, StructuredOutputError } from "@/lib/domain/analysis";
import { SCENE_ANALYSIS_PROMPT, sanitizeScene, sceneAnalysisJsonSchema, sceneAnalysisSchema, sceneToPrompt } from "@/lib/domain/scene";
import { randomModelPersona } from "@/lib/domain/photo-session";
import { ProviderError } from "@/lib/domain/jobs";
import { getImageProvider, getVisionProvider } from "@/lib/providers/registry";
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
 * Applies one reference photo's photographic setup (camera, framing, pose,
 * light, background, style) to the chosen model wearing the chosen product.
 * Step 1: a vision model describes the setup as text, without any wardrobe
 * (filtered again by stripWardrobe). Step 2: the image model receives only
 * that text plus the garment view(s) and the model reference (+ face
 * close-up) — never the reference image, so its clothing cannot leak.
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
    const productRefIds = config.productReferenceAssetIds.slice(0, Math.max(1, Math.min(2, limit - modelRefIds.length - (modelRefIds.length ? 1 : 0))));
    const productAssets = await loadProductAssets(ctx.admin, job, product.id, productRefIds);
    const modelAssets = profile ? await loadModelAssets(ctx.admin, job, profile.id, modelRefIds) : [];

    const [[sceneImage], garments, models] = await Promise.all([
      downloadReferences(ctx.admin, [config.scenePath]),
      downloadReferences(ctx.admin, productAssets.map((a) => a.storage_path)),
      downloadReferences(ctx.admin, modelAssets.map((a) => a.storage_path)),
    ]);
    if (!sceneImage) throw permanent("Reference photo is missing.", "reference_missing");

    // 1) Photographic setup of the reference, as text only.
    const vision = getVisionProvider();
    const analysis = await vision.generateStructured({
      prompt: SCENE_ANALYSIS_PROMPT,
      images: [{ ...sceneImage, label: "reference photo" }],
      jsonSchema: sceneAnalysisJsonSchema,
      signal: ctx.signal,
    });
    await recordUsage(ctx.admin, {
      job,
      provider: analysis.provider,
      model: analysis.resolvedModel ?? analysis.model,
      requestId: analysis.requestId,
      usage: analysis.usage,
      units: { requests: 1, images_in: 1 },
      cost: tokenCost(analysis.model, analysis.resolvedModel, analysis.usage),
      succeeded: true,
    });
    let sceneText: string;
    try {
      sceneText = sceneToPrompt(sanitizeScene(parseStructuredOutput(sceneAnalysisSchema, analysis.text)));
    } catch (error) {
      if (error instanceof StructuredOutputError) throw new ProviderError(error.message, "transient", "invalid_output");
      throw error;
    }
    if (!sceneText) throw new ProviderError("Scene analysis returned nothing usable.", "transient", "invalid_output");
    await ctx.progress(35);
    // Stop before the (quota-consuming) image call if the user cancelled meanwhile.
    if (await ctx.isCancelRequested()) {
      return { status: "cancelled", reason: "Cancelled by user before image generation" };
    }

    // 2) Generate from the text setup + garment + model references only.
    const face = models[0] && garments.length + models.length < limit ? await faceCloseUp(models[0]) : null;
    const modelImages = face ? [...models, face] : models;
    const references: LabelledImage[] = [
      ...garments.map((img, i) => ({ ...img, label: `product reference, ${productAssets[i]?.role ?? "other"} view` })),
      ...modelImages.map((img, i) => ({ ...img, label: face && i === modelImages.length - 1 ? "model face close-up" : "model identity reference" })),
    ];
    const prompt = buildReplicaPrompt({
      product: productContext(product),
      scene: sceneText,
      garments: garments.map((_, i) => 1 + i),
      models: modelImages.map((_, i) => 1 + garments.length + i),
      persona: profile ? null : randomModelPersona(job.batch_id ?? job.id),
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
        sceneAnalysis: sceneText,
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
