import Link from "next/link";
import { requirePageContext } from "@/server/context";
import { signUrls } from "@/server/storage";
import { videoConfig } from "@/lib/env";
import { isVideoEnabled } from "@/lib/providers/registry";
import type { ResultRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { VideoForm } from "./video-form";

export const metadata = { title: "New video" };

export default async function NewVideoPage({ searchParams }: { searchParams: Promise<{ resultIds?: string }> }) {
  const { resultIds } = await searchParams;
  const ctx = await requirePageContext("editor");
  if (!isVideoEnabled()) {
    return (
      <EmptyState
        title="Video generation is not configured"
        description="An administrator must configure a verified video provider on the server. See docs/API_PROVIDERS.md."
        action={<Button asChild size="sm"><Link href="/video">Back to video studio</Link></Button>}
      />
    );
  }
  const preselected = (resultIds ?? "").split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const { data } = await ctx.supabase
    .from("generation_results")
    .select("*, products(sku)")
    .eq("organization_id", ctx.org.organizationId)
    .eq("kind", "image")
    .eq("review_status", "approved")
    .neq("shot_type", "portrait")
    .order("reviewed_at", { ascending: false })
    .limit(60);
  const rows = (data ?? []) as (ResultRow & { products: { sku: string } | null })[];
  const urls = await signUrls(ctx.supabase, rows.map((r) => r.thumbnail_path));
  const cfg = videoConfig();
  return (
    <>
      <PageHeader title="New video" description={`Provider: ${cfg.provider} · model ${cfg.model}`} />
      <VideoForm
        sources={rows.map((r) => ({ id: r.id, url: r.thumbnail_path ? urls[r.thumbnail_path] ?? null : null, sku: r.products?.sku ?? null, shotType: r.shot_type }))}
        initialSelection={preselected}
        durations={cfg.allowedDurations}
        supportsReferenceImages={cfg.supportsReferenceImages}
      />
    </>
  );
}
