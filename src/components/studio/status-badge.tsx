"use client";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n/client";

type Variant = NonNullable<BadgeProps["variant"]>;

const MAP: Record<string, Variant> = {
  // job
  queued: "secondary",
  processing: "info",
  succeeded: "success",
  failed: "destructive",
  cancelled: "outline",
  // review
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  // qc
  not_run: "outline",
  passed: "success",
  flagged: "warning",
  error: "destructive",
  // product
  draft: "secondary",
  ready: "info",
  completed: "success",
  archived: "outline",
  // model / video
  active: "success",
  retired: "outline",
  none: "outline",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { d } = useI18n();
  const e = d.enums;
  // Status words are shared across entities; the first matching translation wins.
  const translated = [e.jobStatus, e.reviewStatus, e.productStatus, e.videoStatus, e.modelStatus, e.analysisStatus]
    .map((m) => (m as Record<string, string>)[status])
    .find(Boolean);
  return <Badge variant={MAP[status] ?? "secondary"}>{label ?? translated ?? status.replace(/_/g, " ")}</Badge>;
}

export function QcBadge({ status }: { status: string }) {
  const { d } = useI18n();
  const label = (d.enums.qcStatus as Record<string, string>)[status] ?? status;
  return <StatusBadge status={status === "queued" ? "queued" : status} label={label} />;
}
