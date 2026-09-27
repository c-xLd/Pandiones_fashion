"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveResultAsModel } from "@/server/actions/models";
import { useI18n } from "@/lib/i18n/client";

/** Save the fictional person in a generated photo as a reusable model. */
export function SaveModelCard({ resultId }: { resultId: string }) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center">
      <span className="flow-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
        <Sparkles className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{saved ? `${t.saveModelDone} · ${saved.name}` : t.saveModel}</p>
        <p className="text-sm text-muted-foreground">{error ?? t.saveModelBody}</p>
      </div>
      {saved ? (
        <Button onClick={() => router.push(`/?modelId=${saved.id}`)}>{t.shootWithModel}</Button>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const res = await saveResultAsModel({ resultId, name: name.trim() || undefined });
              if (!res.ok) return setError(res.error);
              setSaved(res.data);
              router.refresh();
            });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t.saveModelName} aria-label={t.saveModelName} className="h-9 w-44" />
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} {t.saveModel}
          </Button>
        </form>
      )}
    </div>
  );
}
