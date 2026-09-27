"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { FRAMINGS, IMAGE_ASPECT_RATIOS, IMAGE_SIZES, PRESET_CATEGORIES, SHOT_TYPES, type ShootStyle } from "@/lib/domain/schemas";
import type { PresetFormState } from "@/server/actions/generation";

export interface PresetDefaults {
  name: string;
  category: string;
  description: string | null;
  config: Partial<ShootStyle>;
}

export function StyleFields({ config, prefix = "" }: { config: Partial<ShootStyle>; prefix?: string }) {
  const id = (n: string) => `${prefix}${n}`;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={id("framing")}>Framing / crop</Label>
        <NativeSelect id={id("framing")} name="framing" defaultValue={config.framing ?? "full_body"}>
          {FRAMINGS.map((f) => (
            <option key={f} value={f}>
              {f.replace(/_/g, " ")}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("cameraAngle")}>Camera angle</Label>
        <Input id={id("cameraAngle")} name="cameraAngle" maxLength={200} defaultValue={config.cameraAngle ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("pose")}>Pose</Label>
        <Input id={id("pose")} name="pose" maxLength={300} defaultValue={config.pose ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("background")}>Background</Label>
        <Input id={id("background")} name="background" maxLength={300} defaultValue={config.background ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("lighting")}>Lighting</Label>
        <Input id={id("lighting")} name="lighting" maxLength={300} defaultValue={config.lighting ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("aspectRatio")}>Aspect ratio</Label>
        <NativeSelect id={id("aspectRatio")} name="aspectRatio" defaultValue={config.aspectRatio ?? "3:4"}>
          {IMAGE_ASPECT_RATIOS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("imageSize")}>Output resolution</Label>
        <NativeSelect id={id("imageSize")} name="imageSize" defaultValue={config.imageSize ?? "2K"}>
          {IMAGE_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("variations")}>Variations per shot</Label>
        <Input id={id("variations")} name="variations" type="number" min={1} max={8} defaultValue={config.variations ?? 2} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("creativeInstructions")}>Creative instructions</Label>
        <Textarea id={id("creativeInstructions")} name="creativeInstructions" rows={3} maxLength={2000} defaultValue={config.creativeInstructions ?? ""} />
        <p className="text-xs text-muted-foreground">Styling only. Product accuracy constraints are added automatically from the product record.</p>
      </div>
    </>
  );
}

export function PresetForm({
  action,
  defaults,
}: {
  action: (prev: PresetFormState, fd: FormData) => Promise<PresetFormState>;
  defaults?: PresetDefaults;
}) {
  const [state, formAction] = useActionState(action, null);
  const c = defaults?.config ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name *</Label>
          <Input id="name" name="name" required maxLength={120} defaultValue={defaults?.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <NativeSelect id="category" name="category" defaultValue={defaults?.category ?? "ecommerce"}>
            {PRESET_CATEGORIES.map((cat) => (
              <option key={cat}>{cat}</option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Input id="description" name="description" maxLength={500} defaultValue={defaults?.description ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shotType">Default shot type</Label>
          <NativeSelect id="shotType" name="shotType" defaultValue={c.shotType ?? "front"}>
            {SHOT_TYPES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", "-")}
              </option>
            ))}
          </NativeSelect>
        </div>
        <StyleFields config={c} />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save preset</SubmitButton>
    </form>
  );
}
