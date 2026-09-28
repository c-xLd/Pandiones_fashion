import "server-only";
import { CLOUDFLARE_ALLOWED_MODELS, ConfigError, cloudflareConfig, geminiConfig, imageProviderName, videoConfig } from "@/lib/env";
import { GeminiImageProvider, GeminiVisionProvider } from "./gemini/client";
import { CloudflareFluxImageProvider } from "./cloudflare/flux";
import { GeminiVeoProvider } from "./video/gemini-veo";
import type { ImageGenerationProvider, VideoGenerationProvider, VisionProvider } from "./types";

/**
 * Provider selection is server configuration only. Tests inject fakes via
 * setProviderOverrides(); production code never does.
 */
interface Overrides {
  image?: ImageGenerationProvider;
  vision?: VisionProvider;
  video?: VideoGenerationProvider | null;
}
let overrides: Overrides = {};

export function setProviderOverrides(next: Overrides): void {
  overrides = next;
}

/**
 * @param requestedModel model stored on the job (e.g. a higher-quality engine
 *   chosen by the user); honoured only when it is an allowed model of the
 *   configured provider.
 */
export function getImageProvider(requestedModel?: string): ImageGenerationProvider {
  if (overrides.image) return overrides.image;
  if (imageProviderName() === "cloudflare") {
    const cfg = cloudflareConfig();
    const model = requestedModel && CLOUDFLARE_ALLOWED_MODELS.includes(requestedModel) ? requestedModel : cfg.imageModel;
    return new CloudflareFluxImageProvider({ ...cfg, imageModel: model });
  }
  const cfg = geminiConfig();
  if (!cfg.imageModel) throw new ConfigError("GEMINI_IMAGE_MODEL is not set. Set it to an image-capable Gemini model ID verified with `npm run providers:models`.");
  return new GeminiImageProvider(cfg);
}

/** @param model optional analysis model override (e.g. a fallback with its own quota). */
export function getVisionProvider(model?: string): VisionProvider {
  if (overrides.vision) return overrides.vision;
  const cfg = geminiConfig();
  return new GeminiVisionProvider(model ? { ...cfg, analysisModel: model } : cfg);
}

export function getVideoProvider(): VideoGenerationProvider {
  if (overrides.video !== undefined) {
    if (overrides.video === null) throw new ConfigError("Video generation is disabled.");
    return overrides.video;
  }
  const cfg = videoConfig();
  if (cfg.provider === "none") {
    throw new ConfigError("Video generation is disabled. Set VIDEO_PROVIDER=gemini-veo and VIDEO_MODEL to enable it.");
  }
  if (!cfg.model) throw new ConfigError("VIDEO_MODEL is not set. Run `npm run providers:models` to list available models.");
  // The Veo provider uses the Gemini API key.
  geminiConfig();
  return new GeminiVeoProvider(cfg.model);
}

export function isVideoEnabled(): boolean {
  try {
    const cfg = videoConfig();
    return cfg.provider !== "none" && Boolean(cfg.model) && Boolean(process.env.GEMINI_API_KEY);
  } catch {
    return false;
  }
}
