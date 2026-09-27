"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AssetRole } from "@/lib/domain/schemas";
import { createUploadTarget, finalizeProductAsset } from "@/server/actions/products";
import { finalizeModelAsset } from "@/server/actions/models";

export type UploadOutcome = { ok: true; warning: string | null } | { ok: false; error: string };

/** Longest edge sent to the server; larger phone photos are downscaled in the browser. */
const MAX_UPLOAD_EDGE = 2560;
const REENCODE_ABOVE_BYTES = 3 * 1024 * 1024;

export class UnreadableFileError extends Error {}

/**
 * Read the photo in the browser before uploading. This fails fast (with a
 * clear error) for files the browser cannot read, e.g. cloud-only photos
 * picked on Android, and shrinks large camera photos so uploads on mobile
 * networks are small and reliable. EXIF orientation is applied.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UnreadableFileError(file.name);
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_UPLOAD_EDGE && file.size <= REENCODE_ABOVE_BYTES) return file;
    const scale = Math.min(1, MAX_UPLOAD_EDGE / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    // Re-encoding only for size must actually make the file smaller.
    if (scale === 1 && blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/**
 * 1) ask the server for a signed upload URL (authorization + declared type/size check)
 * 2) upload bytes directly from the browser to private storage
 * 3) ask the server to validate the real bytes, hash, thumbnail and register the asset
 */
export async function uploadFile(
  target: "products" | "models",
  entityId: string,
  file: File,
  role: AssetRole,
  onPhase?: (phase: "uploading" | "processing") => void,
  storageErrorTemplate = "Upload failed: {message}",
  unreadableMessage = "The photo could not be read. Choose a photo saved on this device.",
): Promise<UploadOutcome> {
  onPhase?.("uploading");
  try {
    file = await prepareImageForUpload(file);
  } catch (error) {
    if (error instanceof UnreadableFileError) return { ok: false, error: unreadableMessage };
    throw error;
  }
  const t = await createUploadTarget({ target, entityId, fileName: file.name, size: file.size, mimeType: file.type });
  if (!t.ok) return { ok: false, error: t.error };
  const supabase = createSupabaseBrowserClient();
  const put = () => supabase.storage.from(t.data.bucket).uploadToSignedUrl(t.data.path, t.data.token, file, { contentType: file.type });
  let { error } = await put().catch((e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) }));
  // One retry for transient network failures (common on mobile connections).
  if (error) ({ error } = await put().catch((e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) })));
  if (error) return { ok: false, error: storageErrorTemplate.replace("{message}", error.message) };
  onPhase?.("processing");
  const res =
    target === "products"
      ? await finalizeProductAsset({ productId: entityId, path: t.data.path, role, originalFilename: file.name })
      : await finalizeModelAsset({ modelId: entityId, path: t.data.path, originalFilename: file.name });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, warning: res.data.duplicate };
}

/** Run async tasks with bounded concurrency. */
export async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++] as T;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
