"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/studio/status-badge";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { shotLabel } from "@/lib/i18n/labels";

export interface LibraryItem {
  id: string;
  kind: "image" | "video";
  url: string | null;
  href: string;
  sku: string | null;
  shotType: string | null;
  model: string;
  reviewStatus: string;
  createdAt: string;
}

export function LibraryGrid({ items }: { items: LibraryItem[] }) {
  const { d } = useI18n();
  const t = d.library;
  const [selected, setSelected] = useState<string[]>([]);
  const [approvedOnly, setApprovedOnly] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function exportZip() {
    setError(null);
    start(async () => {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resultIds: selected, approvedOnly }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? fmt(t.exportFailed, { status: res.status }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export.zip";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={selected.length > 0 && selected.length === items.length}
            onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id).slice(0, 100) : [])}
            aria-label={t.selectAllPage}
          />
          {fmt(d.common.selected, { n: selected.length })}
        </label>
        <label className="flex items-center gap-2">
          <Checkbox checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
          {t.approvedOnly}
        </label>
        <Button size="sm" onClick={exportZip} disabled={!selected.length || pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Download />} {t.exportZip}
        </Button>
        <span className="text-xs text-muted-foreground">{t.exportHint}</span>
        {error && <span className="text-destructive">{error}</span>}
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {items.map((item) => (
          <li key={item.id} className={`space-y-1.5 rounded-lg border bg-card p-2 ${selected.includes(item.id) ? "ring-2 ring-primary" : ""}`}>
            <div className="relative">
              <Checkbox
                className="absolute left-2 top-2 z-10 h-5 w-5 bg-background"
                checked={selected.includes(item.id)}
                onChange={(e) => setSelected((s) => (e.target.checked ? (s.length < 100 ? [...s, item.id] : s) : s.filter((x) => x !== item.id)))}
                aria-label={t.selectForExport}
              />
              <Link href={item.href}>
                {item.kind === "video" ? (
                  <video src={item.url ?? undefined} muted preload="metadata" className="aspect-[3/4] w-full rounded-md bg-black object-cover" />
                ) : item.url ? (
                  <img src={item.url} alt="" loading="lazy" className="aspect-[3/4] w-full rounded-md object-cover" />
                ) : (
                  <div className="aspect-[3/4] rounded-md bg-muted" />
                )}
              </Link>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono">{item.sku ?? "—"}</span>
              <span className="text-muted-foreground">{item.kind === "video" ? t.video : shotLabel(d, item.shotType)}</span>
            </div>
            <div className="flex items-center justify-between">
              <StatusBadge status={item.reviewStatus} />
              <span className="max-w-[90px] truncate text-[10px] text-muted-foreground" title={item.model}>
                {item.model}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
