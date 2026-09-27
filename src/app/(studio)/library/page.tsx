import { Images } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { REVIEW_STATUSES } from "@/lib/domain/schemas";
import { sanitizeSearch } from "@/lib/search";
import { formatBytes } from "@/lib/utils";
import type { ResultRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { Pagination } from "@/components/studio/pagination";
import { LibraryGrid } from "./library-grid";

export const metadata = { title: "Media library" };
const PAGE_SIZE = 48;
const isUuid = (v: string | undefined) => Boolean(v && /^[0-9a-f-]{36}$/i.test(v));
const isDate = (v: string | undefined) => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePageContext();
  const org = ctx.org.organizationId;
  const db = ctx.supabase;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  // Resolve SKU search to product ids first (keeps the main query indexed).
  let productIds: string[] | null = null;
  const sku = sanitizeSearch(sp.sku);
  if (sku) {
    const { data } = await db.from("products").select("id").eq("organization_id", org).ilike("sku", `%${sku}%`).limit(200);
    productIds = (data ?? []).map((p) => p.id as string);
  }

  let query = db
    .from("generation_results")
    .select("*, products(sku)", { count: "exact" })
    .eq("organization_id", org)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.kind === "image" || sp.kind === "video") query = query.eq("kind", sp.kind);
  if (REVIEW_STATUSES.includes(sp.review as (typeof REVIEW_STATUSES)[number])) query = query.eq("review_status", sp.review as string);
  if (isUuid(sp.model)) query = query.eq("model_profile_id", sp.model as string);
  if (isUuid(sp.campaign)) query = query.eq("video_project_id", sp.campaign as string);
  if (sp.provider && /^[a-z0-9-]{1,40}$/.test(sp.provider)) query = query.eq("provider", sp.provider);
  if (isDate(sp.from)) query = query.gte("created_at", `${sp.from}T00:00:00Z`);
  if (isDate(sp.to)) query = query.lte("created_at", `${sp.to}T23:59:59Z`);
  if (productIds) query = query.in("product_id", productIds.length ? productIds : ["00000000-0000-0000-0000-000000000000"]);

  const [{ data, count, error }, models, campaigns, storage] = await Promise.all([
    query,
    db.from("model_profiles").select("id, display_name").eq("organization_id", org).order("display_name"),
    db.from("video_projects").select("id, name").eq("organization_id", org).order("created_at", { ascending: false }).limit(100),
    db.rpc("org_storage_usage", { p_org: org }),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (ResultRow & { products: { sku: string } | null })[];
  const urls = await signUrls(db, rows.map((r) => (r.kind === "video" ? r.storage_path : r.thumbnail_path)));
  const usage = (storage.data ?? []) as { category: string; files: number; bytes: number }[];
  const totalBytes = usage.reduce((s, u) => s + Number(u.bytes), 0);

  return (
    <>
      <PageHeader title="Media library" description="All generated images and videos. Assets are private; links are short-lived signed URLs." />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap gap-6 p-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Total storage</p>
            <p className="text-lg font-semibold">{formatBytes(totalBytes)}</p>
          </div>
          {usage.map((u) => (
            <div key={u.category}>
              <p className="text-xs text-muted-foreground">{u.category.replace(/_/g, " ")}</p>
              <p>
                {Number(u.files)} files · {formatBytes(Number(u.bytes))}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Input name="sku" placeholder="SKU" defaultValue={sp.sku ?? ""} aria-label="SKU" />
        <NativeSelect name="kind" defaultValue={sp.kind ?? ""} aria-label="Media type">
          <option value="">Images & videos</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
        </NativeSelect>
        <NativeSelect name="review" defaultValue={sp.review ?? ""} aria-label="Approval">
          <option value="">Any approval</option>
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="model" defaultValue={sp.model ?? ""} aria-label="Model profile">
          <option value="">Any model</option>
          {(models.data ?? []).map((m) => (
            <option key={m.id as string} value={m.id as string}>
              {m.display_name as string}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="campaign" defaultValue={sp.campaign ?? ""} aria-label="Campaign / video project">
          <option value="">Any campaign</option>
          {(campaigns.data ?? []).map((c) => (
            <option key={c.id as string} value={c.id as string}>
              {c.name as string}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="provider" defaultValue={sp.provider ?? ""} aria-label="Provider">
          <option value="">Any provider</option>
          <option value="gemini">gemini</option>
          <option value="gemini-veo">gemini-veo</option>
        </NativeSelect>
        <Input type="date" name="from" defaultValue={sp.from ?? ""} aria-label="From date" />
        <div className="flex gap-2">
          <Input type="date" name="to" defaultValue={sp.to ?? ""} aria-label="To date" />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={Images} title="No media matches these filters" />
      ) : (
        <LibraryGrid
          items={rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            url: (r.kind === "video" ? urls[r.storage_path] : r.thumbnail_path ? urls[r.thumbnail_path] : null) ?? null,
            href: r.kind === "video" && r.video_project_id ? `/video/${r.video_project_id}` : `/results/${r.id}`,
            sku: r.products?.sku ?? null,
            shotType: r.shot_type,
            model: r.model,
            reviewStatus: r.review_status,
            createdAt: r.created_at,
          }))}
        />
      )}
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/library"
        params={{ sku: sp.sku, kind: sp.kind, review: sp.review, model: sp.model, campaign: sp.campaign, provider: sp.provider, from: sp.from, to: sp.to }}
      />
    </>
  );
}
