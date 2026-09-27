"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/utils";
import { ACTIVE_ORG_COOKIE, getSessionContext } from "../context";
import { enforceRateLimit } from "../rate-limit";
import { toActionError } from "../action";
import { audit } from "../audit";

export type FormState = { ok: boolean; error?: string; message?: string } | null;

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address").max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  // Only allow same-site relative paths.
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  let next = "/";
  try {
    const input = credentialsSchema.parse({ email: formData.get("email"), password: formData.get("password") });
    next = safeNext(formData.get("next"));
    await enforceRateLimit("auth", `${await clientIp()}:${input.email.toLowerCase()}`);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(input);
    if (error) return { ok: false, error: "Invalid email or password, or the email is not confirmed yet." };
  } catch (error) {
    return toActionError(error, "signIn");
  }
  redirect(next);
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const input = credentialsSchema.parse({ email: formData.get("email"), password: formData.get("password") });
    await enforceRateLimit("auth", `${await clientIp()}:signup`);
    const supabase = await createSupabaseServerClient();
    const h = await headers();
    const origin = h.get("origin") ?? process.env.APP_URL ?? "";
    const { data, error } = await supabase.auth.signUp({
      ...input,
      options: { emailRedirectTo: origin ? `${origin}/auth/callback?next=/onboarding` : undefined },
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) {
      return { ok: true, message: "Check your inbox to confirm your email address, then sign in." };
    }
  } catch (error) {
    return toActionError(error, "signUp");
  }
  redirect("/onboarding");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  (await cookies()).delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}

const orgSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
});

export async function createOrganization(_prev: FormState, formData: FormData): Promise<FormState> {
  let orgId: string;
  try {
    const ctx = await getSessionContext();
    if (!ctx) return { ok: false, error: "You must be signed in." };
    const { name } = orgSchema.parse({ name: formData.get("name") });
    await enforceRateLimit("mutate", ctx.userId);
    const base = slugify(name) || "org";
    const slug = `${base.slice(0, 50)}-${crypto.randomUUID().slice(0, 6)}`;
    const { data, error } = await ctx.supabase.rpc("create_organization", { p_name: name, p_slug: slug });
    if (error || !data) return { ok: false, error: "Could not create the organization." };
    orgId = data as string;
    await audit({ organizationId: orgId, actorId: ctx.userId, action: "organization.created", entityType: "organization", entityId: orgId });
  } catch (error) {
    return toActionError(error, "createOrganization");
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}

export async function switchOrganization(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  const id = String(formData.get("organizationId") ?? "");
  if (!ctx || !ctx.memberships.some((m) => m.organizationId === id)) redirect("/");
  (await cookies()).set(ACTIVE_ORG_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  redirect("/");
}
