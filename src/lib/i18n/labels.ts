import type { Dictionary } from "./dictionaries";

/** Translate a shot type (or return it unchanged if unknown). */
export function shotLabel(d: Dictionary, value: string | null | undefined): string {
  if (!value) return "";
  return (d.enums.shotType as Record<string, string>)[value] ?? value;
}

/** Human-readable explanation for a stored job error code. */
export function jobErrorLabel(d: Dictionary, code: string | null | undefined): string | null {
  if (!code) return null;
  const map = d.jobErrors as Record<string, string>;
  if (map[code]) return map[code];
  if (code.startsWith("http_5")) return map.http_500 ?? null;
  return null;
}
