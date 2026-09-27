"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ORG_ROLES } from "@/lib/domain/schemas";
import { geminiConfig, videoConfig } from "@/lib/env";
import { checkGeminiModel } from "@/lib/providers/gemini/client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";
import { requireOrgContext, roleAtLeast } from "../context";
import { UserFacingError, check, runAction, toActionError } from "../action";
import { enforceRateLimit } from "../rate-limit";
import { audit } from "../audit";

export type SettingsFormState = { ok: boolean; error?: string; message?: string } | null;

const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  monthlyBudgetUsd: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().min(0).max(10_000_000).nullable()),
  budgetAlertPercent: z.coerce.number().int().min(1).max(100),
  budgetHardLimit: z.boolean(),
});

export async function updateOrganizationSettings(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  try {
    const ctx = await requireOrgContext("admin");
    const input = orgSettingsSchema.parse({
      name: formData.get("name"),
      monthlyBudgetUsd: String(formData.get("monthlyBudgetUsd") ?? ""),
      budgetAlertPercent: formData.get("budgetAlertPercent"),
      budgetHardLimit: formData.get("budgetHardLimit") === "on",
    });
    check(
      await ctx.supabase
        .from("organizations")
        .update({
          name: input.name,
          monthly_budget_usd: input.monthlyBudgetUsd,
          budget_alert_percent: input.budgetAlertPercent,
          budget_hard_limit: input.budgetHardLimit,
        })
        .eq("id", ctx.org.organizationId),
      "Update organization",
    );
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "organization.settings_updated", entityType: "organization", entityId: ctx.org.organizationId, metadata: { budget: input.monthlyBudgetUsd, hardLimit: input.budgetHardLimit } });
    revalidatePath("/settings");
    revalidatePath("/costs");
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return toActionError(error, "updateOrganizationSettings");
  }
}

const memberSchema = z.object({ email: z.email().max(254), role: z.enum(ORG_ROLES) });

/**
 * Adds an existing Supabase user to the organization. Membership writes use
 * the service role after an explicit admin check (RLS allows no user writes).
 */
export async function addMember(_prev: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  try {
    const ctx = await requireOrgContext("admin");
    await enforceRateLimit("mutate", ctx.userId);
    const input = memberSchema.parse({ email: formData.get("email"), role: formData.get("role") });
    if (input.role === "owner" && ctx.org.role !== "owner") throw new UserFacingError("Only owners can add owners.");
    const admin = getSupabaseAdmin();
    const userId = await findUserIdByEmail(input.email);
    if (!userId) {
      throw new UserFacingError("No account exists for that email. Ask the person to sign up first, then add them.");
    }
    const { error } = await admin
      .from("organization_members")
      .insert({ organization_id: ctx.org.organizationId, user_id: userId, role: input.role });
    if (error?.code === "23505") throw new UserFacingError("That user is already a member.");
    if (error) throw new Error(error.message);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "member.added", entityType: "organization_member", metadata: { role: input.role } });
    revalidatePath("/settings");
    return { ok: true, message: `${input.email} added as ${input.role}.` };
  } catch (error) {
    return toActionError(error, "addMember");
  }
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const target = email.toLowerCase();
  // Paginate through auth users (admin API). Adequate for internal team sizes.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ownerCount(organizationId: string): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner");
  return count ?? 0;
}

export async function updateMemberRole(memberId: string, role: string): Promise<ActionResult> {
  return runAction("updateMemberRole", async () => {
    const ctx = await requireOrgContext("admin");
    const newRole = z.enum(ORG_ROLES).parse(role);
    const admin = getSupabaseAdmin();
    const { data: member } = await admin
      .from("organization_members")
      .select("id, role, user_id")
      .eq("id", z.uuid().parse(memberId))
      .eq("organization_id", ctx.org.organizationId)
      .maybeSingle();
    if (!member) throw new UserFacingError("Member not found.");
    const touchesOwner = member.role === "owner" || newRole === "owner";
    if (touchesOwner && ctx.org.role !== "owner") throw new UserFacingError("Only owners can change owner roles.");
    if (member.role === "owner" && newRole !== "owner" && (await ownerCount(ctx.org.organizationId)) <= 1) {
      throw new UserFacingError("An organization must keep at least one owner.");
    }
    const { error } = await admin.from("organization_members").update({ role: newRole }).eq("id", member.id);
    if (error) throw new Error(error.message);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "member.role_changed", entityType: "organization_member", entityId: member.id, metadata: { from: member.role, to: newRole } });
    revalidatePath("/settings");
    return undefined;
  });
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  return runAction("removeMember", async () => {
    const ctx = await requireOrgContext("admin");
    const admin = getSupabaseAdmin();
    const { data: member } = await admin
      .from("organization_members")
      .select("id, role, user_id")
      .eq("id", z.uuid().parse(memberId))
      .eq("organization_id", ctx.org.organizationId)
      .maybeSingle();
    if (!member) throw new UserFacingError("Member not found.");
    if (member.role === "owner" && !roleAtLeast(ctx.org.role, "owner")) throw new UserFacingError("Only owners can remove owners.");
    if (member.role === "owner" && (await ownerCount(ctx.org.organizationId)) <= 1) {
      throw new UserFacingError("An organization must keep at least one owner.");
    }
    const { error } = await admin.from("organization_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);
    await audit({ organizationId: ctx.org.organizationId, actorId: ctx.userId, action: "member.removed", entityType: "organization_member", entityId: member.id });
    revalidatePath("/settings");
    return undefined;
  });
}

export interface ProviderCheck {
  name: string;
  configured: boolean;
  ok: boolean;
  detail: string;
}

/** Live verification of configured provider models against the provider API. */
export async function checkProviders(): Promise<ActionResult<ProviderCheck[]>> {
  return runAction("checkProviders", async () => {
    const ctx = await requireOrgContext("admin");
    await enforceRateLimit("analyze", ctx.userId);
    const checks: ProviderCheck[] = [];
    let gemini;
    try {
      gemini = geminiConfig();
    } catch (error) {
      return [{ name: "Gemini", configured: false, ok: false, detail: error instanceof Error ? error.message : "Not configured" }];
    }
    const image = await checkGeminiModel(gemini.imageModel, "generateContent");
    checks.push({ name: `Image model (${gemini.imageModel})`, configured: true, ...image });
    const analysis = await checkGeminiModel(gemini.analysisModel, "generateContent");
    checks.push({ name: `Analysis model (${gemini.analysisModel})`, configured: true, ...analysis });
    const video = videoConfig();
    if (video.provider === "none" || !video.model) {
      checks.push({ name: "Video", configured: false, ok: false, detail: "VIDEO_PROVIDER is none or VIDEO_MODEL is unset — video studio disabled." });
    } else {
      const v = await checkGeminiModel(video.model, "predictLongRunning");
      checks.push({ name: `Video model (${video.model})`, configured: true, ...v });
    }
    return checks;
  });
}
