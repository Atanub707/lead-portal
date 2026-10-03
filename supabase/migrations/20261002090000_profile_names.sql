-- Display names for attribution ("Atanu added this").
-- Any signed-in user may change their OWN display name; the role stays locked
-- behind public.my_role() so a self-update can never escalate privileges.

create or replace function public.my_role()
returns public.user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from public.profiles where id = public.clerk_user_id();
$$;

create policy "profiles_update_self_name" on public.profiles
  for update to authenticated
  using (id = public.clerk_user_id())
  with check (
    id = public.clerk_user_id()
    and role = public.my_role()
  );
