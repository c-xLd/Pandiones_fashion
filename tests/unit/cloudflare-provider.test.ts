import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { classifyCloudflareError, estimateFluxNeurons, fluxCost, fluxDimensions, sniffImageMime, FREE_NEURONS_PER_DAY } from "@/lib/domain/flux";
import { buildConciseProductShotPrompt } from "@/lib/domain/prompts";
import { ProviderError } from "@/lib/domain/jobs";
import { CloudflareFluxImageProvider } from "@/lib/providers/cloudflare/flux";

const config = { accountId: "acc123", apiToken: "tok456", imageModel: "@cf/black-forest-labs/flux-2-klein-4b", requestTimeoutMs: 30_000 };
const png = async (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#c33" } }).png().toBuffer();

describe("fluxDimensions", () => {
  it("keeps the aspect ratio at about 0.8 MP for 1K, in multiples of 16", () => {
    expect(fluxDimensions("3:4", "1K")).toEqual({ width: 768, height: 1024 });
    expect(fluxDimensions("1:1", "1K")).toEqual({ width: 880, height: 880 });
    const wide = fluxDimensions("16:9", "1K");
    expect(wide.width % 16).toBe(0);
    expect(Math.abs(wide.width / wide.height - 16 / 9)).toBeLessThan(0.03);
  });
  it("stays within the model's 256–1920 range", () => {
    for (const r of ["21:9", "9:16", "2:3", "4:3"]) {
      for (const s of ["1K", "2K", "4K"]) {
        const { width, height } = fluxDimensions(r, s);
        expect(Math.max(width, height)).toBeLessThanOrEqual(1920);
        expect(Math.min(width, height)).toBeGreaterThanOrEqual(256);
      }
    }
  });
});

describe("FLUX cost estimate", () => {
  it("prices klein 4B by 512² tiles and leaves many images inside the free allocation", () => {
    const neurons = estimateFluxNeurons(config.imageModel, { width: 768, height: 1024 }, [
      { width: 768, height: 1024 },
      { width: 1024, height: 1024 },
    ]);
    // 4 output tiles × 26.05 + (4 + 4) input tiles × 5.37
    expect(neurons).toBeCloseTo(4 * 26.05 + 8 * 5.37, 5);
    expect(Math.floor(FREE_NEURONS_PER_DAY / (neurons as number))).toBeGreaterThan(50);
  });
  it("prices klein 9B per megapixel and marks unknown models as unknown", () => {
    expect(estimateFluxNeurons("@cf/black-forest-labs/flux-2-klein-9b", { width: 768, height: 1024 }, [{ width: 1024, height: 1024 }])).toBeCloseTo(1363.64 + 181.82, 2);
    expect(fluxCost("@cf/other", { width: 512, height: 512 }, []).source).toBe("unknown");
    const c = fluxCost(config.imageModel, { width: 512, height: 512 }, []);
    expect(c.source).toBe("estimated");
    expect(c.amount).toBeCloseTo((26.05 / 1000) * 0.011, 6);
  });
});

describe("classifyCloudflareError", () => {
  it("treats the exhausted daily free allocation as permanent", () => {
    const r = classifyCloudflareError(429, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan" }] });
    expect(r).toMatchObject({ classification: "permanent", code: "provider_daily_quota" });
  });
  it("retries rate limits and server errors, fails auth and bad requests", () => {
    expect(classifyCloudflareError(429, { errors: [{ message: "Too many requests" }] })).toMatchObject({ classification: "transient", code: "http_429" });
    expect(classifyCloudflareError(503, null)).toMatchObject({ classification: "transient", code: "http_503" });
    expect(classifyCloudflareError(401, { errors: [{ code: 10000, message: "Authentication error" }] })).toMatchObject({ classification: "permanent", code: "http_401" });
    expect(classifyCloudflareError(400, { errors: [{ message: "Input prompt contains NSFW content" }] })).toMatchObject({ classification: "permanent", code: "safety_filtered" });
    expect(
      classifyCloudflareError(400, { errors: [{ code: 3030, message: "AiError: AiError: Your output has been flagged. Please choose another prompt / input image combination" }] }),
    ).toMatchObject({ classification: "permanent", code: "safety_filtered" });
  });
});

describe("sniffImageMime", () => {
  it("detects PNG and JPEG", async () => {
    expect(sniffImageMime(await png(8, 8))).toBe("image/png");
    expect(sniffImageMime(await sharp(await png(8, 8)).jpeg().toBuffer())).toBe("image/jpeg");
  });
});

describe("buildConciseProductShotPrompt", () => {
  const style = {
    shotType: "back" as const,
    pose: "glancing back over the shoulder",
    cameraAngle: "eye level",
    framing: "full_body" as const,
    background: "city street",
    lighting: "soft daylight",
    aspectRatio: "3:4" as const,
    imageSize: "1K" as const,
    variations: 1,
    creativeInstructions: "",
  };
  const product = { sku: "LOOK-1", title: "Linen shirt", category: "shirt", color: "white", description: null, verifiedAttributes: null, aiAnalysis: null };
  it("references inputs by 0-based index and keeps garment fidelity and safety", () => {
    const text = buildConciseProductShotPrompt({
      product,
      model: null,
      style,
      refs: [
        { index: 1, kind: "product", role: "front" },
        { index: 2, kind: "product", role: "back" },
        { index: 3, kind: "model", role: "model" },
      ],
    });
    expect(text).toContain("image 0 (front view), image 1 (back view)");
    expect(text).toContain("The model is exactly the woman in image 2: keep her face unchanged");
    expect(text).toContain("21+");
    expect(text).toContain("non-explicit");
    expect(text).toContain("Setting: city street.");
  });
  it("uses the session persona when there is no model reference", () => {
    const text = buildConciseProductShotPrompt({ product, model: null, style, refs: [{ index: 1, kind: "product", role: "front" }], modelPersona: "age late 20s, fair skin" });
    expect(text).toContain("fictional person: age late 20s, fair skin");
  });
});

describe("CloudflareFluxImageProvider", () => {
  it("posts a multipart form with prompt, size and downscaled input images", async () => {
    const out = await png(768, 1024);
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, result: { image: out.toString("base64") } }), { status: 200, headers: { "cf-ray": "ray-1" } }),
    );
    const provider = new CloudflareFluxImageProvider(config, fetchMock as unknown as typeof fetch);
    const big = await png(3000, 4000);
    const result = await provider.generateImage({
      prompt: "PROMPT",
      references: [{ label: "front", mimeType: "image/png", data: big }],
      aspectRatio: "3:4",
      imageSize: "1K",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/run/@cf/black-forest-labs/flux-2-klein-4b");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok456");
    const form = init?.body as FormData;
    expect(form.get("prompt")).toBe("PROMPT");
    expect(form.get("width")).toBe("768");
    expect(form.get("height")).toBe("1024");
    const input = form.get("input_image_0") as Blob;
    const meta = await sharp(Buffer.from(await input.arrayBuffer())).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1024);
    expect(result.images[0]!.mimeType).toBe("image/png");
    expect(result.requestId).toBe("ray-1");
    expect(result.cost?.source).toBe("estimated");
  });

  it("raises classified ProviderErrors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 4006, message: "daily free allocation exhausted" }] }), { status: 429 }));
    const provider = new CloudflareFluxImageProvider(config, fetchMock as unknown as typeof fetch);
    const error = await provider.generateImage({ prompt: "p", references: [], aspectRatio: "1:1", imageSize: "1K" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe("provider_daily_quota");
    expect((error as ProviderError).classification).toBe("permanent");
  });

  it("rejects more than four references before calling the API", async () => {
    const fetchMock = vi.fn();
    const provider = new CloudflareFluxImageProvider(config, fetchMock as unknown as typeof fetch);
    const ref = { label: "x", mimeType: "image/png", data: Buffer.from("x") };
    await expect(provider.generateImage({ prompt: "p", references: [ref, ref, ref, ref, ref], aspectRatio: "1:1", imageSize: "1K" })).rejects.toMatchObject({ code: "too_many_references" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("2K / 4K output", () => {
  it("requests the model's maximum (1920 px long edge) for 2K and 4K", () => {
    expect(fluxDimensions("3:4", "2K")).toEqual({ width: 1440, height: 1920 });
    expect(fluxDimensions("3:4", "4K")).toEqual({ width: 1440, height: 1920 });
  });

  it("upscales 4K requests to a 3840 px long edge and leaves 2K untouched", async () => {
    const { upscaleIfNeeded } = await import("@/server/jobs/handlers/shared");
    const img = { data: await png(1440, 1920), mimeType: "image/png" };
    const twoK = await upscaleIfNeeded(img, "2K");
    expect(twoK.upscaled).toBe(false);
    const fourK = await upscaleIfNeeded(img, "4K");
    expect(fourK.upscaled).toBe(true);
    const meta = await sharp(fourK.image.data).metadata();
    expect([meta.width, meta.height]).toEqual([2880, 3840]);
    expect(fourK.image.mimeType).toBe("image/jpeg");
    const native = await upscaleIfNeeded({ data: await png(3000, 4000), mimeType: "image/png" }, "4K");
    expect(native.upscaled).toBe(false);
  });
});

describe("realism cues", () => {
  it("are part of product and portrait prompts", async () => {
    const { REALISM, buildModelPortraitPrompt } = await import("@/lib/domain/prompts");
    const portrait = buildModelPortraitPrompt(
      { code: "AI-1", displayName: "Model 1", description: "a beautiful professional female fashion model, age late 20s", appearance: {}, stylingNotes: null, preferredLighting: null, photographyStyle: null },
      "",
      false,
    );
    expect(portrait).toContain(REALISM);
    expect(portrait).toContain("front view facing the camera");
    expect(portrait).toContain("21+");
  });
});
