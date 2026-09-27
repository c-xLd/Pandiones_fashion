"use client";
import Link from "next/link";
import { useRef } from "react";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MediaTileProps {
  href: string;
  kind: "image" | "video";
  url: string | null;
  alt: string;
  /** CSS aspect-ratio value, e.g. "3/4". */
  aspect: string;
  title: string;
  subtitle?: string;
  badges?: React.ReactNode;
}

/** Gallery tile: media fills the card; details fade in on hover/focus. Videos preview on hover. */
export function MediaTile({ href, kind, url, alt, aspect, title, subtitle, badges }: MediaTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <Link
      href={href}
      className="group relative mb-3 block break-inside-avoid overflow-hidden rounded-2xl bg-card outline-none ring-ring focus-visible:ring-2"
      style={{ aspectRatio: aspect }}
      onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      {url ? (
        kind === "video" ? (
          <video ref={videoRef} src={url} muted loop playsInline preload="metadata" aria-label={alt} className="h-full w-full object-cover" />
        ) : (
          <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        )
      ) : (
        <div className="h-full w-full bg-muted" aria-label={alt} />
      )}
      {kind === "video" && (
        <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur" aria-hidden>
          <Play className="h-3.5 w-3.5 fill-current" />
        </span>
      )}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-3 pt-10",
          "opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      >
        <p className="truncate text-sm font-medium text-white">{title}</p>
        {subtitle ? <p className="truncate text-xs text-white/70">{subtitle}</p> : null}
        {badges ? <div className="mt-1.5 flex flex-wrap gap-1">{badges}</div> : null}
      </div>
    </Link>
  );
}
