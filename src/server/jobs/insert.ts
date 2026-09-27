import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobType } from "@/lib/domain/schemas";
import type { JobRow } from "@/lib/types";

export interface EnqueueInput {
  jobType: JobType;
  provider: string;
  model: string;
  idempotencyKey: string;
  productId?: string | null;
  modelProfileId?: string | null;
  videoProjectId?: string | null;
  batchId?: string | null;
  parentJobId?: string | null;
  sourceResultId?: string | null;
  inputAssetRefs?: { kind: string; id: string }[];
  config?: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}

export function toJobInsert(organizationId: string, createdBy: string | null, input: EnqueueInput) {
  return {
    organization_id: organizationId,
    created_by: createdBy,
    job_type: input.jobType,
    provider: input.provider,
    model: input.model,
    idempotency_key: input.idempotencyKey,
    product_id: input.productId ?? null,
    model_profile_id: input.modelProfileId ?? null,
    video_project_id: input.videoProjectId ?? null,
    batch_id: input.batchId ?? null,
    parent_job_id: input.parentJobId ?? null,
    source_result_id: input.sourceResultId ?? null,
    input_asset_refs: input.inputAssetRefs ?? [],
    config: input.config ?? {},
    max_attempts: input.maxAttempts ?? 3,
    run_after: (input.runAfter ?? new Date()).toISOString(),
    status: "queued" as const,
    attempts: 0,
  };
}

/** System-initiated follow-up jobs (e.g. quality review) from the worker. */
export async function enqueueSystemJob(
  admin: SupabaseClient,
  organizationId: string,
  createdBy: string | null,
  input: EnqueueInput,
): Promise<JobRow | null> {
  const row = toJobInsert(organizationId, createdBy, input);
  const { error } = await admin
    .from("generation_jobs")
    .upsert(row, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(`Enqueue follow-up job failed: ${error.message}`);
  const { data } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}
