-- Reporting functions. SECURITY INVOKER: they run with the caller's
-- privileges, so RLS restricts them to organizations the user belongs to.

-- Cost/usage grouped by job type, provider, model, cost source and outcome.
create or replace function public.usage_breakdown(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (
  job_type public.job_type,
  provider text,
  model text,
  cost_source public.cost_source,
  succeeded boolean,
  calls bigint,
  cost numeric,
  input_tokens numeric,
  output_tokens numeric,
  images numeric,
  videos numeric,
  video_seconds numeric
)
language sql stable set search_path = '' as $$
  select
    u.job_type, u.provider, u.model, u.cost_source, u.succeeded,
    count(*),
    coalesce(sum(u.cost_amount), 0),
    coalesce(sum(u.input_tokens), 0),
    coalesce(sum(u.output_tokens), 0),
    coalesce(sum((u.units ->> 'images')::numeric), 0),
    coalesce(sum((u.units ->> 'videos')::numeric), 0),
    coalesce(sum((u.units ->> 'seconds')::numeric), 0)
  from public.usage_ledger u
  where u.organization_id = p_org and u.created_at >= p_from and u.created_at < p_to
  group by 1, 2, 3, 4, 5;
$$;

create or replace function public.usage_daily(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, cost numeric, calls bigint)
language sql stable set search_path = '' as $$
  select (u.created_at at time zone 'utc')::date, coalesce(sum(u.cost_amount), 0), count(*)
  from public.usage_ledger u
  where u.organization_id = p_org and u.created_at >= p_from and u.created_at < p_to
  group by 1 order by 1;
$$;

create or replace function public.usage_by_product(p_org uuid, p_from timestamptz, p_to timestamptz, p_limit integer default 20)
returns table (product_id uuid, sku text, title text, cost numeric, images numeric, videos numeric)
language sql stable set search_path = '' as $$
  select u.product_id, p.sku, p.title,
    coalesce(sum(u.cost_amount), 0),
    coalesce(sum((u.units ->> 'images')::numeric), 0),
    coalesce(sum((u.units ->> 'videos')::numeric), 0)
  from public.usage_ledger u
  join public.products p on p.id = u.product_id
  where u.organization_id = p_org and u.created_at >= p_from and u.created_at < p_to
  group by 1, 2, 3
  order by 4 desc
  limit greatest(1, least(p_limit, 100));
$$;

-- Bytes stored per category (originals, generated images, videos, model references).
create or replace function public.org_storage_usage(p_org uuid)
returns table (category text, files bigint, bytes numeric)
language sql stable set search_path = '' as $$
  select 'product_sources', count(*), coalesce(sum(size_bytes), 0) from public.product_assets where organization_id = p_org
  union all
  select 'model_references', count(*), coalesce(sum(size_bytes), 0) from public.model_profile_assets where organization_id = p_org
  union all
  select 'generated_images', count(*), coalesce(sum(size_bytes), 0) from public.generation_results where organization_id = p_org and kind = 'image'
  union all
  select 'generated_videos', count(*), coalesce(sum(size_bytes), 0) from public.generation_results where organization_id = p_org and kind = 'video';
$$;

-- Queue health for the operations view.
create or replace function public.queue_health(p_org uuid)
returns table (status public.job_status, jobs bigint, oldest timestamptz)
language sql stable set search_path = '' as $$
  select j.status, count(*), min(j.created_at)
  from public.generation_jobs j
  where j.organization_id = p_org and (j.status in ('queued', 'processing') or j.created_at > now() - interval '24 hours')
  group by 1;
$$;

revoke execute on all functions in schema public from anon, public;
grant execute on function public.usage_breakdown(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.usage_daily(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.usage_by_product(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.org_storage_usage(uuid) to authenticated;
grant execute on function public.queue_health(uuid) to authenticated;
-- Re-grant functions from earlier migrations (the revoke above is schema-wide).
grant execute on function public.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.cancel_job(uuid) to authenticated;
grant execute on function public.org_month_spend(uuid) to authenticated;
grant execute on function public.try_uuid(text) to authenticated;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.prevent_org_change() to authenticated;
grant execute on function public.enforce_job_transition() to authenticated;
grant execute on all functions in schema public to service_role;
