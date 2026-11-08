-- Phase 3: human-approved send coins and an anti-spam scheduled send queue.
-- One coin = one explicitly approved email. Coins are allocated by a daily
-- warm-up allowance; no client can write them directly.

create table if not exists public.email_send_policies (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  timezone text not null default 'UTC',
  window_start text not null default '09:30' check (window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  window_end text not null default '17:30' check (window_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  weekdays smallint[] not null default '{1,2,3,4,5}'::smallint[],
  daily_cap integer not null default 30 check (daily_cap between 1 and 30),
  domain_daily_cap integer not null default 1 check (domain_daily_cap between 1 and 3),
  min_gap_minutes integer not null default 4 check (min_gap_minutes between 1 and 60),
  max_gap_minutes integer not null default 10 check (max_gap_minutes between 1 and 120),
  configured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_send_policies_window check (window_start < window_end),
  constraint email_send_policies_gap check (min_gap_minutes <= max_gap_minutes),
  constraint email_send_policies_weekdays check (weekdays <@ '{0,1,2,3,4,5,6}'::smallint[])
);

create table if not exists public.email_send_coins (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  content_hash text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled', 'expired')),
  for_date date not null,
  expires_at timestamptz not null,
  agent_run_id bigint,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists email_send_coins_ws_idx
  on public.email_send_coins (workspace_id, user_id, created_at desc);
create index if not exists email_send_coins_recipient_idx
  on public.email_send_coins (workspace_id, to_email, created_at desc);

create table if not exists public.email_send_queue (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  coin_id uuid not null unique references public.email_send_coins (id) on delete cascade,
  user_id text not null references public.profiles (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  content_hash text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sending', 'sent', 'failed', 'cancelled', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  sent_email_id bigint references public.sent_emails (id) on delete set null,
  agent_run_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists email_send_queue_due_idx
  on public.email_send_queue (status, scheduled_for) where status = 'scheduled';
create index if not exists email_send_queue_ws_idx
  on public.email_send_queue (workspace_id, user_id, scheduled_for desc);
create index if not exists email_send_queue_org_idx
  on public.email_send_queue (workspace_id, org_id, scheduled_for desc);

alter table public.email_send_policies enable row level security;
alter table public.email_send_coins enable row level security;
alter table public.email_send_queue enable row level security;

grant select on public.email_send_policies to authenticated;
grant select on public.email_send_coins to authenticated;
grant select on public.email_send_queue to authenticated;
grant all privileges on public.email_send_policies to service_role;
grant all privileges on public.email_send_coins to service_role;
grant all privileges on public.email_send_queue to service_role;

drop policy if exists "email_send_policies_select" on public.email_send_policies;
create policy "email_send_policies_select" on public.email_send_policies
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "email_send_coins_select" on public.email_send_coins;
create policy "email_send_coins_select" on public.email_send_coins
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "email_send_queue_select" on public.email_send_queue;
create policy "email_send_queue_select" on public.email_send_queue
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
