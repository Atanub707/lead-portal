-- Autopilot Assist: settings, runs and a human-reviewed outbox.
-- No email is sent from these tables directly; approval uses the existing
-- send-coin + scheduled-queue pipeline and its preflight gate.

create table if not exists public.autopilot_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  enabled boolean not null default false,
  pipeline_id text,
  min_score integer not null default 0 check (min_score between 0 and 100),
  daily_draft_limit integer not null default 5 check (daily_draft_limit between 1 and 20),
  run_interval_minutes integer not null default 60 check (run_interval_minutes between 15 and 1440),
  review_required boolean not null default true,
  last_run_at timestamptz,
  created_by text references public.profiles (id) on delete set null,
  updated_by text references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.autopilot_runs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'skipped')),
  trigger text not null default 'manual' check (trigger in ('manual', 'schedule')),
  reason text,
  selected integer not null default 0,
  drafted integer not null default 0,
  skipped integer not null default 0,
  error text,
  details jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists autopilot_runs_ws_idx
  on public.autopilot_runs (workspace_id, started_at desc);

create table if not exists public.autopilot_outbox (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  run_id bigint references public.autopilot_runs (id) on delete set null,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  quality jsonb,
  recipient jsonb,
  gate jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'held', 'failed')),
  queue_id bigint references public.email_send_queue (id) on delete set null,
  coin_id uuid references public.email_send_coins (id) on delete set null,
  created_by text references public.profiles (id) on delete set null,
  approved_by text references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists autopilot_outbox_ws_idx
  on public.autopilot_outbox (workspace_id, status, created_at desc);
create index if not exists autopilot_outbox_run_idx
  on public.autopilot_outbox (run_id);
create unique index if not exists autopilot_outbox_one_pending
  on public.autopilot_outbox (workspace_id, org_id)
  where status = 'pending';

alter table public.autopilot_settings enable row level security;
alter table public.autopilot_runs enable row level security;
alter table public.autopilot_outbox enable row level security;

grant select on public.autopilot_settings to authenticated;
grant select on public.autopilot_runs to authenticated;
grant select on public.autopilot_outbox to authenticated;
grant all privileges on public.autopilot_settings to service_role;
grant all privileges on public.autopilot_runs to service_role;
grant all privileges on public.autopilot_outbox to service_role;

drop policy if exists "autopilot_settings_select" on public.autopilot_settings;
create policy "autopilot_settings_select" on public.autopilot_settings
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "autopilot_runs_select" on public.autopilot_runs;
create policy "autopilot_runs_select" on public.autopilot_runs
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "autopilot_outbox_select" on public.autopilot_outbox;
create policy "autopilot_outbox_select" on public.autopilot_outbox
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
