-- Lead-gen schema upgrade: typed company emails, contact qualification fields,
-- and an enrichment audit log (what was scraped, from where, at what cost).

-- ─── 1. Company emails: typed + sourced (replaces organizations.emails[]) ────
create table public.company_emails (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  email text not null,
  kind text not null default 'general' check (kind in ('general', 'personal', 'other')),
  source text not null default 'manual',
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create index company_emails_org_idx on public.company_emails (org_id);

insert into public.company_emails (org_id, email, kind, source)
select id, unnest(emails), 'general', 'website'
from public.organizations
where coalesce(array_length(emails, 1), 0) > 0
on conflict (org_id, email) do nothing;

alter table public.organizations drop column emails;

-- ─── 2. Contacts: lead qualification ────────────────────────────────────────
alter table public.contacts
  add column seniority text,
  add column is_decision_maker boolean not null default false,
  add column email_status text,
  add column source text;

-- ─── 3. Enrichment runs: audit + cost trail ─────────────────────────────────
create table public.enrichment_runs (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  kind text not null,
  source text not null,
  status text not null default 'ok',
  people_found integer not null default 0,
  emails_found integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  details jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index enrichment_runs_org_idx
  on public.enrichment_runs (org_id, created_at desc);

-- ─── 4. RLS + grants ────────────────────────────────────────────────────────
alter table public.company_emails enable row level security;
alter table public.enrichment_runs enable row level security;

create policy "company_emails_select" on public.company_emails
  for select to authenticated using (true);
create policy "company_emails_insert" on public.company_emails
  for insert to authenticated with check (true);
create policy "company_emails_update" on public.company_emails
  for update to authenticated using (true) with check (true);
create policy "company_emails_delete_owner" on public.company_emails
  for delete to authenticated using (public.is_owner());

create policy "enrichment_runs_select" on public.enrichment_runs
  for select to authenticated using (true);
create policy "enrichment_runs_insert" on public.enrichment_runs
  for insert to authenticated with check (true);
create policy "enrichment_runs_delete_owner" on public.enrichment_runs
  for delete to authenticated using (public.is_owner());

grant select, insert, update, delete
  on public.company_emails, public.enrichment_runs
  to authenticated;

grant all privileges
  on public.company_emails, public.enrichment_runs
  to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;
