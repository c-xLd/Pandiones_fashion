import { ClipboardCheck } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { REVIEW_STATUSES } from "@/lib/domain/schemas";
import type { ResultRow } from "@/lib/types";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { Pagination } from "@/components/studio/pagination";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { ReviewGrid } from "./review-grid";

export const generateMetadata = pageMetadata((d) => d.review.metaTitle);
const PAGE_SIZE = 40;

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const { d } = await getI18n();
  const t = d.review;
  const org = ctx.org.organizationId;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const status = REVIEW_STATUSES.includes(sp.status as (typeof REVIEW_STATUSES)[number]) ? (sp.status as string) : "pending";
  const qc = ["passed", "flagged", "queued", "error", "not_run"].includes(sp.qc ?? "") ? sp.qc : undefined;
  const batch = sp.batch && /^[0-9a-f-]{36}$/i.test(sp.batch) ? sp.batch : undefined;
  const product = sp.product && /^[0-9a-f-]{36}$/i.test(sp.product) ? sp.product : undefined;

  let query = ctx.supabase
    .from("generation_results")
    .select("*, products(sku), generation_jobs!inner(batch_id)", { count: "exact" })
    .eq("organization_id", org)
    .eq("kind", "image")
    .eq("review_status", status)
    .order("created_at", { ascending: status === "pending" })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (qc) query = query.eq("qc_status", qc);
  if (batch) query = query.eq("generation_jobs.batch_id", batch);
  if (product) query = query.eq("product_id", product);

  const [{ data, count, error }, activeJobs] = await Promise.all([
    query,
    ctx.supabase.from("generation_jobs").select("id", { count: "exact", head: true }).eq("organization_id", org).in("status", ["queued", "processing"]),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (ResultRow & { products: { sku: string } | null })[];
  const urls = await signUrls(ctx.supabase, rows.map((r) => r.thumbnail_path));

  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-3">
            {t.description}
            <AutoRefresh active={(activeJobs.count ?? 0) > 0} intervalMs={10000} />
          </span>
        }
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <NativeSelect name="status" defaultValue={status} className="w-40" aria-label={t.reviewStatus}>
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {d.enums.reviewStatus[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="qc" defaultValue={qc ?? ""} className="w-48" aria-label={t.qcStatus}>
          <option value="">{t.anyQc}</option>
          <option value="flagged">{t.qcFlagged}</option>
          <option value="passed">{t.qcNoIssues}</option>
          <option value="queued">{t.qcPending}</option>
          <option value="error">{t.qcError}</option>
          <option value="not_run">{t.qcNotRun}</option>
        </NativeSelect>
        {batch && <input type="hidden" name="batch" value={batch} />}
        {product && <input type="hidden" name="product" value={product} />}
        <Button type="submit" variant="secondary">
          {d.common.filter}
        </Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={status === "pending" ? t.nothingPending : fmt(t.noneWithStatus, { status: d.enums.reviewStatus[status as keyof typeof d.enums.reviewStatus] })}
          description={t.emptyBody}
        />
      ) : (
        <ReviewGrid
          canEdit={roleAtLeast(ctx.org.role, "editor")}
          items={rows.map((r) => ({
            id: r.id,
            url: r.thumbnail_path ? urls[r.thumbnail_path] ?? null : null,
            sku: r.products?.sku ?? null,
            shotType: r.shot_type,
            qcStatus: r.qc_status,
            flagCount: r.qc_flags?.length ?? 0,
            reviewStatus: r.review_status,
          }))}
        />
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/review" params={{ status, qc, batch, product }} />
    </>
  );
}
