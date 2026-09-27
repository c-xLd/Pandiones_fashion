import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { inferGarmentType, planOutfit } from "@/lib/domain/outfit";
import { buildConciseProductShotPrompt, buildProductShotPrompt } from "@/lib/domain/prompts";
import { photoSessionRequestSchema } from "@/lib/domain/schemas";

describe("inferGarmentType", () => {
  it("recognises Turkish and English names", () => {
    expect(inferGarmentType("Keten gömlek")).toBe("top");
    expect(inferGarmentType(null, "bralette")).toBe("top");
    expect(inferGarmentType("Yüksek bel pantolon")).toBe("bottom");
    expect(inferGarmentType("Midi etek")).toBe("bottom");
    expect(inferGarmentType("shirt dress")).toBe("dress");
    expect(inferGarmentType("Yazlık elbise")).toBe("dress");
    expect(inferGarmentType("Oversize ceket")).toBe("outerwear");
    expect(inferGarmentType("Deri çanta")).toBe("accessory");
    expect(inferGarmentType("Beyaz sneakers")).toBe("shoes");
    expect(inferGarmentType("LOOK-260927-ABC")).toBe("top");
  });
});

describe("planOutfit", () => {
  it("is identical for the same session and varies across sessions", () => {
    expect(planOutfit("top", "s1")).toBe(planOutfit("top", "s1"));
    const outfits = new Set(["a", "b", "c", "d", "e", "f"].map((s) => planOutfit("top", s)));
    expect(outfits.size).toBeGreaterThan(1);
  });
  it("adds the missing pieces for each garment type", () => {
    expect(planOutfit("top", "x")).toMatch(/jeans|trousers|skirt/);
    expect(planOutfit("bottom", "x")).toMatch(/t-shirt|tank|camisole|top/);
    expect(planOutfit("dress", "x")).not.toMatch(/jeans|trousers|skirt/);
    expect(planOutfit("shoes", "x")).not.toMatch(/sneakers|pumps|sandals|boots|loafers/);
  });
});

describe("prompts with styling and identity", () => {
  const style = {
    shotType: "front" as const,
    pose: "relaxed",
    cameraAngle: "eye level",
    framing: "full_body" as const,
    background: "studio",
    lighting: "soft",
    aspectRatio: "3:4" as const,
    imageSize: "2K" as const,
    variations: 1,
    creativeInstructions: "",
  };
  const product = { sku: "S", title: "Linen shirt", category: null, color: null, description: null, verifiedAttributes: null, aiAnalysis: null };
  const refs = [
    { index: 1, kind: "product" as const, role: "front" as const },
    { index: 2, kind: "model" as const, role: "model" as const },
    { index: 3, kind: "model" as const, role: "model" as const },
  ];
  it("repeats the session outfit and protects the garment and the face", () => {
    const concise = buildConciseProductShotPrompt({ product, model: null, style, refs, styling: "white jeans, white sneakers" });
    expect(concise).toContain("identical in every photo of this shoot: white jeans, white sneakers");
    expect(concise).toContain("Do not redesign");
    expect(concise).toContain("keep her face unchanged");
    expect(concise).toContain("image 1 and image 2");
    const detailed = buildProductShotPrompt({ product, model: null, style, refs, styling: "white jeans" });
    expect(detailed).toContain("OUTFIT (identical in every photo");
  });
});

describe("session request", () => {
  it("defaults to auto type and engine and rejects unknown values", () => {
    const base = { productId: "7f1c1e0e-7a4b-4c7e-9a55-0d6c5a1d2b3c", modelProfileId: null, locations: ["studio_white"], count: 4, aspectRatio: "3:4", idempotencyKey: "abcdefgh-1" };
    const parsed = photoSessionRequestSchema.parse(base);
    expect(parsed.garmentType).toBe("auto");
    expect(parsed.engine).toBe("auto");
    expect(photoSessionRequestSchema.safeParse({ ...base, engine: "ultra" }).success).toBe(false);
    expect(photoSessionRequestSchema.safeParse({ ...base, garmentType: "hat" }).success).toBe(false);
  });
});

describe("engine and face close-up", () => {
  it("maps the high-quality engine only on Cloudflare", async () => {
    const { engineModel, CLOUDFLARE_HIGH_QUALITY_MODEL } = await import("@/lib/env");
    const cf = { provider: "cloudflare" as const, model: "@cf/black-forest-labs/flux-2-klein-4b", maxReferenceImages: 4 };
    expect(engineModel(cf, "auto")).toBe(cf.model);
    expect(engineModel(cf, "high")).toBe(CLOUDFLARE_HIGH_QUALITY_MODEL);
    expect(engineModel({ provider: "gemini", model: "g", maxReferenceImages: 6 }, "high")).toBe("g");
  });

  it("honours only allowed per-job models", async () => {
    process.env.IMAGE_PROVIDER = "cloudflare";
    process.env.CLOUDFLARE_ACCOUNT_ID = "a";
    process.env.CLOUDFLARE_API_TOKEN = "t";
    const { getImageProvider } = await import("@/lib/providers/registry");
    expect(getImageProvider("@cf/black-forest-labs/flux-2-klein-9b").model).toBe("@cf/black-forest-labs/flux-2-klein-9b");
    expect(getImageProvider("@cf/evil/model").model).toBe("@cf/black-forest-labs/flux-2-klein-4b");
    delete process.env.IMAGE_PROVIDER;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  it("produces a square close-up from a full-body photo", async () => {
    const { faceCloseUp } = await import("@/server/jobs/handlers/shared");
    const photo = await sharp({ create: { width: 900, height: 1600, channels: 3, background: "#d9a" } }).jpeg().toBuffer();
    const face = await faceCloseUp({ data: photo, mimeType: "image/jpeg" });
    const meta = await sharp(face!.data).metadata();
    expect([meta.width, meta.height, face!.mimeType]).toEqual([768, 768, "image/jpeg"]);
  });
});
