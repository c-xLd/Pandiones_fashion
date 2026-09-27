import { en } from "./en";
import { tr } from "./tr";
import type { Locale } from "../config";

export type Dictionary = typeof en;
export type ErrorKey = keyof Dictionary["errors"];

export const dictionaries: Record<Locale, Dictionary> = { en, tr };

export function getDictionarySync(locale: Locale): Dictionary {
  return dictionaries[locale];
}
