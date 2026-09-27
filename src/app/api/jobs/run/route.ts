import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ConfigError } from "@/lib/env";
import { runWorkerTick } from "@/server/jobs/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow long provider calls. The effective limit depends on the hosting plan.
export const maxDuration = 300;

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
  try {
    // No new batch is claimed after the budget; a batch already in flight can
    // take up to GEMINI_REQUEST_TIMEOUT_MS (default 120s), so budget + timeout
    // stays under maxDuration.
    const summary = await runWorkerTick({ timeBudgetMs: 150_000 });
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
