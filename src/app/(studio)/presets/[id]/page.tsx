import { notFound } from "next/navigation";
import { requirePageContext } from "@/server/context";
import { savePreset } from "@/server/actions/generation";
import type { ShootPresetRow } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/studio/page-header";
import { PresetForm } from "../preset-form";

export const metadata = { title: "Edit preset" };

export default async function EditPresetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requirePageContext("editor");
  const { data } = await ctx.supabase.from("shoot_presets").select("*").eq("id", id).eq("organization_id", ctx.org.organizationId).maybeSingle();
  if (!data) notFound();
  const preset = data as ShootPresetRow;
  return (
    <>
      <PageHeader title={`Edit “${preset.name}”`} />
      <Card className="max-w-3xl">
        <CardContent className="pt-5">
          <PresetForm action={savePreset.bind(null, preset.id)} defaults={{ name: preset.name, category: preset.category, description: preset.description, config: preset.config }} />
        </CardContent>
      </Card>
    </>
  );
}
