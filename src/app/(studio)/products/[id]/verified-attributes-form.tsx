"use client";
import { useActionState } from "react";
import type { ProductAnalysis } from "@/lib/domain/analysis";
import type { ProductFormState } from "@/server/actions/products";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/client";
import { fmt } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries";

const FIELDS: { name: keyof Dictionary["verified"]["fields"]; suggest: (a: ProductAnalysis) => string }[] = [
  { name: "category", suggest: (a) => a.category },
  { name: "colors", suggest: (a) => a.dominantColors.map((c) => c.name).join(", ") },
  { name: "fabric", suggest: (a) => a.fabricAppearance },
  { name: "silhouette", suggest: (a) => a.silhouette },
  { name: "construction", suggest: (a) => a.construction },
  {
    name: "closures",
    suggest: (a) => a.details.filter((d) => d.element === "closures").map((d) => d.description).join("; "),
  },
  {
    name: "straps",
    suggest: (a) => a.details.filter((d) => d.element === "straps").map((d) => d.description).join("; "),
  },
  {
    name: "lace_or_pattern",
    suggest: (a) => a.details.filter((d) => d.element === "lace" || d.element === "print").map((d) => d.description).join("; "),
  },
  { name: "notes", suggest: () => "" },
];

export function VerifiedAttributesForm({
  action,
  verified,
  analysis,
  reviewedAt,
  readOnly,
}: {
  action: (prev: ProductFormState, fd: FormData) => Promise<ProductFormState>;
  verified: Record<string, unknown> | null;
  analysis: ProductAnalysis | null;
  reviewedAt: string | null;
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const { locale, d } = useI18n();
  return (
    <form action={formAction} className="space-y-3 border-t pt-4">
      <div>
        <p className="font-medium">{d.verified.title}</p>
        <p className="text-xs text-muted-foreground">
          {reviewedAt
            ? fmt(d.verified.lastConfirmed, { date: formatDateTime(reviewedAt, locale) })
            : analysis
              ? d.verified.prefilled
              : d.verified.optional}
        </p>
      </div>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const current = verified?.[f.name];
          const fallback = !verified && analysis ? f.suggest(analysis) : "";
          return (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`va-${f.name}`}>{d.verified.fields[f.name]}</Label>
              <Input
                id={`va-${f.name}`}
                name={f.name}
                maxLength={500}
                defaultValue={typeof current === "string" ? current : fallback}
              />
            </div>
          );
        })}
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText={d.common.saving} variant="secondary">{d.verified.confirm}</SubmitButton>}
    </form>
  );
}
