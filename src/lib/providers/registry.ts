import "server-only";
import { ConfigError, geminiConfig, videoConfig } from "@/lib/env";
import { GeminiImageProvider, GeminiVisionProvider } from "./gemini/client";
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
  return overrides.image ?? new GeminiImageProvider(geminiConfig());
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
