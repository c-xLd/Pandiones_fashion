"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AssetRole } from "@/lib/domain/schemas";
import { createUploadTarget, finalizeProductAsset, finalizeReferenceImage } from "@/server/actions/products";
import { finalizeModelAsset } from "@/server/actions/models";

export type UploadOutcome = { ok: true; warning: string | null; path?: string; thumbnailPath?: string; width?: number; height?: number } | { ok: false; error: string };

/** Longest edge sent to the server; larger phone photos are downscaled in the browser. */
const MAX_UPLOAD_EDGE = 2560;
const REENCODE_ABOVE_BYTES = 3 * 1024 * 1024;

export class UnreadableFileError extends Error {}

/** True when the browser can read the file's bytes (cloud-only files cannot). */
async function isReadable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 64).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

function jpegName(name: string): string {
  return name.replace(/\.[^.]+$/, "") + ".jpg";
}

/** Draw a decoded image onto a canvas at most MAX_UPLOAD_EDGE long and encode it as JPEG. */
async function encodeScaled(source: CanvasImageSource, width: number, height: number, name: string): Promise<File | null> {
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], jpegName(name), { type: "image/jpeg" }) : null;
}

/** Fallback decoder for devices where createImageBitmap fails (e.g. low memory). */
async function decodeWithImageElement(file: File): Promise<File | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await encodeScaled(img, img.naturalWidth, img.naturalHeight, file.name);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Read the photo in the browser before uploading and shrink large camera
 * photos so uploads on mobile networks are small and reliable (EXIF
 * orientation applied). Decoding falls back from a full decode, to a
 * browser-side downscaled decode, to an <img> element; if the bytes are
 * readable but no decoder works (low-memory phones), the original is sent
 * and validated by the server. Only files whose bytes cannot be read at all
 * (e.g. cloud-only photos on Android) are rejected here.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (!(await isReadable(file))) throw new UnreadableFileError(file.name);

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      // Let the browser decode at a reduced size (lower memory on large photos).
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: MAX_UPLOAD_EDGE, resizeQuality: "high" });
    } catch {
      bitmap = null;
    }
  }

  if (bitmap) {
    try {
      const longest = Math.max(bitmap.width, bitmap.height);
      if (longest <= MAX_UPLOAD_EDGE && file.size <= REENCODE_ABOVE_BYTES) return file;
      const encoded = await encodeScaled(bitmap, bitmap.width, bitmap.height, file.name);
      if (!encoded) return file;
      // Re-encoding only for size must actually make the file smaller.
      if (longest <= MAX_UPLOAD_EDGE && encoded.size >= file.size) return file;
      return encoded;
    } finally {
      bitmap.close();
    }
  }

  return (await decodeWithImageElement(file)) ?? file;
}

/**
 * 1) ask the server for a signed upload URL (authorization + declared type/size check)
 * 2) upload bytes directly from the browser to private storage
 * 3) ask the server to validate the real bytes, hash, thumbnail and register the asset
 */
export async function uploadFile(
  target: "products" | "models" | "references",
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
  if (target === "references") {
    const ref = await finalizeReferenceImage({ batchId: entityId, path: t.data.path });
    if (!ref.ok) return { ok: false, error: ref.error };
    return { ok: true, warning: null, ...ref.data };
  }
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
