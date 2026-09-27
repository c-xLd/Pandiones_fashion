"use server";

import { getI18n } from "@/lib/i18n/server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  imageJobConfigSchema,
  photoSessionRequestSchema,
  presetInputSchema,
  reviewInputSchema,
  shootRequestSchema,
  shootStyleSchema,
  type ImageJobConfig,
  type PhotoSessionRequest,
  type ShootRequest,
} from "@/lib/domain/schemas";
import { planPhotoSession, randomModelPersona } from "@/lib/domain/photo-session";
import { inferGarmentType, planOutfit } from "@/lib/domain/outfit";
import { engineModel, geminiConfig, imageGenerationConfig } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { exportFileName } from "@/lib/domain/files";
import { BUCKET, removeObjects } from "../storage";
import type { ActionResult, JobRow, ResultRow } from "@/lib/types";
import { requireOrgContext } from "../context";
import { UserFacingError, check, runAction, toActionError } from "../action";
import { enforceRateLimit } from "../rate-limit";
import { audit } from "../audit";
import { enqueueJobs, type EnqueueInput } from "../jobs/enqueue";

/** Upper bound on images created by one shoot submission. */
const MAX_JOBS_PER_SHOOT = 40;

export async function createShoot(input: ShootRequest): Promise<ActionResult<{ batchId: string; jobCount: number; created: number }>> {
  return runAction("createShoot", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    const req = shootRequestSchema.parse(input);
    const org = ctx.org.organizationId;
    const cfg = imageGenerationConfig();

    const total = req.shotTypes.length * req.style.variations;
    if (total > MAX_JOBS_PER_SHOOT) {
      throw new UserFacingError("shootTooLarge", { total, max: MAX_JOBS_PER_SHOOT });
    }
    const refCount = req.productReferenceAssetIds.length + req.modelReferenceAssetIds.length;
    if (refCount > cfg.maxReferenceImages) {
      throw new UserFacingError("tooManyReferences", { max: cfg.maxReferenceImages, count: refCount });
    }

    // Verify every referenced record belongs to this organization.
    const product = check(
      await ctx.supabase.from("products").select("id, status").eq("id", req.productId).eq("organization_id", org).maybeSingle(),
      "Load product",
    ) as { id: string; status: string } | null;
    if (!product) throw new UserFacingError("productNotFound");
    if (product.status === "archived") throw new UserFacingError("productArchived");

    const assets = check(
      await ctx.supabase.from("product_assets").select("id").eq("product_id", req.productId).eq("organization_id", org).in("id", req.productReferenceAssetIds),
      "Load assets",
    ) as { id: string }[];
    if (assets.length !== new Set(req.productReferenceAssetIds).size) throw new UserFacingError("invalidProductRefs");

    if (req.modelProfileId) {
      const model = check(
        await ctx.supabase.from("model_profiles").select("id, status").eq("id", req.modelProfileId).eq("organization_id", org).maybeSingle(),
        "Load model",
      ) as { id: string; status: string } | null;
      if (!model) throw new UserFacingError("modelNotFound");
      if (model.status === "retired") throw new UserFacingError("modelProfileRetired");
      if (req.modelReferenceAssetIds.length) {
        const modelAssets = check(
          await ctx.supabase
            .from("model_profile_assets")
            .select("id")
            .eq("model_profile_id", req.modelProfileId)
            .eq("organization_id", org)
            .in("id", req.modelReferenceAssetIds),
          "Load model assets",
        ) as { id: string }[];
        if (modelAssets.length !== new Set(req.modelReferenceAssetIds).size) throw new UserFacingError("invalidModelRefs");
      }
    } else if (req.modelReferenceAssetIds.length) {
      throw new UserFacingError("modelRefsNeedProfile");
    }

    if (req.presetId) {
      const preset = check(await ctx.supabase.from("shoot_presets").select("id").eq("id", req.presetId).maybeSingle(), "Load preset");
      if (!preset) throw new UserFacingError("presetNotFound");
    }

    const batchId = randomUUID();
    const { locale } = await getI18n();
    const jobs: EnqueueInput[] = [];
    for (const shotType of req.shotTypes) {
      for (let v = 0; v < req.style.variations; v++) {
        const config: ImageJobConfig = {
          kind: "product_shot",
          style: shootStyleSchema.parse({ ...req.style, shotType }),
          presetId: req.presetId,
          productReferenceAssetIds: req.productReferenceAssetIds,
          modelReferenceAssetIds: req.modelReferenceAssetIds,
          variationIndex: v,
          regenerationNote: null,
          language: locale,
          modelPersona: null,
          location: null,
          styling: null,
        };
        jobs.push({
          jobType: "image_generation",
          provider: cfg.provider,
          model: cfg.model,
          idempotencyKey: `${req.idempotencyKey}:${shotType}:${v}`,
          productId: req.productId,
          modelProfileId: req.modelProfileId,
          batchId,
          inputAssetRefs: [
            ...req.productReferenceAssetIds.map((id) => ({ kind: "product_asset", id })),
            ...req.modelReferenceAssetIds.map((id) => ({ kind: "model_asset", id })),
          ],
          config,
        });
      }
    }
    const { jobs: rows, created } = await enqueueJobs(ctx, jobs);
    if (created > 0) {
      check(
        await ctx.supabase.from("products").update({ status: "processing" }).eq("id", req.productId).eq("organization_id", org),
        "Update product",
      );
    }
    await audit({ organizationId: org, actorId: ctx.userId, action: "shoot.created", entityType: "product", entityId: req.productId, metadata: { batchId, jobs: rows.length, created } });
    revalidatePath("/jobs");
    revalidatePath(`/products/${req.productId}`);
    return { batchId: rows[0]?.batch_id ?? batchId, jobCount: rows.length, created };
  });
}

/** Product reference views in the order a session sends them to the model. */
const SESSION_REF_ORDER = ["front", "side", "back", "detail", "fabric", "other"];
const SESSION_MAX_PRODUCT_REFS = 4;

/**
 * One-click photo session: the server picks the references and plans varied
 * shots (poses, angles, framings, locations), one background job per photo.
 */
export async function createPhotoSession(
  input: PhotoSessionRequest,
): Promise<ActionResult<{ batchId: string; jobCount: number; created: number }>> {
  return runAction("createPhotoSession", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    const req = photoSessionRequestSchema.parse(input);
    const org = ctx.org.organizationId;
    const cfg = imageGenerationConfig();

    const product = check(
      await ctx.supabase
        .from("products")
        .select("id, status, title, category, ai_analysis")
        .eq("id", req.productId)
        .eq("organization_id", org)
        .maybeSingle(),
      "Load product",
    ) as { id: string; status: string; title: string; category: string | null; ai_analysis: { category?: string } | null } | null;
    if (!product) throw new UserFacingError("productNotFound");
    if (product.status === "archived") throw new UserFacingError("productArchived");
    const garmentType = req.garmentType === "auto" ? inferGarmentType(product.category, product.ai_analysis?.category, product.title) : req.garmentType;
    const styling = planOutfit(garmentType, req.idempotencyKey);
    const model = engineModel(cfg, req.engine);

    let modelRefIds: string[] = [];
    if (req.modelProfileId) {
      const model = check(
        await ctx.supabase.from("model_profiles").select("id, status").eq("id", req.modelProfileId).eq("organization_id", org).maybeSingle(),
        "Load model",
      ) as { id: string; status: string } | null;
      if (!model) throw new UserFacingError("modelNotFound");
      if (model.status === "retired") throw new UserFacingError("modelProfileRetired");
      const modelAssets = check(
        await ctx.supabase
          .from("model_profile_assets")
          .select("id, is_primary, created_at")
          .eq("model_profile_id", model.id)
          .eq("organization_id", org)
          .order("is_primary", { ascending: false })
          .order("created_at")
          .limit(1),
        "Load model assets",
      ) as { id: string }[];
      modelRefIds = modelAssets.map((a) => a.id);
    }

    const assets = check(
      await ctx.supabase.from("product_assets").select("id, role, created_at").eq("product_id", product.id).eq("organization_id", org),
      "Load assets",
    ) as { id: string; role: string; created_at: string }[];
    if (!assets.length) throw new UserFacingError("invalidProductRefs");
    const productRefIds = [...assets]
      .sort((a, b) => SESSION_REF_ORDER.indexOf(a.role) - SESSION_REF_ORDER.indexOf(b.role) || a.created_at.localeCompare(b.created_at))
      .slice(0, Math.max(1, Math.min(SESSION_MAX_PRODUCT_REFS, cfg.maxReferenceImages - modelRefIds.length)))
      .map((a) => a.id);

    // Seeded by the idempotency key: a retried submission yields the same plan.
    const plan = planPhotoSession({ count: req.count, locations: req.locations, seed: req.idempotencyKey });
    const persona = !req.modelProfileId && req.randomModel ? randomModelPersona(req.idempotencyKey) : null;
    const batchId = randomUUID();
    const { locale } = await getI18n();
    const jobs: EnqueueInput[] = plan.map((shot, i) => {
      const config: ImageJobConfig = {
        kind: "product_shot",
        style: shootStyleSchema.parse({
          shotType: shot.shotType,
          pose: shot.pose,
          cameraAngle: shot.cameraAngle,
          framing: shot.framing,
          background: shot.background,
          lighting: shot.lighting,
          aspectRatio: req.aspectRatio,
          imageSize: req.imageSize,
          variations: 1,
          creativeInstructions: req.instructions,
        }),
        presetId: null,
        productReferenceAssetIds: productRefIds,
        modelReferenceAssetIds: modelRefIds,
        variationIndex: i,
        regenerationNote: null,
        language: locale,
        modelPersona: persona,
        location: shot.location,
        styling,
      };
      return {
        jobType: "image_generation",
        provider: cfg.provider,
        model,
        idempotencyKey: `${req.idempotencyKey}:session:${i}`,
        productId: product.id,
        modelProfileId: req.modelProfileId,
        batchId,
        inputAssetRefs: [
          ...productRefIds.map((id) => ({ kind: "product_asset", id })),
          ...modelRefIds.map((id) => ({ kind: "model_asset", id })),
        ],
        config,
      };
    });
    const { jobs: rows, created } = await enqueueJobs(ctx, jobs);
    if (created > 0) {
      check(await ctx.supabase.from("products").update({ status: "processing" }).eq("id", product.id).eq("organization_id", org), "Update product");
    }
    await audit({
      organizationId: org,
      actorId: ctx.userId,
      action: "photo_session.created",
      entityType: "product",
      entityId: product.id,
      metadata: { batchId, jobs: rows.length, created, locations: req.locations, randomModel: Boolean(persona), garmentType, engine: req.engine, model },
    });
    revalidatePath("/");
    revalidatePath("/jobs");
    return { batchId: rows[0]?.batch_id ?? batchId, jobCount: rows.length, created };
  });
}

const regenerateSchema = z.object({
  resultId: z.uuid(),
  note: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function regenerateResult(input: z.input<typeof regenerateSchema>): Promise<ActionResult<{ jobId: string }>> {
  return runAction("regenerateResult", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    const data = regenerateSchema.parse(input);
    const org = ctx.org.organizationId;
    const result = check(
      await ctx.supabase.from("generation_results").select("*").eq("id", data.resultId).eq("organization_id", org).maybeSingle(),
      "Load result",
    ) as ResultRow | null;
    if (!result) throw new UserFacingError("resultNotFound");
    const job = check(
      await ctx.supabase.from("generation_jobs").select("*").eq("id", result.job_id).eq("organization_id", org).single(),
      "Load job",
    ) as JobRow;
    if (job.job_type !== "image_generation" && job.job_type !== "model_portrait") {
      throw new UserFacingError("onlyImagesRegenerate");
    }
    const cfg = imageGenerationConfig();
    let config: Record<string, unknown> = job.config;
    if (job.job_type === "image_generation") {
      const parsed = imageJobConfigSchema.parse(job.config);
      config = { ...parsed, regenerationNote: data.note || null };
    } else if (data.note) {
      config = { ...job.config, instructions: data.note };
    }
    const { jobs } = await enqueueJobs(ctx, [
      {
        jobType: job.job_type,
        provider: cfg.provider,
        model: cfg.model,
        idempotencyKey: data.idempotencyKey,
        productId: job.product_id,
        modelProfileId: job.model_profile_id,
        batchId: job.batch_id,
        parentJobId: job.id,
        sourceResultId: result.id,
        inputAssetRefs: job.input_asset_refs,
        config,
      },
    ]);
    await audit({ organizationId: org, actorId: ctx.userId, action: "result.regenerated", entityType: "generation_result", entityId: result.id, metadata: { note: Boolean(data.note) } });
    revalidatePath("/jobs");
    return { jobId: jobs[0]?.id ?? "" };
  });
}

export async function retryJob(jobId: string): Promise<ActionResult<{ jobId: string }>> {
  return runAction("retryJob", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    const org = ctx.org.organizationId;
    const job = check(
      await ctx.supabase.from("generation_jobs").select("*").eq("id", z.uuid().parse(jobId)).eq("organization_id", org).maybeSingle(),
      "Load job",
    ) as JobRow | null;
    if (!job) throw new UserFacingError("jobNotFound");
    if (job.status !== "failed" && job.status !== "cancelled") throw new UserFacingError("onlyFailedRetry");
    const isImage = job.job_type === "image_generation" || job.job_type === "model_portrait";
    // Image retries use the currently configured image provider.
    const image = isImage ? imageGenerationConfig() : null;
    const model = image ? image.model : job.job_type === "video_generation" ? job.model : geminiConfig().analysisModel;
    const { jobs } = await enqueueJobs(ctx, [
      {
        jobType: job.job_type,
        provider: image ? image.provider : job.provider,
        model,
        idempotencyKey: `retry:${job.id}:${randomUUID()}`,
        productId: job.product_id,
        modelProfileId: job.model_profile_id,
        videoProjectId: job.video_project_id,
        batchId: job.batch_id,
        parentJobId: job.id,
        sourceResultId: job.source_result_id,
        inputAssetRefs: job.input_asset_refs,
        config: job.config,
      },
    ]);
    if (job.job_type === "video_generation" && job.video_project_id) {
      check(await ctx.supabase.from("video_projects").update({ status: "queued" }).eq("id", job.video_project_id).eq("organization_id", org), "Update project");
    }
    if (job.job_type === "product_analysis" && job.product_id) {
      check(await ctx.supabase.from("products").update({ analysis_status: "queued" }).eq("id", job.product_id).eq("organization_id", org), "Update product");
    }
    await audit({ organizationId: org, actorId: ctx.userId, action: "job.retried", entityType: "generation_job", entityId: job.id });
    revalidatePath("/jobs");
    return { jobId: jobs[0]?.id ?? "" };
  });
}

export async function cancelJob(jobId: string): Promise<ActionResult<{ status: string }>> {
  return runAction("cancelJob", async () => {
    const ctx = await requireOrgContext("editor");
    const id = z.uuid().parse(jobId);
    const status = check(await ctx.supabase.rpc("cancel_job", { p_job_id: id }), "Cancel job") as string;
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "job.cancel_requested", entityType: "generation_job", entityId: id, metadata: { status } });
    revalidatePath("/jobs");
    return { status };
  });
}

export async function reviewResults(input: z.input<typeof reviewInputSchema>): Promise<ActionResult<{ updated: number }>> {
  return runAction("reviewResults", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const data = reviewInputSchema.parse(input);
    const pending = data.decision === "pending";
    const rows = check(
      await ctx.supabase
        .from("generation_results")
        .update({
          review_status: data.decision,
          review_notes: data.notes ?? null,
          reviewed_by: pending ? null : ctx.userId,
          reviewed_at: pending ? null : new Date().toISOString(),
        })
        .eq("organization_id", ctx.org.organizationId)
        .in("id", data.resultIds)
        .select("id"),
      "Save review",
    ) as { id: string }[];
    await audit({
      organizationId: ctx.org.organizationId,
      actorId: ctx.userId,
      action: `result.${data.decision}`,
      entityType: "generation_result",
      entityId: data.resultIds.length === 1 ? data.resultIds[0] : null,
      metadata: { count: rows.length, ids: data.resultIds.slice(0, 50) },
    });
    revalidatePath("/review");
    revalidatePath("/library");
    for (const id of data.resultIds.slice(0, 20)) revalidatePath(`/results/${id}`);
    return { updated: rows.length };
  });
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
export type PresetFormState = { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> } | null;

function presetFromForm(formData: FormData) {
  return presetInputSchema.parse({
    name: formData.get("name"),
    category: formData.get("category"),
    description: formData.get("description") ?? undefined,
    config: {
      shotType: formData.get("shotType"),
      pose: formData.get("pose") ?? "",
      cameraAngle: formData.get("cameraAngle") ?? "",
      framing: formData.get("framing"),
      background: formData.get("background") ?? "",
      lighting: formData.get("lighting") ?? "",
      aspectRatio: formData.get("aspectRatio"),
      imageSize: formData.get("imageSize"),
      variations: formData.get("variations"),
      creativeInstructions: formData.get("creativeInstructions") ?? "",
    },
  });
}

export async function savePreset(presetId: string | null, _prev: PresetFormState, formData: FormData): Promise<PresetFormState> {
  try {
    const ctx = await requireOrgContext("editor");
    const input = presetFromForm(formData);
    const org = ctx.org.organizationId;
    if (presetId) {
      const rows = check(
        await ctx.supabase.from("shoot_presets").update(input).eq("id", z.uuid().parse(presetId)).eq("organization_id", org).select("id"),
        "Update preset",
      ) as { id: string }[];
      if (!rows.length) throw new UserFacingError("presetReadOnly");
    } else {
      check(await ctx.supabase.from("shoot_presets").insert({ ...input, organization_id: org, created_by: ctx.userId }), "Create preset");
    }
    await audit({ organizationId: org, actorId: ctx.userId, action: presetId ? "preset.updated" : "preset.created", entityType: "shoot_preset", entityId: presetId });
    revalidatePath("/presets");
    return { ok: true, message: (await getI18n()).d.presets.saved };
  } catch (error) {
    return toActionError(error, "savePreset");
  }
}

export async function deletePreset(presetId: string): Promise<ActionResult> {
  return runAction("deletePreset", async () => {
    const ctx = await requireOrgContext("editor");
    const rows = check(
      await ctx.supabase.from("shoot_presets").delete().eq("id", z.uuid().parse(presetId)).eq("organization_id", ctx.org.organizationId).select("id"),
      "Delete preset",
    ) as { id: string }[];
    if (!rows.length) throw new UserFacingError("presetReadOnly");
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "preset.deleted", entityType: "shoot_preset", entityId: presetId });
    revalidatePath("/presets");
    return undefined;
  });
}

const dismissSchema = z.object({ jobIds: z.array(z.uuid()).max(200).optional(), allFailed: z.boolean().default(false) });

/**
 * Hide failed/cancelled generation jobs from the create canvas. Rows are kept
 * for history and cost reporting. Users cannot update jobs directly (RLS), so
 * this runs with the service role after the editor check, scoped to the org.
 */
export async function dismissJobs(input: z.input<typeof dismissSchema>): Promise<ActionResult<{ dismissed: number }>> {
  return runAction("dismissJobs", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const data = dismissSchema.parse(input);
    if (!data.allFailed && !data.jobIds?.length) return { dismissed: 0 };
    const org = ctx.org.organizationId;
    let query = getSupabaseAdmin()
      .from("generation_jobs")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("organization_id", org)
      .in("status", ["failed", "cancelled"])
      .is("dismissed_at", null);
    if (!data.allFailed) query = query.in("id", data.jobIds ?? []);
    const rows = check(await query.select("id"), "Dismiss jobs") as { id: string }[];
    await audit({ organizationId: org, actorId: ctx.userId, action: "jobs.dismissed", entityType: "generation_job", entityId: rows[0]?.id ?? null, metadata: { count: rows.length, allFailed: data.allFailed } });
    revalidatePath("/");
    return { dismissed: rows.length };
  });
}

/** Short-lived download link for the stored original (2K/4K) of one result. */
export async function getResultDownloadUrl(resultId: string): Promise<ActionResult<{ url: string }>> {
  return runAction("getResultDownloadUrl", async () => {
    const ctx = await requireOrgContext("viewer");
    const result = check(
      await ctx.supabase
        .from("generation_results")
        .select("id, storage_path, mime_type, shot_type, products(sku)")
        .eq("id", z.uuid().parse(resultId))
        .eq("organization_id", ctx.org.organizationId)
        .maybeSingle(),
      "Load result",
    ) as { id: string; storage_path: string; mime_type: string; shot_type: string | null; products: { sku: string } | null } | null;
    if (!result) throw new UserFacingError("resultNotFound");
    const fileName = exportFileName({ sku: result.products?.sku ?? null, shotType: result.shot_type, id: result.id, mimeType: result.mime_type });
    const { data, error } = await ctx.supabase.storage.from(BUCKET).createSignedUrl(result.storage_path, 300, { download: fileName });
    if (error || !data?.signedUrl) throw new Error(`Signing download failed: ${error?.message ?? "no url"}`);
    return { url: data.signedUrl };
  });
}

const deleteResultsSchema = z.object({ resultIds: z.array(z.uuid()).min(1).max(100) });

/**
 * Permanently delete generated results and their files. Admins only (the
 * RLS policy on generation_results); usage and audit history are kept.
 */
export async function deleteResults(input: z.input<typeof deleteResultsSchema>): Promise<ActionResult<{ deleted: number }>> {
  return runAction("deleteResults", async () => {
    const ctx = await requireOrgContext("admin");
    await enforceRateLimit("mutate", ctx.userId);
    const { resultIds } = deleteResultsSchema.parse(input);
    const org = ctx.org.organizationId;
    const rows = check(
      await ctx.supabase.from("generation_results").delete().eq("organization_id", org).in("id", resultIds).select("id, storage_path, thumbnail_path"),
      "Delete results",
    ) as { id: string; storage_path: string; thumbnail_path: string | null }[];
    await removeObjects(rows.flatMap((r) => [r.storage_path, r.thumbnail_path ?? ""]));
    await audit({ organizationId: org, actorId: ctx.userId, action: "results.deleted", entityType: "generation_result", entityId: rows[0]?.id ?? null, metadata: { count: rows.length } });
    revalidatePath("/");
    revalidatePath("/library");
    return { deleted: rows.length };
  });
}
