import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Download, RotateCcw, X, XCircle } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { setVideoApproval } from "@/server/actions/video";
import { cancelJob, retryJob } from "@/server/actions/generation";
import { exportFileName } from "@/lib/domain/files";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/utils";
import type { JobRow, ResultRow, UsageRow, VideoProjectRow } from "@/lib/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/studio/page-header";
import { StatusBadge } from "@/components/studio/status-badge";
import { ActionButton } from "@/components/studio/action-button";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import { jobErrorLabel } from "@/lib/i18n/labels";

export const generateMetadata = pageMetadata((d) => d.video.project.metaTitle);

export default async function VideoProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const t = d.video.project;
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  const { data } = await db.from("video_projects").select("*, products(id, sku)").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!data) notFound();
  const project = data as VideoProjectRow & { products: { id: string; sku: string } | null };

  const [jobsRes, videosRes, sourcesRes] = await Promise.all([
    db.from("generation_jobs").select("*").eq("video_project_id", id).eq("organization_id", org).order("created_at", { ascending: false }),
    db.from("generation_results").select("*").eq("video_project_id", id).eq("organization_id", org).eq("kind", "video").order("created_at", { ascending: false }),
    project.source_result_ids.length
      ? db.from("generation_results").select("*").eq("organization_id", org).in("id", project.source_result_ids)
      : Promise.resolve({ data: [] }),
  ]);
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const videos = (videosRes.data ?? []) as ResultRow[];
  const sources = (sourcesRes.data ?? []) as ResultRow[];
  const jobIds = jobs.map((j) => j.id);
  const usage = jobIds.length ? (((await db.from("usage_ledger").select("*").in("job_id", jobIds)).data ?? []) as UsageRow[]) : [];
  const [viewUrls, downloadUrls] = await Promise.all([
    signUrls(db, [...videos.map((v) => v.storage_path), ...sources.map((s) => s.thumbnail_path)]),
    signUrls(db, videos.map((v) => v.storage_path), { download: true }),
  ]);
  const latestJob = jobs[0];
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const active = project.status === "queued" || project.status === "processing";

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{fmt(t.kindVideo, { kind: d.enums.videoKind[project.kind] })}</Badge>
            <StatusBadge status={project.status} />
            <StatusBadge status={project.approval_status} label={fmt(t.approval, { status: d.enums.reviewStatus[project.approval_status] })} />
            <AutoRefresh active={active} intervalMs={10000} />
          </span>
        }
        actions={
          canEdit && (
            <>
              {active && latestJob && !latestJob.cancel_requested && (
                <ActionButton variant="outline" action={cancelJob.bind(null, latestJob.id)} confirm={t.cancelConfirm}>
                  <XCircle /> {d.common.cancel}
                </ActionButton>
              )}
              {(project.status === "failed" || project.status === "cancelled") && latestJob && (
                <ActionButton variant="outline" action={retryJob.bind(null, latestJob.id)}>
                  <RotateCcw /> {d.common.retry}
                </ActionButton>
              )}
              {project.status === "ready" && project.approval_status !== "approved" && (
                <ActionButton variant="success" action={setVideoApproval.bind(null, project.id, "approved")}>
                  <Check /> {d.common.approve}
                </ActionButton>
              )}
              {project.status === "ready" && project.approval_status !== "rejected" && (
                <ActionButton variant="destructive" action={setVideoApproval.bind(null, project.id, "rejected")}>
                  <X /> {d.common.reject}
                </ActionButton>
              )}
            </>
          )
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{t.preview}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {active && latestJob && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {fmt(t.generating, { status: d.enums.jobStatus[latestJob.status], submitted: latestJob.provider_operation ? t.submitted : "" })}
                </p>
                <Progress value={latestJob.progress} label={t.progress} />
              </div>
            )}
            {project.status === "failed" && latestJob?.error_message && (
              <Alert variant="destructive">
                <AlertDescription>
                  {jobErrorLabel(d, latestJob.error_code) ?? latestJob.error_message}
                  {jobErrorLabel(d, latestJob.error_code) && <span className="block text-xs opacity-80">{latestJob.error_message}</span>}
                </AlertDescription>
              </Alert>
            )}
            {videos.map((v) => (
              <div key={v.id} className="space-y-2">
                <video src={viewUrls[v.storage_path]} controls playsInline className="max-h-[70vh] w-full rounded-md bg-black" />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {v.duration_seconds}s · {formatBytes(v.size_bytes)} · {v.model}
                  </span>
                  {downloadUrls[v.storage_path] && (
                    <Button asChild size="sm" variant="outline">
                      <a href={downloadUrls[v.storage_path]} download={exportFileName({ sku: project.products?.sku ?? null, shotType: "video", id: v.id, mimeType: v.mime_type })}>
                        <Download /> {t.downloadMp4}
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!active && videos.length === 0 && project.status !== "failed" && <p className="text-sm text-muted-foreground">{t.noOutput}</p>}
            {project.approval_status !== "approved" && videos.length > 0 && (
              <p className="text-xs text-warning-foreground">{t.notApproved}</p>
            )}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t.brief}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-2">
                {sources.map((s) => (
                  <Link key={s.id} href={`/results/${s.id}`}>
                    <img src={s.thumbnail_path ? viewUrls[s.thumbnail_path] : undefined} alt={t.source} className="h-24 rounded object-cover" />
                  </Link>
                ))}
              </div>
              <dl className="grid grid-cols-[100px_1fr] gap-1">
                <dt className="text-muted-foreground">{t.product}</dt>
                <dd>{project.products ? <Link className="underline" href={`/products/${project.products.id}`}>{project.products.sku}</Link> : "—"}</dd>
                <dt className="text-muted-foreground">{t.prompt}</dt>
                <dd>{project.prompt}</dd>
                {project.motion_instructions && (
                  <>
                    <dt className="text-muted-foreground">{t.motion}</dt>
                    <dd>{project.motion_instructions}</dd>
                  </>
                )}
                {project.brief && (
                  <>
                    <dt className="text-muted-foreground">{t.briefField}</dt>
                    <dd>{project.brief}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t.spec}</dt>
                <dd>
                  {project.duration_seconds}s · {project.aspect_ratio} · {project.resolution}
                </dd>
                <dt className="text-muted-foreground">{t.provider}</dt>
                <dd>
                  {project.provider} · {project.model}
                </dd>
                <dt className="text-muted-foreground">{t.created}</dt>
                <dd>{formatDateTime(project.created_at, locale)}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t.cost}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {usage.length === 0 ? (
                <p className="text-muted-foreground">{t.costPending}</p>
              ) : (
                usage.map((u) => (
                  <p key={u.id} className="flex justify-between">
                    <span>{fmt(t.secondsGenerated, { s: String((u.units as { seconds?: number }).seconds ?? "?") })}</span>
                    <span>
                      {formatMoney(u.cost_amount == null ? null : Number(u.cost_amount), "USD", 4, locale)} <Badge variant="outline">{d.enums.costSource[u.cost_source]}</Badge>
                    </span>
                  </p>
                ))
              )}
              <p className="pt-2 text-xs text-muted-foreground">{t.costNote}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
