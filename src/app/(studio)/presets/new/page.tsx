import { requirePageContext } from "@/server/context";
import { savePreset } from "@/server/actions/generation";
import type { ShootPresetRow } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { PresetForm } from "../preset-form";
import { getI18n } from "@/lib/i18n/server";
import { pageMetadata } from "@/lib/i18n/metadata";
import { fmt } from "@/lib/i18n/config";

export const generateMetadata = pageMetadata((d) => d.presets.newTitle);

export default async function NewPresetPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const ctx = await requirePageContext("editor");
  const { d } = await getI18n();
  let source: ShootPresetRow | null = null;
  if (from && /^[0-9a-f-]{36}$/i.test(from)) {
    const { data } = await ctx.supabase.from("shoot_presets").select("*").eq("id", from).maybeSingle();
    source = (data as ShootPresetRow | null) ?? null;
  }
  return (
    <>
      <PageHeader title={source ? fmt(d.presets.duplicateTitle, { name: source.name }) : d.presets.newTitle} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <PresetForm
            action={savePreset.bind(null, null)}
            defaults={source ? { name: `${source.name} ${d.presets.copySuffix}`, category: source.category, description: source.description, config: source.config } : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}
