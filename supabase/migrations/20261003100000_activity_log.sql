-- Owner-only activity trail: who did what, when.
create table public.activity_log (
  id bigint generated always as identity primary key,
  actor_id text,
  action text not null,
  org_id bigint references public.organizations (id) on delete set null,
  target_type text,
  target_id text,
  summary text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_created_idx on public.activity_log (created_at desc);
create index activity_log_actor_idx on public.activity_log (actor_id, created_at desc);
create index activity_log_org_idx on public.activity_log (org_id, created_at desc);

alter table public.activity_log enable row level security;

create policy "activity_log_select_owner" on public.activity_log
  for select to authenticated using (public.is_owner());

grant select on public.activity_log to authenticated;
grant all privileges on public.activity_log to service_role;
