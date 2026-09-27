import { describe, expect, it } from "vitest";
import {
  modelProfileInputSchema,
  productInputSchema,
  shootRequestSchema,
  videoRequestSchema,
} from "@/lib/domain/schemas";

const uuid = "4f0b8e0c-1c1a-4c1e-9a7a-2b1d3c4e5f60";

describe("product input (create / edit)", () => {
  it("accepts a valid product and normalises tags", () => {
    const p = productInputSchema.parse({ sku: "PX-1042", title: "Lace bralette", tags: "Lace, summer-26, lace ,", category: "" });
    expect(p.tags).toEqual(["lace", "summer-26"]);
    expect(p.category).toBeNull();
    expect(p.status).toBe("draft");
  });

  it("rejects missing title and unsafe SKU characters", () => {
    expect(productInputSchema.safeParse({ sku: "PX 1042", title: "x" }).success).toBe(false);
    expect(productInputSchema.safeParse({ sku: "PX-1", title: "" }).success).toBe(false);
    expect(productInputSchema.safeParse({ sku: "a".repeat(65), title: "x" }).success).toBe(false);
  });

  it("rejects unknown status values on edit", () => {
    expect(productInputSchema.safeParse({ sku: "A1", title: "x", status: "published" }).success).toBe(false);
    expect(productInputSchema.parse({ sku: "A1", title: "x", status: "archived" }).status).toBe("archived");
  });
});

describe("model profiles are adults only", () => {
  const base = { code: "PX-M01", displayName: "Ana", adultConfirmed: true };
  it("requires explicit adult confirmation", () => {
    expect(modelProfileInputSchema.safeParse({ ...base, adultConfirmed: false }).success).toBe(false);
    expect(modelProfileInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects age ranges below 18", () => {
    expect(modelProfileInputSchema.safeParse({ ...base, ageRange: "16-19" }).success).toBe(false);
    expect(modelProfileInputSchema.safeParse({ ...base, ageRange: "17" }).success).toBe(false);
    expect(modelProfileInputSchema.safeParse({ ...base, ageRange: "25-30" }).success).toBe(true);
  });
});

describe("shoot request", () => {
  const style = { pose: "", cameraAngle: "", framing: "full_body", background: "", lighting: "", aspectRatio: "3:4", imageSize: "2K", variations: 2, creativeInstructions: "" };
  it("requires at least one product reference and shot type", () => {
    const ok = shootRequestSchema.safeParse({
      productId: uuid, modelProfileId: null, presetId: null, productReferenceAssetIds: [uuid], shotTypes: ["front"], style, idempotencyKey: "abcdefgh1",
    });
    expect(ok.success).toBe(true);
    const noRefs = shootRequestSchema.safeParse({
      productId: uuid, modelProfileId: null, presetId: null, productReferenceAssetIds: [], shotTypes: ["front"], style, idempotencyKey: "abcdefgh1",
    });
    expect(noRefs.success).toBe(false);
  });
  it("rejects aspect ratios the image API does not document", () => {
    const bad = shootRequestSchema.safeParse({
      productId: uuid, modelProfileId: null, presetId: null, productReferenceAssetIds: [uuid], shotTypes: ["front"], style: { ...style, aspectRatio: "4:5" }, idempotencyKey: "abcdefgh1",
    });
    expect(bad.success).toBe(false);
  });
});

describe("video request", () => {
  it("limits sources to 3 and validates aspect ratio", () => {
    const base = { name: "v", kind: "product", sourceResultIds: [uuid], prompt: "turn", durationSeconds: 8, aspectRatio: "9:16", resolution: "720p", idempotencyKey: "abcdefgh1" };
    expect(videoRequestSchema.safeParse(base).success).toBe(true);
    expect(videoRequestSchema.safeParse({ ...base, aspectRatio: "1:1" }).success).toBe(false);
    expect(videoRequestSchema.safeParse({ ...base, sourceResultIds: [uuid, uuid, uuid, uuid] }).success).toBe(false);
  });
});
