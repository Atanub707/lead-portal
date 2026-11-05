-- Phase 0 — Universal B2B Lead Intelligence: schema, RLS, indexes, seeds.
--
-- Adds the configuration/intelligence layer without touching existing rows or
-- behaviour. A workspace with no ICP configured behaves exactly as before:
-- pipelines, organizations, contacts, deep research, composer, replies and
-- Crunchbase import keep working.
--
-- Model:
--   business_profiles  what a workspace sells (offering + playbook, no logic)
--   icp_profiles       who it targets (linked to a pipeline)
--   icp_criteria       machine-readable targeting rules
--   icp_personas       decision-maker definitions
--   signal_definitions catalog (global templates + workspace custom)
--   company_firmographics  1:1 firmographic store (replaces JSON-in-runs)
--   company_signals    append-only evidence ledger
--   scoring_models/rules + lead_scores  transparent scoring snapshots
--   company_briefs     cached, versioned AI research
--   campaigns/steps/enrollments/events  sequences
--   suppression_list, email_verifications
--   jobs               worker queue (cron-driven)
--   metrics_daily      analytics rollups
--   template_*         global, read-only seed catalogs

-- ─── 1. Global templates (read-only catalogs) ────────────────────────────────

create table if not exists public.template_business_profiles (
  key text primary key,
  name text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.template_signal_definitions (
  key text primary key,
  label text not null,
  category text not null,
  description text,
  evidence_hint text,
  source_key text not null,
  query_config jsonb not null default '{}'::jsonb,
  default_weight integer not null default 10,
  decay_days integer not null default 180,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.template_business_profiles enable row level security;
alter table public.template_signal_definitions enable row level security;
grant select on public.template_business_profiles to authenticated;
grant select on public.template_signal_definitions to authenticated;
grant all privileges on public.template_business_profiles to service_role;
grant all privileges on public.template_signal_definitions to service_role;

drop policy if exists "template_business_profiles_select" on public.template_business_profiles;
create policy "template_business_profiles_select" on public.template_business_profiles
  for select to authenticated using (true);

drop policy if exists "template_signal_definitions_select" on public.template_signal_definitions;
create policy "template_signal_definitions_select" on public.template_signal_definitions
  for select to authenticated using (true);

-- ─── 2. Business profiles (what the workspace sells) ─────────────────────────

create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  description text,
  service_categories text[] not null default '{}',
  positioning text,
  differentiators text[] not null default '{}',
  outreach_angles jsonb not null default '[]'::jsonb,
  template_key text references public.template_business_profiles (key) on delete set null,
  is_active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_profiles_workspace_idx
  on public.business_profiles (workspace_id);

alter table public.business_profiles enable row level security;
grant select, insert, update, delete on public.business_profiles to authenticated;
grant all privileges on public.business_profiles to service_role;

drop policy if exists "business_profiles_select" on public.business_profiles;
create policy "business_profiles_select" on public.business_profiles
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "business_profiles_insert" on public.business_profiles;
create policy "business_profiles_insert" on public.business_profiles
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );
drop policy if exists "business_profiles_update" on public.business_profiles;
create policy "business_profiles_update" on public.business_profiles
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );
drop policy if exists "business_profiles_delete" on public.business_profiles;
create policy "business_profiles_delete" on public.business_profiles
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 3. ICPs, criteria, personas ─────────────────────────────────────────────

create table if not exists public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  business_profile_id uuid references public.business_profiles (id) on delete set null,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  is_default boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists icp_profiles_workspace_idx on public.icp_profiles (workspace_id);
create unique index if not exists icp_profiles_one_default_idx
  on public.icp_profiles (workspace_id) where is_default;

create table if not exists public.icp_criteria (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  icp_id uuid not null references public.icp_profiles (id) on delete cascade,
  kind text not null check (kind in ('firmographic', 'technographic', 'geo', 'persona', 'signal', 'exclusion')),
  field text not null,
  operator text not null check (operator in ('in', 'not_in', 'gte', 'lte', 'contains', 'exists')),
  value jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  weight numeric not null default 1,
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists icp_criteria_icp_idx on public.icp_criteria (workspace_id, icp_id);

create table if not exists public.icp_personas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  icp_id uuid not null references public.icp_profiles (id) on delete cascade,
  name text not null,
  titles text[] not null default '{}',
  seniorities text[] not null default '{}',
  functions text[] not null default '{}',
  weight numeric not null default 1,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists icp_personas_icp_idx on public.icp_personas (workspace_id, icp_id);

alter table public.icp_profiles enable row level security;
alter table public.icp_criteria enable row level security;
alter table public.icp_personas enable row level security;
grant select, insert, update, delete on public.icp_profiles to authenticated;
grant select, insert, update, delete on public.icp_criteria to authenticated;
grant select, insert, update, delete on public.icp_personas to authenticated;
grant all privileges on public.icp_profiles to service_role;
grant all privileges on public.icp_criteria to service_role;
grant all privileges on public.icp_personas to service_role;

drop policy if exists "icp_profiles_select" on public.icp_profiles;
create policy "icp_profiles_select" on public.icp_profiles
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "icp_profiles_insert" on public.icp_profiles;
create policy "icp_profiles_insert" on public.icp_profiles
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );
drop policy if exists "icp_profiles_update" on public.icp_profiles;
create policy "icp_profiles_update" on public.icp_profiles
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );
drop policy if exists "icp_profiles_delete" on public.icp_profiles;
create policy "icp_profiles_delete" on public.icp_profiles
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

drop policy if exists "icp_criteria_select" on public.icp_criteria;
create policy "icp_criteria_select" on public.icp_criteria
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "icp_criteria_write" on public.icp_criteria;
create policy "icp_criteria_write" on public.icp_criteria
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "icp_personas_select" on public.icp_personas;
create policy "icp_personas_select" on public.icp_personas
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "icp_personas_write" on public.icp_personas;
create policy "icp_personas_write" on public.icp_personas
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

-- ─── 4. Signal catalog (per workspace) ──────────────────────────────────────

create table if not exists public.signal_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null,
  label text not null,
  category text not null check (category in ('funding', 'hiring', 'technology', 'compliance', 'growth', 'news', 'engagement', 'manual')),
  description text,
  evidence_hint text,
  source_key text not null check (source_key in ('crunchbase', 'apollo', 'linkedin_company', 'linkedin_employees', 'linkedin_jobs', 'techstack', 'website', 'news', 'manual')),
  query_config jsonb not null default '{}'::jsonb,
  default_weight integer not null default 10,
  decay_days integer not null default 180,
  is_builtin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create index if not exists signal_definitions_workspace_idx
  on public.signal_definitions (workspace_id);

alter table public.signal_definitions enable row level security;
grant select, insert, update, delete on public.signal_definitions to authenticated;
grant all privileges on public.signal_definitions to service_role;

drop policy if exists "signal_definitions_select" on public.signal_definitions;
create policy "signal_definitions_select" on public.signal_definitions
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "signal_definitions_write" on public.signal_definitions;
create policy "signal_definitions_write" on public.signal_definitions
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

-- ─── 5. Firmographics (1:1 with organizations) ──────────────────────────────

create table if not exists public.company_firmographics (
  org_id bigint primary key references public.organizations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  industry text,
  sub_industries text[] not null default '{}',
  employee_band text,
  employee_count integer,
  founded_year integer,
  hq_country text,
  hq_region text,
  hq_city text,
  funding_stage text,
  last_funding_at date,
  total_funding_usd numeric,
  revenue_band text,
  tech_stack text[] not null default '{}',
  data_sources jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0.5,
  updated_at timestamptz not null default now()
);

create index if not exists company_firmographics_ws_industry_idx
  on public.company_firmographics (workspace_id, industry);
create index if not exists company_firmographics_ws_band_idx
  on public.company_firmographics (workspace_id, employee_band);

alter table public.company_firmographics enable row level security;
grant select on public.company_firmographics to authenticated;
grant all privileges on public.company_firmographics to service_role;

drop policy if exists "company_firmographics_select" on public.company_firmographics;
create policy "company_firmographics_select" on public.company_firmographics
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 6. Signals (evidence ledger) ───────────────────────────────────────────

create table if not exists public.company_signals (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  signal_key text not null,
  value jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  source_key text not null,
  confidence numeric not null default 0.5,
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  dedupe_hash text not null,
  created_at timestamptz not null default now(),
  unique (org_id, signal_key, dedupe_hash)
);

create index if not exists company_signals_org_idx
  on public.company_signals (workspace_id, org_id);
create index if not exists company_signals_key_idx
  on public.company_signals (workspace_id, signal_key, observed_at desc);
create index if not exists company_signals_expiry_idx
  on public.company_signals (expires_at) where expires_at is not null;

alter table public.company_signals enable row level security;
grant select on public.company_signals to authenticated;
grant all privileges on public.company_signals to service_role;

drop policy if exists "company_signals_select" on public.company_signals;
create policy "company_signals_select" on public.company_signals
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 7. Scoring ─────────────────────────────────────────────────────────────

create table if not exists public.scoring_models (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  icp_id uuid references public.icp_profiles (id) on delete cascade,
  name text not null,
  version integer not null default 1,
  weights jsonb not null default '{"fit":0.4,"intent":0.45,"reach":0.15}'::jsonb,
  threshold integer not null default 60,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scoring_models_workspace_idx
  on public.scoring_models (workspace_id, icp_id);

create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  model_id uuid not null references public.scoring_models (id) on delete cascade,
  rule_key text not null,
  label text not null,
  category text not null check (category in ('fit', 'intent', 'reach', 'exclusion')),
  operator text not null default 'exists',
  value jsonb not null default '{}'::jsonb,
  points integer not null default 0,
  is_required boolean not null default false,
  evidence_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists scoring_rules_model_idx
  on public.scoring_rules (workspace_id, model_id);

create table if not exists public.lead_scores (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  icp_id uuid not null references public.icp_profiles (id) on delete cascade,
  model_version integer not null default 1,
  fit integer not null default 0,
  intent integer not null default 0,
  reach integer not null default 0,
  total integer not null default 0,
  grade text not null default 'D' check (grade in ('A', 'B', 'C', 'D', 'excluded')),
  excluded boolean not null default false,
  exclusion_reason text,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

create index if not exists lead_scores_org_idx
  on public.lead_scores (workspace_id, org_id, computed_at desc);
create index if not exists lead_scores_rank_idx
  on public.lead_scores (workspace_id, icp_id, total desc);

alter table public.scoring_models enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.lead_scores enable row level security;
grant select, insert, update, delete on public.scoring_models to authenticated;
grant select, insert, update, delete on public.scoring_rules to authenticated;
grant select on public.lead_scores to authenticated;
grant all privileges on public.scoring_models to service_role;
grant all privileges on public.scoring_rules to service_role;
grant all privileges on public.lead_scores to service_role;

drop policy if exists "scoring_models_select" on public.scoring_models;
create policy "scoring_models_select" on public.scoring_models
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "scoring_models_write" on public.scoring_models;
create policy "scoring_models_write" on public.scoring_models
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "scoring_rules_select" on public.scoring_rules;
create policy "scoring_rules_select" on public.scoring_rules
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "scoring_rules_write" on public.scoring_rules;
create policy "scoring_rules_write" on public.scoring_rules
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "lead_scores_select" on public.lead_scores;
create policy "lead_scores_select" on public.lead_scores
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 8. AI company briefs ───────────────────────────────────────────────────

create table if not exists public.company_briefs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  icp_id uuid references public.icp_profiles (id) on delete set null,
  summary text,
  priorities text[] not null default '{}',
  likely_objections text[] not null default '{}',
  suggested_angle text,
  stakeholder_notes jsonb not null default '[]'::jsonb,
  evidence_signal_ids bigint[] not null default '{}',
  model text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create index if not exists company_briefs_org_idx
  on public.company_briefs (workspace_id, org_id, created_at desc);

alter table public.company_briefs enable row level security;
grant select on public.company_briefs to authenticated;
grant all privileges on public.company_briefs to service_role;

drop policy if exists "company_briefs_select" on public.company_briefs;
create policy "company_briefs_select" on public.company_briefs
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 9. Campaigns / sequences ───────────────────────────────────────────────

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pipeline_id text,
  icp_id uuid references public.icp_profiles (id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  daily_cap integer not null default 30,
  send_window jsonb not null default '{"start":"09:00","end":"18:00","tz":"UTC"}'::jsonb,
  stop_on_reply boolean not null default true,
  min_score integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaigns_workspace_idx
  on public.campaigns (workspace_id, status);

create table if not exists public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step_no integer not null,
  channel text not null default 'email' check (channel in ('email', 'linkedin_task', 'call')),
  delay_days integer not null default 0,
  flavor text,
  template jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (campaign_id, step_no)
);

create index if not exists campaign_steps_campaign_idx
  on public.campaign_steps (workspace_id, campaign_id, step_no);

create table if not exists public.campaign_enrollments (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'active', 'paused', 'done', 'stopped')),
  current_step integer not null default 0,
  next_run_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, org_id, contact_id)
);

create index if not exists campaign_enrollments_due_idx
  on public.campaign_enrollments (status, next_run_at) where status = 'active';
create index if not exists campaign_enrollments_ws_idx
  on public.campaign_enrollments (workspace_id, campaign_id);

create table if not exists public.campaign_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  enrollment_id bigint references public.campaign_enrollments (id) on delete set null,
  org_id bigint references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('sent', 'reply', 'positive_reply', 'bounce', 'unsubscribe', 'stage_change')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists campaign_events_campaign_idx
  on public.campaign_events (workspace_id, campaign_id, created_at desc);

alter table public.campaigns enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_enrollments enable row level security;
alter table public.campaign_events enable row level security;
grant select, insert, update, delete on public.campaigns to authenticated;
grant select, insert, update, delete on public.campaign_steps to authenticated;
grant select, insert, update, delete on public.campaign_enrollments to authenticated;
grant select on public.campaign_events to authenticated;
grant all privileges on public.campaigns to service_role;
grant all privileges on public.campaign_steps to service_role;
grant all privileges on public.campaign_enrollments to service_role;
grant all privileges on public.campaign_events to service_role;

drop policy if exists "campaigns_select" on public.campaigns;
create policy "campaigns_select" on public.campaigns
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "campaigns_write" on public.campaigns;
create policy "campaigns_write" on public.campaigns
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "campaign_steps_select" on public.campaign_steps;
create policy "campaign_steps_select" on public.campaign_steps
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "campaign_steps_write" on public.campaign_steps;
create policy "campaign_steps_write" on public.campaign_steps
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "campaign_enrollments_select" on public.campaign_enrollments;
create policy "campaign_enrollments_select" on public.campaign_enrollments
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "campaign_enrollments_write" on public.campaign_enrollments;
create policy "campaign_enrollments_write" on public.campaign_enrollments
  for all to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "campaign_events_select" on public.campaign_events;
create policy "campaign_events_select" on public.campaign_events
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 10. Deliverability: suppression + verification cache ───────────────────

create table if not exists public.suppression_list (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  reason text not null default 'manual',
  created_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index if not exists suppression_list_ws_idx
  on public.suppression_list (workspace_id, email);

create table if not exists public.email_verifications (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null,
  status text not null check (status in ('valid', 'risky', 'invalid', 'unknown')),
  provider text,
  checked_at timestamptz not null default now(),
  unique (workspace_id, email)
);

create index if not exists email_verifications_ws_idx
  on public.email_verifications (workspace_id, email);

alter table public.suppression_list enable row level security;
alter table public.email_verifications enable row level security;
grant select on public.suppression_list to authenticated;
grant select on public.email_verifications to authenticated;
grant all privileges on public.suppression_list to service_role;
grant all privileges on public.email_verifications to service_role;

drop policy if exists "suppression_list_select" on public.suppression_list;
create policy "suppression_list_select" on public.suppression_list
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );
drop policy if exists "email_verifications_select" on public.email_verifications;
create policy "email_verifications_select" on public.email_verifications
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 11. Worker queue ──────────────────────────────────────────────────────

create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in (
    'discovery', 'signal_scan', 'score_recompute', 'campaign_tick',
    'imap_sync', 'verification', 'brief'
  )),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_due_idx
  on public.jobs (status, run_after) where status = 'queued';
create index if not exists jobs_ws_idx
  on public.jobs (workspace_id, kind, created_at desc);

alter table public.jobs enable row level security;
grant all privileges on public.jobs to service_role;
-- No authenticated policies: jobs are worker-only. Members read their results,
-- never the queue.

-- ─── 12. Analytics rollups ─────────────────────────────────────────────────

create table if not exists public.metrics_daily (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  day date not null,
  pipeline_id text,
  icp_id uuid references public.icp_profiles (id) on delete cascade,
  discovered integer not null default 0,
  enriched integer not null default 0,
  qualified integer not null default 0,
  contacted integer not null default 0,
  replied integer not null default 0,
  positive_replies integer not null default 0,
  meetings integer not null default 0,
  won integer not null default 0,
  signals_by_key jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Rollup uniqueness with NULL-safe sentinels (pipeline/ICP are optional).
create unique index if not exists metrics_daily_unique_idx
  on public.metrics_daily (
    workspace_id,
    day,
    coalesce(pipeline_id, ''),
    coalesce(icp_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.metrics_daily enable row level security;
grant select on public.metrics_daily to authenticated;
grant all privileges on public.metrics_daily to service_role;

drop policy if exists "metrics_daily_select" on public.metrics_daily;
create policy "metrics_daily_select" on public.metrics_daily
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 13. Existing tables: additive columns ─────────────────────────────────

alter table public.pipelines
  add column if not exists icp_id uuid references public.icp_profiles (id) on delete set null;

alter table public.organizations
  add column if not exists icp_id uuid references public.icp_profiles (id) on delete set null,
  add column if not exists score integer,
  add column if not exists grade text,
  add column if not exists signal_count integer not null default 0,
  add column if not exists last_signal_at timestamptz;

create index if not exists organizations_score_idx
  on public.organizations (workspace_id, list, score desc nulls last);

alter table public.lead_imports
  add column if not exists icp_id uuid references public.icp_profiles (id) on delete set null,
  add column if not exists filters jsonb;

alter table public.contacts
  add column if not exists persona_id uuid references public.icp_personas (id) on delete set null;

-- ─── 14. Seed: business profile templates ──────────────────────────────────

insert into public.template_business_profiles (key, name, description, config, sort_order)
values
  (
    'compliance-security',
    'Compliance & Security Readiness',
    'SOC 2 / ISO 27001 readiness, cloud security audits and DevSecOps implementation.',
    $json${
      "service_categories": ["SOC 2 readiness", "ISO 27001 readiness", "Cloud security", "DevSecOps"],
      "icp": {
        "industries": ["SaaS", "FinTech", "Health Care", "Information Technology"],
        "employee_bands": ["11-50", "51-100", "101-250", "251-500"],
        "geo": ["India", "United States", "United Kingdom", "EU"],
        "funding_stages": ["seed", "early_stage_venture"],
        "personas": [
          {"name": "Founder", "titles": ["Founder", "Co-Founder", "CEO"], "seniorities": ["c_suite", "owner"], "is_primary": true},
          {"name": "Engineering leader", "titles": ["CTO", "VP Engineering", "Head of Engineering"], "seniorities": ["c_suite", "vp"]},
          {"name": "Security & Compliance", "titles": ["CISO", "Head of Compliance", "Security Manager"], "seniorities": ["c_suite", "director", "manager"]}
        ],
        "signals": [
          {"key": "funding_recent", "weight": 25},
          {"key": "hiring_security", "weight": 25},
          {"key": "hiring_devops", "weight": 15},
          {"key": "tech_aws", "weight": 10},
          {"key": "soc2_mention", "weight": 20},
          {"key": "us_expansion", "weight": 15}
        ]
      },
      "scoring": {"fit": 0.40, "intent": 0.45, "reach": 0.15, "threshold": 60}
    }$json$,
    1
  ),
  (
    'software-development',
    'Software Development & Modernization',
    'Custom software, legacy modernization, product engineering and outsourcing.',
    $json${
      "service_categories": ["Custom software", "Legacy modernization", "Product engineering", "QA automation"],
      "icp": {
        "industries": ["Information Technology", "Software", "SaaS", "E-Commerce", "Financial Services"],
        "employee_bands": ["51-100", "101-250", "251-500", "501-1000"],
        "geo": ["India", "United States", "United Kingdom", "EU"],
        "personas": [
          {"name": "CTO", "titles": ["CTO", "VP Engineering", "Head of Engineering"], "seniorities": ["c_suite", "vp"], "is_primary": true},
          {"name": "Product leader", "titles": ["CPO", "VP Product", "Head of Product"], "seniorities": ["c_suite", "vp"]}
        ],
        "signals": [
          {"key": "hiring_devops", "weight": 20},
          {"key": "hiring_growth", "weight": 15},
          {"key": "product_launch", "weight": 20},
          {"key": "funding_recent", "weight": 20},
          {"key": "tech_aws", "weight": 10}
        ]
      },
      "scoring": {"fit": 0.45, "intent": 0.40, "reach": 0.15, "threshold": 55}
    }$json$,
    2
  ),
  (
    'marketing-agency',
    'Marketing & Growth Agency',
    'Performance marketing, SEO, brand and growth services.',
    $json${
      "service_categories": ["Performance marketing", "SEO", "Content", "Brand"],
      "icp": {
        "industries": ["E-Commerce", "SaaS", "Financial Services", "Health Care", "Real Estate"],
        "employee_bands": ["11-50", "51-100", "101-250", "251-500"],
        "geo": ["India", "United States", "United Arab Emirates", "United Kingdom"],
        "personas": [
          {"name": "Founder", "titles": ["Founder", "Co-Founder", "CEO"], "seniorities": ["c_suite", "owner"], "is_primary": true},
          {"name": "Marketing leader", "titles": ["CMO", "VP Marketing", "Head of Marketing", "Growth Manager"], "seniorities": ["c_suite", "vp", "director", "manager"]}
        ],
        "signals": [
          {"key": "hiring_marketing", "weight": 25},
          {"key": "funding_recent", "weight": 20},
          {"key": "product_launch", "weight": 15},
          {"key": "enterprise_customers", "weight": 10}
        ]
      },
      "scoring": {"fit": 0.40, "intent": 0.45, "reach": 0.15, "threshold": 55}
    }$json$,
    3
  ),
  (
    'recruitment-staffing',
    'Recruitment & Staffing',
    'Permanent hiring, contract staffing and talent solutions.',
    $json${
      "service_categories": ["Permanent hiring", "Contract staffing", "Executive search", "RPO"],
      "icp": {
        "industries": ["Information Technology", "Software", "Health Care", "Manufacturing", "Financial Services"],
        "employee_bands": ["51-100", "101-250", "251-500", "501-1000", "1001-5000"],
        "geo": ["India", "United States", "United Kingdom", "EU"],
        "personas": [
          {"name": "HR leader", "titles": ["CHRO", "VP HR", "Head of Talent", "HR Manager"], "seniorities": ["c_suite", "vp", "director", "manager"], "is_primary": true},
          {"name": "Founder", "titles": ["Founder", "CEO", "COO"], "seniorities": ["c_suite", "owner"]}
        ],
        "signals": [
          {"key": "hiring_growth", "weight": 30},
          {"key": "funding_recent", "weight": 20},
          {"key": "us_expansion", "weight": 15}
        ]
      },
      "scoring": {"fit": 0.40, "intent": 0.45, "reach": 0.15, "threshold": 55}
    }$json$,
    4
  ),
  (
    'cloud-devops',
    'Cloud & DevOps Consulting',
    'Cloud migration, platform engineering, Kubernetes and DevOps transformation.',
    $json${
      "service_categories": ["Cloud migration", "Platform engineering", "Kubernetes", "DevOps implementation"],
      "icp": {
        "industries": ["SaaS", "Financial Services", "E-Commerce", "Health Care", "Information Technology"],
        "employee_bands": ["51-100", "101-250", "251-500", "501-1000"],
        "geo": ["India", "United States", "United Kingdom", "EU"],
        "personas": [
          {"name": "Engineering leader", "titles": ["CTO", "VP Engineering", "Head of Platform", "DevOps Manager"], "seniorities": ["c_suite", "vp", "director", "manager"], "is_primary": true}
        ],
        "signals": [
          {"key": "hiring_devops", "weight": 30},
          {"key": "tech_kubernetes", "weight": 15},
          {"key": "tech_aws", "weight": 10},
          {"key": "tech_azure", "weight": 10},
          {"key": "funding_recent", "weight": 15}
        ]
      },
      "scoring": {"fit": 0.45, "intent": 0.40, "reach": 0.15, "threshold": 55}
    }$json$,
    5
  ),
  (
    'custom',
    'Custom Business Profile',
    'Start from scratch and define your own ICP, personas, signals and scoring.',
    $json${
      "service_categories": [],
      "icp": {"industries": [], "employee_bands": [], "geo": [], "personas": [], "signals": []},
      "scoring": {"fit": 0.40, "intent": 0.45, "reach": 0.15, "threshold": 60}
    }$json$,
    99
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  config = excluded.config,
  sort_order = excluded.sort_order;

-- ─── 15. Seed: built-in signal catalog ─────────────────────────────────────

insert into public.template_signal_definitions
  (key, label, category, description, evidence_hint, source_key, query_config, default_weight, decay_days, sort_order)
values
  ('funding_recent', 'Recent funding round', 'funding', 'Company raised a round recently — budget and growth trigger.', 'Funding round, date and amount from the company database.', 'crunchbase', '{}'::jsonb, 25, 180, 1),
  ('hiring_security', 'Hiring security / compliance roles', 'hiring', 'Open security, compliance or audit roles signal near-term readiness needs.', 'Job title contains security/compliance keywords.', 'linkedin_jobs', '{"keywords":["security engineer","security analyst","compliance manager","CISO","SOC 2","ISO 27001"],"countries":["India","United States","United Kingdom"]}'::jsonb, 25, 90, 2),
  ('hiring_devops', 'Hiring DevOps / platform roles', 'hiring', 'DevOps, SRE and platform hiring signals infrastructure modernization.', 'Job title contains devops/platform keywords.', 'linkedin_jobs', '{"keywords":["devops","platform engineer","site reliability","SRE","kubernetes","cloud engineer"]}'::jsonb, 15, 90, 3),
  ('hiring_marketing', 'Hiring marketing roles', 'hiring', 'Growth and marketing hiring signals budget for agencies and tooling.', 'Job title contains marketing/growth keywords.', 'linkedin_jobs', '{"keywords":["marketing manager","growth manager","demand generation","performance marketing","content lead"]}'::jsonb, 20, 90, 4),
  ('hiring_sales', 'Hiring sales roles', 'hiring', 'Sales hiring signals go-to-market expansion.', 'Job title contains sales keywords.', 'linkedin_jobs', '{"keywords":["account executive","sales manager","SDR","business development"]}'::jsonb, 15, 90, 5),
  ('hiring_growth', 'Headcount growth', 'growth', 'General hiring growth across functions.', 'Multiple open roles or headcount growth.', 'linkedin_jobs', '{"keywords":[]}'::jsonb, 10, 90, 6),
  ('tech_aws', 'Uses AWS', 'technology', 'Runs on AWS — relevant for cloud security and DevOps services.', 'Technology detected on the company website.', 'techstack', '{"technology":"Amazon Web Services"}'::jsonb, 10, 365, 7),
  ('tech_azure', 'Uses Azure', 'technology', 'Runs on Azure.', 'Technology detected on the company website.', 'techstack', '{"technology":"Microsoft Azure"}'::jsonb, 10, 365, 8),
  ('tech_gcp', 'Uses Google Cloud', 'technology', 'Runs on Google Cloud.', 'Technology detected on the company website.', 'techstack', '{"technology":"Google Cloud Platform"}'::jsonb, 10, 365, 9),
  ('tech_kubernetes', 'Uses Kubernetes', 'technology', 'Container platform in use — DevOps maturity signal.', 'Technology detected on the company website.', 'techstack', '{"technology":"Kubernetes"}'::jsonb, 10, 365, 10),
  ('tech_okta', 'Uses Okta / SSO', 'technology', 'Identity provider in use — security maturity signal.', 'Technology detected on the company website.', 'techstack', '{"technology":"Okta"}'::jsonb, 5, 365, 11),
  ('soc2_mention', 'Mentions SOC 2', 'compliance', 'SOC 2 mentioned on the website, trust center, job posts or news.', 'Keyword appears in site text or job listings.', 'website', '{"keywords":["SOC 2","SOC2","SOC 2 Type II"]}'::jsonb, 20, 180, 12),
  ('iso27001_mention', 'Mentions ISO 27001', 'compliance', 'ISO 27001 mentioned on the website, trust center, job posts or news.', 'Keyword appears in site text or job listings.', 'website', '{"keywords":["ISO 27001","ISO27001","ISMS"]}'::jsonb, 20, 180, 13),
  ('gdpr_mention', 'Mentions GDPR / DPDP', 'compliance', 'Privacy regulation mentioned — compliance program exists or is forming.', 'Keyword appears in site text or job listings.', 'website', '{"keywords":["GDPR","DPDP","privacy policy","data protection officer"]}'::jsonb, 10, 180, 14),
  ('us_expansion', 'US expansion', 'growth', 'Opening US operations or hiring in the US.', 'News or job location indicating US expansion.', 'news', '{"keywords":["opens US office","US expansion","expands to the United States"]}'::jsonb, 15, 180, 15),
  ('eu_expansion', 'EU expansion', 'growth', 'Opening EU operations or hiring in the EU.', 'News or job location indicating EU expansion.', 'news', '{"keywords":["opens European office","EU expansion","expands to Europe"]}'::jsonb, 15, 180, 16),
  ('enterprise_customers', 'Enterprise customers', 'growth', 'Serves enterprise customers — higher compliance and security requirements.', 'Customer logos or enterprise messaging on the website.', 'website', '{"keywords":["trusted by","enterprise customers","Fortune 500"]}'::jsonb, 10, 365, 17),
  ('security_incident', 'Security incident / breach news', 'news', 'Public incident coverage creates urgent security demand.', 'News mentioning the company and a breach or incident.', 'news', '{"keywords":["data breach","security incident","ransomware","vulnerability"]}'::jsonb, 20, 90, 18),
  ('product_launch', 'Product launch', 'news', 'New product or major release — budget and go-to-market activity.', 'News or website announcement of a new product.', 'news', '{"keywords":["launches","new product","general availability","GA release"]}'::jsonb, 10, 90, 19),
  ('manual', 'Manually observed signal', 'manual', 'Signal added by a user from research or a conversation.', 'User-provided note, link or evidence.', 'manual', '{}'::jsonb, 0, 0, 99)
on conflict (key) do update set
  label = excluded.label,
  category = excluded.category,
  description = excluded.description,
  evidence_hint = excluded.evidence_hint,
  source_key = excluded.source_key,
  query_config = excluded.query_config,
  default_weight = excluded.default_weight,
  decay_days = excluded.decay_days,
  sort_order = excluded.sort_order;

-- ─── 16. Per-workspace seed function (Phase 1 calls this) ──────────────────
-- Copies global templates into a workspace. Idempotent: safe to call again.
-- Does not create ICPs yet; Phase 1 creates the default ICP from a template.

create or replace function public.seed_workspace_signal_definitions(ws uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.signal_definitions
    (workspace_id, key, label, category, description, evidence_hint, source_key, query_config, default_weight, decay_days, is_builtin, is_active)
  select
    ws, t.key, t.label, t.category, t.description, t.evidence_hint, t.source_key, t.query_config, t.default_weight, t.decay_days, true, true
  from public.template_signal_definitions t
  on conflict (workspace_id, key) do nothing;
$$;

grant execute on function public.seed_workspace_signal_definitions(uuid) to service_role;

-- ─── 17. Verification ──────────────────────────────────────────────────────

do $$
declare
  missing text := '';
begin
  if to_regclass('public.business_profiles') is null then missing := missing || ' business_profiles'; end if;
  if to_regclass('public.icp_profiles') is null then missing := missing || ' icp_profiles'; end if;
  if to_regclass('public.company_signals') is null then missing := missing || ' company_signals'; end if;
  if to_regclass('public.lead_scores') is null then missing := missing || ' lead_scores'; end if;
  if to_regclass('public.jobs') is null then missing := missing || ' jobs'; end if;
  if missing <> '' then
    raise exception 'Phase 0 verification failed: missing %', missing;
  end if;
  if (select count(*) from public.template_business_profiles) < 6 then
    raise exception 'Phase 0 verification failed: templates not seeded';
  end if;
  if (select count(*) from public.template_signal_definitions) < 19 then
    raise exception 'Phase 0 verification failed: signal catalog not seeded';
  end if;
end $$;
