import Link from "next/link";
import { notFound } from "next/navigation";
import { Clapperboard, Download, UserPlus } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { promoteResultToModelReference } from "@/server/actions/models";
import { exportFileName } from "@/lib/domain/files";
import { formatBytes, formatDateTime, formatMoney } from "@/lib/utils";
import type { JobRow, ModelAssetRow, ProductAssetRow, ResultRow, UsageRow } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/studio/page-header";
import { QcBadge, StatusBadge } from "@/components/studio/status-badge";
import { ActionButton } from "@/components/studio/action-button";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { ReviewPanel } from "./review-panel";

export const metadata = { title: "Result" };

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePageContext();
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  const { data } = await db.from("generation_results").select("*, products(id, sku, title), model_profiles(id, display_name)").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!data) notFound();
  const result = data as ResultRow & { products: { id: string; sku: string; title: string } | null; model_profiles: { id: string; display_name: string } | null };

  const settings = result.settings as {
    style?: Record<string, unknown>;
    productReferenceAssetIds?: string[];
    modelReferenceAssetIds?: string[];
    finishReason?: string;
    latencyMs?: number;
  };
  const productRefIds = settings.productReferenceAssetIds ?? [];
  const modelRefIds = settings.modelReferenceAssetIds ?? [];

  const [jobRes, usageRes, prodAssetsRes, modelAssetsRes, childrenRes] = await Promise.all([
    db.from("generation_jobs").select("*").eq("id", result.job_id).eq("organization_id", org).single(),
    db.from("usage_ledger").select("*").eq("organization_id", org).eq("job_id", result.job_id),
    productRefIds.length ? db.from("product_assets").select("*").eq("organization_id", org).in("id", productRefIds) : Promise.resolve({ data: [] }),
    modelRefIds.length ? db.from("model_profile_assets").select("*").eq("organization_id", org).in("id", modelRefIds) : Promise.resolve({ data: [] }),
    db.from("generation_results").select("id, review_status, created_at").eq("organization_id", org).eq("parent_result_id", id).order("created_at"),
  ]);
  const job = jobRes.data as JobRow | null;
  const usage = (usageRes.data ?? []) as UsageRow[];
  const productAssets = (prodAssetsRes.data ?? []) as ProductAssetRow[];
  const modelAssets = (modelAssetsRes.data ?? []) as ModelAssetRow[];
  // QC runs as a separate job that references this result.
  const qcUsage = await db.from("generation_jobs").select("id").eq("organization_id", org).eq("source_result_id", id).eq("job_type", "quality_review");
  const qcJobIds = (qcUsage.data ?? []).map((j) => j.id as string);
  const qcLedger = qcJobIds.length ? ((await db.from("usage_ledger").select("*").in("job_id", qcJobIds)).data ?? []) as UsageRow[] : [];

  const fileName = exportFileName({ sku: result.products?.sku ?? null, shotType: result.shot_type, id: result.id, mimeType: result.mime_type });
  const [viewUrls, downloadUrls] = await Promise.all([
    signUrls(db, [result.storage_path, ...productAssets.map((a) => a.storage_path), ...modelAssets.map((a) => a.thumbnail_path)]),
    signUrls(db, [result.storage_path], { download: true }),
  ]);
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const allUsage = [...usage, ...qcLedger];
  const totalCost = allUsage.reduce((s, u) => s + Number(u.cost_amount ?? 0), 0);
  const hasEstimate = allUsage.some((u) => u.cost_source === "estimated");
  const hasUnknown = allUsage.some((u) => u.cost_source === "unknown");
  const isPortrait = result.shot_type === "portrait";

  return (
    <>
      <PageHeader
        title={result.products ? `${result.products.sku} · ${result.shot_type ?? result.kind}` : isPortrait ? `Portrait · ${result.model_profiles?.display_name ?? ""}` : "Result"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={result.review_status} />
            {result.kind === "image" && <QcBadge status={result.qc_status} />}
            <span>{formatDateTime(result.created_at)}</span>
            <AutoRefresh active={result.qc_status === "queued"} />
          </span>
        }
        actions={
          <>
            {downloadUrls[result.storage_path] && (
              <Button asChild variant="outline">
                <a href={downloadUrls[result.storage_path]} download={fileName}>
                  <Download /> Download original
                </a>
              </Button>
            )}
            {canEdit && result.review_status === "approved" && result.kind === "image" && !isPortrait && (
              <Button asChild>
                <Link href={`/video/new?resultIds=${result.id}`}>
                  <Clapperboard /> Make video
                </Link>
              </Button>
            )}
            {canEdit && result.review_status === "approved" && result.model_profile_id && isPortrait && (
              <ActionButton action={promoteResultToModelReference.bind(null, result.id)} successText="Added to model references">
                <UserPlus /> Add to model references
              </ActionButton>
            )}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Source vs. output</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Original product references</p>
                  {productAssets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{isPortrait ? "Portrait — no product references." : "Reference images were deleted."}</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {productAssets.map((a) => (
                        <figure key={a.id} className="space-y-1">
                          <a href={viewUrls[a.storage_path]} target="_blank" rel="noreferrer">
                            <img src={viewUrls[a.storage_path]} alt={`${a.role} reference`} className="w-full rounded-md border object-contain" />
                          </a>
                          <figcaption className="text-xs text-muted-foreground">{a.role}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  {modelAssets.length > 0 && (
                    <>
                      <p className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Model references</p>
                      <div className="flex gap-2">
                        {modelAssets.map((a) => (
                          <img key={a.id} src={a.thumbnail_path ? viewUrls[a.thumbnail_path] : undefined} alt="Model reference" className="h-28 rounded-md border object-cover" />
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Generated output</p>
                  {viewUrls[result.storage_path] ? (
                    <a href={viewUrls[result.storage_path]} target="_blank" rel="noreferrer">
                      <img src={viewUrls[result.storage_path]} alt="Generated output" className="checkerboard w-full rounded-md border object-contain" />
                    </a>
                  ) : (
                    <p className="text-sm text-muted-foreground">Preview unavailable.</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {result.width}×{result.height} · {formatBytes(result.size_bytes)} · {result.mime_type}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Automated quality screening</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Alert variant="info">
                <AlertDescription>
                  These flags come from an AI comparison against the references. They can miss problems and raise false alarms — always inspect the images yourself.
                </AlertDescription>
              </Alert>
              {result.qc_status === "queued" && <p className="text-muted-foreground">Screening in progress…</p>}
              {result.qc_status === "not_run" && <p className="text-muted-foreground">Automated screening is disabled or was not run for this result.</p>}
              {result.qc_status === "error" && <p className="text-destructive">Screening failed. See the Jobs page.</p>}
              {result.qc_summary && <p>{result.qc_summary}</p>}
              {result.qc_flags && result.qc_flags.length > 0 ? (
                <ul className="space-y-1.5">
                  {result.qc_flags.map((f, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-2">
                      <Badge variant={f.severity === "high" ? "destructive" : f.severity === "medium" ? "warning" : "outline"}>{f.severity}</Badge>
                      <Badge variant="secondary">{f.type.replace(/_/g, " ")}</Badge>
                      <span>{f.description}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                result.qc_status === "passed" && <p className="text-success">No issues were flagged by the screening model.</p>
              )}
              {result.qc_model && <p className="text-xs text-muted-foreground">Screening model: {result.qc_model}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Generation settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-[140px_1fr] gap-1">
                <dt className="text-muted-foreground">Provider / model</dt>
                <dd>
                  {result.provider} · {result.model}
                </dd>
                {result.model_profiles && (
                  <>
                    <dt className="text-muted-foreground">Model profile</dt>
                    <dd>
                      <Link className="underline" href={`/models/${result.model_profiles.id}`}>
                        {result.model_profiles.display_name}
                      </Link>
                    </dd>
                  </>
                )}
                {settings.style &&
                  Object.entries(settings.style).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd>{String(v) || "—"}</dd>
                    </div>
                  ))}
                <dt className="text-muted-foreground">Finish reason</dt>
                <dd>{settings.finishReason ?? "—"}</dd>
                <dt className="text-muted-foreground">Latency</dt>
                <dd>{settings.latencyMs ? `${(settings.latencyMs / 1000).toFixed(1)}s` : "—"}</dd>
                <dt className="text-muted-foreground">Request ID</dt>
                <dd className="break-all font-mono text-xs">{job?.provider_request_id ?? "—"}</dd>
                <dt className="text-muted-foreground">Job</dt>
                <dd>
                  <Link className="underline" href={`/jobs?batch=${job?.batch_id ?? ""}`}>
                    {job?.id.slice(0, 8)}
                  </Link>{" "}
                  (attempt {job?.attempts})
                </dd>
                {result.parent_result_id && (
                  <>
                    <dt className="text-muted-foreground">Regenerated from</dt>
                    <dd>
                      <Link className="underline" href={`/results/${result.parent_result_id}`}>
                        previous result
                      </Link>
                    </dd>
                  </>
                )}
              </dl>
              {(childrenRes.data ?? []).length > 0 && (
                <p>
                  Regenerations:{" "}
                  {(childrenRes.data ?? []).map((c, i) => (
                    <Link key={c.id as string} className="mr-2 underline" href={`/results/${c.id as string}`}>
                      #{i + 1} ({c.review_status as string})
                    </Link>
                  ))}
                </p>
              )}
              {result.provider_text && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Model text response</summary>
                  <p className="mt-1 whitespace-pre-wrap text-xs">{result.provider_text}</p>
                </details>
              )}
              {result.prompt && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Full prompt</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-xs">{result.prompt}</pre>
                </details>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <ReviewPanel resultId={result.id} currentNotes={result.review_notes} canRegenerate={result.kind === "image"} />
              ) : (
                <p className="text-sm text-muted-foreground">You have read-only access.</p>
              )}
              {result.reviewed_at && (
                <p className="mt-3 text-xs text-muted-foreground">Last reviewed {formatDateTime(result.reviewed_at)}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cost</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-2xl font-semibold">{formatMoney(totalCost, "USD", 4)}</p>
              <p className="text-xs text-muted-foreground">
                {hasEstimate ? "Estimated from reported token usage and configured pricing (not provider-billed amounts). " : ""}
                {hasUnknown ? "Some calls have unknown cost (no pricing configured for the model). " : ""}
                Includes generation attempts and QC screening.
              </p>
              <ul className="divide-y text-xs">
                {allUsage.map((u) => (
                  <li key={u.id} className="flex justify-between py-1">
                    <span>
                      {u.job_type.replace(/_/g, " ")} · {u.input_tokens ?? "?"} in / {u.output_tokens ?? "?"} out {u.succeeded ? "" : "(failed)"}
                    </span>
                    <span>
                      {formatMoney(u.cost_amount == null ? null : Number(u.cost_amount))} <Badge variant="outline">{u.cost_source}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
