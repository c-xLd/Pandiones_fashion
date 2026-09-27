import "server-only";
import { createHash, randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { EXTENSION_FOR_MIME, validateImageBytes } from "@/lib/domain/files";
import { UserFacingError } from "./errors";

export const BUCKET = "studio-assets";
export const SIGNED_URL_TTL_SECONDS = 60 * 30;
export const THUMBNAIL_MAX = 512;

/** All object keys are "<organizationId>/..." (enforced by storage RLS and table checks). */
export const paths = {
  productSource: (org: string, productId: string, mime: string) =>
    `${org}/products/${productId}/source/${randomUUID()}.${EXTENSION_FOR_MIME[mime] ?? "bin"}`,
  modelSource: (org: string, modelId: string, mime: string) =>
    `${org}/models/${modelId}/source/${randomUUID()}.${EXTENSION_FOR_MIME[mime] ?? "bin"}`,
  result: (org: string, jobId: string, mime: string) =>
    `${org}/results/${jobId}/${randomUUID()}.${EXTENSION_FOR_MIME[mime] ?? "bin"}`,
  thumbnailFor: (path: string) => path.replace(/\.[a-z0-9]+$/i, "") + ".thumb.webp",
};

/** Upload paths must be issued for the caller's organization and target entity. */
export function assertUploadPath(path: string, org: string, kind: "products" | "models", entityId: string): void {
  const pattern = new RegExp(
    `^${org}/${kind}/${entityId}/source/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
  );
  if (!pattern.test(path)) throw new UserFacingError("invalidUploadPath");
}

export async function downloadObject(path: string, client: SupabaseClient = getSupabaseAdmin()): Promise<Buffer> {
  const { data, error } = await client.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed for ${path}: ${error?.message ?? "no data"}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadObject(path: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .upload(path, data, { contentType, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
}

export async function removeObjects(pathsToRemove: string[]): Promise<void> {
  const list = pathsToRemove.filter(Boolean);
  if (!list.length) return;
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(list);
  if (error) console.error("[storage] remove failed", { count: list.length, error: error.message });
}

export interface ProcessedImage {
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  thumbnail: Buffer;
}

/** Validate real bytes, read dimensions and build a WebP thumbnail. */
export async function processImage(bytes: Buffer, opts: { enforceMinSize?: boolean } = {}): Promise<ProcessedImage> {
  const basic = validateImageBytes(bytes);
  if (!basic.ok) throw new UserFacingError(basic.error, basic.vars);
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: 12_000 * 12_000 }).metadata();
  } catch {
    throw new UserFacingError("imageUndecodable");
  }
  // EXIF orientations 5–8 swap width and height.
  const rotated = (meta.orientation ?? 1) >= 5;
  const width = (rotated ? meta.height : meta.width) ?? 0;
  const height = (rotated ? meta.width : meta.height) ?? 0;
  if (opts.enforceMinSize !== false) {
    const withDims = validateImageBytes(bytes, { width, height });
    if (!withDims.ok) throw new UserFacingError(withDims.error, withDims.vars);
  }
  const thumbnail = await sharp(bytes)
    .rotate()
    .resize(THUMBNAIL_MAX, THUMBNAIL_MAX, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return {
    mimeType: basic.mimeType,
    sizeBytes: bytes.byteLength,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    thumbnail,
  };
}

/**
 * Signed URLs are created with the USER's client so storage RLS decides
 * access; a path from another organization simply yields no URL.
 */
export async function signUrls(
  client: SupabaseClient,
  objectPaths: (string | null | undefined)[],
  opts: { download?: boolean } = {},
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(objectPaths.filter((p): p is string => Boolean(p))));
  if (!unique.length) return {};
  const out: Record<string, string> = {};
  // createSignedUrls accepts batches; keep them moderate.
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS, opts.download ? { download: true } : undefined);
    if (error) {
      console.error("[storage] createSignedUrls failed", { error: error.message });
      continue;
    }
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) out[item.path] = item.signedUrl;
    }
  }
  return out;
}
