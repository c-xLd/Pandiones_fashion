import { ProviderError, classifyError, decideRetry, sanitizeErrorMessage } from "@/lib/domain/jobs";
import type { JobRow } from "@/lib/types";

/**
 * Pure functions that turn a handler outcome or failure into the database
 * update applied to a job. Kept separate from I/O for unit testing.
 */

export type HandlerOutcome =
  | { status: "succeeded"; requestId?: string | null }
  | { status: "pending"; operation: string; progress: number | null; pollAfterMs: number; requestId?: string | null }
  | { status: "cancelled"; reason: string };

export type JobPatch = Partial<
  Pick<
    JobRow,
    | "status"
    | "progress"
    | "provider_request_id"
    | "provider_operation"
    | "error_code"
    | "error_message"
    | "error_details"
    | "run_after"
    | "locked_by"
    | "locked_until"
  >
>;

export function patchForOutcome(outcome: HandlerOutcome, now: Date): JobPatch {
  switch (outcome.status) {
    case "succeeded":
      return {
        status: "succeeded",
        progress: 100,
        error_code: null,
        error_message: null,
        ...(outcome.requestId ? { provider_request_id: outcome.requestId } : {}),
      };
    case "pending":
      // Remains "processing"; the lease expiry doubles as the next poll time,
      // so any worker can pick it up again via claim_jobs().
      return {
        status: "processing",
        provider_operation: outcome.operation,
        progress: Math.max(1, Math.min(99, Math.round(outcome.progress ?? 10))),
        locked_by: null,
        locked_until: new Date(now.getTime() + outcome.pollAfterMs).toISOString(),
        ...(outcome.requestId ? { provider_request_id: outcome.requestId } : {}),
      };
    case "cancelled":
      return { status: "cancelled", error_code: "cancelled", error_message: outcome.reason };
  }
}

export interface FailureDecision {
  patch: JobPatch;
  final: boolean;
  logLevel: "warn" | "error";
}

export function patchForFailure(
  job: Pick<JobRow, "attempts" | "max_attempts" | "provider_operation">,
  error: unknown,
  now: Date,
  random: () => number = Math.random,
): FailureDecision {
  const { classification, code } = classifyError(error);
  const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
  const details = error instanceof ProviderError ? safeDetails(error.details) : {};
  const retryAfterMs = error instanceof ProviderError ? error.retryAfterMs : undefined;

  // A failed status poll of a submitted long-running operation should be
  // retried without consuming generation attempts or resubmitting.
  if (job.provider_operation && classification === "transient") {
    return {
      final: false,
      logLevel: "warn",
      patch: {
        status: "processing",
        locked_by: null,
        locked_until: new Date(now.getTime() + Math.max(30_000, retryAfterMs ?? 0)).toISOString(),
        error_code: code,
        error_message: message,
      },
    };
  }

  const decision = decideRetry({
    classification,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    retryAfterMs,
    random,
  });
  if (decision.action === "retry") {
    return {
      final: false,
      logLevel: "warn",
      patch: {
        status: "queued",
        run_after: new Date(now.getTime() + decision.delayMs).toISOString(),
        error_code: code,
        error_message: message,
        error_details: { ...details, classification, attempt: job.attempts },
        locked_by: null,
        locked_until: null,
      },
    };
  }
  return {
    final: true,
    logLevel: "error",
    patch: {
      status: "failed",
      error_code: code,
      error_message: message,
      error_details: { ...details, classification, attempt: job.attempts },
    },
  };
}

/** Keep only small, non-sensitive diagnostic fields. */
function safeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (v == null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = sanitizeErrorMessage(v).slice(0, 500);
    else if (k === "usage") out[k] = v;
  }
  return out;
}
