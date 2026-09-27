import "server-only";
import { buildQualityReviewPrompt } from "@/lib/domain/prompts";
import {
  parseStructuredOutput,
  qcStatusFromReview,
  qualityReviewJsonSchema,
  qualityReviewSchema,
  StructuredOutputError,
} from "@/lib/domain/analysis";
import { ProviderError } from "@/lib/domain/jobs";
import { getVisionProvider } from "@/lib/providers/registry";
import type { ResultRow } from "@/lib/types";
import type { JobHandler } from "../worker";
import { recordUsage, tokenCost } from "../usage";
import { downloadObject } from "../../storage";
import { downloadReferences, loadModelAssets, loadProductAssets, permanent, prepareReference } from "./shared";

/**
 * Automated screening of a generated image against its source references.
 * The verdict is a signal for the human reviewer, never an approval.
 */
export const qualityReviewHandler: JobHandler = {
  async run(job, ctx) {
    const resultId = job.source_result_id;
    if (!resultId) throw permanent("Quality review job has no result.", "invalid_job");
    const { data, error } = await ctx.admin
      .from("generation_results")
      .select("*")
      .eq("id", resultId)
      .eq("organization_id", job.organization_id)
      .maybeSingle();
    if (error) throw new Error(`Load result failed: ${error.message}`);
    if (!data) throw permanent("Result no longer exists.", "not_found");
    const result = data as ResultRow;

    const productIds = job.input_asset_refs.filter((r) => r.kind === "product_asset").map((r) => r.id);
    const modelIds = job.input_asset_refs.filter((r) => r.kind === "model_asset").map((r) => r.id);
    const productAssets = result.product_id ? await loadProductAssets(ctx.admin, job, result.product_id, productIds) : [];
    const modelAssets =
      result.model_profile_id && modelIds.length ? await loadModelAssets(ctx.admin, job, result.model_profile_id, modelIds) : [];

    const [productImages, modelImages, generated] = await Promise.all([
      downloadReferences(ctx.admin, productAssets.map((a) => a.storage_path)),
      downloadReferences(ctx.admin, modelAssets.map((a) => a.storage_path)),
      downloadObject(result.storage_path, ctx.admin).then(prepareReference),
    ]);

    const style = (result.settings as { style?: { framing?: string; background?: string } }).style;
    const provider = getVisionProvider();
    const response = await provider.generateStructured({
      prompt: buildQualityReviewPrompt({
        productRefCount: productImages.length,
        modelRefCount: modelImages.length,
        shotType: result.shot_type,
        framing: style?.framing ?? null,
        background: style?.background ?? null,
      }),
      images: [
        ...productImages.map((img, i) => ({ ...img, label: `original product reference (${productAssets[i]?.role})` })),
        ...modelImages.map((img) => ({ ...img, label: "model identity reference" })),
        { ...generated, label: "GENERATED RESULT to review" },
      ],
      jsonSchema: qualityReviewJsonSchema,
      signal: ctx.signal,
    });

    const usageEntry = {
      job,
      provider: response.provider,
      model: response.resolvedModel ?? response.model,
      requestId: response.requestId,
      usage: response.usage,
      units: { requests: 1 },
      cost: tokenCost(response.model, response.resolvedModel, response.usage),
    };

    let review;
    try {
      review = parseStructuredOutput(qualityReviewSchema, response.text);
    } catch (err) {
      await recordUsage(ctx.admin, { ...usageEntry, succeeded: false });
      if (err instanceof StructuredOutputError) throw new ProviderError(err.message, "transient", "invalid_output");
      throw err;
    }
    await recordUsage(ctx.admin, { ...usageEntry, succeeded: true });

    const { error: updateError } = await ctx.admin
      .from("generation_results")
      .update({
        qc_status: qcStatusFromReview(review),
        qc_flags: review.flags,
        qc_summary: review.summary,
        qc_model: response.resolvedModel ?? response.model,
      })
      .eq("id", result.id)
      .eq("organization_id", job.organization_id);
    if (updateError) throw new Error(`Saving QC failed: ${updateError.message}`);
    return { status: "succeeded", requestId: response.requestId };
  },

  async onTerminalFailure(job, { admin }) {
    if (!job.source_result_id) return;
    await admin
      .from("generation_results")
      .update({ qc_status: "error" })
      .eq("id", job.source_result_id)
      .eq("organization_id", job.organization_id);
  },
};
