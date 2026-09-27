import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, ArchiveRestore, Camera, ScanSearch, Trash2 } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import {
  deleteProduct,
  deleteProductAsset,
  requestAnalysis,
  saveVerifiedAttributes,
  setProductStatus,
  updateProduct,
} from "@/server/actions/products";
import { isGeminiConfigured } from "@/lib/env";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";
import { shotLabel } from "@/lib/i18n/labels";
import type { JobRow, ProductAssetRow, ProductRow, ResultRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/studio/page-header";
import { StatusBadge, QcBadge } from "@/components/studio/status-badge";
import { ActionButton } from "@/components/studio/action-button";
import { AssetRoleSelect } from "@/components/studio/asset-role-select";
import { ImageUploader } from "@/components/studio/image-uploader";
import { MediaThumb } from "@/components/studio/media-thumb";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { ProductForm } from "../product-form";
import { AnalysisView } from "./analysis-view";
import { VerifiedAttributesForm } from "./verified-attributes-form";

export const generateMetadata = pageMetadata((d) => d.product.metaTitle);

const CORE_ROLES = ["front", "back", "side", "detail", "fabric"] as const;

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: product } = await db.from("products").select("*").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!product) notFound();
  const p = product as ProductRow;

  const [assetsRes, jobsRes, resultsRes, costRes] = await Promise.all([
    db.from("product_assets").select("*").eq("product_id", id).eq("organization_id", org).order("created_at"),
    db.from("generation_jobs").select("*").eq("product_id", id).eq("organization_id", org).order("created_at", { ascending: false }).limit(20),
    db.from("generation_results").select("*").eq("product_id", id).eq("organization_id", org).order("created_at", { ascending: false }).limit(24),
    db.from("usage_ledger").select("cost_amount, cost_source").eq("product_id", id).eq("organization_id", org),
  ]);
  const assets = (assetsRes.data ?? []) as ProductAssetRow[];
  const jobs = (jobsRes.data ?? []) as JobRow[];
  const results = (resultsRes.data ?? []) as ResultRow[];
  const urls = await signUrls(db, [...assets.map((a) => a.thumbnail_path), ...results.map((r) => r.thumbnail_path)]);
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const isAdmin = roleAtLeast(ctx.org.role, "admin");
  const missing = CORE_ROLES.filter((r) => !assets.some((a) => a.role === r));
  const active = jobs.some((j) => j.status === "queued" || j.status === "processing") || p.analysis_status === "queued";
  const costTotal = (costRes.data ?? []).reduce((sum, r) => sum + Number(r.cost_amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title={p.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            <StatusBadge status={p.status} />
            <AutoRefresh active={active} />
          </span>
        }
        actions={
          canEdit && (
            <>
              <Button asChild>
                <Link href={`/shoots/new?productId=${p.id}`}>
                  <Camera /> {d.product.newShoot}
                </Link>
              </Button>
              {p.status === "archived" ? (
                <ActionButton variant="outline" action={setProductStatus.bind(null, p.id, "draft")}>
                  <ArchiveRestore /> {d.product.unarchive}
                </ActionButton>
              ) : (
                <ActionButton variant="outline" action={setProductStatus.bind(null, p.id, "archived")}>
                  <Archive /> {d.product.archive}
                </ActionButton>
              )}
              {isAdmin && (
                <ActionButton
                  variant="destructive"
                  action={deleteProduct.bind(null, p.id)}
                  confirm={fmt(d.product.deleteConfirm, { sku: p.sku })}
                >
                  <Trash2 /> {d.common.delete}
                </ActionButton>
              )}
            </>
          )
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{d.product.referenceImages}</CardTitle>
              <CardDescription>
                {d.product.referenceDescription}{" "}
                {missing.length > 0 && <span>{fmt(d.product.missingAngles, { angles: missing.map((r) => d.enums.assetRole[r]).join(", ") })}</span>}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {assets.length > 0 && (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {assets.map((a) => (
                    <li key={a.id} className="space-y-1.5">
                      <MediaThumb src={a.thumbnail_path ? urls[a.thumbnail_path] : null} alt={d.enums.assetRole[a.role]} />
                      <AssetRoleSelect assetId={a.id} role={a.role} disabled={!canEdit} />
                      <p className="truncate text-[11px] text-muted-foreground" title={a.original_filename ?? ""}>
                        {a.width}×{a.height} · {formatBytes(a.size_bytes)}
                      </p>
                      {canEdit && (
                        <ActionButton
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          action={deleteProductAsset.bind(null, a.id)}
                          confirm={d.product.removeImageConfirm}
                        >
                          <Trash2 /> {d.common.remove}
                        </ActionButton>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && <ImageUploader target="products" entityId={p.id} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{d.product.analysisTitle}</CardTitle>
                <CardDescription>
                  {d.product.analysisDescription}
                </CardDescription>
              </div>
              {canEdit && (
                <ActionButton
                  variant="outline"
                  size="sm"
                  action={requestAnalysis.bind(null, p.id)}
                  disabled={!assets.length || p.analysis_status === "queued" || !isGeminiConfigured()}
                  successText={d.product.analysisQueued}
                >
                  <ScanSearch /> {p.ai_analysis ? d.product.reanalyze : d.product.analyze}
                </ActionButton>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!isGeminiConfigured() && (
                <Alert variant="warning">
                  <AlertDescription>{d.product.geminiMissing}</AlertDescription>
                </Alert>
              )}
              {p.analysis_status === "queued" && <p className="text-sm text-muted-foreground">{d.product.analysisRunning}</p>}
              {p.analysis_status === "failed" && (
                <Alert variant="destructive">
                  <AlertDescription>{d.product.analysisFailed}</AlertDescription>
                </Alert>
              )}
              {p.ai_analysis ? (
                <AnalysisView analysis={p.ai_analysis} model={p.analysis_model} analyzedAt={p.analyzed_at} />
              ) : (
                p.analysis_status === "none" && <p className="text-sm text-muted-foreground">{d.product.noAnalysis}</p>
              )}
              <VerifiedAttributesForm
                action={saveVerifiedAttributes.bind(null, p.id)}
                verified={p.verified_attributes}
                analysis={p.ai_analysis}
                reviewedAt={p.analysis_reviewed_at}
                readOnly={!canEdit}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.product.historyTitle}</CardTitle>
              <CardDescription>
                {fmt(d.product.historyDescription, { count: results.length, cost: formatMoney(costTotal, "USD", 4, locale) })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {results.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.product.noMedia}</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {results.map((r) => (
                    <Link key={r.id} href={r.kind === "video" && r.video_project_id ? `/video/${r.video_project_id}` : `/results/${r.id}`} className="space-y-1">
                      <MediaThumb src={r.thumbnail_path ? urls[r.thumbnail_path] : null} alt={r.shot_type ?? r.kind} kind={r.kind} />
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={r.review_status} />
                        {r.kind === "image" && <QcBadge status={r.qc_status} />}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
              {jobs.length > 0 && (
                <ul className="divide-y rounded-md border text-sm">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                      <span className="flex items-center gap-2">
                        <StatusBadge status={j.status} />
                        <span>{d.enums.jobType[j.job_type]}</span>
                        {typeof j.config.style === "object" && j.config.style && (
                          <span className="text-muted-foreground">· {shotLabel(d, (j.config.style as { shotType?: string }).shotType)}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(j.created_at, locale)}{" "}
                        <Link className="underline" href={`/jobs?batch=${j.batch_id ?? ""}`}>
                          {d.common.details}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{d.product.detailsTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ProductForm action={updateProduct.bind(null, p.id)} product={p} readOnly={!canEdit} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
