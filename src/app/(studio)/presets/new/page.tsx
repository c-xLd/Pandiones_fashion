import { requirePageContext } from "@/server/context";
import { savePreset } from "@/server/actions/generation";
import type { ShootPresetRow } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { PresetForm } from "../preset-form";

export const metadata = { title: "New preset" };

export default async function NewPresetPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const ctx = await requirePageContext("editor");
  let source: ShootPresetRow | null = null;
  if (from && /^[0-9a-f-]{36}$/i.test(from)) {
    const { data } = await ctx.supabase.from("shoot_presets").select("*").eq("id", from).maybeSingle();
    source = (data as ShootPresetRow | null) ?? null;
  }
  return (
    <>
      <PageHeader title={source ? `Duplicate “${source.name}”` : "New preset"} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <PresetForm
            action={savePreset.bind(null, null)}
            defaults={source ? { name: `${source.name} (copy)`, category: source.category, description: source.description, config: source.config } : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}
