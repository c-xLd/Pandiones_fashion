import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export class RateLimitError extends Error {
  constructor(public readonly key: "rateLimited" | "rateLimiterUnavailable" = "rateLimited") {
    super(key === "rateLimited" ? "Too many requests. Please wait a moment and try again." : "Rate limiter unavailable; try again shortly.");
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
    if (scope === "generate" || scope === "export") throw new RateLimitError("rateLimiterUnavailable");
    return;
  }
  if (data === false) throw new RateLimitError();
}
