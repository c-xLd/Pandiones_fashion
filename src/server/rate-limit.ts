import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export class RateLimitError extends Error {
  constructor(message = "Too many requests. Please wait a moment and try again.") {
    super(message);
    this.name = "RateLimitError";
  }
}

/** Named limits: [max hits, window seconds]. Shared across all server instances via Postgres. */
export const LIMITS = {
  generate: [60, 60],
  analyze: [30, 60],
  upload: [300, 60],
  export: [10, 60],
  auth: [10, 300],
  mutate: [120, 60],
} as const satisfies Record<string, readonly [number, number]>;

export async function enforceRateLimit(scope: keyof typeof LIMITS, subject: string): Promise<void> {
  const [limit, windowSeconds] = LIMITS[scope];
  const { data, error } = await getSupabaseAdmin().rpc("rate_limit_hit", {
    p_key: `${scope}:${subject}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed for expensive operations, open for cheap ones.
    console.error("[rate-limit] check failed", { scope, error: error.message });
    if (scope === "generate" || scope === "export") throw new RateLimitError("Rate limiter unavailable; try again shortly.");
    return;
  }
  if (data === false) throw new RateLimitError();
}
