import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProviderError } from "@/lib/domain/jobs";
import type { ProductAnalysis } from "@/lib/domain/analysis";
import type { ModelContext, ProductContext } from "@/lib/domain/prompts";
import type { BinaryImage } from "@/lib/providers/types";
import type { JobRow, ModelAssetRow, ModelProfileRow, ProductAssetRow, ProductRow, ResultRow } from "@/lib/types";
import { downloadObject, paths, processImage, uploadObject } from "../../storage";

/** Longest side sent to providers; keeps requests well under inline size limits. */
const REFERENCE_MAX_SIDE = 2048;

export function permanent(message: string, code: string): ProviderError {
  return new ProviderError(message, "permanent", code);
}

/** Downscale + normalise a reference image for provider input. */
export async function prepareReference(bytes: Buffer): Promise<BinaryImage> {
  const data = await sharp(bytes)
    .rotate()
    .resize(REFERENCE_MAX_SIDE, REFERENCE_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { mimeType: "image/jpeg", data };
}

export async function loadProduct(admin: SupabaseClient, job: JobRow): Promise<ProductRow> {
  if (!job.product_id) throw permanent("Job has no product.", "invalid_job");
  const { data, error } = await admin
    .from("products")
    .select("*")
    .eq("id", job.product_id)
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (error) throw new Error(`Load product failed: ${error.message}`);
  if (!data) throw permanent("Product no longer exists.", "not_found");
  return data as ProductRow;
}

export function productContext(product: ProductRow): ProductContext {
  return {
    sku: product.sku,
    title: product.title,
    category: product.category,
    color: product.color,
    description: product.description,
    verifiedAttributes: product.verified_attributes,
    aiAnalysis: (product.ai_analysis as ProductAnalysis | null) ?? null,
  };
}

/** Load product assets, verifying each belongs to this organization AND product. */
export async function loadProductAssets(
  admin: SupabaseClient,
  job: JobRow,
  productId: string,
  assetIds: string[] | null,
): Promise<ProductAssetRow[]> {
  let query = admin
    .from("product_assets")
    .select("*")
    .eq("organization_id", job.organization_id)
    .eq("product_id", productId)
    .order("created_at", { ascending: true });
  if (assetIds) query = query.in("id", assetIds);
  const { data, error } = await query;
  if (error) throw new Error(`Load product assets failed: ${error.message}`);
  const rows = (data ?? []) as ProductAssetRow[];
  if (assetIds && rows.length !== new Set(assetIds).size) {
    throw permanent("One or more reference images were deleted or do not belong to this product.", "reference_missing");
  }
  if (!rows.length) throw permanent("The product has no reference images.", "reference_missing");
  // Preserve the requested order.
  if (assetIds) rows.sort((a, b) => assetIds.indexOf(a.id) - assetIds.indexOf(b.id));
  return rows;
}

export async function loadModelProfile(
  admin: SupabaseClient,
  job: JobRow,
  modelProfileId: string | null,
): Promise<ModelProfileRow | null> {
  if (!modelProfileId) return null;
  const { data, error } = await admin
    .from("model_profiles")
    .select("*")
    .eq("id", modelProfileId)
    .eq("organization_id", job.organization_id)
    .maybeSingle();
  if (error) throw new Error(`Load model profile failed: ${error.message}`);
  if (!data) throw permanent("Model profile no longer exists.", "not_found");
  const profile = data as ModelProfileRow;
  if (!profile.adult_confirmed) throw permanent("Model profile is not confirmed as an adult.", "policy");
  if (profile.status === "retired") throw permanent("Model profile is retired.", "policy");
  return profile;
}

export async function loadModelAssets(
  admin: SupabaseClient,
  job: JobRow,
  modelProfileId: string,
  assetIds: string[],
): Promise<ModelAssetRow[]> {
  if (!assetIds.length) return [];
  const { data, error } = await admin
    .from("model_profile_assets")
    .select("*")
    .eq("organization_id", job.organization_id)
    .eq("model_profile_id", modelProfileId)
    .in("id", assetIds);
  if (error) throw new Error(`Load model assets failed: ${error.message}`);
  const rows = (data ?? []) as ModelAssetRow[];
  if (rows.length !== new Set(assetIds).size) {
    throw permanent("One or more model reference images were deleted.", "reference_missing");
  }
  rows.sort((a, b) => assetIds.indexOf(a.id) - assetIds.indexOf(b.id));
  return rows;
}

export function modelContext(profile: ModelProfileRow): ModelContext {
  return {
    code: profile.code,
    displayName: profile.display_name,
    description: profile.description,
    appearance: profile.appearance ?? {},
    stylingNotes: profile.styling_notes,
    preferredLighting: profile.preferred_lighting,
    photographyStyle: profile.photography_style,
  };
}

export async function downloadReferences(admin: SupabaseClient, storagePaths: string[]): Promise<BinaryImage[]> {
  return Promise.all(storagePaths.map(async (p) => prepareReference(await downloadObject(p, admin))));
}

/** Persist a generated image (original bytes + thumbnail) and its result row. */
export async function storeGeneratedImage(
  admin: SupabaseClient,
  job: JobRow,
  image: BinaryImage,
  row: Partial<ResultRow> & Pick<ResultRow, "provider" | "model">,
): Promise<ResultRow> {
  const processed = await processImage(image.data, { enforceMinSize: false });
  const storagePath = paths.result(job.organization_id, job.id, processed.mimeType);
  const thumbPath = paths.thumbnailFor(storagePath);
  await uploadObject(storagePath, image.data, processed.mimeType);
  await uploadObject(thumbPath, processed.thumbnail, "image/webp");
  const { data, error } = await admin
    .from("generation_results")
    .insert({
      organization_id: job.organization_id,
      job_id: job.id,
      kind: "image",
      storage_path: storagePath,
      thumbnail_path: thumbPath,
      mime_type: processed.mimeType,
      size_bytes: processed.sizeBytes,
      width: processed.width,
      height: processed.height,
      ...row,
    })
    .select("*")
    .single();
  if (error) throw new Error(`Saving generation result failed: ${error.message}`);
  return data as ResultRow;
}

/** Long edge delivered for each requested size when the provider returns less. */
const TARGET_LONG_EDGE: Record<string, number> = { "4K": 3840 };

/**
 * When a size is requested that the model cannot produce natively (e.g. 4K
 * from a model capped near 2K), upscale with Lanczos resampling. This adds
 * pixels, not detail; results record `upscaled: true`.
 */
export async function upscaleIfNeeded(image: BinaryImage, imageSize: string): Promise<{ image: BinaryImage; upscaled: boolean }> {
  const target = TARGET_LONG_EDGE[imageSize];
  if (!target) return { image, upscaled: false };
  const meta = await sharp(image.data).metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!longest || longest >= target * 0.9) return { image, upscaled: false };
  const scale = target / longest;
  const data = await sharp(image.data)
    .resize({ width: Math.round((meta.width ?? 0) * scale), height: Math.round((meta.height ?? 0) * scale), kernel: "lanczos3" })
    .sharpen({ sigma: 0.6 })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return { image: { data, mimeType: "image/jpeg" }, upscaled: true };
}

/**
 * Casting: store a generated portrait as a model reference (primary when the
 * profile has none) and activate the profile, so shoots keep this identity.
 */
export async function saveCastingReference(admin: SupabaseClient, job: JobRow, modelId: string, image: BinaryImage, resultId: string): Promise<void> {
  const processed = await processImage(image.data, { enforceMinSize: false });
  const dest = paths.modelSource(job.organization_id, modelId, processed.mimeType);
  const thumb = paths.thumbnailFor(dest);
  await uploadObject(dest, image.data, processed.mimeType);
  await uploadObject(thumb, processed.thumbnail, "image/webp");
  const { count } = await admin
    .from("model_profile_assets")
    .select("id", { count: "exact", head: true })
    .eq("model_profile_id", modelId)
    .eq("organization_id", job.organization_id);
  const { error } = await admin.from("model_profile_assets").insert({
    organization_id: job.organization_id,
    model_profile_id: modelId,
    storage_path: dest,
    thumbnail_path: thumb,
    mime_type: processed.mimeType,
    size_bytes: processed.sizeBytes,
    width: processed.width,
    height: processed.height,
    sha256: processed.sha256,
    is_primary: (count ?? 0) === 0,
    source: "generated",
    source_result_id: resultId,
    created_by: job.created_by,
  });
  if (error) throw new Error(`Saving casting reference failed: ${error.message}`);
  await admin.from("model_profiles").update({ status: "active" }).eq("id", modelId).eq("organization_id", job.organization_id).eq("status", "draft");
}

/**
 * Heuristic face close-up from a model photo: the upper part of the frame,
 * square-cropped around the most salient region (sharp's "attention"
 * strategy favours skin tones and detail). Not face detection; it helps the
 * model keep identity when the reference is a full-body shot.
 */
export async function faceCloseUp(image: BinaryImage): Promise<BinaryImage | null> {
  try {
    const rotated = await sharp(image.data).rotate().toBuffer();
    const meta = await sharp(rotated).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return null;
    // Portrait-like frames (face fills the image) need less cropping than full-body ones.
    const top = height > width * 1.2 ? Math.round(height * 0.5) : height;
    const data = await sharp(rotated)
      .extract({ left: 0, top: 0, width, height: Math.max(1, top) })
      .resize(768, 768, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { data, mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
