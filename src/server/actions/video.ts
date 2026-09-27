"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { REVIEW_STATUSES, videoRequestSchema, type VideoJobConfig, type VideoRequest } from "@/lib/domain/schemas";
import { VIDEO_NEGATIVE_PROMPT, buildVideoPrompt } from "@/lib/domain/prompts";
import { videoConfig } from "@/lib/env";
import { isVideoEnabled } from "@/lib/providers/registry";
import { VEO_PROVIDER } from "@/lib/providers/video/gemini-veo";
import type { ActionResult, ResultRow } from "@/lib/types";
import { requireOrgContext } from "../context";
import { UserFacingError, check, runAction } from "../action";
import { enforceRateLimit } from "../rate-limit";
import { audit } from "../audit";
import { enqueueJobs } from "../jobs/enqueue";

export async function createVideoProject(input: VideoRequest): Promise<ActionResult<{ projectId: string }>> {
  return runAction("createVideoProject", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    if (!isVideoEnabled()) {
      throw new UserFacingError("videoNotConfigured");
    }
    const data = videoRequestSchema.parse(input);
    const cfg = videoConfig();
    if (!cfg.allowedDurations.includes(data.durationSeconds)) {
      throw new UserFacingError("videoDuration", { list: cfg.allowedDurations.join(", ") });
    }
    if (data.kind === "product" && data.sourceResultIds.length !== 1) {
      throw new UserFacingError("productVideoOneImage");
    }
    if (data.sourceResultIds.length > 1 && !cfg.supportsReferenceImages) {
      throw new UserFacingError("videoNeedsRefSupport");
    }
    const org = ctx.org.organizationId;
    const sources = check(
      await ctx.supabase.from("generation_results").select("*").eq("organization_id", org).in("id", data.sourceResultIds),
      "Load images",
    ) as ResultRow[];
    if (sources.length !== data.sourceResultIds.length) throw new UserFacingError("imagesNotFound");
    if (sources.some((s) => s.kind !== "image" || s.review_status !== "approved")) {
      throw new UserFacingError("onlyApprovedForVideo");
    }
    const productId = sources[0]?.product_id ?? null;

    const project = check(
      await ctx.supabase
        .from("video_projects")
        .insert({
          organization_id: org,
          name: data.name,
          kind: data.kind,
          product_id: productId,
          source_result_ids: data.sourceResultIds,
          brief: data.brief || null,
          prompt: data.prompt,
          motion_instructions: data.motionInstructions || null,
          duration_seconds: data.durationSeconds,
          aspect_ratio: data.aspectRatio,
          resolution: data.resolution,
          status: "queued",
          provider: VEO_PROVIDER,
          model: cfg.model,
          created_by: ctx.userId,
        })
        .select("id")
        .single(),
      "Create project",
    ) as { id: string };

    const config: VideoJobConfig = {
      kind: data.kind,
      prompt: buildVideoPrompt({ kind: data.kind, prompt: data.prompt, motionInstructions: data.motionInstructions, brief: data.brief }),
      negativePrompt: VIDEO_NEGATIVE_PROMPT,
      durationSeconds: data.durationSeconds,
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      sourceResultIds: data.sourceResultIds,
      useReferenceImages: data.sourceResultIds.length > 1 && cfg.supportsReferenceImages,
    };
    const enqueue = enqueueJobs(ctx, [
      {
        jobType: "video_generation",
        provider: VEO_PROVIDER,
        model: cfg.model ?? "",
        idempotencyKey: data.idempotencyKey,
        productId,
        videoProjectId: project.id,
        inputAssetRefs: data.sourceResultIds.map((id) => ({ kind: "generation_result", id })),
        config,
        // Each attempt of a video job is a new paid submission; keep retries low.
        maxAttempts: 2,
      },
    ]);
    try {
      await enqueue;
    } catch (error) {
      await ctx.supabase.from("video_projects").update({ status: "failed" }).eq("id", project.id).eq("organization_id", org);
      throw error;
    }
    await audit({ organizationId: org, actorId: ctx.userId, action: "video.created", entityType: "video_project", entityId: project.id, metadata: { kind: data.kind, duration: data.durationSeconds } });
    revalidatePath("/video");
    return { projectId: project.id };
  });
}

export async function setVideoApproval(projectId: string, decision: string): Promise<ActionResult> {
  return runAction("setVideoApproval", async () => {
    const ctx = await requireOrgContext("editor");
    const status = z.enum(REVIEW_STATUSES).parse(decision);
    const id = z.uuid().parse(projectId);
    const org = ctx.org.organizationId;
    const project = check(
      await ctx.supabase.from("video_projects").select("status").eq("id", id).eq("organization_id", org).maybeSingle(),
      "Load project",
    ) as { status: string } | null;
    if (!project) throw new UserFacingError("videoProjectNotFound");
    if (status === "approved" && project.status !== "ready") throw new UserFacingError("onlyFinishedApproved");
    check(
      await ctx.supabase
        .from("video_projects")
        .update({
          approval_status: status,
          approved_by: status === "approved" ? ctx.userId : null,
          approved_at: status === "approved" ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .eq("organization_id", org),
      "Update approval",
    );
    // Mirror the decision onto the video result(s) for the media library.
    check(
      await ctx.supabase
        .from("generation_results")
        .update({ review_status: status, reviewed_by: ctx.userId, reviewed_at: new Date().toISOString() })
        .eq("video_project_id", id)
        .eq("organization_id", org),
      "Update video results",
    );
    await audit({ organizationId: org, actorId: ctx.userId, action: `video.${status}`, entityType: "video_project", entityId: id });
    revalidatePath(`/video/${id}`);
    revalidatePath("/video");
    return undefined;
  });
}
