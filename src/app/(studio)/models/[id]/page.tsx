import Link from "next/link";
import { notFound } from "next/navigation";
import { Star, Trash2, UserPlus } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import { deleteModelAsset, promoteResultToModelReference, setPrimaryModelAsset, updateModelProfile } from "@/server/actions/models";
import { reviewResults } from "@/server/actions/generation";
import { isImageGenerationConfigured } from "@/lib/env";
import type { ModelAssetRow, ModelProfileRow, ResultRow } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { StatusBadge } from "@/components/studio/status-badge";
import { ActionButton } from "@/components/studio/action-button";
import { ImageUploader } from "@/components/studio/image-uploader";
import { MediaThumb } from "@/components/studio/media-thumb";
import { AutoRefresh } from "@/components/studio/auto-refresh";
import { ModelForm } from "../model-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { PortraitGenerator } from "./portrait-generator";

export const generateMetadata = pageMetadata((d) => d.model.metaTitle);

export default async function ModelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePageContext();
  const { d } = await getI18n();
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  const { data } = await db.from("model_profiles").select("*").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!data) notFound();
  const model = data as ModelProfileRow;

  const [assetsRes, portraitsRes, shotsRes, activeRes] = await Promise.all([
    db.from("model_profile_assets").select("*").eq("model_profile_id", id).eq("organization_id", org).order("created_at"),
    db.from("generation_results").select("*").eq("model_profile_id", id).eq("organization_id", org).eq("shot_type", "portrait").order("created_at", { ascending: false }).limit(12),
    db
      .from("generation_results")
      .select("*, products(sku)")
      .eq("model_profile_id", id)
      .eq("organization_id", org)
      .eq("kind", "image")
      .neq("shot_type", "portrait")
      .order("created_at", { ascending: false })
      .limit(24),
    db.from("generation_jobs").select("id", { count: "exact", head: true }).eq("model_profile_id", id).eq("organization_id", org).in("status", ["queued", "processing"]),
  ]);
  const assets = (assetsRes.data ?? []) as ModelAssetRow[];
  const portraits = (portraitsRes.data ?? []) as ResultRow[];
  const shots = (shotsRes.data ?? []) as (ResultRow & { products: { sku: string } | null })[];
  const urls = await signUrls(db, [...assets.map((a) => a.thumbnail_path), ...portraits.map((p) => p.thumbnail_path), ...shots.map((s) => s.thumbnail_path)]);
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  const promoted = new Set(assets.map((a) => a.source_result_id).filter(Boolean));

  return (
    <>
      <PageHeader
        title={model.display_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{model.code}</span> <StatusBadge status={model.status} />
            <AutoRefresh active={(activeRes.count ?? 0) > 0} />
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{d.model.referencesTitle}</CardTitle>
              <CardDescription>
                {d.model.referencesDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {assets.length > 0 && (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {assets.map((a) => (
                    <li key={a.id} className="space-y-1">
                      <MediaThumb src={a.thumbnail_path ? urls[a.thumbnail_path] : null} alt={d.model.modelReference} />
                      <div className="flex flex-wrap items-center gap-1">
                        {a.is_primary && <Badge variant="success">{d.model.primary}</Badge>}
                        <Badge variant="outline">{d.enums.storageSource[a.source]}</Badge>
                      </div>
                      {canEdit && (
                        <div className="flex flex-wrap">
                          {!a.is_primary && (
                            <ActionButton size="sm" variant="ghost" className="h-7 px-2 text-xs" action={setPrimaryModelAsset.bind(null, model.id, a.id)}>
                              <Star /> {d.model.makePrimary}
                            </ActionButton>
                          )}
                          <ActionButton size="sm" variant="ghost" className="h-7 px-2 text-xs" action={deleteModelAsset.bind(null, a.id)} confirm={d.model.removeReferenceConfirm}>
                            <Trash2 />
                          </ActionButton>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && <ImageUploader target="models" entityId={model.id} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.model.portraitsTitle}</CardTitle>
              <CardDescription>{d.model.portraitsDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {canEdit && (
                <PortraitGenerator
                  modelId={model.id}
                  references={assets.map((a) => ({ id: a.id, url: a.thumbnail_path ? urls[a.thumbnail_path] ?? null : null }))}
                  disabledReason={
                    !isImageGenerationConfigured() ? d.model.geminiMissing : model.status === "retired" ? d.model.retired : null
                  }
                />
              )}
              {portraits.length > 0 && (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {portraits.map((p) => (
                    <li key={p.id} className="space-y-1">
                      <Link href={`/results/${p.id}`}>
                        <MediaThumb src={p.thumbnail_path ? urls[p.thumbnail_path] : null} alt={d.model.generatedPortrait} />
                      </Link>
                      <StatusBadge status={p.review_status} />
                      {canEdit && p.review_status === "pending" && (
                        <ActionButton size="sm" variant="outline" className="h-7 text-xs" action={reviewResults.bind(null, { resultIds: [p.id], decision: "approved" })}>
                          {d.common.approve}
                        </ActionButton>
                      )}
                      {canEdit && p.review_status === "approved" && !promoted.has(p.id) && (
                        <ActionButton size="sm" variant="secondary" className="h-7 text-xs" action={promoteResultToModelReference.bind(null, p.id)}>
                          <UserPlus /> {d.model.addAsReference}
                        </ActionButton>
                      )}
                      {promoted.has(p.id) && <Badge variant="success">{d.model.inReferences}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{d.model.consistencyTitle}</CardTitle>
              <CardDescription>{d.model.consistencyDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              {shots.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.model.noShots}</p>
              ) : (
                <div className="grid grid-cols-[120px_1fr] gap-4">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{d.model.primaryReference}</p>
                    {(() => {
                      const primary = assets.find((a) => a.is_primary) ?? assets[0];
                      return <MediaThumb src={primary?.thumbnail_path ? urls[primary.thumbnail_path] : null} alt={d.model.primaryReference} />;
                    })()}
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {shots.map((s) => (
                      <Link key={s.id} href={`/results/${s.id}`} className="space-y-1">
                        <MediaThumb src={s.thumbnail_path ? urls[s.thumbnail_path] : null} alt={`${s.products?.sku ?? ""} ${s.shot_type ?? ""}`} />
                        <p className="truncate text-[11px] text-muted-foreground">{s.products?.sku ?? "—"}</p>
                        {s.qc_flags?.some((f) => f.type === "identity_inconsistency") && <Badge variant="warning">{d.model.identityFlag}</Badge>}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{d.model.profile}</CardTitle>
          </CardHeader>
          <CardContent>
            <ModelForm action={updateModelProfile.bind(null, model.id)} model={model} readOnly={!canEdit} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
