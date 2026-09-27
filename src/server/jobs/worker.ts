import "server-only";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { workerConfig } from "@/lib/env";
import type { JobType } from "@/lib/domain/schemas";
import type { JobRow } from "@/lib/types";
import { patchForFailure, patchForOutcome, type HandlerOutcome, type JobPatch } from "./policy";
import { analysisHandler } from "./handlers/analysis";
import { imageGenerationHandler } from "./handlers/image-generation";
import { qualityReviewHandler } from "./handlers/quality-review";
import { modelPortraitHandler } from "./handlers/model-portrait";
import { videoGenerationHandler } from "./handlers/video-generation";

export interface HandlerContext {
  admin: SupabaseClient;
  signal: AbortSignal;
  /** Update progress while the job runs (best effort). */
  progress: (value: number) => Promise<void>;
  /** Re-read the cancel flag from the database. */
  isCancelRequested: () => Promise<boolean>;
}

export interface JobHandler {
  run(job: JobRow, ctx: HandlerContext): Promise<HandlerOutcome>;
  /** Called once when the job ends failed or cancelled (not on retries). */
  onTerminalFailure?(job: JobRow, ctx: { admin: SupabaseClient }, reason: string): Promise<void>;
}

export const HANDLERS: Record<JobType, JobHandler> = {
  product_analysis: analysisHandler,
  image_generation: imageGenerationHandler,
  quality_review: qualityReviewHandler,
  model_portrait: modelPortraitHandler,
  video_generation: videoGenerationHandler,
};

export interface TickSummary {
  workerId: string;
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  pending: number;
  cancelled: number;
  durationMs: number;
}

function log(level: "info" | "warn" | "error", message: string, meta: Record<string, unknown>) {
  // Structured, secret-free operational log line.
  console[level](JSON.stringify({ level, msg: message, ts: new Date().toISOString(), ...meta }));
}

async function applyPatch(admin: SupabaseClient, job: JobRow, workerId: string, patch: JobPatch): Promise<boolean> {
  // Guard on lease ownership: if our lease expired and another worker
  // reclaimed the job, our late result must not overwrite theirs.
  const { data, error } = await admin
    .from("generation_jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("locked_by", workerId)
    .select("id");
  if (error) {
    log("error", "job update failed", { jobId: job.id, error: error.message });
    return false;
  }
  if (!data?.length) {
    log("warn", "job lease lost before update", { jobId: job.id });
    return false;
  }
  return true;
}

export async function processJob(admin: SupabaseClient, job: JobRow, workerId: string, leaseSeconds: number) {
  const handler = HANDLERS[job.job_type];
  const controller = new AbortController();
  // Abort provider calls before the lease expires so another worker never
  // runs the same job concurrently.
  const timer = setTimeout(() => controller.abort(), Math.max(30, leaseSeconds - 30) * 1000);
  const meta = { jobId: job.id, org: job.organization_id, type: job.job_type, attempt: job.attempts, provider: job.provider, model: job.model };

  const ctx: HandlerContext = {
    admin,
    signal: controller.signal,
    progress: async (value) => {
      await admin
        .from("generation_jobs")
        .update({ progress: Math.max(0, Math.min(99, Math.round(value))) })
        .eq("id", job.id)
        .eq("locked_by", workerId);
    },
    isCancelRequested: async () => {
      const { data } = await admin.from("generation_jobs").select("cancel_requested").eq("id", job.id).single();
      return Boolean((data as { cancel_requested?: boolean } | null)?.cancel_requested);
    },
  };

  try {
    if (job.cancel_requested) {
      await applyPatch(admin, job, workerId, patchForOutcome({ status: "cancelled", reason: "Cancelled by user" }, new Date()));
      await handler.onTerminalFailure?.(job, { admin }, "cancelled");
      return "cancelled" as const;
    }
    log("info", "job started", meta);
    const outcome = await handler.run(job, ctx);
    await applyPatch(admin, job, workerId, patchForOutcome(outcome, new Date()));
    if (outcome.status === "cancelled") {
      await handler.onTerminalFailure?.(job, { admin }, outcome.reason);
    }
    log("info", `job ${outcome.status}`, { ...meta, requestId: "requestId" in outcome ? outcome.requestId ?? null : null });
    return outcome.status;
  } catch (error) {
    const decision = patchForFailure(job, error, new Date());
    log(decision.logLevel, decision.final ? "job failed" : "job will retry", {
      ...meta,
      code: decision.patch.error_code,
      error: decision.patch.error_message,
      runAfter: decision.patch.run_after ?? null,
    });
    const updated = await applyPatch(admin, job, workerId, decision.patch);
    if (updated && decision.final) {
      await handler.onTerminalFailure?.(job, { admin }, decision.patch.error_message ?? "failed");
    }
    if (decision.final) return "failed" as const;
    return decision.patch.status === "processing" ? ("pending" as const) : ("retried" as const);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Claim and process jobs until the queue is empty or the time budget is
 * spent. Safe to run concurrently from many processes.
 */
export async function runWorkerTick(opts: { timeBudgetMs?: number; workerId?: string } = {}): Promise<TickSummary> {
  const cfg = workerConfig();
  const admin = getSupabaseAdmin();
  const workerId = opts.workerId ?? `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 50_000;
  const summary: TickSummary = { workerId, claimed: 0, succeeded: 0, failed: 0, retried: 0, pending: 0, cancelled: 0, durationMs: 0 };

  while (Date.now() - started < budget) {
    const { data, error } = await admin.rpc("claim_jobs", {
      p_worker: workerId,
      p_limit: cfg.batchSize,
      p_lease_seconds: cfg.leaseSeconds,
      p_max_active: cfg.maxConcurrency,
    });
    if (error) {
      log("error", "claim_jobs failed", { error: error.message });
      break;
    }
    const jobs = (data ?? []) as JobRow[];
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    const results = await Promise.all(jobs.map((job) => processJob(admin, job, workerId, cfg.leaseSeconds)));
    for (const r of results) summary[r]++;
    // Only pending (polling) jobs were claimed: stop, they are not due yet.
    if (results.every((r) => r === "pending")) break;
  }
  summary.durationMs = Date.now() - started;
  return summary;
}
