import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_BYTES,
  exportFileName,
  parseBulkFileName,
  safeFileSegment,
  sniffMimeType,
  validateDeclaredImage,
  validateImageBytes,
} from "@/lib/domain/files";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");

describe("upload validation", () => {
  it("sniffs real file types from magic bytes", () => {
    expect(sniffMimeType(png)).toBe("image/png");
    expect(sniffMimeType(jpeg)).toBe("image/jpeg");
    expect(sniffMimeType(webp)).toBe("image/webp");
    expect(sniffMimeType(html)).toBeNull();
  });

  it("rejects disallowed declared types and oversized files", () => {
    expect(validateDeclaredImage({ name: "a.svg", size: 10, type: "image/svg+xml" }).ok).toBe(false);
    expect(validateDeclaredImage({ name: "a.gif", size: 10, type: "image/gif" }).ok).toBe(false);
    expect(validateDeclaredImage({ name: "a.png", size: MAX_IMAGE_BYTES + 1, type: "image/png" }).ok).toBe(false);
    expect(validateDeclaredImage({ name: "a.png", size: 0, type: "image/png" }).ok).toBe(false);
    expect(validateDeclaredImage({ name: "a.png", size: 100, type: "image/png" }).ok).toBe(true);
  });

  it("rejects content that does not match an allowed image type (spoofed extension)", () => {
    const res = validateImageBytes(html);
    expect(res.ok).toBe(false);
  });

  it("enforces minimum and maximum dimensions", () => {
    expect(validateImageBytes(png, { width: 100, height: 800 }).ok).toBe(false);
    expect(validateImageBytes(png, { width: 20000, height: 800 }).ok).toBe(false);
    expect(validateImageBytes(png, { width: 800, height: 1200 })).toEqual({ ok: true, mimeType: "image/png" });
  });
});

describe("safe file naming", () => {
  it("strips path traversal and unsafe characters", () => {
    expect(safeFileSegment("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileSegment("Été 2026 / lace")).toBe("Ete-2026-lace");
    expect(safeFileSegment("")).toBe("file");
  });
  it("builds export names from SKU, shot and id", () => {
    expect(exportFileName({ sku: "PX/1042", shotType: "three_quarter", id: "ab12cd34-0000-0000-0000-000000000000", mimeType: "image/png" })).toBe(
      "PX-1042_three_quarter_ab12cd34.png",
    );
  });
});

describe("bulk file name parsing", () => {
  it.each([
    ["PX-1042_back.jpg", { sku: "PX-1042", role: "back" }],
    ["PX-1042-detail-2.png", { sku: "PX-1042", role: "detail" }],
    ["SKU9 fabric.webp", { sku: "SKU9", role: "fabric" }],
    ["PX-1042.jpg", { sku: "PX-1042", role: "front" }],
  ])("%s", (name, expected) => {
    expect(parseBulkFileName(name)).toEqual(expected);
  });
  it("returns null for unusable names", () => {
    expect(parseBulkFileName("my photo (1).jpg")).toBeNull();
  });
});
