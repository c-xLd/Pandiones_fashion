/**
 * Standalone long-running worker for local development or self-hosting
 * (e.g. a container, Fly.io, Railway, or a VM next to the database).
 *
 *   npm run worker
 *
 * Loads .env.local / .env, then claims and processes jobs in a loop. Several
 * instances can run at once: claim_jobs() uses SKIP LOCKED leases.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const IDLE_DELAY_MS = Number(process.env.WORKER_IDLE_DELAY_MS ?? 5_000);
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current tick…`);
    stopping = true;
  });
}

async function main() {
  const { runWorkerTick } = await import("../src/server/jobs/worker");
  console.log("[worker] started");
  while (!stopping) {
    try {
      const summary = await runWorkerTick({ timeBudgetMs: 60_000 });
      if (summary.claimed > 0) console.log("[worker] tick", JSON.stringify(summary));
      else await new Promise((r) => setTimeout(r, IDLE_DELAY_MS));
    } catch (error) {
      console.error("[worker] tick error", error instanceof Error ? error.message : error);
      await new Promise((r) => setTimeout(r, IDLE_DELAY_MS * 2));
    }
  }
  console.log("[worker] stopped");
}

void main();
