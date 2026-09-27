import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/domain/schemas";
import { ORG_ROLES } from "@/lib/domain/schemas";
import { AuthorizationError } from "./errors";

export const ACTIVE_ORG_COOKIE = "pfs_org";

export { AuthorizationError };

export interface Membership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
  email: string | null;
  memberships: Membership[];
  org: Membership | null;
}

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ORG_ROLES.indexOf(role) >= ORG_ROLES.indexOf(min);
}

/** Resolve the verified user and the active organization (once per request). */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;

  const { data: rows, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", claims.sub)
    .order("created_at", { ascending: true });
  if (membershipError) throw new Error(`Could not load memberships: ${membershipError.message}`);

  const memberships: Membership[] = (rows ?? []).map((r) => {
    const orgs = r.organizations as { name: string } | { name: string }[] | null;
    const name = Array.isArray(orgs) ? orgs[0]?.name : orgs?.name;
    return { organizationId: r.organization_id as string, organizationName: name ?? "Organization", role: r.role as OrgRole };
  });

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const org = memberships.find((m) => m.organizationId === preferred) ?? memberships[0] ?? null;

  return {
    supabase,
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    memberships,
    org,
  };
});

export interface OrgContext extends SessionContext {
  org: Membership;
}

/** For pages: redirects to login/onboarding when needed. */
export async function requirePageContext(minRole: OrgRole = "viewer"): Promise<OrgContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.org) redirect("/onboarding");
  if (!roleAtLeast(ctx.org.role, minRole)) redirect("/?error=forbidden");
  return ctx as OrgContext;
}

/** For server actions and route handlers: throws instead of redirecting. */
export async function requireOrgContext(minRole: OrgRole = "viewer"): Promise<OrgContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new AuthorizationError("notSignedIn");
  if (!ctx.org) throw new AuthorizationError("noOrganization");
  if (!roleAtLeast(ctx.org.role, minRole)) {
    throw new AuthorizationError("roleRequired", { role: minRole });
  }
  return ctx as OrgContext;
}
