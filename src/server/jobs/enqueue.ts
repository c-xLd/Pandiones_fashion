import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRow } from "@/lib/types";
import { UserFacingError, check } from "../action";
import type { OrgContext } from "../context";
import { kickWorker } from "./kick";
import { toJobInsert, type EnqueueInput } from "./insert";

export type { EnqueueInput };

/** Refuse new paid work when a hard monthly budget is exhausted. */
export async function assertWithinBudget(client: SupabaseClient, organizationId: string): Promise<void> {
  const org = check(
    await client
      .from("organizations")
      .select("monthly_budget_usd, budget_hard_limit")
      .eq("id", organizationId)
      .single(),
    "Load budget",
  ) as { monthly_budget_usd: string | number | null; budget_hard_limit: boolean };
  if (!org.budget_hard_limit || org.monthly_budget_usd == null) return;
  const spend = Number(check(await client.rpc("org_month_spend", { p_org: organizationId }), "Load spend") ?? 0);
  if (spend >= Number(org.monthly_budget_usd)) {
    throw new UserFacingError(
      `Monthly budget of $${Number(org.monthly_budget_usd).toFixed(2)} is exhausted (estimated spend $${spend.toFixed(2)}). An admin can raise it in Settings.`,
    );
  }
}

/**
 * Insert jobs idempotently: re-submitting the same idempotency key returns the
 * existing job instead of creating a duplicate. Uses the user's client so the
 * RLS insert policy (editor role, queued state) applies.
 */
export async function enqueueJobs(
  ctx: OrgContext,
  inputs: EnqueueInput[],
): Promise<{ jobs: JobRow[]; created: number }> {
  if (!inputs.length) return { jobs: [], created: 0 };
  await assertWithinBudget(ctx.supabase, ctx.org.organizationId);
  const rows = inputs.map((i) => toJobInsert(ctx.org.organizationId, ctx.userId, i));

  const inserted = check(
    await ctx.supabase
      .from("generation_jobs")
      .upsert(rows, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true })
      .select("id"),
    "Enqueue jobs",
  ) as { id: string }[];

  const jobs = check(
    await ctx.supabase
      .from("generation_jobs")
      .select("*")
      .eq("organization_id", ctx.org.organizationId)
      .in(
        "idempotency_key",
        rows.map((r) => r.idempotency_key),
      ),
    "Load jobs",
  ) as JobRow[];

  if (inserted.length > 0) {
    // Best-effort acceleration; the scheduled worker is the durable path.
    after(() => kickWorker());
  }
  return { jobs, created: inserted.length };
}
