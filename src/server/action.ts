import "server-only";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { AuthorizationError, UserFacingError } from "./errors";
import { RateLimitError } from "./rate-limit";
import type { ActionResult } from "@/lib/types";

export { UserFacingError };

/**
 * Converts thrown errors into a safe ActionResult. Only errors known to carry
 * user-safe messages are shown; everything else is logged server-side and
 * replaced by a generic message.
 */
export function toActionError(error: unknown, context: string): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: error.issues[0]?.message ?? "Invalid input", fieldErrors };
  }
  if (
    error instanceof AuthorizationError ||
    error instanceof RateLimitError ||
    error instanceof UserFacingError ||
    error instanceof ConfigError
  ) {
    return { ok: false, error: error.message };
  }
  console.error(`[action:${context}]`, error instanceof Error ? { name: error.name, message: error.message } : error);
  return { ok: false, error: "Something went wrong. The error has been logged." };
}

export async function runAction<T>(context: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data } as ActionResult<T>;
  } catch (error) {
    // Let Next.js redirect()/notFound() propagate.
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw error;
    }
    return toActionError(error, context);
  }
}

/** Throw on a Supabase error with a safe message. */
export function check<T>(result: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (result.error) {
    if (result.error.code === "23505") throw new UserFacingError(`${what}: a record with the same unique value already exists.`);
    if (result.error.code === "42501") throw new AuthorizationError();
    throw new Error(`${what}: ${result.error.message}`);
  }
  return result.data;
}
