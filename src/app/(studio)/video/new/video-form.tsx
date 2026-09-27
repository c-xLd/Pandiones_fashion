"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { VIDEO_ASPECT_RATIOS, VIDEO_RESOLUTIONS } from "@/lib/domain/schemas";
import { createVideoProject } from "@/server/actions/video";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import { shotLabel } from "@/lib/i18n/labels";

export interface VideoSource {
  id: string;
  url: string | null;
  sku: string | null;
  shotType: string | null;
}

export function VideoForm({
  sources,
  initialSelection,
  durations,
  supportsReferenceImages,
}: {
  sources: VideoSource[];
  initialSelection: string[];
  durations: number[];
  supportsReferenceImages: boolean;
}) {
  const router = useRouter();
  const { d } = useI18n();
  const t = d.video.form;
  const [kind, setKind] = useState<"product" | "advertising">("product");
  const [selected, setSelected] = useState<string[]>(initialSelection.slice(0, 1));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const maxImages = kind === "product" ? 1 : supportsReferenceImages ? 3 : 1;

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      if (!on) return s.filter((x) => x !== id);
      if (maxImages === 1) return [id];
      return s.length >= maxImages ? s : [...s, id];
    });
  }

  return (
    <form
      className="grid gap-6 xl:grid-cols-[1fr_380px]"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await createVideoProject({
            name: String(fd.get("name") ?? ""),
            kind,
            sourceResultIds: selected,
            brief: String(fd.get("brief") ?? ""),
            prompt: String(fd.get("prompt") ?? ""),
            motionInstructions: String(fd.get("motion") ?? ""),
            durationSeconds: Number(fd.get("duration")),
            aspectRatio: String(fd.get("aspectRatio")) as (typeof VIDEO_ASPECT_RATIOS)[number],
            resolution: String(fd.get("resolution")) as (typeof VIDEO_RESOLUTIONS)[number],
            idempotencyKey: key,
          });
          if (!res.ok) return setError(res.error);
          router.push(`/video/${res.data.projectId}`);
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{t.sourcesTitle}</CardTitle>
          <CardDescription>
            {kind === "product" ? t.sourcesProduct : supportsReferenceImages ? t.sourcesAdRefs : t.sourcesAdSingle}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noApproved}</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {sources.map((s) => (
                <label key={s.id} className={`relative block cursor-pointer rounded-md ${selected.includes(s.id) ? "ring-2 ring-primary" : ""}`}>
                  <Checkbox
                    className="absolute left-1.5 top-1.5"
                    checked={selected.includes(s.id)}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                    aria-label={fmt(t.useImage, { name: `${s.sku ?? ""} ${shotLabel(d, s.shotType)}` })}
                  />
                  {s.url ? <img src={s.url} alt="" className="aspect-[3/4] w-full rounded-md object-cover" /> : <div className="aspect-[3/4] rounded-md bg-muted" />}
                  <span className="text-[11px] text-muted-foreground">
                    {s.sku} · {shotLabel(d, s.shotType)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t.settings}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">{t.videoType}</legend>
            {(["product", "advertising"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === k}
                  onChange={() => {
                    setKind(k);
                    setSelected((s) => s.slice(0, 1));
                  }}
                />
                {k === "product" ? t.productVideo : t.adVideo}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="name">{t.name}</Label>
            <Input id="name" name="name" required maxLength={160} />
          </div>
          {kind === "advertising" && (
            <div className="space-y-1">
              <Label htmlFor="brief">{t.brief}</Label>
              <Textarea id="brief" name="brief" rows={3} maxLength={3000} placeholder={t.briefPlaceholder} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="prompt">{t.prompt}</Label>
            <Textarea id="prompt" name="prompt" rows={3} required maxLength={2000} placeholder={t.promptPlaceholder} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="motion">{t.motion}</Label>
            <Input id="motion" name="motion" maxLength={1000} placeholder={t.motionPlaceholder} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="duration">{t.duration}</Label>
              <NativeSelect id="duration" name="duration" defaultValue={String(durations[durations.length - 1])}>
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aspectRatio">{t.aspect}</Label>
              <NativeSelect id="aspectRatio" name="aspectRatio" defaultValue="9:16">
                {VIDEO_ASPECT_RATIOS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="resolution">{t.resolution}</Label>
              <NativeSelect id="resolution" name="resolution" defaultValue="720p">
                {VIDEO_RESOLUTIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t.billingNote}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending || selected.length === 0}>
            {pending ? <Loader2 className="animate-spin" /> : <Clapperboard />} {t.generate}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
