import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function MediaThumb({
  src,
  alt,
  className,
  kind = "image",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  kind?: "image" | "video";
}) {
  if (!src) {
    return (
      <div className={cn("flex aspect-[3/4] items-center justify-center rounded-md bg-muted text-muted-foreground", className)}>
        <ImageOff className="h-5 w-5" aria-hidden />
        <span className="sr-only">{alt}</span>
      </div>
    );
  }
  if (kind === "video") {
    return <video src={src} className={cn("aspect-[3/4] w-full rounded-md bg-black object-cover", className)} muted preload="metadata" aria-label={alt} />;
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={cn("aspect-[3/4] w-full rounded-md bg-muted object-cover", className)} />;
}
