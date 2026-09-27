import { z } from "zod";
import trLocale from "zod/v4/locales/tr.js";
import { fmt, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";

const trErrorMap = trLocale().localeError;

/**
 * Localize a zod issue. Custom schema messages are dictionary keys
 * (d.validation.*); other messages are zod's built-in texts, re-rendered
 * with zod's Turkish locale when needed.
 */
export function localizeIssue(issue: z.core.$ZodIssue, locale: Locale, d: Dictionary): string {
  const custom = (d.validation as Record<string, string>)[issue.message];
  if (custom) return fmt(custom, issue as unknown as Record<string, string | number>);
  if (locale === "tr") {
    const out = trErrorMap(issue as unknown as Parameters<typeof trErrorMap>[0]);
    const message = typeof out === "string" ? out : out?.message;
    if (message) return message;
  }
  return issue.message;
}

export function localizeZodError(error: z.ZodError, locale: Locale, d: Dictionary) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fieldErrors[key] ??= []).push(localizeIssue(issue, locale, d));
  }
  const first = error.issues[0];
  return { error: first ? localizeIssue(first, locale, d) : d.errors.invalidInput, fieldErrors };
}
