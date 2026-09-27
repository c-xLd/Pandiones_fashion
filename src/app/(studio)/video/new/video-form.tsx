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
          <CardTitle>Approved source images</CardTitle>
          <CardDescription>
            {kind === "product"
              ? "Pick one approved image; it becomes the starting frame."
              : supportsReferenceImages
                ? "Pick up to 3 approved images as visual references."
                : "The configured video model is set up for a single starting image; pick one."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No approved images yet. Approve images in Review first.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {sources.map((s) => (
                <label key={s.id} className={`relative block cursor-pointer rounded-md ${selected.includes(s.id) ? "ring-2 ring-primary" : ""}`}>
                  <Checkbox
                    className="absolute left-1.5 top-1.5"
                    checked={selected.includes(s.id)}
                    onChange={(e) => toggle(s.id, e.target.checked)}
                    aria-label={`Use ${s.sku ?? ""} ${s.shotType ?? ""}`}
                  />
                  {s.url ? <img src={s.url} alt="" className="aspect-[3/4] w-full rounded-md object-cover" /> : <div className="aspect-[3/4] rounded-md bg-muted" />}
                  <span className="text-[11px] text-muted-foreground">
                    {s.sku} · {s.shotType}
                  </span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Video settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset className="flex gap-4 text-sm">
            <legend className="sr-only">Video type</legend>
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
                {k === "product" ? "Product video" : "Advertising video"}
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" name="name" required maxLength={160} />
          </div>
          {kind === "advertising" && (
            <div className="space-y-1">
              <Label htmlFor="brief">Campaign brief</Label>
              <Textarea id="brief" name="brief" rows={3} maxLength={3000} placeholder="Audience, mood, message, season…" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="prompt">Scene description *</Label>
            <Textarea id="prompt" name="prompt" rows={3} required maxLength={2000} placeholder="The model turns slowly to show the garment…" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="motion">Camera & motion</Label>
            <Input id="motion" name="motion" maxLength={1000} placeholder="slow dolly-in, gentle fabric movement" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="duration">Duration</Label>
              <NativeSelect id="duration" name="duration" defaultValue={String(durations[durations.length - 1])}>
                {durations.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aspectRatio">Aspect</Label>
              <NativeSelect id="aspectRatio" name="aspectRatio" defaultValue="9:16">
                {VIDEO_ASPECT_RATIOS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="resolution">Resolution</Label>
              <NativeSelect id="resolution" name="resolution" defaultValue="720p">
                {VIDEO_RESOLUTIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Video generation is billed per generated second and runs for several minutes in the background. Supported durations and resolutions depend on the
            configured model.
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="w-full" disabled={pending || selected.length === 0}>
            {pending ? <Loader2 className="animate-spin" /> : <Clapperboard />} Generate video
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
