import "server-only";
import { videoJobConfigSchema } from "@/lib/domain/schemas";
import { estimateVideoCost } from "@/lib/domain/costs";
import { ProviderError } from "@/lib/domain/jobs";
import { videoConfig } from "@/lib/env";
import { getVideoProvider } from "@/lib/providers/registry";
import type { ResultRow } from "@/lib/types";
import type { JobHandler } from "../worker";
import { recordUsage } from "../usage";
import { downloadReferences, permanent } from "./shared";
import { paths, uploadObject } from "../../storage";

/**
 * Two-phase long-running job:
 *  1. submit the generation and store the provider operation name;
 *  2. on later worker ticks, poll the operation until it finishes, then
 *     download and store the video.
 * The job stays in `processing` between polls and survives worker restarts.
 */
export const videoGenerationHandler: JobHandler = {
  async run(job, ctx) {
    const parsed = videoJobConfigSchema.safeParse(job.config);
    if (!parsed.success) throw permanent("Job configuration is invalid.", "invalid_config");
    const config = parsed.data;
    if (!job.video_project_id) throw permanent("Video job has no project.", "invalid_job");
    const provider = getVideoProvider();
    const pollAfterMs = videoConfig().pollIntervalSeconds * 1000;

    if (!job.provider_operation) {
      const { data, error } = await ctx.admin
        .from("generation_results")
        .select("*")
        .eq("organization_id", job.organization_id)
        .in("id", config.sourceResultIds);
      if (error) throw new Error(`Load source images failed: ${error.message}`);
      const sources = ((data ?? []) as ResultRow[]).filter((r) => r.kind === "image" && r.review_status === "approved");
      if (sources.length !== config.sourceResultIds.length) {
        throw permanent("Source images must exist and be approved before video generation.", "source_not_approved");
      }
      sources.sort((a, b) => config.sourceResultIds.indexOf(a.id) - config.sourceResultIds.indexOf(b.id));
      const images = await downloadReferences(ctx.admin, sources.map((s) => s.storage_path));
      const useReferences = config.useReferenceImages && images.length > 1;

      const submission = await provider.submit({
        prompt: config.prompt,
        negativePrompt: config.negativePrompt,
        image: useReferences ? null : images[0] ?? null,
        referenceImages: useReferences ? images : [],
        durationSeconds: config.durationSeconds,
        aspectRatio: config.aspectRatio,
        resolution: config.resolution,
      });
      await ctx.admin
        .from("video_projects")
        .update({ status: "processing", provider: submission.provider, model: submission.model })
        .eq("id", job.video_project_id)
        .eq("organization_id", job.organization_id);
      return { status: "pending", operation: submission.operationId, progress: 5, pollAfterMs, requestId: submission.operationId };
    }

    if (await ctx.isCancelRequested()) {
      return {
        status: "cancelled",
        reason: "Cancelled by user. The provider operation may still complete and be billed.",
      };
    }

    const poll = await provider.poll(job.provider_operation);
    if (!poll.done) {
      return { status: "pending", operation: job.provider_operation, progress: poll.progress ?? 50, pollAfterMs };
    }

    const cost = estimateVideoCost(job.model, {
      seconds: config.durationSeconds,
      resolution: config.resolution,
      count: poll.videos.length,
    });
    await recordUsage(ctx.admin, {
      job,
      provider: provider.name,
      model: job.model,
      requestId: job.provider_operation,
      usage: null,
      units: { videos: poll.videos.length, seconds: config.durationSeconds * poll.videos.length },
      cost: poll.videos.length ? cost : { amount: null, currency: "USD", source: "unknown", pricingRef: cost.pricingRef },
      succeeded: poll.videos.length > 0,
    });

    if (!poll.videos.length) {
      throw new ProviderError(
        poll.filteredCount
          ? `The video was withheld by provider safety filters (${poll.filteredReasons.join("; ") || "no reason given"}).`
          : "The provider finished without returning a video.",
        "permanent",
        poll.filteredCount ? "safety_filtered" : "no_video",
      );
    }

    for (const video of poll.videos) {
      const storagePath = paths.result(job.organization_id, job.id, "video/mp4");
      await uploadObject(storagePath, video.data, "video/mp4");
      const { error } = await ctx.admin.from("generation_results").insert({
        organization_id: job.organization_id,
        job_id: job.id,
        product_id: job.product_id,
        video_project_id: job.video_project_id,
        kind: "video",
        storage_path: storagePath,
        mime_type: "video/mp4",
        size_bytes: video.data.byteLength,
        duration_seconds: config.durationSeconds,
        prompt: config.prompt,
        settings: {
          aspectRatio: config.aspectRatio,
          resolution: config.resolution,
          sourceResultIds: config.sourceResultIds,
          operation: job.provider_operation,
        },
        provider: provider.name,
        model: job.model,
      });
      if (error) throw new Error(`Saving video result failed: ${error.message}`);
    }
    await ctx.admin
      .from("video_projects")
      .update({ status: "ready" })
      .eq("id", job.video_project_id)
      .eq("organization_id", job.organization_id);
    return { status: "succeeded", requestId: job.provider_operation };
  },

  async onTerminalFailure(job, { admin }, reason) {
    if (!job.video_project_id) return;
    await admin
      .from("video_projects")
      .update({ status: reason === "cancelled" || reason.startsWith("Cancelled") ? "cancelled" : "failed" })
      .eq("id", job.video_project_id)
      .eq("organization_id", job.organization_id);
  },
};
