"use server";

import { getI18n } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n/config";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ASSET_ROLES, PRODUCT_STATUSES, productInputSchema } from "@/lib/domain/schemas";
import { validateDeclaredImage } from "@/lib/domain/files";
import { geminiConfig } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, ProductAssetRow } from "@/lib/types";
import { requireOrgContext } from "../context";
import { UserFacingError, check, runAction, toActionError } from "../action";
import { enforceRateLimit } from "../rate-limit";
import { audit } from "../audit";
import { BUCKET, assertUploadPath, downloadObject, paths, processImage, removeObjects, uploadObject } from "../storage";
import { enqueueJobs } from "../jobs/enqueue";

export type ProductFormState = { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> } | null;

function productFromForm(formData: FormData) {
  return productInputSchema.parse({
    sku: formData.get("sku"),
    title: formData.get("title"),
    category: formData.get("category") ?? undefined,
    color: formData.get("color") ?? undefined,
    size: formData.get("size") ?? undefined,
    description: formData.get("description") ?? undefined,
    tags: formData.get("tags") ?? undefined,
    status: formData.get("status") ?? undefined,
  });
}

export async function createProduct(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  let id: string;
  try {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const input = productFromForm(formData);
    const row = check(
      await ctx.supabase
        .from("products")
        .insert({ ...input, organization_id: ctx.org.organizationId, created_by: ctx.userId })
        .select("id")
        .single(),
      "Create product",
    ) as { id: string };
    id = row.id;
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.created", entityType: "product", entityId: id, metadata: { sku: input.sku } });
  } catch (error) {
    return toActionError(error, "createProduct");
  }
  revalidatePath("/products");
  redirect(`/products/${id}`);
}

export async function updateProduct(productId: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  try {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const input = productFromForm(formData);
    const rows = check(
      await ctx.supabase
        .from("products")
        .update(input)
        .eq("id", z.uuid().parse(productId))
        .eq("organization_id", ctx.org.organizationId)
        .select("id"),
      "Update product",
    ) as { id: string }[];
    if (!rows.length) throw new UserFacingError("productNotFound");
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.updated", entityType: "product", entityId: productId });
    revalidatePath(`/products/${productId}`);
    revalidatePath("/products");
    return { ok: true, message: (await getI18n()).d.products.saved };
  } catch (error) {
    return toActionError(error, "updateProduct");
  }
}

export async function setProductStatus(productId: string, status: string): Promise<ActionResult> {
  return runAction("setProductStatus", async () => {
    const ctx = await requireOrgContext("editor");
    const parsed = z.enum(PRODUCT_STATUSES).parse(status);
    check(
      await ctx.supabase
        .from("products")
        .update({ status: parsed })
        .eq("id", z.uuid().parse(productId))
        .eq("organization_id", ctx.org.organizationId),
      "Update status",
    );
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.status_changed", entityType: "product", entityId: productId, metadata: { status: parsed } });
    revalidatePath(`/products/${productId}`);
    revalidatePath("/products");
    return undefined;
  });
}

export async function deleteProduct(productId: string): Promise<ActionResult> {
  const result = await runAction("deleteProduct", async () => {
    const ctx = await requireOrgContext("admin");
    const id = z.uuid().parse(productId);
    const assets = check(
      await ctx.supabase.from("product_assets").select("storage_path, thumbnail_path").eq("product_id", id).eq("organization_id", ctx.org.organizationId),
      "Load assets",
    ) as { storage_path: string; thumbnail_path: string | null }[];
    const deleted = check(
      await ctx.supabase.from("products").delete().eq("id", id).eq("organization_id", ctx.org.organizationId).select("id"),
      "Delete product",
    ) as { id: string }[];
    if (!deleted.length) throw new UserFacingError("productNotFound");
    // Source images are removed with the product; generated results are kept
    // (they remain in the media library, detached from the product).
    await removeObjects(assets.flatMap((a) => [a.storage_path, a.thumbnail_path ?? ""]));
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.deleted", entityType: "product", entityId: id });
    return undefined;
  });
  if (result.ok) redirect("/products");
  return result;
}

// ---------------------------------------------------------------------------
// Uploads: browser -> signed upload URL -> finalize (server validates bytes)
// ---------------------------------------------------------------------------
const uploadTargetSchema = z.object({
  target: z.enum(["products", "models"]),
  entityId: z.uuid(),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().max(100),
});

export async function createUploadTarget(
  input: z.input<typeof uploadTargetSchema>,
): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  return runAction("createUploadTarget", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("upload", ctx.userId);
    const data = uploadTargetSchema.parse(input);
    const declared = validateDeclaredImage({ name: data.fileName, size: data.size, type: data.mimeType });
    if (!declared.ok) throw new UserFacingError(declared.error, declared.vars);

    const table = data.target === "products" ? "products" : "model_profiles";
    const owner = check(
      await ctx.supabase.from(table).select("id").eq("id", data.entityId).eq("organization_id", ctx.org.organizationId).maybeSingle(),
      "Load target",
    );
    if (!owner) throw new UserFacingError("targetNotFound");

    const path =
      data.target === "products"
        ? paths.productSource(ctx.org.organizationId, data.entityId, declared.mimeType)
        : paths.modelSource(ctx.org.organizationId, data.entityId, declared.mimeType);
    const signed = await getSupabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw new Error(`createSignedUploadUrl failed: ${signed.error?.message}`);
    return { path: signed.data.path, token: signed.data.token, bucket: BUCKET };
  });
}

const finalizeSchema = z.object({
  productId: z.uuid(),
  path: z.string().max(300),
  role: z.enum(ASSET_ROLES),
  originalFilename: z.string().max(255),
});

export async function finalizeProductAsset(
  input: z.input<typeof finalizeSchema>,
): Promise<ActionResult<{ asset: ProductAssetRow; duplicate: string | null }>> {
  return runAction("finalizeProductAsset", async () => {
    const ctx = await requireOrgContext("editor");
    const data = finalizeSchema.parse(input);
    const org = ctx.org.organizationId;
    assertUploadPath(data.path, org, "products", data.productId);

    const bytes = await downloadObject(data.path).catch(() => {
      throw new UserFacingError("uploadNotFound");
    });
    let processed;
    try {
      processed = await processImage(bytes);
    } catch (error) {
      await removeObjects([data.path]);
      throw error;
    }

    // Duplicate detection by content hash.
    const dupes = check(
      await ctx.supabase.from("product_assets").select("id, product_id, products(sku)").eq("organization_id", org).eq("sha256", processed.sha256).limit(5),
      "Duplicate check",
    ) as { id: string; product_id: string; products: { sku: string } | { sku: string }[] | null }[];
    const sameProduct = dupes.find((d) => d.product_id === data.productId);
    if (sameProduct) {
      await removeObjects([data.path]);
      throw new UserFacingError("duplicateProductImage");
    }
    const other = dupes[0];
    const otherSku = other ? (Array.isArray(other.products) ? other.products[0]?.sku : other.products?.sku) : null;

    const thumbPath = paths.thumbnailFor(data.path);
    await uploadObject(thumbPath, processed.thumbnail, "image/webp");
    const asset = check(
      await ctx.supabase
        .from("product_assets")
        .insert({
          organization_id: org,
          product_id: data.productId,
          role: data.role,
          storage_path: data.path,
          thumbnail_path: thumbPath,
          mime_type: processed.mimeType,
          size_bytes: processed.sizeBytes,
          width: processed.width,
          height: processed.height,
          sha256: processed.sha256,
          original_filename: data.originalFilename,
          created_by: ctx.userId,
        })
        .select("*")
        .single(),
      "Save asset",
    ) as ProductAssetRow;
    await audit({ organizationId: org, actorId: ctx.userId, action: "product_asset.uploaded", entityType: "product_asset", entityId: asset.id, metadata: { productId: data.productId, role: data.role, sizeBytes: processed.sizeBytes } });
    revalidatePath(`/products/${data.productId}`);
    return { asset, duplicate: otherSku ? fmt((await getI18n()).d.errors.duplicateOnProduct, { sku: otherSku }) : null };
  });
}

export async function updateAssetRole(assetId: string, role: string): Promise<ActionResult> {
  return runAction("updateAssetRole", async () => {
    const ctx = await requireOrgContext("editor");
    const rows = check(
      await ctx.supabase
        .from("product_assets")
        .update({ role: z.enum(ASSET_ROLES).parse(role) })
        .eq("id", z.uuid().parse(assetId))
        .eq("organization_id", ctx.org.organizationId)
        .select("product_id"),
      "Update role",
    ) as { product_id: string }[];
    if (rows[0]) revalidatePath(`/products/${rows[0].product_id}`);
    return undefined;
  });
}

export async function deleteProductAsset(assetId: string): Promise<ActionResult> {
  return runAction("deleteProductAsset", async () => {
    const ctx = await requireOrgContext("editor");
    const rows = check(
      await ctx.supabase
        .from("product_assets")
        .delete()
        .eq("id", z.uuid().parse(assetId))
        .eq("organization_id", ctx.org.organizationId)
        .select("product_id, storage_path, thumbnail_path"),
      "Delete asset",
    ) as { product_id: string; storage_path: string; thumbnail_path: string | null }[];
    const row = rows[0];
    if (!row) throw new UserFacingError("imageNotFound");
    await removeObjects([row.storage_path, row.thumbnail_path ?? ""]);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product_asset.deleted", entityType: "product_asset", entityId: assetId });
    revalidatePath(`/products/${row.product_id}`);
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
export async function requestAnalysis(productId: string): Promise<ActionResult<{ jobId: string }>> {
  return runAction("requestAnalysis", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("analyze", ctx.userId);
    const id = z.uuid().parse(productId);
    const cfg = geminiConfig();
    const assets = check(
      await ctx.supabase.from("product_assets").select("id").eq("product_id", id).eq("organization_id", ctx.org.organizationId).order("created_at").limit(8),
      "Load assets",
    ) as { id: string }[];
    if (!assets.length) throw new UserFacingError("analysisNeedsImages");
    const { jobs } = await enqueueJobs(ctx, [
      {
        jobType: "product_analysis",
        provider: "gemini",
        model: cfg.analysisModel,
        idempotencyKey: `analysis:${id}:${randomUUID()}`,
        productId: id,
        inputAssetRefs: assets.map((a) => ({ kind: "product_asset", id: a.id })),
        config: { language: (await getI18n()).locale },
      },
    ]);
    check(
      await ctx.supabase.from("products").update({ analysis_status: "queued" }).eq("id", id).eq("organization_id", ctx.org.organizationId),
      "Update product",
    );
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.analysis_requested", entityType: "product", entityId: id });
    revalidatePath(`/products/${id}`);
    return { jobId: jobs[0]?.id ?? "" };
  });
}

const VERIFIED_FIELDS = ["category", "colors", "fabric", "silhouette", "construction", "closures", "straps", "lace_or_pattern", "notes"] as const;

export async function saveVerifiedAttributes(productId: string, _prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  try {
    const ctx = await requireOrgContext("editor");
    const attrs: Record<string, string> = {};
    for (const field of VERIFIED_FIELDS) {
      const value = String(formData.get(field) ?? "").trim().slice(0, 500);
      if (value) attrs[field] = value;
    }
    check(
      await ctx.supabase
        .from("products")
        .update({
          verified_attributes: attrs,
          analysis_reviewed_by: ctx.userId,
          analysis_reviewed_at: new Date().toISOString(),
        })
        .eq("id", z.uuid().parse(productId))
        .eq("organization_id", ctx.org.organizationId),
      "Save attributes",
    );
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.attributes_verified", entityType: "product", entityId: productId });
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: (await getI18n()).d.verified.saved };
  } catch (error) {
    return toActionError(error, "saveVerifiedAttributes");
  }
}

// ---------------------------------------------------------------------------
// Bulk import helpers
// ---------------------------------------------------------------------------
export async function ensureProductsForSkus(skus: string[]): Promise<ActionResult<Record<string, string>>> {
  return runAction("ensureProductsForSkus", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const list = z.array(productInputSchema.shape.sku).min(1).max(500).parse(Array.from(new Set(skus)));
    const org = ctx.org.organizationId;
    const existing = check(
      await ctx.supabase.from("products").select("id, sku").eq("organization_id", org).in("sku", list),
      "Load products",
    ) as { id: string; sku: string }[];
    const map: Record<string, string> = Object.fromEntries(existing.map((p) => [p.sku, p.id]));
    const missing = list.filter((s) => !map[s]);
    if (missing.length) {
      const created = check(
        await ctx.supabase
          .from("products")
          .insert(missing.map((sku) => ({ organization_id: org, sku, title: sku, created_by: ctx.userId })))
          .select("id, sku"),
        "Create products",
      ) as { id: string; sku: string }[];
      for (const p of created) map[p.sku] = p.id;
      await audit({ organizationId: org, actorId: ctx.userId, action: "product.bulk_created", entityType: "product", metadata: { count: created.length } });
    }
    revalidatePath("/products");
    return map;
  });
}

const quickProductSchema = z.object({ title: z.string().trim().max(200).optional() });

/**
 * Creates a product on the fly when a garment photo is dropped into the
 * create composer. The SKU is generated and can be edited later.
 */
export async function quickCreateProduct(input: z.input<typeof quickProductSchema>): Promise<ActionResult<{ id: string; sku: string }>> {
  return runAction("quickCreateProduct", async () => {
    const ctx = await requireOrgContext("editor");
    await enforceRateLimit("mutate", ctx.userId);
    const { title } = quickProductSchema.parse(input);
    const { d } = await getI18n();
    const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
    const sku = `LOOK-${date}-${randomUUID().slice(0, 5).toUpperCase()}`;
    const row = check(
      await ctx.supabase
        .from("products")
        .insert({ sku, title: title || d.create.newGarment, organization_id: ctx.org.organizationId, created_by: ctx.userId })
        .select("id")
        .single(),
      "Create product",
    ) as { id: string };
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "product.created", entityType: "product", entityId: row.id, metadata: { sku, quick: true } });
    revalidatePath("/products");
    return { id: row.id, sku };
  });
}

/**
 * Removes a product created by the quick-add flow when none of its photos
 * could be uploaded. Only the creator can discard it, only while it is empty
 * and recent; everything else goes through the regular (admin) delete.
 */
export async function discardEmptyProduct(productId: string): Promise<ActionResult> {
  return runAction("discardEmptyProduct", async () => {
    const ctx = await requireOrgContext("editor");
    const id = z.uuid().parse(productId);
    const org = ctx.org.organizationId;
    const admin = getSupabaseAdmin();
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from("product_assets").select("id", { count: "exact", head: true }).eq("product_id", id).eq("organization_id", org);
    if ((count ?? 0) > 0) return undefined;
    check(
      await admin.from("products").delete().eq("id", id).eq("organization_id", org).eq("created_by", ctx.userId).gte("created_at", since),
      "Discard product",
    );
    return undefined;
  });
}
