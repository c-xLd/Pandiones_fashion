import "server-only";
import { ConfigError, cloudflareConfig, geminiConfig, imageProviderName, videoConfig } from "@/lib/env";
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

export function getImageProvider(): ImageGenerationProvider {
  if (overrides.image) return overrides.image;
  if (imageProviderName() === "cloudflare") return new CloudflareFluxImageProvider(cloudflareConfig());
  const cfg = geminiConfig();
  if (!cfg.imageModel) throw new ConfigError("GEMINI_IMAGE_MODEL is not set. Set it to an image-capable Gemini model ID verified with `npm run providers:models`.");
  return new GeminiImageProvider(cfg);
}

export function getVisionProvider(): VisionProvider {
  return overrides.vision ?? new GeminiVisionProvider(geminiConfig());
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
