import Link from "next/link";
import { after } from "next/server";
import { kickWorker } from "@/server/jobs/kick";
import { AlertTriangle, Clapperboard, Loader2 } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { budgetState } from "@/lib/domain/costs";
import { isGeminiConfigured } from "@/lib/env";
import { formatMoney, cn } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import { jobErrorLabel, shotLabel } from "@/lib/i18n/labels";
import type { SessionLocation } from "@/lib/domain/photo-session";
import type { JobRow, ResultRow } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { QcBadge, StatusBadge } from "@/components/studio/status-badge";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { MediaTile } from "./_create/media-tile";
import { Composer } from "./_create/composer";

export const generateMetadata = pageMetadata((d) => d.create.metaTitle);

const GALLERY_LIMIT = 60;
const GENERATION_TYPES = ["image_generation", "video_generation", "model_portrait"] as const;

/** "3:4" → "3/4" for CSS aspect-ratio; falls back to portrait. */
function cssAspect(value: unknown, fallback = "3/4"): string {
  return typeof value === "string" && /^\d+:\d+$/.test(value) ? value.replace(":", "/") : fallback;
}

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ error?: string; kind?: string }> }) {
  const sp = await searchParams;
  const kind = sp.kind === "image" || sp.kind === "video" ? sp.kind : null;
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const t = d.create;
  const db = ctx.supabase;
  const org = ctx.org.organizationId;
  const canEdit = roleAtLeast(ctx.org.role, "editor");

  let results = db.from("generation_results").select("*, products(sku)").eq("organization_id", org).order("created_at", { ascending: false }).limit(GALLERY_LIMIT);
  if (kind) results = results.eq("kind", kind);

  const [resultsRes, activeRes, failedRes, pendingReview, productsRes, modelsRes, orgRow, spend] = await Promise.all([
    results,
    db
      .from("generation_jobs")
      .select("id, job_type, status, progress, config, created_at, products(sku)")
      .eq("organization_id", org)
      .in("job_type", [...GENERATION_TYPES])
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(24),
    db
      .from("generation_jobs")
      .select("id, job_type, error_code, config, created_at, products(sku)")
      .eq("organization_id", org)
      .in("job_type", [...GENERATION_TYPES])
      .eq("status", "failed")
      .gte("completed_at", new Date(Date.now() - 6 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(4),
    db.from("generation_results").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("review_status", "pending"),
    canEdit
      ? db
          .from("products")
          .select("id, sku, title, product_assets(id, role, thumbnail_path, created_at)")
          .eq("organization_id", org)
          .neq("status", "archived")
          .order("updated_at", { ascending: false })
          .limit(60)
      : Promise.resolve({ data: [] }),
    canEdit
      ? db.from("model_profiles").select("id, display_name, model_profile_assets(id, is_primary, thumbnail_path)").eq("organization_id", org).neq("status", "retired").order("display_name")
      : Promise.resolve({ data: [] }),
    db.from("organizations").select("monthly_budget_usd, budget_alert_percent").eq("id", org).single(),
    db.rpc("org_month_spend", { p_org: org }),
  ]);

  type Joined<T> = T & { products: { sku: string } | null };
  const rows = (resultsRes.data ?? []) as Joined<ResultRow>[];
  const active = (activeRes.data ?? []) as unknown as Joined<Pick<JobRow, "id" | "job_type" | "status" | "progress" | "config" | "created_at">>[];
  const failed = (failedRes.data ?? []) as unknown as Joined<Pick<JobRow, "id" | "job_type" | "error_code" | "config" | "created_at">>[];

  // Safety net: if queued work has been waiting, nudge the worker (cheap, idempotent).
  const STALE_QUEUE_MS = 45_000;
  if (active.some((j) => j.status === "queued" && Date.now() - Date.parse(j.created_at) > STALE_QUEUE_MS)) {
    after(() => kickWorker());
  }

  type ProductWithAssets = { id: string; sku: string; title: string; product_assets: { id: string; role: string; thumbnail_path: string | null; created_at: string }[] };
  type ModelWithAssets = { id: string; display_name: string; model_profile_assets: { id: string; is_primary: boolean; thumbnail_path: string | null }[] };
  const ROLE_ORDER = ["front", "side", "back", "detail", "fabric", "other"];
  const products = ((productsRes.data ?? []) as ProductWithAssets[]).map((p) => ({
    ...p,
    product_assets: [...p.product_assets].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.created_at.localeCompare(b.created_at)),
  }));
  const models = (modelsRes.data ?? []) as ModelWithAssets[];
  const modelPrimary = (m: ModelWithAssets) => m.model_profile_assets.find((a) => a.is_primary) ?? m.model_profile_assets[0];

  const urls = await signUrls(db, [
    ...rows.map((r) => (r.kind === "video" ? r.storage_path : r.thumbnail_path)),
    ...products.map((p) => p.product_assets[0]?.thumbnail_path ?? null),
    ...models.map((m) => modelPrimary(m)?.thumbnail_path ?? null),
  ]);
  const signed = (path: string | null | undefined) => (path ? urls[path] ?? null : null);

  const monthSpend = Number(spend.data ?? 0);
  const budget = orgRow.data?.monthly_budget_usd == null ? null : Number(orgRow.data.monthly_budget_usd);
  const budgetInfo = budgetState(monthSpend, budget, orgRow.data?.budget_alert_percent ?? 80);
  const money = (v: number | null) => formatMoney(v, "USD", 2, locale);

  let disabledReason: string | null = null;
  if (!canEdit) disabledReason = t.readOnly;
  else if (!isGeminiConfigured()) disabledReason = d.shoot.geminiMissing;

  const jobAspect = (config: Record<string, unknown>, jobType: string) => {
    const style = (config.style ?? {}) as Record<string, unknown>;
    return cssAspect(style.aspectRatio ?? config.aspectRatio, jobType === "video_generation" ? "16/9" : "3/4");
  };
  const locationLabel = (config: Record<string, unknown>) => {
    const loc = config.location as SessionLocation | undefined;
    return loc && loc in t.locationNames ? t.locationNames[loc] : null;
  };
  const isEmpty = rows.length === 0 && active.length === 0 && failed.length === 0;

  const filters = [
    { key: null, label: t.all },
    { key: "image", label: t.images },
    { key: "video", label: t.videos },
  ] as const;

  return (
    <div className="pb-64">
      {sp.error === "forbidden" && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{d.dashboard.forbidden}</AlertDescription>
        </Alert>
      )}
      {!isGeminiConfigured() && (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>{d.dashboard.geminiMissingTitle}</AlertTitle>
          <AlertDescription>{d.dashboard.geminiMissingBody}</AlertDescription>
        </Alert>
      )}
      {(budgetInfo.level === "warning" || budgetInfo.level === "exceeded") && (
        <Alert variant={budgetInfo.level === "exceeded" ? "destructive" : "warning"} className="mb-4">
          <AlertTitle>{budgetInfo.level === "exceeded" ? d.dashboard.budgetExceededTitle : d.dashboard.budgetWarningTitle}</AlertTitle>
          <AlertDescription>
            {fmt(d.dashboard.budgetBody, { spend: money(monthSpend), budget: money(budget), percent: budgetInfo.percent?.toFixed(0) })}{" "}
            <Link href="/costs" className="underline">
              {d.dashboard.viewCosts}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {isEmpty && !kind ? (
        <section className="flex min-h-[55vh] flex-col items-center justify-center text-center">
          <span className="flow-gradient mb-6 h-14 w-14 rounded-2xl opacity-90 shadow-[0_0_60px_-10px] shadow-brand" aria-hidden />
          <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-5xl">
            <span className="flow-gradient-text">{t.heroTitle}</span>
          </h1>
          <p className="mt-4 max-w-xl text-balance text-muted-foreground">{t.heroBody}</p>
          <p className="mt-2 text-sm text-muted-foreground">{fmt(d.dashboard.welcome, { org: ctx.org.organizationName })}</p>
        </section>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border bg-card/60 p-1" role="tablist" aria-label={d.common.filter}>
              {filters.map((f) => {
                const selected = kind === f.key;
                return (
                  <Link
                    key={f.label}
                    href={f.key ? `/?kind=${f.key}` : "/"}
                    role="tab"
                    aria-selected={selected}
                    className={cn(
                      "rounded-full px-3.5 py-1 text-sm transition-colors",
                      selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {f.label}
                  </Link>
                );
              })}
            </div>
            {active.length > 0 && (
              <Link href="/jobs?status=active" className="flex items-center gap-1.5 rounded-full border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {fmt(t.generatingCount, { n: active.length })}
              </Link>
            )}
            {(pendingReview.count ?? 0) > 0 && (
              <Link href="/review" className="rounded-full border bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                {fmt(t.awaitingReview, { n: pendingReview.count ?? 0 })}
              </Link>
            )}
            <div className="ml-auto">
              <AutoRefresh active={active.length > 0} />
            </div>
          </div>

          {rows.length === 0 && active.length === 0 && failed.length === 0 ? (
            <p className="py-24 text-center text-muted-foreground">{t.empty}</p>
          ) : (
            <div className="columns-2 gap-3 md:columns-3 xl:columns-4 2xl:columns-5">
              {active
                .filter((j) => !kind || kind === (j.job_type === "video_generation" ? "video" : "image"))
                .map((j) => (
                    <Link
                      key={j.id}
                      href={`/jobs?status=active`}
                      className="flow-shimmer relative mb-3 flex break-inside-avoid flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border text-center"
                      style={{ aspectRatio: jobAspect(j.config, j.job_type) }}
                    >
                      {j.job_type === "video_generation" ? <Clapperboard className="h-5 w-5 text-muted-foreground" /> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                      <span className="text-sm font-medium">{j.status === "queued" ? t.queued : t.generating}</span>
                      <span className="text-xs text-muted-foreground">
                        {[shotLabel(d, ((j.config.style ?? {}) as { shotType?: string }).shotType), locationLabel(j.config)].filter(Boolean).join(" · ")}
                      </span>
                      {j.status === "processing" && j.progress > 0 && (
                        <span className="absolute inset-x-4 bottom-4 h-1 overflow-hidden rounded-full bg-white/10">
                          <span className="flow-gradient block h-full" style={{ width: `${Math.min(100, j.progress)}%` }} />
                        </span>
                      )}
                    </Link>
                ))}
              {!kind &&
                failed.map((j) => (
                  <Link
                    key={j.id}
                    href="/jobs?status=failed"
                    className="relative mb-3 flex break-inside-avoid flex-col items-center justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-center"
                    style={{ aspectRatio: jobAspect(j.config, j.job_type) }}
                  >
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    <span className="text-sm font-medium">{t.failed}</span>
                    <span className="line-clamp-3 text-xs text-muted-foreground">{jobErrorLabel(d, j.error_code) ?? j.error_code}</span>
                  </Link>
                ))}
              {rows.map((r) => {
                const title = [shotLabel(d, r.shot_type), locationLabel(r.settings)].filter(Boolean).join(" · ") || d.enums.mediaKind[r.kind];
                return (
                  <MediaTile
                    key={r.id}
                    href={r.kind === "video" && r.video_project_id ? `/video/${r.video_project_id}` : `/results/${r.id}`}
                    kind={r.kind}
                    url={signed(r.kind === "video" ? r.storage_path : r.thumbnail_path)}
                    alt={title}
                    aspect={r.width && r.height ? `${r.width}/${r.height}` : r.kind === "video" ? "16/9" : "3/4"}
                    title={title}
                    subtitle={[r.products?.sku, new Date(r.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}
                    badges={
                      <>
                        <StatusBadge status={r.review_status} />
                        {r.kind === "image" && <QcBadge status={r.qc_status} />}
                      </>
                    }
                  />
                );
              })}
            </div>
          )}
          {rows.length >= GALLERY_LIMIT && (
            <p className="mt-6 text-center">
              <Link href="/library" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {t.openLibrary}
              </Link>
            </p>
          )}
        </>
      )}

      <Composer
        products={products.map((p) => ({
          id: p.id,
          sku: p.sku,
          title: p.title,
          thumb: signed(p.product_assets[0]?.thumbnail_path),
          hasAssets: p.product_assets.length > 0,
        }))}
        models={models.map((m) => ({
          id: m.id,
          name: m.display_name,
          thumb: signed(modelPrimary(m)?.thumbnail_path),
        }))}
        disabledReason={disabledReason}
      />
    </div>
  );
}
