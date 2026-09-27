import { Badge, type BadgeProps } from "@/components/ui/badge";

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
  return <Badge variant={MAP[status] ?? "secondary"}>{label ?? status.replace(/_/g, " ")}</Badge>;
}

export function QcBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    not_run: "QC not run",
    queued: "QC queued",
    passed: "QC: no issues found",
    flagged: "QC: flagged",
    error: "QC error",
  };
  return <StatusBadge status={status === "queued" ? "queued" : status} label={labels[status] ?? status} />;
}
