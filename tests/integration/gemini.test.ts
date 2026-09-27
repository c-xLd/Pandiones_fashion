import { describe, expect, it } from "vitest";
import sharp from "sharp";
import nextEnv from "@next/env";

/**
 * Live provider integration tests. They call the real Gemini API and are
 * skipped unless explicitly enabled:
 *
 *   RUN_PROVIDER_INTEGRATION=1 npm run test:integration          # model checks + one analysis call (small cost)
 *   RUN_PROVIDER_IMAGE_GENERATION=1 npm run test:integration     # additionally generates one image (billed)
 *
 * Requires GEMINI_API_KEY and GEMINI_IMAGE_MODEL (from .env.local or the environment).
 */
nextEnv.loadEnvConfig(process.cwd());
const enabled = process.env.RUN_PROVIDER_INTEGRATION === "1" && Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_IMAGE_MODEL);

describe.skipIf(!enabled)("Gemini provider (live)", () => {
  it("configured models exist and support generateContent", async () => {
    const { checkGeminiModel } = await import("@/lib/providers/gemini/client");
    const { geminiConfig } = await import("@/lib/env");
    const cfg = geminiConfig();
    const image = await checkGeminiModel(cfg.imageModel, "generateContent");
    expect(image.ok, image.detail).toBe(true);
    const analysis = await checkGeminiModel(cfg.analysisModel, "generateContent");
    expect(analysis.ok, analysis.detail).toBe(true);
  }, 60_000);

  it("returns schema-valid structured analysis for a product image", async () => {
    const { GeminiVisionProvider } = await import("@/lib/providers/gemini/client");
    const { parseStructuredOutput, productAnalysisJsonSchema, productAnalysisSchema } = await import("@/lib/domain/analysis");
    const { buildAnalysisPrompt } = await import("@/lib/domain/prompts");
    // Synthetic test image: a plain red rectangle on white (no real product).
    const data = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#ffffff" } })
      .composite([{ input: await sharp({ create: { width: 256, height: 320, channels: 3, background: "#b01010" } }).png().toBuffer(), top: 96, left: 128 }])
      .jpeg()
      .toBuffer();
    const provider = new GeminiVisionProvider();
    const result = await provider.generateStructured({
      prompt: buildAnalysisPrompt([{ index: 1, role: "front" }]),
      images: [{ label: "product reference (front)", mimeType: "image/jpeg", data }],
      jsonSchema: productAnalysisJsonSchema,
    });
    const analysis = parseStructuredOutput(productAnalysisSchema, result.text);
    expect(analysis.dominantColors.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(process.env.RUN_PROVIDER_IMAGE_GENERATION !== "1")(
    "generates an image (billed)",
    async () => {
      const { GeminiImageProvider } = await import("@/lib/providers/gemini/client");
      const provider = new GeminiImageProvider();
      const result = await provider.generateImage({
        prompt: "A plain white cotton t-shirt laid flat on a light grey background, studio product photo.",
        references: [],
        aspectRatio: "1:1",
        imageSize: "1K",
      });
      expect(result.images.length).toBeGreaterThan(0);
      expect(result.images[0]!.data.byteLength).toBeGreaterThan(1000);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    },
    180_000,
  );
});
