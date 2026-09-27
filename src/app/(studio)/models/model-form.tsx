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
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const a = model?.appearance ?? {};
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name *</Label>
          <Input id="displayName" name="displayName" required maxLength={120} defaultValue={model?.display_name} />
          <FieldError errors={fe?.displayName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code">Model identifier *</Label>
          <Input id="code" name="code" required pattern="[A-Za-z0-9_-]{2,40}" placeholder="e.g. PX-M01" defaultValue={model?.code} />
          <FieldError errors={fe?.code} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hair">Hair</Label>
          <Input id="hair" name="hair" defaultValue={a.hair ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eyes">Eyes</Label>
          <Input id="eyes" name="eyes" defaultValue={a.eyes ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="skinTone">Skin tone</Label>
          <Input id="skinTone" name="skinTone" defaultValue={a.skin_tone ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="build">Build</Label>
          <Input id="build" name="build" defaultValue={a.build ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ageRange">Apparent age range (18+)</Label>
          <Input id="ageRange" name="ageRange" placeholder="e.g. 25-30" defaultValue={a.age_range ?? ""} />
          <FieldError errors={fe?.ageRange} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Usage status</Label>
          <NativeSelect id="status" name="status" defaultValue={model?.status ?? "draft"}>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="retired">retired</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preferredLighting">Preferred lighting</Label>
          <Input id="preferredLighting" name="preferredLighting" defaultValue={model?.preferred_lighting ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="photographyStyle">Photography style</Label>
          <Input id="photographyStyle" name="photographyStyle" defaultValue={model?.photography_style ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={3} defaultValue={model?.description ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="stylingNotes">Styling notes</Label>
          <Textarea id="stylingNotes" name="stylingNotes" rows={2} defaultValue={model?.styling_notes ?? ""} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="consentNotes">Consent / rights notes</Label>
          <Textarea
            id="consentNotes"
            name="consentNotes"
            rows={2}
            placeholder="For real people: model release reference, usage scope, expiry. For synthetic models: note that it is AI-generated."
            defaultValue={model?.consent_notes ?? ""}
          />
        </div>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <Checkbox name="adultConfirmed" defaultChecked={model?.adult_confirmed ?? false} required className="mt-0.5" />
          <span>
            I confirm this profile depicts an adult (18+), and that any real person shown has given documented consent for this use.
          </span>
        </label>
        <FieldError errors={fe?.adultConfirmed} />
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText="Saving…">{model ? "Save profile" : "Create profile"}</SubmitButton>}
    </form>
  );
}
