import Link from "next/link";
import { Plus, Shirt, Upload } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { PRODUCT_STATUSES, productListQuerySchema } from "@/lib/domain/schemas";
import { sanitizeSearch } from "@/lib/search";
import { formatDateTime } from "@/lib/utils";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import type { ProductRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { Pagination } from "@/components/studio/pagination";

export const generateMetadata = pageMetadata((d) => d.products.metaTitle);
const PAGE_SIZE = 25;

const SORTS = {
  updated_desc: { column: "updated_at", ascending: false },
  created_desc: { column: "created_at", ascending: false },
  sku_asc: { column: "sku", ascending: true },
  title_asc: { column: "title", ascending: true },
} as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const params = productListQuerySchema.catch({ sort: "updated_desc", page: 1 }).parse(raw);
  const ctx = await requirePageContext();
  const { locale, d } = await getI18n();
  const org = ctx.org.organizationId;
  const sort = SORTS[params.sort];

  let query = ctx.supabase
    .from("products")
    .select("*, product_assets(thumbnail_path, role)", { count: "exact" })
    .eq("organization_id", org)
    .order(sort.column, { ascending: sort.ascending })
    .range((params.page - 1) * PAGE_SIZE, params.page * PAGE_SIZE - 1)
    .limit(1, { referencedTable: "product_assets" });
  const q = sanitizeSearch(params.q);
  if (q) query = query.or(`sku.ilike.%${q}%,title.ilike.%${q}%`);
  if (params.status) query = query.eq("status", params.status);
  else query = query.neq("status", "archived");
  if (params.category) query = query.ilike("category", params.category);

  const [{ data, count, error }, categoriesRes] = await Promise.all([
    query,
    ctx.supabase.from("products").select("category").eq("organization_id", org).not("category", "is", null).limit(500),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as (ProductRow & { product_assets: { thumbnail_path: string | null; role: string }[] })[];
  const urls = await signUrls(ctx.supabase, rows.map((r) => r.product_assets[0]?.thumbnail_path));
  const categories = Array.from(new Set((categoriesRes.data ?? []).map((c) => c.category as string))).sort();
  const canEdit = ctx.org.role !== "viewer";

  return (
    <>
      <PageHeader
        title={d.products.title}
        description={d.products.description}
        actions={
          canEdit && (
            <>
              <Button asChild variant="outline">
                <Link href="/products/import">
                  <Upload /> {d.products.bulkImport}
                </Link>
              </Button>
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> {d.products.newProduct}
                </Link>
              </Button>
            </>
          )
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_160px_180px_auto]" role="search">
        <Input name="q" placeholder={d.products.searchPlaceholder} defaultValue={params.q ?? ""} aria-label={d.common.search} />
        <NativeSelect name="status" defaultValue={params.status ?? ""} aria-label={d.products.columns.status}>
          <option value="">{d.products.activeNotArchived}</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {d.enums.productStatus[s]}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={params.category ?? ""} aria-label={d.products.columns.category}>
          <option value="">{d.products.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={params.sort} aria-label={d.products.sortLabel}>
          {(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => (
            <option key={k} value={k}>
              {d.products.sorts[k]}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          {d.common.apply}
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Shirt}
          title={q || params.status || params.category ? d.products.noMatchTitle : d.products.emptyTitle}
          description={d.products.emptyBody}
          action={
            canEdit && (
              <Button asChild size="sm">
                <Link href="/products/new">{d.products.newProduct}</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">{d.products.columns.image}</TableHead>
                <TableHead>{d.products.columns.sku}</TableHead>
                <TableHead>{d.products.columns.title}</TableHead>
                <TableHead>{d.products.columns.category}</TableHead>
                <TableHead>{d.products.columns.status}</TableHead>
                <TableHead>{d.products.columns.analysis}</TableHead>
                <TableHead>{d.products.columns.updated}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const thumb = p.product_assets[0]?.thumbnail_path;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      {thumb && urls[thumb] ? (
                        <img src={urls[thumb]} alt="" loading="lazy" className="h-12 w-10 rounded object-cover" />
                      ) : (
                        <div className="h-12 w-10 rounded bg-muted" aria-hidden />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/products/${p.id}`} className="hover:underline">
                        {p.sku}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                        {p.title}
                      </Link>
                    </TableCell>
                    <TableCell>{p.category ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.analysis_status === "completed" ? (p.analysis_reviewed_at ? "approved" : "pending") : p.analysis_status} label={p.analysis_status === "completed" ? (p.analysis_reviewed_at ? d.products.analysisVerified : d.products.analysisNeedsReview) : d.enums.analysisStatus[p.analysis_status]} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(p.updated_at, locale)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        page={params.page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/products"
        params={{ q: params.q, status: params.status, category: params.category, sort: params.sort }}
      />
    </>
  );
}
