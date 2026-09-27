import Link from "next/link";
import { Plus, UserRound } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { signUrls } from "@/server/storage";
import type { ModelProfileRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { EmptyState } from "@/components/studio/empty-state";
import { StatusBadge } from "@/components/studio/status-badge";
import { MediaThumb } from "@/components/studio/media-thumb";

export const metadata = { title: "Models" };

export default async function ModelsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const ctx = await requirePageContext();
  let query = ctx.supabase
    .from("model_profiles")
    .select("*, model_profile_assets(thumbnail_path, is_primary)")
    .eq("organization_id", ctx.org.organizationId)
    .order("display_name")
    .limit(200);
  if (status === "draft" || status === "active" || status === "retired") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const models = (data ?? []) as (ModelProfileRow & { model_profile_assets: { thumbnail_path: string | null; is_primary: boolean }[] })[];
  const primary = (m: (typeof models)[number]) =>
    (m.model_profile_assets.find((a) => a.is_primary) ?? m.model_profile_assets[0])?.thumbnail_path ?? null;
  const urls = await signUrls(ctx.supabase, models.map(primary));
  const canEdit = roleAtLeast(ctx.org.role, "editor");

  return (
    <>
      <PageHeader
        title="Model library"
        description="Reusable adult model profiles with approved reference images for identity consistency."
        actions={
          canEdit && (
            <Button asChild>
              <Link href="/models/new">
                <Plus /> New model
              </Link>
            </Button>
          )
        }
      />
      <div className="mb-4 flex gap-2 text-sm">
        {["all", "active", "draft", "retired"].map((s) => (
          <Link
            key={s}
            href={s === "all" ? "/models" : `/models?status=${s}`}
            className={`rounded-md px-3 py-1 ${(status ?? "all") === s ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
          >
            {s}
          </Link>
        ))}
      </div>
      {models.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title="No model profiles"
          description="Create a profile, then upload consented reference photos or generate a synthetic reference portrait."
          action={canEdit && <Button asChild size="sm"><Link href="/models/new">New model</Link></Button>}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {models.map((m) => (
            <Link key={m.id} href={`/models/${m.id}`}>
              <Card className="overflow-hidden transition-colors hover:bg-accent/50">
                <MediaThumb src={primary(m) ? urls[primary(m) as string] : null} alt={m.display_name} className="rounded-none" />
                <CardContent className="space-y-1 p-3">
                  <p className="font-medium">{m.display_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{m.code}</p>
                  <div className="flex items-center justify-between">
                    <StatusBadge status={m.status} />
                    <span className="text-xs text-muted-foreground">{m.model_profile_assets.length} refs</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
