export const LOCALES = ["tr", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "pfs_locale";

export const LOCALE_NAMES: Record<Locale, string> = { tr: "Türkçe", en: "English" };

/** Intl locale tags used for dates, numbers and currency. */
export const INTL_LOCALE: Record<Locale, string> = { tr: "tr-TR", en: "en-GB" };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Cookie wins; otherwise the first supported language in Accept-Language. */
export function resolveLocale(cookieValue: string | undefined | null, acceptLanguage: string | undefined | null): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { lang: (tag ?? "").toLowerCase().split("-")[0] ?? "", q: q ? Number(q.split("=")[1]) || 0 : 1 };
    })
    .filter((x) => x.lang)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of preferred) if (isLocale(lang)) return lang;
  return DEFAULT_LOCALE;
}

/** Replace {name} placeholders. Unknown placeholders are left as-is. */
export function fmt(template: string, vars: Record<string, string | number | null | undefined> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}
