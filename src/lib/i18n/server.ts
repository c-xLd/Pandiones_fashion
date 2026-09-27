import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { dictionaries, type Dictionary } from "./dictionaries";

/** Locale for the current request (cookie, then Accept-Language). */
export const getLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
});

export async function getI18n(): Promise<{ locale: Locale; d: Dictionary }> {
  const locale = await getLocale();
  return { locale, d: dictionaries[locale] };
}
