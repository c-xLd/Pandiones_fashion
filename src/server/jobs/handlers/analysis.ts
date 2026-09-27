import "server-only";
import { buildAnalysisPrompt } from "@/lib/domain/prompts";
import { parseStructuredOutput, productAnalysisJsonSchema, productAnalysisSchema, StructuredOutputError } from "@/lib/domain/analysis";
import { ProviderError } from "@/lib/domain/jobs";
import { getVisionProvider } from "@/lib/providers/registry";
import type { JobHandler } from "../worker";
import { recordUsage, tokenCost } from "../usage";
import { downloadReferences, loadProduct, loadProductAssets } from "./shared";

const MAX_ANALYSIS_IMAGES = 8;

export const analysisHandler: JobHandler = {
  async run(job, ctx) {
    const product = await loadProduct(ctx.admin, job);
    const assetIds = job.input_asset_refs.filter((r) => r.kind === "product_asset").map((r) => r.id);
    const assets = (await loadProductAssets(ctx.admin, job, product.id, assetIds.length ? assetIds : null)).slice(
      0,
      MAX_ANALYSIS_IMAGES,
    );
    const images = await downloadReferences(ctx.admin, assets.map((a) => a.storage_path));
    await ctx.progress(30);

    const provider = getVisionProvider();
    const result = await provider.generateStructured({
      prompt: buildAnalysisPrompt(
        assets.map((a, i) => ({ index: i + 1, role: a.role })),
        typeof job.config.language === "string" ? job.config.language : undefined,
      ),
      images: images.map((img, i) => ({ ...img, label: `product reference (${assets[i]?.role ?? "other"})` })),
      jsonSchema: productAnalysisJsonSchema,
      signal: ctx.signal,
    });

    let analysis;
    try {
      analysis = parseStructuredOutput(productAnalysisSchema, result.text);
    } catch (error) {
      await recordUsage(ctx.admin, {
        job,
        provider: result.provider,
        model: result.resolvedModel ?? result.model,
        requestId: result.requestId,
        usage: result.usage,
        units: { requests: 1 },
        cost: tokenCost(result.model, result.resolvedModel, result.usage),
        succeeded: false,
      });
      // Malformed structured output is occasionally transient; retry.
      if (error instanceof StructuredOutputError) throw new ProviderError(error.message, "transient", "invalid_output");
      throw error;
    }

    await recordUsage(ctx.admin, {
      job,
      provider: result.provider,
      model: result.resolvedModel ?? result.model,
      requestId: result.requestId,
      usage: result.usage,
      units: { requests: 1, images_in: images.length },
      cost: tokenCost(result.model, result.resolvedModel, result.usage),
      succeeded: true,
    });

    const { error } = await ctx.admin
      .from("products")
      .update({
        ai_analysis: analysis,
        analysis_status: "completed",
        analysis_model: result.resolvedModel ?? result.model,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", product.id)
      .eq("organization_id", job.organization_id);
    if (error) throw new Error(`Saving analysis failed: ${error.message}`);
    return { status: "succeeded", requestId: result.requestId };
  },

  async onTerminalFailure(job, { admin }) {
    if (!job.product_id) return;
    await admin
      .from("products")
      .update({ analysis_status: "failed" })
      .eq("id", job.product_id)
      .eq("organization_id", job.organization_id)
      .eq("analysis_status", "queued");
  },
};
