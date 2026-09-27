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
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={formAction} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sku">SKU *</Label>
          <Input id="sku" name="sku" required maxLength={64} defaultValue={product?.sku} aria-invalid={Boolean(fe?.sku)} />
          <FieldError errors={fe?.sku} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="title">Title *</Label>
          <Input id="title" name="title" required maxLength={200} defaultValue={product?.title} aria-invalid={Boolean(fe?.title)} />
          <FieldError errors={fe?.title} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="category">Category</Label>
          <Input id="category" name="category" maxLength={80} placeholder="e.g. bralette" defaultValue={product?.category ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="color">Color</Label>
          <Input id="color" name="color" maxLength={80} defaultValue={product?.color ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="size">Size(s)</Label>
          <Input id="size" name="size" maxLength={80} placeholder="e.g. XS–XL" defaultValue={product?.size ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={product?.status ?? "draft"}>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="tags">Tags</Label>
          <Input id="tags" name="tags" placeholder="comma separated, e.g. lace, summer-26" defaultValue={product?.tags.join(", ")} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" rows={4} maxLength={5000} defaultValue={product?.description ?? ""} />
        </div>
      </fieldset>
      <FormMessage state={state} />
      {!readOnly && <SubmitButton pendingText="Saving…">{product ? "Save changes" : "Create product"}</SubmitButton>}
    </form>
  );
}
