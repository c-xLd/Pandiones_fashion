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
    imageModel: requireVar(
      "GEMINI_IMAGE_MODEL",
      "Set it to an image-capable Gemini model ID verified with `npm run providers:models`.",
    ),
    analysisModel: read("GEMINI_ANALYSIS_MODEL") ?? "gemini-flash-latest",
    requestTimeoutMs: intFrom(120_000, 10_000, 600_000).parse(read("GEMINI_REQUEST_TIMEOUT_MS")),
    maxReferenceImages: intFrom(6, 1, 14).parse(read("GEMINI_MAX_REFERENCE_IMAGES")),
    sendImageSize: read("GEMINI_SEND_IMAGE_SIZE") !== "false",
  };
}

export function isGeminiConfigured(): boolean {
  return Boolean(read("GEMINI_API_KEY") && read("GEMINI_IMAGE_MODEL"));
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
