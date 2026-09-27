"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export default function StudioError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { d } = useI18n();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-xl border p-6 text-center">
      <h2 className="text-lg font-semibold">{d.errorPage.title}</h2>
      <p className="text-sm text-muted-foreground">
        {d.errorPage.body} {error.digest ? fmt(d.errorPage.reference, { digest: error.digest }) : ""}
      </p>
      <Button onClick={reset}>{d.common.tryAgain}</Button>
    </div>
  );
}
