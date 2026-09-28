import { describe, expect, it } from "vitest";
import { isReferencePath, nearestAspectRatio } from "@/lib/domain/replica";
import { buildReplicaPrompt } from "@/lib/domain/prompts";
import { replicaJobConfigSchema, replicaRequestSchema } from "@/lib/domain/schemas";

const org = "5e53929c-76ba-458f-896b-a19c9ac72382";
const batch = "7f1c1e0e-7a4b-4c7e-9a55-0d6c5a1d2b3c";
const product = { sku: "S", title: "Lace bra set", category: null, color: null, description: null, verifiedAttributes: null, aiAnalysis: null };

describe("replica helpers", () => {
  it("maps reference dimensions to the closest supported aspect ratio", () => {
    expect(nearestAspectRatio(1080, 1440)).toBe("3:4");
    expect(nearestAspectRatio(1080, 1920)).toBe("9:16");
    expect(nearestAspectRatio(2000, 2000)).toBe("1:1");
    expect(nearestAspectRatio(1600, 1067)).toBe("3:2");
    expect(nearestAspectRatio(0, 0)).toBe("3:4");
  });

  it("accepts only this organization's reference uploads", () => {
    expect(isReferencePath(`${org}/references/${batch}/${batch}.jpg`, org)).toBe(true);
    expect(isReferencePath(`other-org/references/${batch}/${batch}.jpg`, org)).toBe(false);
    expect(isReferencePath(`${org}/products/${batch}/source/${batch}.jpg`, org)).toBe(false);
    expect(isReferencePath(`${org}/references/${batch}/../../x.jpg`, org)).toBe(false);
  });
});

describe("buildReplicaPrompt", () => {
  it("uses the text setup, the exact garment and the model — no reference image (FLUX numbering)", () => {
    const text = buildReplicaPrompt({ product, scene: "Pose: seated on the floor.", garments: [1, 2], models: [3, 4], format: "concise" });
    expect(text).toContain("recreating this exact photographic setup: Pose: seated on the floor.");
    expect(text).toContain("the woman in image 2 and image 3");
    expect(text).toContain("ONLY the garment shown in image 0 and image 1 (Lace bra set)");
    expect(text).toContain("do not add any other clothing, hosiery, jewellery or accessories");
    expect(text).not.toMatch(/Recreate image/);
    expect(text).toContain("21+");
  });
  it("uses a persona when no model is chosen (Gemini numbering)", () => {
    const text = buildReplicaPrompt({ product, scene: "Lighting: soft.", garments: [1], models: [], persona: "a beautiful professional female fashion model", format: "detailed", instructions: "warmer light" });
    expect(text).toContain("fictional person: a beautiful professional female fashion model");
    expect(text).toContain("Image #1");
    expect(text).toContain("warmer light");
  });
});

describe("replica schemas", () => {
  it("allows one to four references per batch", () => {
    const base = { productId: batch, modelProfileId: null, idempotencyKey: "abcdefgh-1" };
    expect(replicaRequestSchema.safeParse({ ...base, scenePaths: [] }).success).toBe(false);
    expect(replicaRequestSchema.safeParse({ ...base, scenePaths: ["a", "b", "c", "d", "e"] }).success).toBe(false);
    const ok = replicaRequestSchema.parse({ ...base, scenePaths: ["a"] });
    expect(ok.imageSize).toBe("2K");
    expect(ok.engine).toBe("auto");
    expect(
      replicaJobConfigSchema.safeParse({
        kind: "replica",
        scenePath: "p",
        sceneThumbnailPath: null,
        aspectRatio: "3:4",
        imageSize: "2K",
        productReferenceAssetIds: [batch],
        modelReferenceAssetIds: [],
      }).success,
    ).toBe(true);
  });
});
