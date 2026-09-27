"use client";
import { createContext, useContext } from "react";
import type { Locale } from "./config";
import type { Dictionary } from "./dictionaries";

const I18nContext = createContext<{ locale: Locale; d: Dictionary } | null>(null);

export function I18nProvider({ locale, d, children }: { locale: Locale; d: Dictionary; children: React.ReactNode }) {
  return <I18nContext.Provider value={{ locale, d }}>{children}</I18nContext.Provider>;
}

export function useI18n(): { locale: Locale; d: Dictionary } {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
