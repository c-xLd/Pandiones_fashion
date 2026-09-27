/**
 * Upload validation. The declared MIME type from the browser is never
 * trusted: the actual bytes are sniffed and must agree with an allow-list.
 */

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MIN_IMAGE_DIMENSION = 256;
export const MAX_IMAGE_DIMENSION = 12_000;

export const EXTENSION_FOR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

/** Detect the real file type from magic bytes. */
export function sniffMimeType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // ISO BMFF: bytes 4..7 == "ftyp"
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4";
  return null;
}

export type UploadValidation =
  | { ok: true; mimeType: ImageMimeType }
  | { ok: false; error: string };

/** Pre-upload check on the metadata the browser declares. */
export function validateDeclaredImage(input: { name: string; size: number; type: string }): UploadValidation {
  if (!IMAGE_MIME_TYPES.includes(input.type as ImageMimeType)) {
    return { ok: false, error: `Unsupported file type "${input.type || "unknown"}". Use JPEG, PNG or WebP.` };
  }
  if (input.size <= 0) return { ok: false, error: "File is empty." };
  if (input.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `File is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.` };
  }
  if (input.name.length > 255) return { ok: false, error: "File name is too long." };
  return { ok: true, mimeType: input.type as ImageMimeType };
}

/** Post-upload check on the real bytes. */
export function validateImageBytes(
  bytes: Uint8Array,
  dims?: { width?: number; height?: number },
): UploadValidation {
  if (bytes.byteLength === 0) return { ok: false, error: "File is empty." };
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, error: "File exceeds the maximum size." };
  const sniffed = sniffMimeType(bytes);
  if (!sniffed || !IMAGE_MIME_TYPES.includes(sniffed as ImageMimeType)) {
    return { ok: false, error: "File content is not a valid JPEG, PNG or WebP image." };
  }
  if (dims) {
    const { width, height } = dims;
    if (!width || !height) return { ok: false, error: "Could not read image dimensions." };
    if (Math.min(width, height) < MIN_IMAGE_DIMENSION) {
      return { ok: false, error: `Image is too small (${width}×${height}); minimum side is ${MIN_IMAGE_DIMENSION}px.` };
    }
    if (Math.max(width, height) > MAX_IMAGE_DIMENSION) {
      return { ok: false, error: `Image is too large (${width}×${height}).` };
    }
  }
  return { ok: true, mimeType: sniffed as ImageMimeType };
}

/** Filesystem- and URL-safe name segment. */
export function safeFileSegment(value: string, max = 60): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, max);
  return cleaned || "file";
}

/** Export file name, e.g. "SKU-123_front_ab12cd34.png". */
export function exportFileName(input: {
  sku: string | null;
  shotType: string | null;
  id: string;
  mimeType: string;
}): string {
  const ext = EXTENSION_FOR_MIME[input.mimeType] ?? "bin";
  const parts = [safeFileSegment(input.sku ?? "unassigned", 40)];
  if (input.shotType) parts.push(safeFileSegment(input.shotType, 20));
  parts.push(input.id.replace(/-/g, "").slice(0, 8));
  return `${parts.join("_")}.${ext}`;
}

/**
 * Guess SKU and asset role from a bulk-upload file name like
 * "PX-1042_back.jpg" or "PX-1042-detail-2.png".
 */
export function parseBulkFileName(fileName: string): { sku: string; role: string } | null {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const match = /^(.+?)[_\-\s](front|back|side|detail|fabric|other)(?:[_\-\s]?\d+)?$/i.exec(base);
  if (match?.[1] && match[2]) return { sku: match[1].trim(), role: match[2].toLowerCase() };
  if (/^[A-Za-z0-9._\-/]{1,64}$/.test(base)) return { sku: base, role: "front" };
  return null;
}
