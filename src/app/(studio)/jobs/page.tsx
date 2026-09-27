import Link from "next/link";
import { ListChecks, RotateCcw, XCircle } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { cancelJob, retryJob } from "@/server/actions/generation";
import { JOB_STATUSES, JOB_TYPES } from "@/lib/domain/schemas";
import { formatDateTime } from "@/lib/utils";
import type { JobRow } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { StatusBadge } from "@/components/studio/status-badge";
import { EmptyState } from "@/components/studio/empty-state";
import { Pagination } from "@/components/studio/pagination";
import { ActionButton } from "@/components/studio/action-button";
import { AutoRefresh } from "@/components/studio/auto-refresh";

export const metadata = { title: "Jobs" };
const PAGE_SIZE = 50;

function duration(job: JobRow): string {
  if (!job.started_at) return "—";
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(job.started_at).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const org = ctx.org.organizationId;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const status = sp.status;
  const type = JOB_TYPES.includes(sp.type as (typeof JOB_TYPES)[number]) ? sp.type : undefined;
  const batch = sp.batch && /^[0-9a-f-]{36}$/i.test(sp.batch) ? sp.batch : undefined;

  let query = ctx.supabase
    .from("generation_jobs")
    .select("*, products(sku)", { count: "exact" })
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (status === "active") query = query.in("status", ["queued", "processing"]);
  else if (JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number])) query = query.eq("status", status as string);
  if (type) query = query.eq("job_type", type);
  if (batch) query = query.eq("batch_id", batch);

  const [{ data, count, error }, oldestQueued] = await Promise.all([
    query,
    ctx.supabase.from("generation_jobs").select("created_at").eq("organization_id", org).eq("status", "queued").lte("run_after", new Date().toISOString()).order("created_at").limit(1),
  ]);
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as (JobRow & { products: { sku: string } | null })[];
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const active = jobs.some((j) => j.status === "queued" || j.status === "processing");
  const oldest = oldestQueued.data?.[0]?.created_at as string | undefined;
  const stalledMinutes = oldest ? (Date.now() - new Date(oldest).getTime()) / 60000 : 0;

  return (
    <>
      <PageHeader
        title="Generation queue"
        description={
          <span className="flex flex-wrap items-center gap-3">
            Durable background jobs. Closing the browser does not stop them.
            <AutoRefresh active={active} />
          </span>
        }
      />
      {stalledMinutes > 5 && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Jobs are waiting longer than expected</AlertTitle>
          <AlertDescription>
            The oldest runnable job has been queued for {Math.round(stalledMinutes)} minutes. Check that the worker is scheduled (Vercel Cron or{" "}
            <code>npm run worker</code>) — see docs/OPERATIONS.md.
          </AlertDescription>
        </Alert>
      )}
      <form className="mb-4 grid gap-2 sm:grid-cols-[180px_200px_auto]">
        <NativeSelect name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active (queued + processing)</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="type" defaultValue={type ?? ""} aria-label="Job type">
          <option value="">All types</option>
          {JOB_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </NativeSelect>
        <div className="flex gap-2">
          {batch && <input type="hidden" name="batch" value={batch} />}
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {batch && (
            <Button asChild variant="ghost">
              <Link href="/jobs">Clear batch filter</Link>
            </Button>
          )}
          {batch && (
            <Button asChild variant="outline">
              <Link href={`/review?batch=${batch}`}>Review this batch</Link>
            </Button>
          )}
        </div>
      </form>

      {jobs.length === 0 ? (
        <EmptyState icon={ListChecks} title="No jobs" description="Start a shoot or run a product analysis to create jobs." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="w-44">Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Details</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(j.created_at)}</TableCell>
                  <TableCell className="text-xs">
                    {j.job_type.replace(/_/g, " ")}
                    {typeof j.config.style === "object" && j.config.style && (
                      <span className="block text-muted-foreground">{(j.config.style as { shotType?: string }).shotType}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {j.product_id ? <Link href={`/products/${j.product_id}`} className="hover:underline">{j.products?.sku ?? "—"}</Link> : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <StatusBadge status={j.status} />
                      {j.status === "processing" && <Progress value={j.progress} label="Job progress" />}
                      {j.cancel_requested && j.status === "processing" && <span className="block text-[11px] text-muted-foreground">cancel requested</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {j.attempts}/{j.max_attempts}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs" title={`${j.provider} · ${j.model}`}>
                    {j.model}
                  </TableCell>
                  <TableCell className="text-xs">{duration(j)}</TableCell>
                  <TableCell className="max-w-[280px] text-xs">
                    {j.error_message && (
                      <span className={j.status === "failed" ? "text-destructive" : "text-muted-foreground"} title={j.error_message}>
                        {j.status === "queued" && j.attempts > 0 ? `Retrying after: ` : ""}
                        {j.error_message.slice(0, 160)}
                      </span>
                    )}
                    {j.provider_request_id && (
                      <span className="block truncate text-muted-foreground" title={j.provider_request_id}>
                        req: {j.provider_request_id}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {canEdit && (j.status === "queued" || (j.status === "processing" && !j.cancel_requested)) && (
                      <ActionButton size="sm" variant="ghost" action={cancelJob.bind(null, j.id)} confirm="Cancel this job? Work already sent to the provider may still be billed.">
                        <XCircle /> Cancel
                      </ActionButton>
                    )}
                    {canEdit && (j.status === "failed" || j.status === "cancelled") && (
                      <ActionButton size="sm" variant="ghost" action={retryJob.bind(null, j.id)}>
                        <RotateCcw /> Retry
                      </ActionButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/jobs" params={{ status, type, batch }} />
    </>
  );
}
