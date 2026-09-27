import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatMoney(amount: number | null | undefined, currency = "USD", digits = 4, locale: Locale = "en"): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(amount);
}

export function formatDateTime(value: string | null | undefined, locale: Locale = "en"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(value),
  ) + " UTC";
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
