import { NextResponse, type NextRequest } from "next/server";
import { Zip, ZipPassThrough } from "fflate";
import { z } from "zod";
import { requireOrgContext, AuthorizationError } from "@/server/context";
import { enforceRateLimit, RateLimitError } from "@/server/rate-limit";
import { BUCKET } from "@/server/storage";
import { audit } from "@/server/audit";
import { toActionError } from "@/server/action";
import { getI18n } from "@/lib/i18n/server";
import { exportFileName } from "@/lib/domain/files";
import type { ResultRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILES = 100;

const bodySchema = z.object({
  resultIds: z.array(z.uuid()).min(1).max(MAX_FILES),
  approvedOnly: z.boolean().default(true),
});

function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Streams a ZIP of selected results plus a manifest (CSV + JSON). Files are
 * read with the USER's client, so storage RLS enforces tenant isolation.
 */
export async function POST(request: NextRequest) {
  const { d } = await getI18n();
  let ctx;
  try {
    ctx = await requireOrgContext("viewer");
    await enforceRateLimit("export", ctx.userId);
  } catch (error) {
    const status = error instanceof AuthorizationError ? 403 : error instanceof RateLimitError ? 429 : 500;
    return NextResponse.json({ error: (await toActionError(error, "export")).error }, { status });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: d.errors.exportInvalid }, { status: 400 });

  let query = ctx.supabase
    .from("generation_results")
    .select("*, products(sku, title), model_profiles(code)")
    .eq("organization_id", ctx.org.organizationId)
    .in("id", parsed.data.resultIds);
  if (parsed.data.approvedOnly) query = query.eq("review_status", "approved");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: d.errors.generic }, { status: 500 });
  const rows = (data ?? []) as (ResultRow & { products: { sku: string; title: string } | null; model_profiles: { code: string } | null })[];
  if (!rows.length) {
    return NextResponse.json({ error: parsed.data.approvedOnly ? d.errors.exportNoneApproved : d.errors.exportNothing }, { status: 400 });
  }

  const supabase = ctx.supabase;
  const orgId = ctx.org.organizationId;
  const userId = ctx.userId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const manifest: Record<string, unknown>[] = [];
      const used = new Set<string>();
      for (const row of rows) {
        let name = exportFileName({ sku: row.products?.sku ?? null, shotType: row.shot_type, id: row.id, mimeType: row.mime_type });
        while (used.has(name)) name = name.replace(/(\.[a-z0-9]+)$/, `_dup$1`);
        used.add(name);
        const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(row.storage_path);
        if (dlError || !blob) {
          manifest.push({ file: null, id: row.id, error: "download failed" });
          continue;
        }
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(new Uint8Array(await blob.arrayBuffer()), true);
        manifest.push({
          file: name,
          id: row.id,
          kind: row.kind,
          sku: row.products?.sku ?? null,
          product_title: row.products?.title ?? null,
          model_profile: row.model_profiles?.code ?? null,
          shot_type: row.shot_type,
          review_status: row.review_status,
          reviewed_at: row.reviewed_at,
          qc_status: row.qc_status,
          provider: row.provider,
          model: row.model,
          width: row.width,
          height: row.height,
          duration_seconds: row.duration_seconds,
          created_at: row.created_at,
        });
      }
      const json = new ZipPassThrough("manifest.json");
      zip.add(json);
      json.push(new TextEncoder().encode(JSON.stringify(manifest, null, 2)), true);
      const headers = Object.keys(manifest.find((m) => m.file) ?? manifest[0] ?? {});
      const csv = [headers.map(csvCell).join(","), ...manifest.map((m) => headers.map((h) => csvCell(m[h])).join(","))].join("\n");
      const csvEntry = new ZipPassThrough("manifest.csv");
      zip.add(csvEntry);
      csvEntry.push(new TextEncoder().encode(csv), true);
      zip.end();
      await audit({ organizationId: orgId, actorId: userId, action: "media.exported", entityType: "generation_result", metadata: { count: rows.length, approvedOnly: parsed.data.approvedOnly } });
    },
  });

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="pandiones-export-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
