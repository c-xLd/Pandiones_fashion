import Link from "next/link";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { requirePageContext, roleAtLeast } from "@/server/context";
import { deletePreset } from "@/server/actions/generation";
import type { ShootPresetRow } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { ActionButton } from "@/components/studio/action-button";

export const metadata = { title: "Shoot presets" };

export default async function PresetsPage() {
  const ctx = await requirePageContext();
  const { data, error } = await ctx.supabase
    .from("shoot_presets")
    .select("*")
    .or(`organization_id.is.null,organization_id.eq.${ctx.org.organizationId}`)
    .order("category")
    .order("name");
  if (error) throw new Error(error.message);
  const presets = (data ?? []) as ShootPresetRow[];
  const canEdit = roleAtLeast(ctx.org.role, "editor");
  return (
    <>
      <PageHeader
        title="Shoot presets"
        description="Reusable creative direction. Built-in presets are read-only; duplicate them to customise."
        actions={
          canEdit && (
            <Button asChild>
              <Link href="/presets/new">
                <Plus /> New preset
              </Link>
            </Button>
          )
        }
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {presets.map((p) => {
          const c = p.config as Record<string, string | number>;
          return (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <div className="flex gap-1">
                    <Badge variant="outline">{p.category}</Badge>
                    {!p.organization_id && <Badge variant="secondary">built-in</Badge>}
                  </div>
                </div>
                {p.description && <CardDescription>{p.description}</CardDescription>}
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <dl className="grid grid-cols-[100px_1fr] gap-1 text-xs">
                  <dt className="text-muted-foreground">Shot</dt>
                  <dd>{String(c.shotType)} · {String(c.framing).replace(/_/g, " ")}</dd>
                  <dt className="text-muted-foreground">Background</dt>
                  <dd>{String(c.background || "—")}</dd>
                  <dt className="text-muted-foreground">Lighting</dt>
                  <dd>{String(c.lighting || "—")}</dd>
                  <dt className="text-muted-foreground">Output</dt>
                  <dd>
                    {String(c.aspectRatio)} · {String(c.imageSize)} · {String(c.variations)} variations
                  </dd>
                </dl>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/presets/new?from=${p.id}`}>
                        <Copy /> Duplicate
                      </Link>
                    </Button>
                    {p.organization_id && (
                      <>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/presets/${p.id}`}>
                            <Pencil /> Edit
                          </Link>
                        </Button>
                        <ActionButton size="sm" variant="ghost" action={deletePreset.bind(null, p.id)} confirm={`Delete preset "${p.name}"?`}>
                          <Trash2 /> Delete
                        </ActionButton>
                      </>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
