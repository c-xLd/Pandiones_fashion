import Link from "next/link";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { geminiConfig, isGeminiConfigured } from "@/lib/env";
import { sanitizeSearch } from "@/lib/search";
import type { ModelAssetRow, ModelProfileRow, ProductAssetRow, ProductRow, ShootPresetRow } from "@/lib/types";
import type { ShootStyle } from "@/lib/domain/schemas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { ShootForm } from "./shoot-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";

export const generateMetadata = pageMetadata((d) => d.shoot.metaTitle);

export default async function NewShootPage({ searchParams }: { searchParams: Promise<{ productId?: string; q?: string }> }) {
  const { productId, q } = await searchParams;
  const ctx = await requirePageContext("editor");
  const { d } = await getI18n();
  const t = d.shoot;
  const db = ctx.supabase;
  const org = ctx.org.organizationId;

  if (!productId || !/^[0-9a-f-]{36}$/i.test(productId)) {
    const term = sanitizeSearch(q);
    let query = db.from("products").select("id, sku, title, status").eq("organization_id", org).neq("status", "archived").order("updated_at", { ascending: false }).limit(30);
    if (term) query = query.or(`sku.ilike.%${term}%,title.ilike.%${term}%`);
    const { data } = await query;
    const products = (data ?? []) as Pick<ProductRow, "id" | "sku" | "title" | "status">[];
    return (
      <>
        <PageHeader title={t.title} description={t.chooseProduct} />
        <form className="mb-4 flex max-w-md gap-2" role="search">
          <Input name="q" placeholder={d.products.searchPlaceholder} defaultValue={q ?? ""} aria-label={t.searchProducts} />
          <Button type="submit" variant="secondary">
            {d.common.search}
          </Button>
        </form>
        {products.length === 0 ? (
          <EmptyState title={t.noProducts} action={<Button asChild size="sm"><Link href="/products/new">{t.createProduct}</Link></Button>} />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {products.map((p) => (
                <Link key={p.id} href={`/shoots/new?productId=${p.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-accent/50">
                  <span>
                    <span className="font-mono text-xs">{p.sku}</span> · {p.title}
                  </span>
                  <StatusBadge status={p.status} />
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  const { data: product } = await db.from("products").select("*").eq("id", productId).eq("organization_id", org).maybeSingle();
  if (!product) {
    return <EmptyState title={t.productNotFound} action={<Button asChild size="sm"><Link href="/shoots/new">{t.chooseAnother}</Link></Button>} />;
  }
  const p = product as ProductRow;
  const [assetsRes, modelsRes, presetsRes] = await Promise.all([
    db.from("product_assets").select("*").eq("product_id", p.id).eq("organization_id", org).order("created_at"),
    db.from("model_profiles").select("*, model_profile_assets(*)").eq("organization_id", org).neq("status", "retired").order("display_name"),
    db.from("shoot_presets").select("*").or(`organization_id.is.null,organization_id.eq.${org}`).order("category").order("name"),
  ]);
  const assets = (assetsRes.data ?? []) as ProductAssetRow[];
  const models = (modelsRes.data ?? []) as (ModelProfileRow & { model_profile_assets: ModelAssetRow[] })[];
  const presets = (presetsRes.data ?? []) as ShootPresetRow[];
  const urls = await signUrls(db, [...assets.map((a) => a.thumbnail_path), ...models.flatMap((m) => m.model_profile_assets.map((a) => a.thumbnail_path))]);

  if (!assets.length) {
    return (
      <EmptyState
        title={t.uploadFirstTitle}
        description={t.uploadFirstBody}
        action={<Button asChild size="sm"><Link href={`/products/${p.id}`}>{t.openProduct}</Link></Button>}
      />
    );
  }

  let maxReferences = 6;
  let disabledReason: string | null = null;
  if (!isGeminiConfigured()) disabledReason = t.geminiMissing;
  else maxReferences = geminiConfig().maxReferenceImages;
  if (p.status === "archived") disabledReason = t.archived;

  return (
    <>
      <PageHeader title={t.title} description={fmt(t.configureFor, { sku: p.sku })} />
      <ShootForm
        product={{ id: p.id, sku: p.sku, title: p.title }}
        productAssets={assets.map((a) => ({ id: a.id, role: a.role, url: a.thumbnail_path ? urls[a.thumbnail_path] ?? null : null }))}
        models={models.map((m) => ({
          id: m.id,
          name: m.display_name,
          code: m.code,
          assets: m.model_profile_assets.map((a) => ({ id: a.id, isPrimary: a.is_primary, url: a.thumbnail_path ? urls[a.thumbnail_path] ?? null : null })),
        }))}
        presets={presets.map((pr) => ({ id: pr.id, name: pr.name, category: pr.category, config: pr.config as Partial<ShootStyle> }))}
        maxReferences={maxReferences}
        maxJobs={40}
        disabledReason={disabledReason}
      />
    </>
  );
}
