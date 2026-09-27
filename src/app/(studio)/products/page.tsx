import Link from "next/link";
import { Plus, Shirt, Upload } from "lucide-react";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { PRODUCT_STATUSES, productListQuerySchema } from "@/lib/domain/schemas";
import { sanitizeSearch } from "@/lib/search";
import { formatDateTime } from "@/lib/utils";
import type { ProductRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { Pagination } from "@/components/studio/pagination";

export const metadata = { title: "Products" };
const PAGE_SIZE = 25;

const SORTS = {
  updated_desc: { column: "updated_at", ascending: false, label: "Recently updated" },
  created_desc: { column: "created_at", ascending: false, label: "Newest" },
  sku_asc: { column: "sku", ascending: true, label: "SKU A–Z" },
  title_asc: { column: "title", ascending: true, label: "Title A–Z" },
} as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const raw = await searchParams;
  const params = productListQuerySchema.catch({ sort: "updated_desc", page: 1 }).parse(raw);
  const ctx = await requirePageContext();
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
        title="Products"
        description="Catalog items with their original reference photography."
        actions={
          canEdit && (
            <>
              <Button asChild variant="outline">
                <Link href="/products/import">
                  <Upload /> Bulk import
                </Link>
              </Button>
              <Button asChild>
                <Link href="/products/new">
                  <Plus /> New product
                </Link>
              </Button>
            </>
          )
        }
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_160px_160px_180px_auto]" role="search">
        <Input name="q" placeholder="Search SKU or title" defaultValue={params.q ?? ""} aria-label="Search" />
        <NativeSelect name="status" defaultValue={params.status ?? ""} aria-label="Status">
          <option value="">Active (not archived)</option>
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={params.category ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="sort" defaultValue={params.sort} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Shirt}
          title={q || params.status || params.category ? "No products match these filters" : "No products yet"}
          description="Create a product and upload front, back, side, detail and fabric reference photos."
          action={
            canEdit && (
              <Button asChild size="sm">
                <Link href="/products/new">New product</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Image</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Analysis</TableHead>
                <TableHead>Updated</TableHead>
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
                      <StatusBadge status={p.analysis_status === "completed" ? (p.analysis_reviewed_at ? "approved" : "pending") : p.analysis_status} label={p.analysis_status === "completed" ? (p.analysis_reviewed_at ? "verified" : "needs review") : p.analysis_status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(p.updated_at)}</TableCell>
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
