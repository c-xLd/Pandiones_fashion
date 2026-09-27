"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { QcBadge, StatusBadge } from "@/components/studio/status-badge";
import { reviewResults } from "@/server/actions/generation";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { shotLabel } from "@/lib/i18n/labels";

export interface ReviewItem {
  id: string;
  url: string | null;
  sku: string | null;
  shotType: string | null;
  qcStatus: string;
  flagCount: number;
  reviewStatus: string;
}

export function ReviewGrid({ items, canEdit }: { items: ReviewItem[]; canEdit: boolean }) {
  const router = useRouter();
  const { d } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(ids: string[], decision: "approved" | "rejected") {
    setError(null);
    start(async () => {
      const res = await reviewResults({ resultIds: ids, decision, notes: notes || undefined });
      if (!res.ok) setError(res.error);
      else {
        setSelected([]);
        setNotes("");
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.length > 0 && selected.length === items.length}
              onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
              aria-label={d.common.selectAll}
            />
            {fmt(d.common.selected, { n: selected.length })}
          </label>
          <Input className="h-8 max-w-xs" placeholder={d.review.notePlaceholder} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} aria-label={d.review.noteLabel} />
          <Button size="sm" variant="success" disabled={!selected.length || pending} onClick={() => decide(selected, "approved")}>
            {pending ? <Loader2 className="animate-spin" /> : <Check />} {d.common.approve}
          </Button>
          <Button size="sm" variant="destructive" disabled={!selected.length || pending} onClick={() => decide(selected, "rejected")}>
            <X /> {d.common.reject}
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((item) => (
          <li key={item.id} className={`space-y-2 rounded-lg border bg-card p-2 ${selected.includes(item.id) ? "ring-2 ring-primary" : ""}`}>
            <div className="relative">
              {canEdit && (
                <Checkbox
                  className="absolute left-2 top-2 z-10 h-5 w-5 bg-background"
                  checked={selected.includes(item.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, item.id] : s.filter((x) => x !== item.id)))}
                  aria-label={d.review.selectImage}
                />
              )}
              <Link href={`/results/${item.id}`}>
                {item.url ? (
                  <img src={item.url} alt={`${item.sku ?? ""} ${item.shotType ?? ""}`} loading="lazy" className="aspect-[3/4] w-full rounded-md object-cover" />
                ) : (
                  <div className="aspect-[3/4] rounded-md bg-muted" />
                )}
              </Link>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono">{item.sku ?? "—"}</span>
              <span className="text-muted-foreground">{shotLabel(d, item.shotType)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <StatusBadge status={item.reviewStatus} />
              <QcBadge status={item.qcStatus} />
              {item.flagCount > 0 && <span className="text-[11px] text-warning-foreground">{fmt(d.review.flags, { n: item.flagCount })}</span>}
            </div>
            {canEdit && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={pending} onClick={() => decide([item.id], "approved")}>
                  {d.common.approve}
                </Button>
                <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" disabled={pending} onClick={() => decide([item.id], "rejected")}>
                  {d.common.reject}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
