import "server-only";
import { z } from "zod";

/**
 * Server-side environment. Values are validated lazily at the boundary that
 * needs them so a missing provider key disables that feature with an
 * actionable error instead of crashing the whole app.
 */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

function requireVar(name: string, hint: string): string {
  const value = read(name);
  if (!value) throw new ConfigError(`${name} is not set. ${hint} See docs/SETUP.md.`);
  return value;
}

export function supabaseUrl(): string {
  return requireVar("NEXT_PUBLIC_SUPABASE_URL", "Set it to your Supabase project URL.");
}

export function supabasePublishableKey(): string {
  const value = read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!value) {
    throw new ConfigError(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set (legacy NEXT_PUBLIC_SUPABASE_ANON_KEY is also accepted). See docs/SETUP.md.",
    );
  }
  return value;
}

/** Secret (service-role) key. Only ever used by trusted server code. */
export function supabaseSecretKey(): string {
  const value = read("SUPABASE_SECRET_KEY") ?? read("SUPABASE_SERVICE_ROLE_KEY");
  if (!value) {
    throw new ConfigError(
      "SUPABASE_SECRET_KEY is not set (legacy SUPABASE_SERVICE_ROLE_KEY is also accepted). See docs/SETUP.md.",
    );
  }
  return value;
}

const intFrom = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).catch(fallback);

export interface GeminiConfig {
  apiKey: string;
  imageModel: string;
  analysisModel: string;
  requestTimeoutMs: number;
  maxReferenceImages: number;
  /** Whether to send imageConfig.imageSize (not every image model accepts it). */
  sendImageSize: boolean;
}

export function geminiConfig(): GeminiConfig {
  return {
    apiKey: requireVar("GEMINI_API_KEY", "Create a key in Google AI Studio."),
    // Only required when Gemini is the image provider (checked by GeminiImageProvider).
    imageModel: read("GEMINI_IMAGE_MODEL") ?? "",
    analysisModel: read("GEMINI_ANALYSIS_MODEL") ?? "gemini-flash-latest",
    requestTimeoutMs: intFrom(120_000, 10_000, 600_000).parse(read("GEMINI_REQUEST_TIMEOUT_MS")),
    maxReferenceImages: intFrom(6, 1, 14).parse(read("GEMINI_MAX_REFERENCE_IMAGES")),
    sendImageSize: read("GEMINI_SEND_IMAGE_SIZE") !== "false",
  };
}

/** Gemini key present: enough for product analysis and quality review. */
export function isGeminiConfigured(): boolean {
  return Boolean(read("GEMINI_API_KEY"));
}

export type ImageProviderName = "gemini" | "cloudflare";

/** Which provider generates images (IMAGE_PROVIDER, default "gemini"). */
export function imageProviderName(): ImageProviderName {
  const value = read("IMAGE_PROVIDER") ?? "gemini";
  if (value !== "gemini" && value !== "cloudflare") {
    throw new ConfigError(`IMAGE_PROVIDER must be "gemini" or "cloudflare" (got "${value}").`);
  }
  return value;
}

/** FLUX.2 [klein] 4B: multi-reference editing, cheapest per image on Workers AI. */
export const DEFAULT_CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  imageModel: string;
  requestTimeoutMs: number;
}

export function cloudflareConfig(): CloudflareConfig {
  return {
    accountId: requireVar("CLOUDFLARE_ACCOUNT_ID", "Find it in the Cloudflare dashboard (Workers AI → Use REST API)."),
    apiToken: requireVar("CLOUDFLARE_API_TOKEN", "Create a token with the Workers AI permission."),
    imageModel: read("CLOUDFLARE_IMAGE_MODEL") ?? DEFAULT_CLOUDFLARE_IMAGE_MODEL,
    requestTimeoutMs: intFrom(120_000, 10_000, 600_000).parse(read("GEMINI_REQUEST_TIMEOUT_MS")),
  };
}

/** FLUX.2 on Workers AI accepts up to 4 input images. */
export const CLOUDFLARE_MAX_REFERENCE_IMAGES = 4;

export interface ImageGenerationConfig {
  provider: ImageProviderName;
  model: string;
  maxReferenceImages: number;
}

/** Provider, model and limits for image generation; throws ConfigError when incomplete. */
export function imageGenerationConfig(): ImageGenerationConfig {
  if (imageProviderName() === "cloudflare") {
    const cf = cloudflareConfig();
    return { provider: "cloudflare", model: cf.imageModel, maxReferenceImages: CLOUDFLARE_MAX_REFERENCE_IMAGES };
  }
  const g = geminiConfig();
  if (!g.imageModel) {
    throw new ConfigError("GEMINI_IMAGE_MODEL is not set. Set it to an image-capable Gemini model ID verified with `npm run providers:models`.");
  }
  return { provider: "gemini", model: g.imageModel, maxReferenceImages: g.maxReferenceImages };
}

/** Higher-quality FLUX.2 model (FLUX Non-Commercial License; ~10x the neurons of klein 4B). */
export const CLOUDFLARE_HIGH_QUALITY_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";
/** Models a job may request explicitly (anything else falls back to the configured model). */
export const CLOUDFLARE_ALLOWED_MODELS = [DEFAULT_CLOUDFLARE_IMAGE_MODEL, CLOUDFLARE_HIGH_QUALITY_MODEL];

/** Model ID for a requested engine; "high" only changes the model on Cloudflare. */
export function engineModel(cfg: ImageGenerationConfig, engine: "auto" | "standard" | "high"): string {
  if (engine === "high" && cfg.provider === "cloudflare") return CLOUDFLARE_HIGH_QUALITY_MODEL;
  return cfg.model;
}

export function isImageGenerationConfigured(): boolean {
  try {
    imageGenerationConfig();
    return true;
  } catch {
    return false;
  }
}

export type VideoProviderName = "gemini-veo" | "none";

export interface VideoConfig {
  provider: VideoProviderName;
  model: string | null;
  allowedDurations: number[];
  supportsReferenceImages: boolean;
  pollIntervalSeconds: number;
}

export function videoConfig(): VideoConfig {
  const provider = (read("VIDEO_PROVIDER") ?? "none") as VideoProviderName;
  if (provider !== "gemini-veo" && provider !== "none") {
    throw new ConfigError(`VIDEO_PROVIDER must be "gemini-veo" or "none" (got "${provider}").`);
  }
  const durations = (read("VIDEO_ALLOWED_DURATIONS") ?? "4,6,8")
    .split(",")
    .map((d) => Number.parseInt(d.trim(), 10))
    .filter((d) => Number.isInteger(d) && d > 0 && d <= 60);
  return {
    provider,
    model: provider === "none" ? null : read("VIDEO_MODEL") ?? null,
    allowedDurations: durations.length ? durations : [8],
    supportsReferenceImages: read("VIDEO_SUPPORTS_REFERENCE_IMAGES") === "true",
    pollIntervalSeconds: intFrom(15, 5, 300).parse(read("VIDEO_POLL_INTERVAL_SECONDS")),
  };
}

export interface WorkerConfig {
  secret: string;
  maxConcurrency: number;
  batchSize: number;
  leaseSeconds: number;
}

export function workerConfig(): WorkerConfig {
  const secret = requireVar("BACKGROUND_JOB_SECRET", "Generate one with `openssl rand -hex 32`.");
  if (secret.length < 32) throw new ConfigError("BACKGROUND_JOB_SECRET must be at least 32 characters.");
  return {
    secret,
    maxConcurrency: intFrom(4, 1, 64).parse(read("WORKER_MAX_CONCURRENCY")),
    batchSize: intFrom(4, 1, 32).parse(read("WORKER_BATCH_SIZE")),
    leaseSeconds: intFrom(300, 60, 900).parse(read("WORKER_LEASE_SECONDS")),
  };
}

export function appUrl(): string | undefined {
  return read("APP_URL") ?? (read("VERCEL_URL") ? `https://${read("VERCEL_URL")}` : undefined);
}

export function qualityReviewEnabled(): boolean {
  return read("AUTO_QUALITY_REVIEW") !== "false";
}
