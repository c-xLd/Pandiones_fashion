"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { IMAGE_ASPECT_RATIOS, IMAGE_SIZES } from "@/lib/domain/schemas";
import { requestModelPortrait } from "@/server/actions/models";

export function PortraitGenerator({
  modelId,
  references,
  disabledReason,
}: {
  modelId: string;
  references: { id: string; url: string | null }[];
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await requestModelPortrait({
            modelId,
            instructions: String(fd.get("instructions") ?? ""),
            referenceAssetIds: selected,
            aspectRatio: String(fd.get("aspectRatio")) as (typeof IMAGE_ASPECT_RATIOS)[number],
            imageSize: String(fd.get("imageSize")) as (typeof IMAGE_SIZES)[number],
            idempotencyKey: key,
          });
          if (res.ok) {
            setMessage({ ok: true, text: "Portrait queued. It appears below when the worker finishes." });
            setKey(crypto.randomUUID());
            router.refresh();
          } else setMessage({ ok: false, text: res.error });
        });
      }}
    >
      {references.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Identity references (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {references.map((r) => (
              <label key={r.id} className="relative cursor-pointer">
                <Checkbox
                  className="absolute left-1 top-1"
                  checked={selected.includes(r.id)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))}
                  aria-label="Use as identity reference"
                />
                {r.url ? <img src={r.url} alt="" className="h-20 w-16 rounded object-cover" /> : <div className="h-20 w-16 rounded bg-muted" />}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="aspectRatio">Aspect ratio</Label>
          <NativeSelect id="aspectRatio" name="aspectRatio" defaultValue="3:4">
            {IMAGE_ASPECT_RATIOS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="imageSize">Size</Label>
          <NativeSelect id="imageSize" name="imageSize" defaultValue="1K">
            {IMAGE_SIZES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="instructions">Instructions</Label>
        <Textarea id="instructions" name="instructions" rows={2} maxLength={2000} placeholder="e.g. soft smile, hair tied back" />
      </div>
      {disabledReason && <p className="text-xs text-warning-foreground">{disabledReason}</p>}
      <Button type="submit" disabled={pending || Boolean(disabledReason)}>
        {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate reference portrait
      </Button>
      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-destructive"}`}>{message.text}</p>}
    </form>
  );
}
