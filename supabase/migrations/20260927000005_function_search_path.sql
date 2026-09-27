-- Pin search_path on trigger/helper functions (Supabase advisor 0011).
-- Their bodies only use pg_catalog built-ins, which stay resolvable.
alter function public.set_updated_at() set search_path = '';
alter function public.prevent_org_change() set search_path = '';
alter function public.try_uuid(text) set search_path = '';
alter function public.enforce_job_transition() set search_path = '';
