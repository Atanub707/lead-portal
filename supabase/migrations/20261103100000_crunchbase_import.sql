-- Crunchbase lead importer: per-workspace cookie vault + import run ledger.

create table if not exists public.lead_source_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  crunchbase_cookies_enc text,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.lead_source_settings enable row level security;
grant all privileges on public.lead_source_settings to service_role;

create table if not exists public.lead_imports (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by text,
  pipeline_id text not null,
  source text not null default 'crunchbase',
  search_url text not null,
  requested_count integer not null default 25,
  actor_run_id text,
  dataset_id text,
  status text not null default 'running',
  imported integer not null default 0,
  skipped integer not null default 0,
  cost_usd numeric not null default 0,
  error text,
  details jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.lead_imports enable row level security;
grant all privileges on public.lead_imports to service_role;
