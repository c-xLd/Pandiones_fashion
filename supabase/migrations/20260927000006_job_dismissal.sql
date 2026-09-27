-- Failed/cancelled jobs can be dismissed from the create canvas. The row is
-- kept (history, usage and audit stay intact); only the canvas hides it.
-- Written by trusted server code (service role) after an editor check.
alter table public.generation_jobs add column dismissed_at timestamptz;

create index generation_jobs_failed_visible_idx
  on public.generation_jobs (organization_id, completed_at desc)
  where status = 'failed' and dismissed_at is null;
