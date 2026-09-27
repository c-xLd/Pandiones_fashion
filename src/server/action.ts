import "server-only";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/env";
import { fmt } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n/server";
import { localizeZodError } from "@/lib/i18n/zod";
import { AuthorizationError, UserFacingError } from "./errors";
import { RateLimitError } from "./rate-limit";
import type { ActionResult } from "@/lib/types";

export { UserFacingError };

/**
 * Converts thrown errors into a safe ActionResult in the requester's
 * language. Only errors known to carry user-safe messages are shown;
 * everything else is logged server-side and replaced by a generic message.
 */
export async function toActionError(
  error: unknown,
  context: string,
): Promise<{ ok: false; error: string; fieldErrors?: Record<string, string[]> }> {
  const { locale, d } = await getI18n();
  if (error instanceof ZodError) {
    return { ok: false, ...localizeZodError(error, locale, d) };
  }
  if (error instanceof UserFacingError || error instanceof AuthorizationError) {
    const vars = { ...error.vars };
    if (typeof vars.role === "string" && vars.role in d.enums.role) {
      vars.role = d.enums.role[vars.role as keyof typeof d.enums.role];
    }
    return { ok: false, error: fmt(d.errors[error.key], vars) };
  }
  if (error instanceof RateLimitError) return { ok: false, error: d.errors[error.key] };
  if (error instanceof ConfigError) return { ok: false, error: fmt(d.errors.config, { detail: error.message }) };
  console.error(`[action:${context}]`, error instanceof Error ? { name: error.name, message: error.message } : error);
  return { ok: false, error: d.errors.generic };
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
    if (result.error.code === "23505") throw new UserFacingError("duplicate", { what });
    if (result.error.code === "42501") throw new AuthorizationError();
    throw new Error(`${what}: ${result.error.message}`);
  }
  return result.data;
}
