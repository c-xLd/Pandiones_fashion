import { describe, expect, it } from "vitest";
import { SAFETY_BASELINE, buildProductShotPrompt, buildQualityReviewPrompt, buildVideoPrompt } from "@/lib/domain/prompts";
import { productAnalysisSchema } from "@/lib/domain/analysis";
import { validAnalysisFixture } from "../fixtures/gemini";

const product = {
  sku: "PX-1042",
  title: "Lace bralette",
  category: "bralette",
  color: "black",
  description: null,
  verifiedAttributes: null,
  aiAnalysis: productAnalysisSchema.parse(validAnalysisFixture),
};
const style = {
  shotType: "back" as const,
  pose: "standing",
  cameraAngle: "eye level",
  framing: "full_body" as const,
  background: "grey seamless",
  lighting: "soft",
  aspectRatio: "3:4" as const,
  imageSize: "2K" as const,
  variations: 1,
  creativeInstructions: "elegant",
};

describe("product shot prompt", () => {
  const prompt = buildProductShotPrompt({
    product,
    model: null,
    style,
    refs: [{ index: 1, kind: "product", role: "front" }],
    regenerationNote: "strap too wide",
  });

  it("keeps product constraints separate from creative direction", () => {
    const constraints = prompt.indexOf("PRODUCT PRESERVATION REQUIREMENTS");
    const creative = prompt.indexOf("CREATIVE DIRECTION");
    expect(constraints).toBeGreaterThan(-1);
    expect(creative).toBeGreaterThan(constraints);
    expect(prompt.slice(constraints, creative)).not.toContain("elegant");
    expect(prompt.slice(creative)).toContain("elegant");
  });

  it("labels AI observations as unverified and forbids inventing unseen details", () => {
    expect(prompt).toContain("unverified hints");
    expect(prompt).toContain("Do not invent details");
    expect(prompt).toContain("#1 (front)");
  });

  it("always includes the adult / non-explicit safety baseline and reviewer feedback", () => {
    expect(prompt).toContain(SAFETY_BASELINE);
    expect(prompt).toContain("strap too wide");
    expect(prompt).toContain("back view");
  });

  it("uses verified attributes as facts when present", () => {
    const p = buildProductShotPrompt({
      product: { ...product, verifiedAttributes: { colors: "ivory", closures: "hook and eye" } },
      model: null,
      style,
      refs: [],
    });
    expect(p).toContain("Verified product attributes: colors: ivory; closures: hook and eye");
    expect(p).not.toContain("Colour (from catalog)");
  });
});

describe("other prompts", () => {
  it("QC prompt orders references then the generated image", () => {
    const p = buildQualityReviewPrompt({ productRefCount: 2, modelRefCount: 1, shotType: "front", framing: null, background: null });
    expect(p).toContain("Images #1..#2 are the ORIGINAL product reference photos");
    expect(p).toContain("Images #3..#3 are reference photos of the intended model");
    expect(p).toContain("LAST image is the GENERATED result");
  });
  it("video prompt includes brief only for advertising", () => {
    expect(buildVideoPrompt({ kind: "product", prompt: "turn", motionInstructions: "", brief: "summer" })).not.toContain("summer");
    expect(buildVideoPrompt({ kind: "advertising", prompt: "turn", motionInstructions: "dolly", brief: "summer" })).toContain("Campaign brief: summer");
  });
});
