"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { dismissJobs, retryJob } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** Failed generation on the canvas: tap for the error, retry or remove. */
export function FailedTile({ jobId, aspect, reason, canEdit }: { jobId: string; aspect: string; reason: string; canEdit: boolean }) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);

  function run(action: "retry" | "remove") {
    setError(null);
    start(async () => {
      if (action === "retry") {
        const res = await retryJob(jobId);
        if (!res.ok) return setError(res.error);
      }
      // A retried job is replaced by its new attempt, so hide the failed one either way.
      const res = await dismissJobs({ jobIds: [jobId] });
      if (!res.ok) return setError(res.error);
      setGone(true);
      router.refresh();
    });
  }

  if (gone) return null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((v) => !v);
        }
      }}
      className="flow-drop relative mb-3 flex cursor-pointer break-inside-avoid flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-center outline-none ring-ring focus-visible:ring-2"
      style={{ aspectRatio: aspect }}
    >
      {canEdit && !open && (
        <button
          type="button"
          aria-label={t.remove}
          title={t.remove}
          disabled={pending}
          onClick={(e) => {
            e.stopPropagation();
            run("remove");
          }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </button>
      )}
      <AlertTriangle className="h-5 w-5 text-destructive" />
      <span className="text-sm font-medium">{t.failed}</span>
      <span className={cn("text-xs text-muted-foreground", open ? "line-clamp-6" : "line-clamp-2")}>{reason}</span>
      {error && <span className="text-xs text-destructive">{error}</span>}
      {open && canEdit && (
        <div className="mt-1 flex flex-wrap justify-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("retry")}
            className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} {d.common.retry}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run("remove")}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> {t.remove}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Clear failed (n)" chip next to the canvas filters. */
export function ClearFailedButton({ count }: { count: number }) {
  const router = useRouter();
  const { d } = useI18n();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await dismissJobs({ allFailed: true });
          if (res.ok) router.refresh();
        })
      }
      className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-50"
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {d.create.clearFailed.replace("{n}", String(count))}
    </button>
  );
}
