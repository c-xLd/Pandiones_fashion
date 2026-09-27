import type { ProductAnalysis, QualityReview } from "./domain/analysis";
import type { AssetRole, JobStatus, JobType, OrgRole, ProductStatus, ReviewStatus } from "./domain/schemas";

/** Row shapes of the public schema (see supabase/migrations). */

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  monthly_budget_usd: number | string | null;
  budget_alert_percent: number;
  budget_hard_limit: boolean;
  created_at: string;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface ProductRow {
  id: string;
  organization_id: string;
  sku: string;
  title: string;
  category: string | null;
  color: string | null;
  size: string | null;
  description: string | null;
  tags: string[];
  status: ProductStatus;
  ai_analysis: ProductAnalysis | null;
  analysis_status: "none" | "queued" | "completed" | "failed";
  analysis_model: string | null;
  analyzed_at: string | null;
  verified_attributes: Record<string, unknown> | null;
  analysis_reviewed_by: string | null;
  analysis_reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductAssetRow {
  id: string;
  organization_id: string;
  product_id: string;
  role: AssetRole;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  original_filename: string | null;
  created_at: string;
}

export interface ModelProfileRow {
  id: string;
  organization_id: string;
  code: string;
  display_name: string;
  description: string | null;
  appearance: Record<string, string | null>;
  styling_notes: string | null;
  preferred_lighting: string | null;
  photography_style: string | null;
  status: "draft" | "active" | "retired";
  adult_confirmed: boolean;
  consent_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ModelAssetRow {
  id: string;
  organization_id: string;
  model_profile_id: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string;
  source: "upload" | "generated";
  source_result_id: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface ShootPresetRow {
  id: string;
  organization_id: string | null;
  name: string;
  category: "ecommerce" | "editorial" | "detail" | "campaign";
  description: string | null;
  config: Record<string, unknown>;
  created_at: string;
}

export interface JobRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  job_type: JobType;
  product_id: string | null;
  model_profile_id: string | null;
  video_project_id: string | null;
  batch_id: string | null;
  parent_job_id: string | null;
  source_result_id: string | null;
  provider: string;
  model: string;
  input_asset_refs: { kind: string; id: string }[];
  config: Record<string, unknown>;
  status: JobStatus;
  progress: number;
  attempts: number;
  max_attempts: number;
  provider_request_id: string | null;
  provider_operation: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details: Record<string, unknown> | null;
  idempotency_key: string;
  cancel_requested: boolean;
  run_after: string;
  locked_by: string | null;
  locked_until: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResultRow {
  id: string;
  organization_id: string;
  job_id: string;
  product_id: string | null;
  model_profile_id: string | null;
  video_project_id: string | null;
  parent_result_id: string | null;
  kind: "image" | "video";
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  shot_type: string | null;
  prompt: string | null;
  settings: Record<string, unknown>;
  provider: string;
  model: string;
  provider_text: string | null;
  review_status: ReviewStatus;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  qc_status: "not_run" | "queued" | "passed" | "flagged" | "error";
  qc_flags: QualityReview["flags"] | null;
  qc_summary: string | null;
  qc_model: string | null;
  created_at: string;
}

export interface VideoProjectRow {
  id: string;
  organization_id: string;
  name: string;
  kind: "product" | "advertising";
  product_id: string | null;
  source_result_ids: string[];
  brief: string | null;
  prompt: string | null;
  motion_instructions: string | null;
  duration_seconds: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  status: "draft" | "queued" | "processing" | "ready" | "failed" | "cancelled";
  provider: string | null;
  model: string | null;
  approval_status: ReviewStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageRow {
  id: string;
  organization_id: string;
  job_id: string | null;
  product_id: string | null;
  job_type: JobType;
  provider: string;
  model: string;
  request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  units: Record<string, unknown>;
  cost_amount: number | string | null;
  cost_currency: string;
  cost_source: "provider_reported" | "estimated" | "unknown";
  pricing_ref: string | null;
  succeeded: boolean;
  created_at: string;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
