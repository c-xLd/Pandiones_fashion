"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, FormMessage } from "@/components/forms/form-message";
import type { ModelFormState } from "@/server/actions/models";
import type { ModelProfileRow } from "@/lib/types";
import { useI18n } from "@/lib/i18n/client";

export function ModelForm({
  action,
  model,
  readOnly = false,
}: {
  action: (prev: ModelFormState, fd: FormData) => Promise<ModelFormState>;
  model?: ModelProfileRow;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const { d } = useI18n();
  const f = d.models.form;
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const a = model?.appearance ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">{f.displayName}</Label>
          <Input id="displayName" name="displayName" required maxLength={120} defaultValue={model?.display_name} />
          <FieldError errors={fe?.displayName} />
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <Checkbox name="adultConfirmed" defaultChecked={model?.adult_confirmed ?? false} required className="mt-0.5" />
          <span>{f.adultConfirm}</span>
        </label>
        <FieldError errors={fe?.adultConfirmed} />
        <details className="group rounded-2xl border px-4 py-3 open:pb-4">
          <summary className="cursor-pointer select-none text-sm text-muted-foreground marker:content-none hover:text-foreground">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> {d.quickAdd.moreDetails}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="code">{f.code}</Label>
              <Input id="code" name="code" required pattern="[A-Za-z0-9_-]{2,40}" placeholder={f.codePlaceholder} defaultValue={model?.code} />
              <FieldError errors={fe?.code} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hair">{f.hair}</Label>
              <Input id="hair" name="hair" defaultValue={a.hair ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eyes">{f.eyes}</Label>
              <Input id="eyes" name="eyes" defaultValue={a.eyes ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skinTone">{f.skinTone}</Label>
              <Input id="skinTone" name="skinTone" defaultValue={a.skin_tone ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="build">{f.build}</Label>
              <Input id="build" name="build" defaultValue={a.build ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ageRange">{f.ageRange}</Label>
              <Input id="ageRange" name="ageRange" placeholder={f.ageRangePlaceholder} defaultValue={a.age_range ?? ""} />
              <FieldError errors={fe?.ageRange} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">{f.status}</Label>
              <NativeSelect id="status" name="status" defaultValue={model?.status ?? "draft"}>
                <option value="draft">{d.enums.modelStatus.draft}</option>
                <option value="active">{d.enums.modelStatus.active}</option>
                <option value="retired">{d.enums.modelStatus.retired}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="preferredLighting">{f.preferredLighting}</Label>
              <Input id="preferredLighting" name="preferredLighting" defaultValue={model?.preferred_lighting ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="photographyStyle">{f.photographyStyle}</Label>
              <Input id="photographyStyle" name="photographyStyle" defaultValue={model?.photography_style ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">{f.description}</Label>
              <Textarea id="description" name="description" rows={3} defaultValue={model?.description ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="stylingNotes">{f.stylingNotes}</Label>
              <Textarea id="stylingNotes" name="stylingNotes" rows={2} defaultValue={model?.styling_notes ?? ""} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="consentNotes">{f.consentNotes}</Label>
              <Textarea id="consentNotes" name="consentNotes" rows={2} placeholder={f.consentPlaceholder} defaultValue={model?.consent_notes ?? ""} />
            </div>
          </div>
        </details>
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText={d.common.saving}>{model ? f.save : f.create}</SubmitButton>}
    </form>
  );
}
