"use client";
import { useActionState } from "react";
import type { ProductAnalysis } from "@/lib/domain/analysis";
import type { ProductFormState } from "@/server/actions/products";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormMessage } from "@/components/forms/form-message";
import { formatDateTime } from "@/lib/utils";

const FIELDS: { name: string; label: string; suggest: (a: ProductAnalysis) => string }[] = [
  { name: "category", label: "Category", suggest: (a) => a.category },
  { name: "colors", label: "Colors", suggest: (a) => a.dominantColors.map((c) => c.name).join(", ") },
  { name: "fabric", label: "Fabric", suggest: (a) => a.fabricAppearance },
  { name: "silhouette", label: "Silhouette", suggest: (a) => a.silhouette },
  { name: "construction", label: "Construction", suggest: (a) => a.construction },
  {
    name: "closures",
    label: "Closures",
    suggest: (a) => a.details.filter((d) => d.element === "closures").map((d) => d.description).join("; "),
  },
  {
    name: "straps",
    label: "Straps",
    suggest: (a) => a.details.filter((d) => d.element === "straps").map((d) => d.description).join("; "),
  },
  {
    name: "lace_or_pattern",
    label: "Lace / pattern",
    suggest: (a) => a.details.filter((d) => d.element === "lace" || d.element === "print").map((d) => d.description).join("; "),
  },
  { name: "notes", label: "Other notes", suggest: () => "" },
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
  return (
    <form action={formAction} className="space-y-3 border-t pt-4">
      <div>
        <p className="font-medium">Verified product attributes</p>
        <p className="text-xs text-muted-foreground">
          {reviewedAt
            ? `Last confirmed ${formatDateTime(reviewedAt)}. These are sent to the image model as product facts.`
            : analysis
              ? "Pre-filled from the AI analysis. Check each value against the real product, correct it, then save."
              : "Optional. Enter facts about the garment you want every shoot to respect."}
        </p>
      </div>
      <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => {
          const current = verified?.[f.name];
          const fallback = !verified && analysis ? f.suggest(analysis) : "";
          return (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`va-${f.name}`}>{f.label}</Label>
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
      {!readOnly && <SubmitButton pendingText="Saving…" variant="secondary">Confirm attributes</SubmitButton>}
    </form>
  );
}
