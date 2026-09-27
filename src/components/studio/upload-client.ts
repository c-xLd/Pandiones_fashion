"use client";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AssetRole } from "@/lib/domain/schemas";
import { createUploadTarget, finalizeProductAsset } from "@/server/actions/products";
import { finalizeModelAsset } from "@/server/actions/models";

export type UploadOutcome = { ok: true; warning: string | null } | { ok: false; error: string };

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
): Promise<UploadOutcome> {
  onPhase?.("uploading");
  const t = await createUploadTarget({ target, entityId, fileName: file.name, size: file.size, mimeType: file.type });
  if (!t.ok) return { ok: false, error: t.error };
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(t.data.bucket).uploadToSignedUrl(t.data.path, t.data.token, file, {
    contentType: file.type,
  });
  if (error) return { ok: false, error: `Upload failed: ${error.message}` };
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
