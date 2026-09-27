import "server-only";
import { appUrl } from "@/lib/env";

/**
 * Ask the worker endpoint to process the queue now instead of waiting for
 * the next scheduled run. Purely an accelerator: if it fails, the scheduled
 * cron / standalone worker still picks the job up because jobs live in
 * Postgres, not in this process.
 */
export async function kickWorker(): Promise<void> {
  const base = appUrl();
  const secret = process.env.BACKGROUND_JOB_SECRET;
  if (!base || !secret) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    await fetch(new URL("/api/jobs/run", base), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // Timeout/abort is expected: the worker keeps running server-side.
  } finally {
    clearTimeout(timer);
  }
}
