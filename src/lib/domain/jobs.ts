import type { JobStatus } from "./schemas";

/** Mirrors public.enforce_job_transition() in the database. */
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["processing", "cancelled", "failed"],
  processing: ["succeeded", "failed", "cancelled", "queued"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

/**
 * Exponential backoff with full jitter, in milliseconds.
 * attempt is 1-based (the attempt that just failed).
 */
export function backoffDelayMs(
  attempt: number,
  opts: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const base = opts.baseMs ?? 5_000;
  const max = opts.maxMs ?? 5 * 60_000;
  const random = opts.random ?? Math.random;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  // Full jitter keeps retries from synchronising, but never below half the step.
  return Math.round(exp / 2 + random() * (exp / 2));
}

export type ErrorClass = "transient" | "permanent" | "cancelled";

/** Provider-agnostic classified failure. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly classification: ErrorClass,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

/** Classify an HTTP status from a provider. */
export function classifyHttpStatus(status: number | undefined): ErrorClass {
  if (status == null) return "transient";
  return TRANSIENT_HTTP.has(status) ? "transient" : "permanent";
}

/** Classify any thrown value (network errors, timeouts, SDK errors). */
export function classifyError(error: unknown): { classification: ErrorClass; code: string; status?: number } {
  if (error instanceof ProviderError) return { classification: error.classification, code: error.code };
  if (error && typeof error === "object") {
    const e = error as { name?: string; status?: unknown; code?: unknown; message?: unknown };
    if (e.name === "AbortError") return { classification: "transient", code: "timeout" };
    if (typeof e.status === "number") {
      return { classification: classifyHttpStatus(e.status), code: `http_${e.status}`, status: e.status };
    }
    const msg = typeof e.message === "string" ? e.message : "";
    if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|timed? ?out/i.test(msg)) {
      return { classification: "transient", code: "network" };
    }
  }
  return { classification: "permanent", code: "unknown" };
}

export interface RetryDecision {
  action: "retry" | "fail";
  delayMs: number;
}

export function decideRetry(input: {
  classification: ErrorClass;
  attempts: number;
  maxAttempts: number;
  retryAfterMs?: number;
  random?: () => number;
}): RetryDecision {
  if (input.classification !== "transient" || input.attempts >= input.maxAttempts) {
    return { action: "fail", delayMs: 0 };
  }
  const backoff = backoffDelayMs(input.attempts, { random: input.random });
  return { action: "retry", delayMs: Math.max(backoff, input.retryAfterMs ?? 0) };
}

/** Strip anything that could be a credential from error text before storing it. */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[redacted-key]")
    .replace(/(key|token|secret|authorization)=([^&\s"]+)/gi, "$1=[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [redacted]")
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_\-]+/g, "[redacted-key]")
    .slice(0, 1000);
}

/**
 * Delay before a worker invocation re-triggers itself while work is pending
 * (queued jobs, retries waiting for backoff, video operations to poll).
 * Clamped so a chain of invocations stays cheap but responsive, and never
 * sleeps past the invocation's remaining time.
 */
export function continuationDelayMs(nextDueAt: number, now: number, remainingMs: number): number {
  const MIN = 1_000;
  const MAX = 15_000;
  const wanted = Math.min(MAX, Math.max(MIN, nextDueAt - now));
  return Math.max(0, Math.min(wanted, remainingMs - 5_000));
}
