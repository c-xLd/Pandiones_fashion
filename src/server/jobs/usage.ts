import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CostEstimate, TokenUsage } from "@/lib/domain/costs";
import { estimateTokenCost } from "@/lib/domain/costs";
import type { JobRow } from "@/lib/types";

export interface UsageEntry {
  job: Pick<JobRow, "id" | "organization_id" | "product_id" | "job_type">;
  provider: string;
  model: string;
  requestId: string | null;
  usage: TokenUsage | null;
  units: Record<string, number>;
  cost: CostEstimate;
  succeeded: boolean;
}

export async function recordUsage(admin: SupabaseClient, entry: UsageEntry): Promise<void> {
  const { error } = await admin.from("usage_ledger").insert({
    organization_id: entry.job.organization_id,
    job_id: entry.job.id,
    product_id: entry.job.product_id,
    job_type: entry.job.job_type,
    provider: entry.provider,
    model: entry.model,
    request_id: entry.requestId,
    input_tokens: entry.usage?.inputTokens ?? null,
    output_tokens: entry.usage?.outputTokens ?? null,
    total_tokens: entry.usage?.totalTokens ?? null,
    units: entry.units,
    cost_amount: entry.cost.amount,
    cost_currency: entry.cost.currency,
    cost_source: entry.cost.source,
    pricing_ref: entry.cost.pricingRef,
    succeeded: entry.succeeded,
  });
  if (error) console.error("[usage] failed to record usage", { jobId: entry.job.id, error: error.message });
}

/** Token-billed call: price by the resolved model version when the provider reports one. */
export function tokenCost(model: string, resolvedModel: string | null, usage: TokenUsage): CostEstimate {
  const byResolved = resolvedModel ? estimateTokenCost(resolvedModel, usage) : null;
  if (byResolved && byResolved.source !== "unknown") return byResolved;
  return estimateTokenCost(model, usage);
}
