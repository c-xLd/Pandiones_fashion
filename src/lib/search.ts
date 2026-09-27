/** Make free text safe for a PostgREST `ilike` filter inside `.or()`. */
export function sanitizeSearch(q: string | undefined | null): string | null {
  if (!q) return null;
  const cleaned = q.replace(/[%_*,()\\"'.:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned.length ? cleaned : null;
}
