"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/client";
import { setLocale } from "@/server/actions/locale";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, d } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Languages className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">{d.common.language}</span>
      <NativeSelect
        aria-label={d.common.language}
        className="h-8 text-xs"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}
