-- Row Level Security, least-privilege grants, and durable queue functions.

-- ---------------------------------------------------------------------------
-- Baseline privileges: anonymous users get nothing; authenticated users get
-- only what RLS policies and column grants below allow.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Functions callable by signed-in users (each checks membership itself).
grant execute on function public.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function public.create_organization(text, text) to authenticated;
-- Trigger helpers must be executable by whoever performs the DML.
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.prevent_org_change() to authenticated;
grant execute on function public.enforce_job_transition() to authenticated;
grant execute on function public.try_uuid(text) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.products enable row level security;
alter table public.product_assets enable row level security;
alter table public.model_profiles enable row level security;
alter table public.model_profile_assets enable row level security;
alter table public.shoot_presets enable row level security;
alter table public.video_projects enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_results enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
grant select on public.organizations to authenticated;
grant update (name, monthly_budget_usd, budget_alert_percent, budget_hard_limit) on public.organizations to authenticated;

create policy organizations_select on public.organizations for select to authenticated
  using (public.has_org_role(id, 'viewer'));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, 'admin')) with check (public.has_org_role(id, 'admin'));

-- ---------------------------------------------------------------------------
-- organization_members (mutations happen in trusted server code only)
-- ---------------------------------------------------------------------------
grant select on public.organization_members to authenticated;
create policy members_select on public.organization_members for select to authenticated
  using (public.has_org_role(organization_id, 'viewer'));

-- ---------------------------------------------------------------------------
-- Standard tenant tables: viewers read, editors write, admins delete.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_assets', 'model_profiles', 'model_profile_assets', 'video_projects'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
      using (public.has_org_role(organization_id, 'viewer'))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
      with check (public.has_org_role(organization_id, 'editor'))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
      using (public.has_org_role(organization_id, 'editor'))
      with check (public.has_org_role(organization_id, 'editor'))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
      using (public.has_org_role(organization_id, 'admin'))$p$, t);
  end loop;
end;
$$;

-- Editors may remove individual reference assets they manage.
create policy product_assets_delete_editor on public.product_assets for delete to authenticated
  using (public.has_org_role(organization_id, 'editor'));
create policy model_profile_assets_delete_editor on public.model_profile_assets for delete to authenticated
  using (public.has_org_role(organization_id, 'editor'));

-- Asset storage metadata is written once and never repointed by clients.
revoke update on public.product_assets from authenticated;
grant update (role) on public.product_assets to authenticated;
revoke update on public.model_profile_assets from authenticated;
grant update (is_primary) on public.model_profile_assets to authenticated;

-- ---------------------------------------------------------------------------
-- shoot_presets: system presets (organization_id null) are readable by all
-- signed-in users and immutable for them.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.shoot_presets to authenticated;
create policy shoot_presets_select on public.shoot_presets for select to authenticated
  using (organization_id is null or public.has_org_role(organization_id, 'viewer'));
create policy shoot_presets_insert on public.shoot_presets for insert to authenticated
  with check (organization_id is not null and public.has_org_role(organization_id, 'editor'));
create policy shoot_presets_update on public.shoot_presets for update to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, 'editor'))
  with check (organization_id is not null and public.has_org_role(organization_id, 'editor'));
create policy shoot_presets_delete on public.shoot_presets for delete to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, 'editor'));

-- ---------------------------------------------------------------------------
-- generation_jobs: users can read and enqueue; only the worker (service
-- role) changes job state. Cancellation goes through cancel_job().
-- ---------------------------------------------------------------------------
grant select, insert on public.generation_jobs to authenticated;
create policy generation_jobs_select on public.generation_jobs for select to authenticated
  using (public.has_org_role(organization_id, 'viewer'));
create policy generation_jobs_insert on public.generation_jobs for insert to authenticated
  with check (
    public.has_org_role(organization_id, 'editor')
    and created_by = (select auth.uid())
    and status = 'queued'
    and attempts = 0
    and provider_request_id is null
    and provider_operation is null
    and locked_by is null
  );

-- ---------------------------------------------------------------------------
-- generation_results: read by members; only review columns are writable.
-- ---------------------------------------------------------------------------
grant select, delete on public.generation_results to authenticated;
grant update (review_status, review_notes, reviewed_by, reviewed_at) on public.generation_results to authenticated;
create policy generation_results_select on public.generation_results for select to authenticated
  using (public.has_org_role(organization_id, 'viewer'));
create policy generation_results_update on public.generation_results for update to authenticated
  using (public.has_org_role(organization_id, 'editor'))
  with check (public.has_org_role(organization_id, 'editor'));
create policy generation_results_delete on public.generation_results for delete to authenticated
  using (public.has_org_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- usage_ledger and audit_logs: read-only for users, written by the server.
-- ---------------------------------------------------------------------------
grant select on public.usage_ledger to authenticated;
create policy usage_ledger_select on public.usage_ledger for select to authenticated
  using (public.has_org_role(organization_id, 'viewer'));

grant select on public.audit_logs to authenticated;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_org_role(organization_id, 'admin'));

-- rate_limits: no policies -> no access for authenticated users.

-- ---------------------------------------------------------------------------
-- Job cancellation (user-facing)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_job(p_job_id uuid)
returns public.job_status
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.generation_jobs;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found or not public.has_org_role(v_job.organization_id, 'editor') then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if v_job.status = 'queued' then
    update public.generation_jobs
      set status = 'cancelled', cancel_requested = true, error_code = 'cancelled', error_message = 'Cancelled by user'
      where id = p_job_id;
    return 'cancelled';
  elsif v_job.status = 'processing' then
    -- The worker checks this flag before persisting results and between
    -- polling rounds. Provider-side work may still be billed.
    update public.generation_jobs set cancel_requested = true where id = p_job_id;
    return 'processing';
  end if;
  return v_job.status;
end;
$$;
grant execute on function public.cancel_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Worker functions (service role only)
-- ---------------------------------------------------------------------------

-- Claims up to p_limit runnable jobs using SKIP LOCKED so concurrent workers
-- never receive the same job. Also reclaims jobs whose lease expired
-- (crashed worker, or a video job due for its next status poll).
create or replace function public.claim_jobs(
  p_worker text,
  p_limit integer,
  p_lease_seconds integer,
  p_max_active integer
)
returns setof public.generation_jobs
language plpgsql security definer set search_path = '' as $$
declare
  v_active integer;
  v_take integer;
begin
  -- Jobs whose worker died mid-request and exhausted their attempts fail.
  update public.generation_jobs
    set status = 'failed',
        error_code = 'lease_expired',
        error_message = 'Worker lease expired after the maximum number of attempts'
    where status = 'processing'
      and locked_until < now()
      and provider_operation is null
      and attempts >= max_attempts;

  select count(*) into v_active from public.generation_jobs
    where status = 'processing' and locked_until >= now() and provider_operation is null;

  v_take := least(p_limit, greatest(p_max_active - v_active, 0));
  if v_take <= 0 then
    return;
  end if;

  return query
  with candidates as (
    select j.id from public.generation_jobs j
    where (j.status = 'queued' and j.run_after <= now())
       or (j.status = 'processing' and j.locked_until < now())
    order by j.run_after, j.created_at
    for update skip locked
    limit v_take
  )
  update public.generation_jobs j
    set status = 'processing',
        locked_by = p_worker,
        locked_until = now() + make_interval(secs => p_lease_seconds),
        -- Polling an already-submitted long-running operation is not a new attempt.
        attempts = j.attempts + case when j.provider_operation is null then 1 else 0 end,
        started_at = coalesce(j.started_at, now())
    from candidates c
    where j.id = c.id
    returning j.*;
end;
$$;

-- Month-to-date spend used for budget enforcement. SECURITY INVOKER: users
-- only see their own organizations' ledger rows through RLS.
create or replace function public.org_month_spend(p_org uuid)
returns numeric
language sql stable set search_path = '' as $$
  select coalesce(sum(cost_amount), 0) from public.usage_ledger
  where organization_id = p_org and created_at >= date_trunc('month', now());
$$;
grant execute on function public.org_month_spend(uuid) to authenticated;

revoke execute on function public.claim_jobs(text, integer, integer, integer) from authenticated, public;
revoke execute on function public.rate_limit_hit(text, integer, integer) from authenticated, public;
grant execute on function public.claim_jobs(text, integer, integer, integer) to service_role;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;
