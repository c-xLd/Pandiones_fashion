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
  it("recreates the scene and swaps only the person and the garment (FLUX numbering)", () => {
    const text = buildReplicaPrompt({ product, scene: 1, garments: [2, 3], models: [4], format: "concise" });
    expect(text).toContain("Recreate image 0 as faithfully as possible");
    expect(text).toContain("the woman in image 3");
    expect(text).toContain("garment shown in image 1 and image 2 (Lace bra set)");
    expect(text).toContain("Do not combine it with other scenes");
    expect(text).toContain("21+");
  });
  it("keeps the reference person when no model is chosen (Gemini numbering)", () => {
    const text = buildReplicaPrompt({ product, scene: 1, garments: [2], models: [], format: "detailed", instructions: "warmer light" });
    expect(text).toContain("Keep the same person as in Image #1");
    expect(text).toContain("Image #2");
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
