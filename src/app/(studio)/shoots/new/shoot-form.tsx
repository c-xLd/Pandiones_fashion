"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SHOT_TYPES, shootStyleSchema, type ShotType, type ShootStyle } from "@/lib/domain/schemas";
import { createShoot } from "@/server/actions/generation";
import { StyleFields } from "../../presets/preset-form";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";

export interface ShootFormProps {
  product: { id: string; sku: string; title: string };
  productAssets: { id: string; role: string; url: string | null }[];
  models: { id: string; name: string; code: string; assets: { id: string; url: string | null; isPrimary: boolean }[] }[];
  presets: { id: string; name: string; category: string; config: Partial<ShootStyle> }[];
  maxReferences: number;
  maxJobs: number;
  disabledReason: string | null;
}

export function ShootForm(props: ShootFormProps) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.shoot;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [presetId, setPresetId] = useState<string>(props.presets[0]?.id ?? "");
  const preset = props.presets.find((p) => p.id === presetId);
  const [shotTypes, setShotTypes] = useState<ShotType[]>([(preset?.config.shotType as ShotType) ?? "front"]);
  const [productRefs, setProductRefs] = useState<string[]>(props.productAssets.slice(0, Math.min(4, props.maxReferences)).map((a) => a.id));
  const [modelId, setModelId] = useState<string>("");
  const model = props.models.find((m) => m.id === modelId);
  const [modelRefs, setModelRefs] = useState<string[]>([]);
  const [variations, setVariations] = useState<number>(Number(preset?.config.variations ?? 2));

  const totalRefs = productRefs.length + modelRefs.length;
  const totalJobs = shotTypes.length * variations;
  const blocking = useMemo(() => {
    if (props.disabledReason) return props.disabledReason;
    if (!productRefs.length) return t.selectRef;
    if (totalRefs > props.maxReferences) return fmt(t.tooManyRefs, { max: props.maxReferences });
    if (!shotTypes.length) return t.selectShot;
    if (totalJobs > props.maxJobs) return fmt(t.tooManyJobs, { total: totalJobs, max: props.maxJobs });
    return null;
  }, [props.disabledReason, productRefs.length, totalRefs, props.maxReferences, shotTypes.length, totalJobs, props.maxJobs, t]);

  const roleLabel = (r: string) => (d.enums.assetRole as Record<string, string>)[r] ?? r;

  function toggle<T>(list: T[], value: T, on: boolean): T[] {
    return on ? Array.from(new Set([...list, value])) : list.filter((v) => v !== value);
  }

  return (
    <form
      className="grid gap-6 xl:grid-cols-[1fr_380px]"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        const style = shootStyleSchema.omit({ shotType: true }).safeParse({
          pose: fd.get("pose"),
          cameraAngle: fd.get("cameraAngle"),
          framing: fd.get("framing"),
          background: fd.get("background"),
          lighting: fd.get("lighting"),
          aspectRatio: fd.get("aspectRatio"),
          imageSize: fd.get("imageSize"),
          variations: fd.get("variations"),
          creativeInstructions: fd.get("creativeInstructions"),
        });
        if (!style.success) return setError(t.invalidSettings);
        start(async () => {
          const res = await createShoot({
            productId: props.product.id,
            modelProfileId: modelId || null,
            presetId: presetId || null,
            productReferenceAssetIds: productRefs,
            modelReferenceAssetIds: modelRefs,
            shotTypes,
            style: style.data,
            idempotencyKey,
          });
          if (!res.ok) return setError(res.error);
          router.push(`/jobs?batch=${res.data.batchId}`);
        });
      }}
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t.step1}</CardTitle>
            <CardDescription>
              {fmt(t.step1Description, { sku: props.product.sku, title: props.product.title })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-6">
              {props.productAssets.map((a) => (
                <label key={a.id} className="relative block cursor-pointer space-y-1">
                  <Checkbox
                    className="absolute left-1.5 top-1.5"
                    checked={productRefs.includes(a.id)}
                    onChange={(e) => setProductRefs((s) => toggle(s, a.id, e.target.checked))}
                    aria-label={fmt(t.useImage, { role: roleLabel(a.role) })}
                  />
                  {a.url ? <img src={a.url} alt="" className="aspect-[3/4] w-full rounded-md object-cover" /> : <div className="aspect-[3/4] rounded-md bg-muted" />}
                  <span className="text-xs text-muted-foreground">{roleLabel(a.role)}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.step2}</CardTitle>
            <CardDescription>{t.step2Description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NativeSelect
              aria-label={t.modelProfile}
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
                const m = props.models.find((x) => x.id === e.target.value);
                setModelRefs(m ? m.assets.filter((a) => a.isPrimary).map((a) => a.id).slice(0, 1) : []);
              }}
            >
              <option value="">{t.genericModel}</option>
              {props.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code})
                </option>
              ))}
            </NativeSelect>
            {model && model.assets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {model.assets.map((a) => (
                  <label key={a.id} className="relative cursor-pointer">
                    <Checkbox
                      className="absolute left-1 top-1"
                      checked={modelRefs.includes(a.id)}
                      onChange={(e) => setModelRefs((s) => toggle(s, a.id, e.target.checked))}
                      aria-label={t.useModelRef}
                    />
                    {a.url ? <img src={a.url} alt="" className="h-24 w-18 rounded object-cover" /> : <div className="h-24 w-18 rounded bg-muted" />}
                  </label>
                ))}
              </div>
            )}
            {model && model.assets.length === 0 && (
              <p className="text-sm text-muted-foreground">{t.noModelRefs}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.step3}</CardTitle>
            <CardDescription>{t.step3Description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="preset">{t.preset}</Label>
              <NativeSelect
                id="preset"
                value={presetId}
                onChange={(e) => {
                  setPresetId(e.target.value);
                  const p = props.presets.find((x) => x.id === e.target.value);
                  if (p?.config.shotType) setShotTypes([p.config.shotType as ShotType]);
                  if (p?.config.variations) setVariations(Number(p.config.variations));
                }}
              >
                <option value="">{t.customPreset}</option>
                {props.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{(d.enums.presetCategory as Record<string, string>)[p.category] ?? p.category}] {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">{t.shotTypes}</legend>
              <div className="flex flex-wrap gap-4">
                {SHOT_TYPES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={shotTypes.includes(s)} onChange={(e) => setShotTypes((list) => toggle(list, s, e.target.checked))} />
                    {d.enums.shotType[s]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div key={presetId} className="grid gap-4 sm:grid-cols-2" onChange={(e) => {
              const t = e.target as HTMLInputElement;
              if (t.name === "variations") setVariations(Number(t.value) || 1);
            }}>
              <StyleFields config={{ ...(preset?.config ?? {}), variations }} prefix="shoot-" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle>{t.summary}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{fmt(t.summaryImages, { total: totalJobs, shots: shotTypes.length, variations })}</p>
            <p>{fmt(t.summaryRefs, { n: totalRefs, max: props.maxReferences })}</p>
            <p className="text-muted-foreground">{t.summaryNote}</p>
            {blocking && (
              <Alert variant="warning">
                <AlertDescription>{blocking}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={pending || Boolean(blocking)}>
              {pending ? <Loader2 className="animate-spin" /> : <Camera />} {fmt(t.queue, { n: totalJobs })}
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
