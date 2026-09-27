"use server";

import { getI18n } from "@/lib/i18n/server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { IMAGE_ASPECT_RATIOS, IMAGE_SIZES, modelProfileInputSchema } from "@/lib/domain/schemas";
import { imageGenerationConfig } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, ModelAssetRow, ResultRow } from "@/lib/types";
import { requireOrgContext } from "../context";
import { UserFacingError, check, runAction, toActionError } from "../action";
import { enforceRateLimit } from "../rate-limit";
import { audit } from "../audit";
import { assertUploadPath, downloadObject, paths, processImage, removeObjects, uploadObject } from "../storage";
import { enqueueJobs } from "../jobs/enqueue";

export type ModelFormState = { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> } | null;

function modelFromForm(formData: FormData) {
  const input = modelProfileInputSchema.parse({
    code: formData.get("code"),
    displayName: formData.get("displayName"),
    description: formData.get("description") ?? undefined,
    hair: formData.get("hair") ?? undefined,
    eyes: formData.get("eyes") ?? undefined,
    skinTone: formData.get("skinTone") ?? undefined,
    build: formData.get("build") ?? undefined,
    ageRange: formData.get("ageRange") ?? undefined,
    stylingNotes: formData.get("stylingNotes") ?? undefined,
    preferredLighting: formData.get("preferredLighting") ?? undefined,
    photographyStyle: formData.get("photographyStyle") ?? undefined,
    status: formData.get("status") ?? undefined,
    adultConfirmed: formData.get("adultConfirmed") === "on",
    consentNotes: formData.get("consentNotes") ?? undefined,
  });
  return {
    code: input.code,
    display_name: input.displayName,
    description: input.description,
    appearance: { hair: input.hair, eyes: input.eyes, skin_tone: input.skinTone, build: input.build, age_range: input.ageRange },
    styling_notes: input.stylingNotes,
    preferred_lighting: input.preferredLighting,
    photography_style: input.photographyStyle,
    status: input.status,
    adult_confirmed: input.adultConfirmed,
    consent_notes: input.consentNotes,
  };
}

export async function createModelProfile(_prev: ModelFormState, formData: FormData): Promise<ModelFormState> {
  let id: string;
  try {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const row = check(
      await ctx.supabase
        .from("model_profiles")
        .insert({ ...modelFromForm(formData), organization_id: ctx.org.organizationId, created_by: ctx.userId })
        .select("id")
        .single(),
      "Create model profile",
    ) as { id: string };
    id = row.id;
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "model_profile.created", entityType: "model_profile", entityId: id });
  } catch (error) {
    return toActionError(error, "createModelProfile");
  }
  revalidatePath("/models");
  redirect(`/models/${id}`);
}

export async function updateModelProfile(modelId: string, _prev: ModelFormState, formData: FormData): Promise<ModelFormState> {
  try {
    const ctx = await requireOrgContext("editor");
    const rows = check(
      await ctx.supabase
        .from("model_profiles")
        .update(modelFromForm(formData))
        .eq("id", z.uuid().parse(modelId))
        .eq("organization_id", ctx.org.organizationId)
        .select("id"),
      "Update model profile",
    ) as { id: string }[];
    if (!rows.length) throw new UserFacingError("modelNotFound");
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "model_profile.updated", entityType: "model_profile", entityId: modelId });
    revalidatePath(`/models/${modelId}`);
    revalidatePath("/models");
    return { ok: true, message: (await getI18n()).d.models.saved };
  } catch (error) {
    return toActionError(error, "updateModelProfile");
  }
}

const finalizeSchema = z.object({ modelId: z.uuid(), path: z.string().max(300), originalFilename: z.string().max(255) });

export async function finalizeModelAsset(
  input: z.input<typeof finalizeSchema>,
): Promise<ActionResult<{ asset: ModelAssetRow; duplicate: string | null }>> {
  return runAction("finalizeModelAsset", async () => {
    const ctx = await requireOrgContext("editor");
    const data = finalizeSchema.parse(input);
    const org = ctx.org.organizationId;
    assertUploadPath(data.path, org, "models", data.modelId);
    const bytes = await downloadObject(data.path).catch(() => {
      throw new UserFacingError("uploadNotFound");
    });
    let processed;
    try {
      processed = await processImage(bytes);
    } catch (error) {
      await removeObjects([data.path]);
      throw error;
    }
    const existing = check(
      await ctx.supabase.from("model_profile_assets").select("id").eq("model_profile_id", data.modelId).eq("sha256", processed.sha256).limit(1),
      "Duplicate check",
    ) as { id: string }[];
    if (existing.length) {
      await removeObjects([data.path]);
      throw new UserFacingError("duplicateModelRef");
    }
    const thumbPath = paths.thumbnailFor(data.path);
    await uploadObject(thumbPath, processed.thumbnail, "image/webp");
    const { count } = await ctx.supabase
      .from("model_profile_assets")
      .select("id", { count: "exact", head: true })
      .eq("model_profile_id", data.modelId);
    const asset = check(
      await ctx.supabase
        .from("model_profile_assets")
        .insert({
          organization_id: org,
          model_profile_id: data.modelId,
          storage_path: data.path,
          thumbnail_path: thumbPath,
          mime_type: processed.mimeType,
          size_bytes: processed.sizeBytes,
          width: processed.width,
          height: processed.height,
          sha256: processed.sha256,
          source: "upload",
          is_primary: (count ?? 0) === 0,
          created_by: ctx.userId,
        })
        .select("*")
        .single(),
      "Save model asset",
    ) as ModelAssetRow;
    await audit({ organizationId: org, actorId: ctx.userId, action: "model_asset.uploaded", entityType: "model_profile_asset", entityId: asset.id, metadata: { modelId: data.modelId } });
    revalidatePath(`/models/${data.modelId}`);
    return { asset, duplicate: null };
  });
}

export async function deleteModelAsset(assetId: string): Promise<ActionResult> {
  return runAction("deleteModelAsset", async () => {
    const ctx = await requireOrgContext("editor");
    const rows = check(
      await ctx.supabase
        .from("model_profile_assets")
        .delete()
        .eq("id", z.uuid().parse(assetId))
        .eq("organization_id", ctx.org.organizationId)
        .select("model_profile_id, storage_path, thumbnail_path"),
      "Delete model asset",
    ) as { model_profile_id: string; storage_path: string; thumbnail_path: string | null }[];
    const row = rows[0];
    if (!row) throw new UserFacingError("imageNotFound");
    await removeObjects([row.storage_path, row.thumbnail_path ?? ""]);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "model_asset.deleted", entityType: "model_profile_asset", entityId: assetId });
    revalidatePath(`/models/${row.model_profile_id}`);
    return undefined;
  });
}

export async function setPrimaryModelAsset(modelId: string, assetId: string): Promise<ActionResult> {
  return runAction("setPrimaryModelAsset", async () => {
    const ctx = await requireOrgContext("editor");
    const org = ctx.org.organizationId;
    const mid = z.uuid().parse(modelId);
    check(await ctx.supabase.from("model_profile_assets").update({ is_primary: false }).eq("model_profile_id", mid).eq("organization_id", org), "Reset primary");
    check(
      await ctx.supabase.from("model_profile_assets").update({ is_primary: true }).eq("id", z.uuid().parse(assetId)).eq("model_profile_id", mid).eq("organization_id", org),
      "Set primary",
    );
    revalidatePath(`/models/${mid}`);
    return undefined;
  });
}

const portraitSchema = z.object({
  modelId: z.uuid(),
  instructions: z.string().trim().max(2000).default(""),
  referenceAssetIds: z.array(z.uuid()).max(6).default([]),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).default("3:4"),
  imageSize: z.enum(IMAGE_SIZES).default("1K"),
  idempotencyKey: z.string().min(8).max(100),
});

export async function requestModelPortrait(input: z.input<typeof portraitSchema>): Promise<ActionResult<{ jobId: string }>> {
  return runAction("requestModelPortrait", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("generate", ctx.userId);
    const data = portraitSchema.parse(input);
    const cfg = imageGenerationConfig();
    const profile = check(
      await ctx.supabase.from("model_profiles").select("id, status").eq("id", data.modelId).eq("organization_id", ctx.org.organizationId).maybeSingle(),
      "Load model",
    ) as { id: string; status: string } | null;
    if (!profile) throw new UserFacingError("modelNotFound");
    if (profile.status === "retired") throw new UserFacingError("modelRetired");
    const { jobs } = await enqueueJobs(ctx, [
      {
        jobType: "model_portrait",
        provider: cfg.provider,
        model: cfg.model,
        idempotencyKey: data.idempotencyKey,
        modelProfileId: data.modelId,
        inputAssetRefs: data.referenceAssetIds.map((id) => ({ kind: "model_asset", id })),
        config: {
          kind: "model_portrait",
          aspectRatio: data.aspectRatio,
          imageSize: data.imageSize,
          instructions: data.instructions,
          modelReferenceAssetIds: data.referenceAssetIds,
        },
      },
    ]);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "model_profile.portrait_requested", entityType: "model_profile", entityId: data.modelId });
    revalidatePath(`/models/${data.modelId}`);
    return { jobId: jobs[0]?.id ?? "" };
  });
}

/** Copy an approved generated image into the model's reference set. */
export async function promoteResultToModelReference(resultId: string): Promise<ActionResult> {
  return runAction("promoteResultToModelReference", async () => {
    const ctx = await requireOrgContext("editor");
    const org = ctx.org.organizationId;
    const result = check(
      await ctx.supabase.from("generation_results").select("*").eq("id", z.uuid().parse(resultId)).eq("organization_id", org).maybeSingle(),
      "Load result",
    ) as ResultRow | null;
    if (!result || result.kind !== "image") throw new UserFacingError("imageNotFound");
    if (!result.model_profile_id) throw new UserFacingError("notLinkedToModel");
    if (result.review_status !== "approved") throw new UserFacingError("approveBeforePromote");

    const bytes = await downloadObject(result.storage_path);
    const processed = await processImage(bytes, { enforceMinSize: false });
    const dest = paths.modelSource(org, result.model_profile_id, processed.mimeType);
    const thumb = paths.thumbnailFor(dest);
    await uploadObject(dest, bytes, processed.mimeType);
    await uploadObject(thumb, processed.thumbnail, "image/webp");
    check(
      await ctx.supabase.from("model_profile_assets").insert({
        organization_id: org,
        model_profile_id: result.model_profile_id,
        storage_path: dest,
        thumbnail_path: thumb,
        mime_type: processed.mimeType,
        size_bytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        source: "generated",
        source_result_id: result.id,
        created_by: ctx.userId,
      }),
      "Save model reference",
    );
    await audit({ organizationId: org, actorId: ctx.userId, action: "model_asset.promoted", entityType: "generation_result", entityId: result.id });
    revalidatePath(`/models/${result.model_profile_id}`);
    return undefined;
  });
}

const quickModelSchema = z.object({
  name: z.string().trim().max(120).optional(),
  adultConfirmed: z.literal(true),
  consentConfirmed: z.literal(true),
});

/**
 * Creates a model profile when a model photo is uploaded from the create
 * composer. The uploader must confirm the person is an adult and consented.
 */
export async function quickCreateModel(input: z.input<typeof quickModelSchema>): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction("quickCreateModel", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const data = quickModelSchema.parse(input);
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const name = data.name || `Model ${suffix}`;
    const row = check(
      await ctx.supabase
        .from("model_profiles")
        .insert({
          code: `M-${suffix}-${randomUUID().slice(0, 4).toUpperCase()}`,
          display_name: name,
          appearance: {},
          status: "active",
          adult_confirmed: true,
          consent_notes: `Uploader confirmed adult (18+) and consent to use the likeness (studio composer, ${new Date().toISOString()}).`,
          organization_id: ctx.org.organizationId,
          created_by: ctx.userId,
        })
        .select("id")
        .single(),
      "Create model profile",
    ) as { id: string };
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "model_profile.created", entityType: "model_profile", entityId: row.id, metadata: { quick: true } });
    revalidatePath("/models");
    return { id: row.id, name };
  });
}

/** Same as discardEmptyProduct, for quick-added model profiles. */
export async function discardEmptyModel(modelId: string): Promise<ActionResult> {
  return runAction("discardEmptyModel", async () => {
    const ctx = await requireOrgContext("editor");
    const id = z.uuid().parse(modelId);
    const org = ctx.org.organizationId;
    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("model_profile_assets").select("id", { count: "exact", head: true }).eq("model_profile_id", id).eq("organization_id", org);
    if ((count ?? 0) > 0) return undefined;
    check(
      await admin.from("model_profiles").delete().eq("id", id).eq("organization_id", org).eq("created_by", ctx.userId).gte("created_at", since),
      "Discard model",
    );
    return undefined;
  });
}

const saveResultModelSchema = z.object({ resultId: z.uuid(), name: z.string().trim().max(120).optional() });

/**
 * Saves the (fictional, AI-generated) person in a generated photo as a model
 * profile, with that photo as its primary identity reference, so future
 * shoots can reuse the same model.
 */
export async function saveResultAsModel(input: z.input<typeof saveResultModelSchema>): Promise<ActionResult<{ id: string; name: string }>> {
  return runAction("saveResultAsModel", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const data = saveResultModelSchema.parse(input);
    const org = ctx.org.organizationId;
    const result = check(
      await ctx.supabase.from("generation_results").select("*").eq("id", data.resultId).eq("organization_id", org).maybeSingle(),
      "Load result",
    ) as ResultRow | null;
    if (!result || result.kind !== "image") throw new UserFacingError("imageNotFound");
    // Photos of an existing profile already belong to that model.
    if (result.model_profile_id) throw new UserFacingError("resultHasModel");

    const persona = typeof result.settings?.modelPersona === "string" ? result.settings.modelPersona : null;
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const name = data.name || `Model ${suffix}`;
    const profile = check(
      await ctx.supabase
        .from("model_profiles")
        .insert({
          code: `AI-${suffix}-${randomUUID().slice(0, 4).toUpperCase()}`,
          display_name: name,
          description: persona,
          appearance: {},
          status: "active",
          // Generated people are fictional adults: every generation prompt requires 21+.
          adult_confirmed: true,
          consent_notes: `Fictional AI-generated model saved from generated result ${result.id}.`,
          organization_id: org,
          created_by: ctx.userId,
        })
        .select("id")
        .single(),
      "Create model profile",
    ) as { id: string };

    const bytes = await downloadObject(result.storage_path);
    const processed = await processImage(bytes, { enforceMinSize: false });
    const dest = paths.modelSource(org, profile.id, processed.mimeType);
    const thumb = paths.thumbnailFor(dest);
    await uploadObject(dest, bytes, processed.mimeType);
    await uploadObject(thumb, processed.thumbnail, "image/webp");
    check(
      await ctx.supabase.from("model_profile_assets").insert({
        organization_id: org,
        model_profile_id: profile.id,
        storage_path: dest,
        thumbnail_path: thumb,
        mime_type: processed.mimeType,
        size_bytes: processed.sizeBytes,
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        is_primary: true,
        source: "generated",
        source_result_id: result.id,
        created_by: ctx.userId,
      }),
      "Save model reference",
    );
    await audit({ organizationId: org, actorId: ctx.userId, action: "model_profile.created", entityType: "model_profile", entityId: profile.id, metadata: { fromResult: result.id } });
    revalidatePath("/models");
    revalidatePath("/");
    return { id: profile.id, name };
  });
}
