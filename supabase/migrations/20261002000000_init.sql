-- Lead Portal — initial schema
-- Run this in Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Creates: profiles (roles), organizations, contacts, interactions + RLS security.

-- ─── Enums ───────────────────────────────────────────────────────────────────
create type public.org_list as enum ('pos', 'compliance');
create type public.org_kind as enum ('lead', 'partner', 'competitor', 'other');
create type public.pipeline_stage as enum ('new', 'contacted', 'demo', 'scoping', 'proposal', 'won', 'lost');
create type public.user_role as enum ('owner', 'editor');

-- ─── Profiles (one row per user, linked to Supabase Auth) ────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role public.user_role not null default 'editor',
  created_at timestamptz not null default now()
);

-- The FIRST user to sign up becomes the owner; everyone after is an editor.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when exists (select 1 from public.profiles) then 'editor'::public.user_role
      else 'owner'::public.user_role
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── Organizations ───────────────────────────────────────────────────────────
create table public.organizations (
  id bigint generated always as identity primary key,
  list public.org_list not null,
  name text not null,
  website text,
  linkedin_url text,
  kind public.org_kind not null default 'lead',
  status public.pipeline_stage not null default 'new',
  priority text check (priority in ('high', 'medium', 'low')),
  next_action text,
  last_contact date,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index organizations_list_idx on public.organizations (list);
create index organizations_list_status_idx on public.organizations (list, status);

-- ─── Contacts (members of an organization) ───────────────────────────────────
create table public.contacts (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  name text not null,
  title text,
  linkedin_url text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now()
);

create index contacts_org_idx on public.contacts (org_id);

-- ─── Interactions (the track record — append-only by convention) ─────────────
create table public.interactions (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  occurred_on date not null default current_date,
  channel text,
  summary text not null,
  outcome text,
  logged_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index interactions_org_idx on public.interactions (org_id, occurred_on desc);

-- ─── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.touch_updated_at();

-- ─── Role helper ─────────────────────────────────────────────────────────────
create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

-- ─── Row-Level Security ──────────────────────────────────────────────────────
-- Rules: each authenticated user can read everything, add and edit.
-- Only the owner can delete records or change user roles.
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.contacts enable row level security;
alter table public.interactions enable row level security;

-- profiles
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_owner" on public.profiles
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());

-- organizations
create policy "orgs_select" on public.organizations
  for select to authenticated using (true);

create policy "orgs_insert" on public.organizations
  for insert to authenticated with check (true);

create policy "orgs_update" on public.organizations
  for update to authenticated using (true) with check (true);

create policy "orgs_delete_owner" on public.organizations
  for delete to authenticated using (public.is_owner());

-- contacts
create policy "contacts_select" on public.contacts
  for select to authenticated using (true);

create policy "contacts_insert" on public.contacts
  for insert to authenticated with check (true);

create policy "contacts_update" on public.contacts
  for update to authenticated using (true) with check (true);

create policy "contacts_delete_owner" on public.contacts
  for delete to authenticated using (public.is_owner());

-- interactions
create policy "interactions_select" on public.interactions
  for select to authenticated using (true);

create policy "interactions_insert" on public.interactions
  for insert to authenticated with check (true);

create policy "interactions_update" on public.interactions
  for update to authenticated using (true) with check (true);

create policy "interactions_delete_owner" on public.interactions
  for delete to authenticated using (public.is_owner());

-- ─── API grants ──────────────────────────────────────────────────────────────
-- Make the app work regardless of the "Automatically expose new tables" toggle.
-- Table-level grants let the API role reach the tables; the RLS policies above
-- still decide which rows each user can touch. `service_role` (import script)
-- bypasses RLS by design.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on public.profiles,
     public.organizations,
     public.contacts,
     public.interactions
  to authenticated;

grant all privileges
  on public.profiles,
     public.organizations,
     public.contacts,
     public.interactions
  to service_role;

-- Brand-new sequences used by identity columns are covered by the table grants
-- above; this line future-proofs any serial-based additions.
grant usage, select on all sequences in schema public to authenticated, service_role;
