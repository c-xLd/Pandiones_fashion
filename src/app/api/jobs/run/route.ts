import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { ConfigError } from "@/lib/env";
import { continuationDelayMs } from "@/lib/domain/jobs";
import { nextDueAt, runWorkerTick } from "@/server/jobs/worker";
import { kickWorker } from "@/server/jobs/kick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow long provider calls. The effective limit depends on the hosting plan.
export const maxDuration = 300;
const MAX_DURATION_MS = maxDuration * 1000;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  // Vercel Cron sends CRON_SECRET; manual/external schedulers use BACKGROUND_JOB_SECRET.
  for (const secret of [process.env.BACKGROUND_JOB_SECRET, process.env.CRON_SECRET]) {
    if (!secret) continue;
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    // No new batch is claimed after the budget; a batch already in flight can
    // take up to GEMINI_REQUEST_TIMEOUT_MS (default 120s), so budget + timeout
    // stays under maxDuration.
    const summary = await runWorkerTick({ timeBudgetMs: 150_000 });
    // Keep the queue moving without a per-minute scheduler: while work is
    // pending (more jobs, retry backoff, video polling), trigger the next
    // invocation. The chain stops by itself once the queue is empty.
    after(async () => {
      try {
        const due = await nextDueAt();
        if (due === null) return;
        const wait = continuationDelayMs(due, Date.now(), MAX_DURATION_MS - (Date.now() - startedAt));
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        await kickWorker();
      } catch (error) {
        console.error("[worker] continuation failed", error instanceof Error ? error.message : error);
      }
    });
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof ConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[worker] tick failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Worker tick failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
