-- Auth moves from Supabase Auth to Clerk.
-- profiles.id becomes the Clerk user id (text). Old Supabase-Auth identities are
-- replaced by Clerk identities: existing profile rows are removed and re-created
-- on first Clerk login (the first profile ever becomes owner again).

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.organizations drop constraint if exists organizations_created_by_fkey;
alter table public.interactions drop constraint if exists interactions_logged_by_fkey;

alter table public.profiles alter column id type text;
alter table public.organizations alter column created_by type text;
alter table public.interactions alter column logged_by type text;

alter table public.organizations
  add constraint organizations_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.interactions
  add constraint interactions_logged_by_fkey
  foreign key (logged_by) references public.profiles (id) on delete set null;

delete from public.profiles;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

alter table public.profiles drop column if exists onboarded;

-- Identity helpers read the Clerk session JWT (third-party auth) instead of auth.uid().
create or replace function public.clerk_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

create or replace function public.is_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = public.clerk_user_id() and role = 'owner'
  );
$$;
