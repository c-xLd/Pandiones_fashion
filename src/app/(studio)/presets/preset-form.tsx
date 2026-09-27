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
import { useI18n } from "@/lib/i18n/client";

export interface PresetDefaults {
  name: string;
  category: string;
  description: string | null;
  config: Partial<ShootStyle>;
}

export function StyleFields({ config, prefix = "" }: { config: Partial<ShootStyle>; prefix?: string }) {
  const id = (n: string) => `${prefix}${n}`;
  const { d } = useI18n();
  const f = d.presets.form;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={id("framing")}>{f.framing}</Label>
        <NativeSelect id={id("framing")} name="framing" defaultValue={config.framing ?? "full_body"}>
          {FRAMINGS.map((fr) => (
            <option key={fr} value={fr}>
              {d.enums.framing[fr]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("cameraAngle")}>{f.cameraAngle}</Label>
        <Input id={id("cameraAngle")} name="cameraAngle" maxLength={200} defaultValue={config.cameraAngle ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("pose")}>{f.pose}</Label>
        <Input id={id("pose")} name="pose" maxLength={300} defaultValue={config.pose ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("background")}>{f.background}</Label>
        <Input id={id("background")} name="background" maxLength={300} defaultValue={config.background ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("lighting")}>{f.lighting}</Label>
        <Input id={id("lighting")} name="lighting" maxLength={300} defaultValue={config.lighting ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("aspectRatio")}>{f.aspectRatio}</Label>
        <NativeSelect id={id("aspectRatio")} name="aspectRatio" defaultValue={config.aspectRatio ?? "3:4"}>
          {IMAGE_ASPECT_RATIOS.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("imageSize")}>{f.imageSize}</Label>
        <NativeSelect id={id("imageSize")} name="imageSize" defaultValue={config.imageSize ?? "2K"}>
          {IMAGE_SIZES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("variations")}>{f.variations}</Label>
        <Input id={id("variations")} name="variations" type="number" min={1} max={8} defaultValue={config.variations ?? 2} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("creativeInstructions")}>{f.creativeInstructions}</Label>
        <Textarea id={id("creativeInstructions")} name="creativeInstructions" rows={3} maxLength={2000} defaultValue={config.creativeInstructions ?? ""} />
        <p className="text-xs text-muted-foreground">{f.creativeHint}</p>
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
  const { d } = useI18n();
  const f = d.presets.form;
  const c = defaults?.config ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">{f.name}</Label>
          <Input id="name" name="name" required maxLength={120} defaultValue={defaults?.name} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">{f.category}</Label>
          <NativeSelect id="category" name="category" defaultValue={defaults?.category ?? "ecommerce"}>
            {PRESET_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {d.enums.presetCategory[cat]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">{f.description}</Label>
          <Input id="description" name="description" maxLength={500} defaultValue={defaults?.description ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shotType">{f.shotType}</Label>
          <NativeSelect id="shotType" name="shotType" defaultValue={c.shotType ?? "front"}>
            {SHOT_TYPES.map((s) => (
              <option key={s} value={s}>
                {d.enums.shotType[s]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <StyleFields config={c} />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText={d.common.saving}>{f.save}</SubmitButton>
    </form>
  );
}
