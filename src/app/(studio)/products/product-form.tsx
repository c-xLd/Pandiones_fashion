"use client";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { SubmitButton } from "@/components/forms/submit-button";
import { FieldError, FormMessage } from "@/components/forms/form-message";
import { PRODUCT_STATUSES } from "@/lib/domain/schemas";
import type { ProductFormState } from "@/server/actions/products";
import type { ProductRow } from "@/lib/types";
import { useI18n } from "@/lib/i18n/client";

export function ProductForm({
  action,
  product,
  readOnly = false,
}: {
  action: (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;
  product?: ProductRow;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const { d } = useI18n();
  const f = d.products.form;
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sku">{f.sku}</Label>
            <Input id="sku" name="sku" required maxLength={64} defaultValue={product?.sku} aria-invalid={Boolean(fe?.sku)} />
            <FieldError errors={fe?.sku} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="title">{f.title}</Label>
            <Input id="title" name="title" required maxLength={200} defaultValue={product?.title} aria-invalid={Boolean(fe?.title)} />
            <FieldError errors={fe?.title} />
          </div>
        </div>
        <details className="group rounded-2xl border px-4 py-3 open:pb-4">
          <summary className="cursor-pointer select-none text-sm text-muted-foreground marker:content-none hover:text-foreground">
            <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span> {d.quickAdd.moreDetails}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="category">{f.category}</Label>
              <Input id="category" name="category" maxLength={80} placeholder={f.categoryPlaceholder} defaultValue={product?.category ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="color">{f.color}</Label>
              <Input id="color" name="color" maxLength={80} defaultValue={product?.color ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="size">{f.size}</Label>
              <Input id="size" name="size" maxLength={80} placeholder={f.sizePlaceholder} defaultValue={product?.size ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">{f.status}</Label>
              <NativeSelect id="status" name="status" defaultValue={product?.status ?? "draft"}>
                {PRODUCT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {d.enums.productStatus[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tags">{f.tags}</Label>
              <Input id="tags" name="tags" placeholder={f.tagsPlaceholder} defaultValue={product?.tags.join(", ")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">{f.description}</Label>
              <Textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={product?.description ?? ""} />
            </div>
          </div>
        </details>
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText={d.common.saving}>{product ? d.common.saveChanges : f.create}</SubmitButton>}
    </form>
  );
}
