-- Pandiones AI Fashion Studio — core schema
-- Every tenant-owned table carries organization_id and is protected by RLS.

create extension if not exists pgcrypto;
-- Extensions live in the "extensions" schema (Supabase convention), not public.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Declared in ascending privilege order so `role >= 'editor'` comparisons work.
create type public.org_role as enum ('viewer', 'editor', 'admin', 'owner');
create type public.product_status as enum ('draft', 'ready', 'processing', 'completed', 'archived');
create type public.asset_role as enum ('front', 'back', 'side', 'detail', 'fabric', 'other');
create type public.job_type as enum ('product_analysis', 'image_generation', 'quality_review', 'video_generation', 'model_portrait');
create type public.job_status as enum ('queued', 'processing', 'succeeded', 'failed', 'cancelled');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.media_kind as enum ('image', 'video');
create type public.qc_status as enum ('not_run', 'queued', 'passed', 'flagged', 'error');
create type public.cost_source as enum ('provider_reported', 'estimated', 'unknown');

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tenant-owned rows can never be moved to another organization.
create or replace function public.prevent_org_change() returns trigger
language plpgsql as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.try_uuid(value text) returns uuid
language plpgsql immutable as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  monthly_budget_usd numeric(12, 2) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  budget_alert_percent integer not null default 80 check (budget_alert_percent between 1 and 100),
  budget_hard_limit boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

-- Membership check used by every RLS policy. SECURITY DEFINER avoids
-- recursive RLS evaluation on organization_members.
create or replace function public.has_org_role(org uuid, min_role public.org_role)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role >= min_role
  );
$$;

-- Creates an organization and makes the caller its owner.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, created_by)
    values (p_name, p_slug, v_uid) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role)
    values (v_org, v_uid, 'owner');
  return v_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 64),
  title text not null check (char_length(title) between 1 and 200),
  category text,
  color text,
  size text,
  description text,
  tags text[] not null default '{}',
  status public.product_status not null default 'draft',
  -- Raw AI analysis (screening only, never treated as verified fact).
  ai_analysis jsonb,
  analysis_status text not null default 'none' check (analysis_status in ('none', 'queued', 'completed', 'failed')),
  analysis_model text,
  analyzed_at timestamptz,
  -- Attributes confirmed or corrected by a human reviewer.
  verified_attributes jsonb,
  analysis_reviewed_by uuid references auth.users (id) on delete set null,
  analysis_reviewed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create index products_org_status_idx on public.products (organization_id, status, updated_at desc);
-- Substring search on SKU / title (ILIKE '%q%') uses trigram indexes.
create index products_sku_trgm_idx on public.products using gin (sku extensions.gin_trgm_ops);
create index products_title_trgm_idx on public.products using gin (title extensions.gin_trgm_ops);
create index products_category_idx on public.products (organization_id, category);
create index products_tags_idx on public.products using gin (tags);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger products_org_immutable before update on public.products
  for each row execute function public.prevent_org_change();

create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  role public.asset_role not null default 'other',
  storage_path text not null unique,
  thumbnail_path text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer,
  height integer,
  sha256 text not null,
  original_filename text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Storage paths are always namespaced by organization.
  check (storage_path like organization_id::text || '/%')
);
create index product_assets_product_idx on public.product_assets (product_id, role);
create index product_assets_sha_idx on public.product_assets (organization_id, sha256);
create trigger product_assets_org_immutable before update on public.product_assets
  for each row execute function public.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Model profiles (adult fashion models only)
-- ---------------------------------------------------------------------------
create table public.model_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (code ~ '^[A-Za-z0-9_-]{2,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  description text,
  appearance jsonb not null default '{}',
  styling_notes text,
  preferred_lighting text,
  photography_style text,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  -- Every profile must depict an adult. Enforced at the database level.
  adult_confirmed boolean not null check (adult_confirmed),
  consent_notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index model_profiles_org_idx on public.model_profiles (organization_id, status);
create trigger model_profiles_updated_at before update on public.model_profiles
  for each row execute function public.set_updated_at();
create trigger model_profiles_org_immutable before update on public.model_profiles
  for each row execute function public.prevent_org_change();

create table public.model_profile_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  model_profile_id uuid not null references public.model_profiles (id) on delete cascade,
  storage_path text not null unique,
  thumbnail_path text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer,
  height integer,
  sha256 text not null,
  source text not null default 'upload' check (source in ('upload', 'generated')),
  source_result_id uuid,
  is_primary boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (storage_path like organization_id::text || '/%')
);
create index model_profile_assets_profile_idx on public.model_profile_assets (model_profile_id);
create trigger model_profile_assets_org_immutable before update on public.model_profile_assets
  for each row execute function public.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Shoot presets (organization_id null = built-in system preset)
-- ---------------------------------------------------------------------------
create table public.shoot_presets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('ecommerce', 'editorial', 'detail', 'campaign')),
  description text,
  config jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shoot_presets_org_idx on public.shoot_presets (organization_id);
create trigger shoot_presets_updated_at before update on public.shoot_presets
  for each row execute function public.set_updated_at();
create trigger shoot_presets_org_immutable before update on public.shoot_presets
  for each row execute function public.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Video projects
-- ---------------------------------------------------------------------------
create table public.video_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  kind text not null check (kind in ('product', 'advertising')),
  product_id uuid references public.products (id) on delete set null,
  source_result_ids uuid[] not null default '{}',
  brief text,
  prompt text,
  motion_instructions text,
  duration_seconds integer,
  aspect_ratio text,
  resolution text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'processing', 'ready', 'failed', 'cancelled')),
  provider text,
  model text,
  approval_status public.review_status not null default 'pending',
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_projects_org_idx on public.video_projects (organization_id, updated_at desc);
create trigger video_projects_updated_at before update on public.video_projects
  for each row execute function public.set_updated_at();
create trigger video_projects_org_immutable before update on public.video_projects
  for each row execute function public.prevent_org_change();

-- ---------------------------------------------------------------------------
-- Generation jobs (durable queue)
-- ---------------------------------------------------------------------------
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  job_type public.job_type not null,
  product_id uuid references public.products (id) on delete set null,
  model_profile_id uuid references public.model_profiles (id) on delete set null,
  video_project_id uuid references public.video_projects (id) on delete set null,
  batch_id uuid,
  parent_job_id uuid references public.generation_jobs (id) on delete set null,
  source_result_id uuid,
  provider text not null,
  model text not null,
  input_asset_refs jsonb not null default '[]',
  config jsonb not null default '{}',
  status public.job_status not null default 'queued',
  progress integer not null default 0 check (progress between 0 and 100),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  provider_request_id text,
  provider_operation text,
  error_code text,
  error_message text,
  error_details jsonb,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  cancel_requested boolean not null default false,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index generation_jobs_queue_idx on public.generation_jobs (run_after, created_at) where status = 'queued';
create index generation_jobs_processing_idx on public.generation_jobs (locked_until) where status = 'processing';
create index generation_jobs_org_idx on public.generation_jobs (organization_id, created_at desc);
create index generation_jobs_product_idx on public.generation_jobs (product_id, created_at desc);
create index generation_jobs_batch_idx on public.generation_jobs (batch_id);
create trigger generation_jobs_updated_at before update on public.generation_jobs
  for each row execute function public.set_updated_at();
create trigger generation_jobs_org_immutable before update on public.generation_jobs
  for each row execute function public.prevent_org_change();

-- Explicit state machine: queued -> processing -> succeeded|failed|cancelled,
-- processing -> queued (transient retry), queued -> cancelled|failed.
create or replace function public.enforce_job_transition() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then
    if old.status in ('succeeded', 'failed', 'cancelled') and (
      new.provider_operation is distinct from old.provider_operation or
      new.config is distinct from old.config
    ) then
      raise exception 'terminal job % is immutable', old.id using errcode = '23514';
    end if;
    return new;
  end if;
  if (old.status::text, new.status::text) not in (
    ('queued', 'processing'),
    ('queued', 'cancelled'),
    ('queued', 'failed'),
    ('processing', 'succeeded'),
    ('processing', 'failed'),
    ('processing', 'cancelled'),
    ('processing', 'queued')
  ) then
    raise exception 'invalid job transition % -> %', old.status, new.status using errcode = '23514';
  end if;
  if new.status in ('succeeded', 'failed', 'cancelled') then
    new.completed_at = coalesce(new.completed_at, now());
    new.locked_by = null;
    new.locked_until = null;
    if new.status = 'succeeded' then
      new.progress = 100;
    end if;
  end if;
  return new;
end;
$$;
create trigger generation_jobs_transition before update of status on public.generation_jobs
  for each row execute function public.enforce_job_transition();

-- ---------------------------------------------------------------------------
-- Generation results (images and videos)
-- ---------------------------------------------------------------------------
create table public.generation_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  model_profile_id uuid references public.model_profiles (id) on delete set null,
  video_project_id uuid references public.video_projects (id) on delete set null,
  parent_result_id uuid references public.generation_results (id) on delete set null,
  kind public.media_kind not null,
  storage_path text not null unique,
  thumbnail_path text,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  width integer,
  height integer,
  duration_seconds numeric(8, 2),
  shot_type text,
  prompt text,
  settings jsonb not null default '{}',
  provider text not null,
  model text not null,
  provider_text text,
  review_status public.review_status not null default 'pending',
  review_notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  qc_status public.qc_status not null default 'not_run',
  qc_flags jsonb,
  qc_summary text,
  qc_model text,
  created_at timestamptz not null default now(),
  check (storage_path like organization_id::text || '/%')
);
create index generation_results_org_idx on public.generation_results (organization_id, created_at desc);
create index generation_results_product_idx on public.generation_results (product_id, created_at desc);
create index generation_results_model_idx on public.generation_results (model_profile_id, created_at desc);
create index generation_results_review_idx on public.generation_results (organization_id, review_status, created_at desc);
create index generation_results_job_idx on public.generation_results (job_id);
create trigger generation_results_org_immutable before update on public.generation_results
  for each row execute function public.prevent_org_change();

alter table public.model_profile_assets
  add constraint model_profile_assets_source_result_fk
  foreign key (source_result_id) references public.generation_results (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Usage ledger (costs)
-- ---------------------------------------------------------------------------
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid references public.generation_jobs (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  job_type public.job_type not null,
  provider text not null,
  model text not null,
  request_id text,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  units jsonb not null default '{}',
  cost_amount numeric(14, 6),
  cost_currency text not null default 'USD',
  cost_source public.cost_source not null,
  pricing_ref text,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index usage_ledger_org_idx on public.usage_ledger (organization_id, created_at desc);
create index usage_ledger_product_idx on public.usage_ledger (product_id);
create index usage_ledger_job_idx on public.usage_ledger (job_id);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed window, server-side only)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_hits integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
    values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
