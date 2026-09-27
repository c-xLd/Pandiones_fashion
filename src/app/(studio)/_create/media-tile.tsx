"use client";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Loader2, Play, Trash2 } from "lucide-react";
import { deleteResults, getResultDownloadUrl } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export interface MediaTileProps {
  resultId: string;
  href: string;
  kind: "image" | "video";
  url: string | null;
  alt: string;
  /** CSS aspect-ratio value, e.g. "3/4". */
  aspect: string;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
  canDelete: boolean;
}

/**
 * Gallery tile: media fills the card. Tap (or click) shows actions: open,
 * download the stored original (2K/4K), delete. Videos preview on hover.
 */
export function MediaTile({ resultId, href, kind, url, alt, aspect, title, subtitle, badges, canDelete }: MediaTileProps) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.create;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"download" | "delete" | null>(null);
  const [, start] = useTransition();

  function download() {
    setError(null);
    setBusy("download");
    start(async () => {
      const res = await getResultDownloadUrl(resultId);
      setBusy(null);
      if (!res.ok) return setError(res.error);
      window.location.href = res.data.url;
    });
  }

  function remove() {
    setError(null);
    setBusy("delete");
    start(async () => {
      const res = await deleteResults({ resultIds: [resultId] });
      setBusy(null);
      if (!res.ok) return setError(res.error);
      setGone(true);
      router.refresh();
    });
  }

  if (gone) return null;
  return (
    <div
      className="flow-drop group relative mb-3 block break-inside-avoid overflow-hidden rounded-2xl bg-card"
      style={{ aspectRatio: aspect }}
      onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      <button
        type="button"
        aria-label={title}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setConfirming(false);
        }}
        className="absolute inset-0 h-full w-full outline-none ring-ring focus-visible:ring-2"
      >
        {url ? (
          kind === "video" ? (
            <video ref={videoRef} src={url} muted loop playsInline preload="metadata" aria-label={alt} className="h-full w-full object-cover" />
          ) : (
            <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          )
        ) : (
          <span className="block h-full w-full bg-muted" />
        )}
      </button>
      {kind === "video" && (
        <span className="pointer-events-none absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur" aria-hidden>
          <Play className="h-3.5 w-3.5 fill-current" />
        </span>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-10 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <p className="truncate text-sm font-medium text-white">{title}</p>
        {subtitle ? <p className="truncate text-xs text-white/70">{subtitle}</p> : null}
        {badges ? <div className="mt-1.5 flex flex-wrap gap-1">{badges}</div> : null}
        {error ? <p className="mt-1 text-xs text-red-300">{error}</p> : null}
      </div>

      {open && (
        <div className="absolute inset-x-2 top-2 flex flex-wrap justify-end gap-1.5">
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(false)} className={actionClass}>
                {d.common.cancel}
              </button>
              <button type="button" disabled={busy !== null} onClick={remove} className={cn(actionClass, "bg-red-600/90 text-white hover:bg-red-600")}>
                {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} {t.confirmDelete}
              </button>
            </>
          ) : (
            <>
              <Link href={href} className={actionClass}>
                <ExternalLink className="h-3.5 w-3.5" /> {t.openDetails}
              </Link>
              <button type="button" disabled={busy !== null} onClick={download} className={actionClass}>
                {busy === "download" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {d.common.download}
              </button>
              {canDelete && (
                <button type="button" onClick={() => setConfirming(true)} className={actionClass} aria-label={t.deletePhoto}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const actionClass =
  "flex h-8 items-center gap-1.5 rounded-full bg-black/65 px-3 text-xs font-medium text-white backdrop-blur hover:bg-black/80 disabled:opacity-60";
