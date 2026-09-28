import { ArrowRight } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { isImageGenerationConfigured } from "@/lib/env";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { jobErrorLabel } from "@/lib/i18n/labels";
import type { JobRow, ResultRow } from "@/lib/types";
import { PageHeader } from "@/components/studio/page-header";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { MediaTile } from "../_create/media-tile";
import { FailedTile } from "../_create/failed-tile";
import { ActiveTile } from "../_create/active-tile";
import { ReplicaStudio } from "./replica-studio";

export const generateMetadata = pageMetadata((d) => d.replica.metaTitle);

const ROLE_ORDER = ["front", "side", "back", "detail", "fabric", "other"];

export default async function ReplicaPage() {
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const t = d.replica;
  const db = ctx.supabase;
  const org = ctx.org.organizationId;
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const canDelete = roleAtLeast(ctx.org.role, "admin");

  const [productsRes, modelsRes, jobsRes] = await Promise.all([
    db
      .from("products")
      .select("id, sku, title, product_assets(id, role, thumbnail_path, created_at)")
      .eq("organization_id", org)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(40),
    db.from("model_profiles").select("id, display_name, model_profile_assets(id, is_primary, thumbnail_path)").eq("organization_id", org).neq("status", "retired").order("created_at", { ascending: false }),
    db
      .from("generation_jobs")
      .select("id, status, progress, error_code, config, created_at, dismissed_at")
      .eq("organization_id", org)
      .eq("job_type", "replica_generation")
      .is("dismissed_at", null)
      // Jobs the user cancelled are gone on purpose; don't show them as failures.
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  type P = { id: string; sku: string; title: string; product_assets: { id: string; role: string; thumbnail_path: string | null; created_at: string }[] };
  type M = { id: string; display_name: string; model_profile_assets: { id: string; is_primary: boolean; thumbnail_path: string | null }[] };
  const products = ((productsRes.data ?? []) as P[]).map((p) => ({
    ...p,
    first: [...p.product_assets].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.created_at.localeCompare(b.created_at))[0],
  }));
  const models = ((modelsRes.data ?? []) as M[]).filter((m) => m.model_profile_assets.length > 0);
  const primary = (m: M) => m.model_profile_assets.find((a) => a.is_primary) ?? m.model_profile_assets[0];
  const allJobs = (jobsRes.data ?? []) as Pick<JobRow, "id" | "status" | "progress" | "error_code" | "config" | "created_at">[];

  const jobIds = allJobs.map((j) => j.id);
  const resultsRes = jobIds.length
    ? await db.from("generation_results").select("*, products(sku)").eq("organization_id", org).in("job_id", jobIds)
    : { data: [] };
  const results = (resultsRes.data ?? []) as (ResultRow & { products: { sku: string } | null })[];
  const resultByJob = new Map(results.map((r) => [r.job_id, r]));
  // A succeeded job whose photo was deleted has nothing left to show.
  const jobs = allJobs.filter((j) => j.status !== "succeeded" || resultByJob.has(j.id));

  const sceneThumb = (j: (typeof jobs)[number]) => (j.config as { sceneThumbnailPath?: string | null }).sceneThumbnailPath ?? null;
  const urls = await signUrls(db, [
    ...products.map((p) => p.first?.thumbnail_path ?? null),
    ...models.map((m) => primary(m)?.thumbnail_path ?? null),
    ...jobs.map(sceneThumb),
    ...results.map((r) => r.thumbnail_path),
  ]);
  const signed = (path: string | null | undefined) => (path ? urls[path] ?? null : null);
  const active = jobs.some((j) => j.status === "queued" || j.status === "processing");
  const aspect = (j: (typeof jobs)[number]) => String((j.config as { aspectRatio?: string }).aspectRatio ?? "3:4").replace(":", "/");

  return (
    <div className="pb-10">
      <PageHeader title={t.title} description={t.description} />
      {canEdit && (
        <ReplicaStudio
          products={products.map((p) => ({ id: p.id, name: p.title || p.sku, thumb: signed(p.first?.thumbnail_path), hasAssets: p.product_assets.length > 0 }))}
          models={models.map((m) => ({ id: m.id, name: m.display_name, thumb: signed(primary(m)?.thumbnail_path) }))}
          disabledReason={isImageGenerationConfigured() ? null : d.shoot.geminiMissing}
        />
      )}

      <div className="mb-3 mt-8 flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t.results}</h2>
        <AutoRefresh active={active} />
      </div>
      {jobs.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">{t.empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((j) => {
            const result = resultByJob.get(j.id);
            const ref = signed(sceneThumb(j));
            return (
              <div key={j.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border bg-card/60 p-2">
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.reference}</p>
                  {ref ? <img src={ref} alt={t.reference} className="w-full rounded-xl object-cover" style={{ aspectRatio: aspect(j) }} /> : <div className="rounded-xl bg-muted" style={{ aspectRatio: aspect(j) }} />}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.result}</p>
                  {result ? (
                    <MediaTile
                      resultId={result.id}
                      canDelete={canDelete}
                      href={`/results/${result.id}`}
                      kind="image"
                      url={signed(result.thumbnail_path)}
                      alt={t.result}
                      aspect={result.width && result.height ? `${result.width}/${result.height}` : aspect(j)}
                      title={result.products?.sku ?? t.result}
                      subtitle={new Date(result.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
                    />
                  ) : j.status === "failed" ? (
                    <FailedTile jobId={j.id} aspect={aspect(j)} reason={jobErrorLabel(d, j.error_code) ?? j.error_code ?? ""} canEdit={canEdit} />
                  ) : (
                    <ActiveTile
                      jobId={j.id}
                      aspect={aspect(j)}
                      status={j.status as "queued" | "processing"}
                      progress={j.progress}
                      label=""
                      canEdit={canEdit}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
