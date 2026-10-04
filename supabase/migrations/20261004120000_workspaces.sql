-- Multi-tenant workspaces: foundation.
-- Sequencing: apply together with the workspace-scoped app deploy (same minute).
-- Policy inventory at write time (31 policies, see drops below).

-- ─── 1. Workspaces ───────────────────────────────────────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text,
  trial_ends_at timestamptz,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

grant select, update on public.workspaces to authenticated;
grant all privileges on public.workspaces to service_role;

-- ─── 2. Profiles: workspace + super-admin ────────────────────────────────────

alter table public.profiles
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,
  add column if not exists is_super_admin boolean not null default false;

-- ─── 3. Data tables: workspace_id (nullable, backfilled below) ───────────────

alter table public.organizations   add column if not exists workspace_id uuid;
alter table public.contacts        add column if not exists workspace_id uuid;
alter table public.company_emails  add column if not exists workspace_id uuid;
alter table public.enrichment_runs add column if not exists workspace_id uuid;
alter table public.interactions    add column if not exists workspace_id uuid;
alter table public.sent_emails     add column if not exists workspace_id uuid;
alter table public.activity_log    add column if not exists workspace_id uuid;
alter table public.pipelines       add column if not exists workspace_id uuid;

-- ─── 4. HI Labs workspace + backfill ─────────────────────────────────────────

insert into public.workspaces (id, name, plan)
values ('00000000-0000-4000-8000-000000000001', 'HI Labs', 'active')
on conflict (id) do nothing;

update public.organizations   set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.contacts        set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.company_emails  set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.enrichment_runs set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.interactions    set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.sent_emails     set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.activity_log    set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.pipelines       set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.profiles        set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;

update public.profiles set is_super_admin = true where email = 'atanub707@gmail.com';

-- ─── 5. NOT NULL + FKs + indexes ─────────────────────────────────────────────

alter table public.organizations   alter column workspace_id set not null;
alter table public.contacts        alter column workspace_id set not null;
alter table public.company_emails  alter column workspace_id set not null;
alter table public.enrichment_runs alter column workspace_id set not null;
alter table public.interactions    alter column workspace_id set not null;
alter table public.sent_emails     alter column workspace_id set not null;
alter table public.activity_log    alter column workspace_id set not null;
alter table public.pipelines       alter column workspace_id set not null;

alter table public.organizations   add constraint organizations_workspace_fkey   foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.contacts        add constraint contacts_workspace_fkey        foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.company_emails  add constraint company_emails_workspace_fkey  foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.enrichment_runs add constraint enrichment_runs_workspace_fkey foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.interactions    add constraint interactions_workspace_fkey    foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.sent_emails     add constraint sent_emails_workspace_fkey     foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.activity_log    add constraint activity_log_workspace_fkey    foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.pipelines       add constraint pipelines_workspace_fkey       foreign key (workspace_id) references public.workspaces (id) on delete cascade;

create index organizations_workspace_idx   on public.organizations (workspace_id);
create index contacts_workspace_idx        on public.contacts (workspace_id);
create index company_emails_workspace_idx  on public.company_emails (workspace_id);
create index enrichment_runs_workspace_idx on public.enrichment_runs (workspace_id);
create index interactions_workspace_idx    on public.interactions (workspace_id);
create index sent_emails_workspace_idx     on public.sent_emails (workspace_id);
create index activity_log_workspace_idx    on public.activity_log (workspace_id);
create index pipelines_workspace_idx       on public.pipelines (workspace_id);

-- ─── 6. Pipelines: composite key + scoped FK from organizations ──────────────

alter table public.organizations drop constraint if exists organizations_list_fkey;
alter table public.pipelines drop constraint if exists pipelines_pkey;
alter table public.pipelines add constraint pipelines_pkey primary key (workspace_id, id);
alter table public.organizations
  add constraint organizations_list_fkey
  foreign key (workspace_id, list) references public.pipelines (workspace_id, id);

-- ─── 7. Helper functions ─────────────────────────────────────────────────────

create or replace function public.my_workspace()
returns uuid language sql security definer stable set search_path = public as $$
  select workspace_id from public.profiles where id = public.clerk_user_id();
$$;

-- is_owner() now means "owner of the caller's own workspace" — every existing
-- policy that references it becomes workspace-scoped automatically.
create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = public.clerk_user_id() and role = 'owner'
  );
$$;

create or replace function public.is_super_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.profiles where id = public.clerk_user_id()),
    false
  );
$$;

create or replace function public.trial_active(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspaces
    where id = ws and (trial_ends_at is null or trial_ends_at > now())
  );
$$;

grant execute on function public.my_workspace, public.is_owner, public.is_super_admin, public.trial_active to authenticated;

-- ─── 8. RLS — workspaces (policies created after the helpers exist) ──────────

create policy "workspaces_select" on public.workspaces
  for select to authenticated using (
    id = public.my_workspace() or public.is_super_admin()
  );

create policy "workspaces_update_owner" on public.workspaces
  for update to authenticated using (
    id = public.my_workspace() and public.is_owner() and public.trial_active(id)
  ) with check (
    id = public.my_workspace() and public.is_owner() and public.trial_active(id)
  );

-- ─── 9. RLS rewrite — organizations ──────────────────────────────────────────

drop policy if exists "orgs_select" on public.organizations;
create policy "orgs_select" on public.organizations
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "orgs_insert" on public.organizations;
create policy "orgs_insert" on public.organizations
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "orgs_update" on public.organizations;
create policy "orgs_update" on public.organizations
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "orgs_delete_owner" on public.organizations;
create policy "orgs_delete_owner" on public.organizations
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 9. RLS rewrite — contacts ───────────────────────────────────────────────

drop policy if exists "contacts_select" on public.contacts;
create policy "contacts_select" on public.contacts
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "contacts_insert" on public.contacts;
create policy "contacts_insert" on public.contacts
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "contacts_update" on public.contacts;
create policy "contacts_update" on public.contacts
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "contacts_delete_owner" on public.contacts;
create policy "contacts_delete_owner" on public.contacts
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 10. RLS rewrite — company_emails ────────────────────────────────────────

drop policy if exists "company_emails_select" on public.company_emails;
create policy "company_emails_select" on public.company_emails
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "company_emails_insert" on public.company_emails;
create policy "company_emails_insert" on public.company_emails
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "company_emails_update" on public.company_emails;
create policy "company_emails_update" on public.company_emails
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "company_emails_delete_owner" on public.company_emails;
create policy "company_emails_delete_owner" on public.company_emails
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 11. RLS rewrite — enrichment_runs (no UPDATE policy by design) ──────────

drop policy if exists "enrichment_runs_select" on public.enrichment_runs;
create policy "enrichment_runs_select" on public.enrichment_runs
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "enrichment_runs_insert" on public.enrichment_runs;
create policy "enrichment_runs_insert" on public.enrichment_runs
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "enrichment_runs_delete_owner" on public.enrichment_runs;
create policy "enrichment_runs_delete_owner" on public.enrichment_runs
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 12. RLS rewrite — interactions ──────────────────────────────────────────

drop policy if exists "interactions_select" on public.interactions;
create policy "interactions_select" on public.interactions
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "interactions_insert" on public.interactions;
create policy "interactions_insert" on public.interactions
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "interactions_update" on public.interactions;
create policy "interactions_update" on public.interactions
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.trial_active(workspace_id)
  );

drop policy if exists "interactions_delete_owner" on public.interactions;
create policy "interactions_delete_owner" on public.interactions
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 13. RLS rewrite — sent_emails (SELECT only; inserts via service role) ───

drop policy if exists "sent_emails_select" on public.sent_emails;
create policy "sent_emails_select" on public.sent_emails
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- ─── 14. RLS rewrite — activity_log (owner-of-workspace or super-admin) ──────

drop policy if exists "activity_log_select_owner" on public.activity_log;
create policy "activity_log_select_owner" on public.activity_log
  for select to authenticated using (
    (workspace_id = public.my_workspace() and public.is_owner()) or public.is_super_admin()
  );

-- ─── 15. RLS rewrite — pipelines ─────────────────────────────────────────────

drop policy if exists "pipelines_select" on public.pipelines;
create policy "pipelines_select" on public.pipelines
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

drop policy if exists "pipelines_insert_owner" on public.pipelines;
create policy "pipelines_insert_owner" on public.pipelines
  for insert to authenticated with check (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

drop policy if exists "pipelines_update_owner" on public.pipelines;
create policy "pipelines_update_owner" on public.pipelines
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  ) with check (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

drop policy if exists "pipelines_delete_owner" on public.pipelines;
create policy "pipelines_delete_owner" on public.pipelines
  for delete to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id)
  );

-- ─── 16. RLS rewrite — profiles ──────────────────────────────────────────────

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (
    workspace_id = public.my_workspace()
    or id = public.clerk_user_id()
    or public.is_super_admin()
  );

-- Owner role changes stay owner-gated; scoped to the same workspace.
drop policy if exists "profiles_update_owner" on public.profiles;
create policy "profiles_update_owner" on public.profiles
  for update to authenticated using (
    workspace_id = public.my_workspace() and public.is_owner()
  ) with check (
    workspace_id = public.my_workspace() and public.is_owner()
  );

-- profiles_update_self_name stays as-is (clerk_user_id() + role via my_role()).

-- ─── 17. RLS rewrite — user_email_settings (own row + trial gate) ────────────

drop policy if exists "user_email_settings_insert_own" on public.user_email_settings;
create policy "user_email_settings_insert_own" on public.user_email_settings
  for insert to authenticated with check (
    user_id = public.clerk_user_id() and public.trial_active(public.my_workspace())
  );

drop policy if exists "user_email_settings_update_own" on public.user_email_settings;
create policy "user_email_settings_update_own" on public.user_email_settings
  for update to authenticated using (
    user_id = public.clerk_user_id()
  ) with check (
    user_id = public.clerk_user_id() and public.trial_active(public.my_workspace())
  );

-- user_email_settings_select_own stays as-is.
