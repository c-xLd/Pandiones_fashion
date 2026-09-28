"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Square, X } from "lucide-react";
import { cancelJobs } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** In-progress generation on the canvas, with a cancel button (saves quota). */
export function ActiveTile({
  jobId,
  aspect,
  status,
  progress,
  label,
  video,
  canEdit,
  className,
}: {
  jobId: string;
  aspect: string;
  status: "queued" | "processing";
  progress: number;
  label: string;
  video?: boolean;
  canEdit: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [pending, start] = useTransition();
  const [stopped, setStopped] = useState<"cancelled" | "stopping" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    start(async () => {
      const res = await cancelJobs({ jobIds: [jobId] });
      if (!res.ok) return setError(res.error);
      // Neither cancelled nor stopping: the job had already finished.
      setStopped(res.data.stopping ? "stopping" : "cancelled");
      router.refresh();
    });
  }

  if (stopped === "cancelled") return null;
  return (
    <div
      className={cn("flow-shimmer relative mb-3 flex break-inside-avoid flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border text-center", className)}
      style={{ aspectRatio: aspect }}
    >
      {canEdit && !stopped && (
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          aria-label={t.cancelJob}
          className="absolute right-2 top-2 flex h-8 items-center gap-1 rounded-full bg-black/55 px-2.5 text-xs text-white backdrop-blur active:scale-95 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} {t.cancelJob}
        </button>
      )}
      {video ? <Clapperboard className="h-5 w-5 text-muted-foreground" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      <span className="text-sm font-medium">{stopped === "stopping" ? t.stopping : status === "queued" ? t.queued : t.generating}</span>
      {label ? <span className="px-3 text-xs text-muted-foreground">{label}</span> : null}
      {stopped === "stopping" && <span className="px-3 text-[11px] text-muted-foreground">{t.stoppingHint}</span>}
      {error && <span className="px-3 text-xs text-destructive">{error}</span>}
      {status === "processing" && progress > 0 && !stopped && (
        <span className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full bg-white/10">
          <span className="flow-gradient block h-full" style={{ width: `${Math.min(100, progress)}%` }} />
        </span>
      )}
    </div>
  );
}

/** "Stop all (n)": cancels every queued/running generation of the organization. */
export function StopAllButton({ count }: { count: number }) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (error) {
    return (
      <button type="button" onClick={() => setError(null)} className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
        {error}
      </button>
    );
  }
  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={() => setConfirming(false)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground">
          {d.common.cancel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await cancelJobs({ allActive: true });
              setConfirming(false);
              if (!res.ok) return setError(res.error);
              router.refresh();
            })
          }
          className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3 w-3 fill-current" />} {t.confirmStopAll}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive active:scale-95"
    >
      <Square className="h-3 w-3 fill-current" /> {fmt(t.stopAll, { n: count })}
    </button>
  );
}
