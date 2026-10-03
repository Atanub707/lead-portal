-- Reconcile claims need a claim timestamp: enrichment_runs only had created_at.
-- updated_at is refreshed by the existing touch_updated_at() trigger function on
-- every update (claim, release, finalize), so reconcile staleness can be measured.

alter table public.enrichment_runs
  add column updated_at timestamptz not null default now();

create trigger enrichment_runs_touch
  before update on public.enrichment_runs
  for each row execute function public.touch_updated_at();
