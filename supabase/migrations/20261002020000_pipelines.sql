-- Pipelines become data: owners can create new sections from the sidebar.

create table public.pipelines (
  id text primary key,
  name text not null,
  icon text not null default 'layers',
  stages text[] not null default '{new,contacted,proposal,won,lost}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.pipelines (id, name, icon, stages, sort_order) values
  ('pos', 'POS Pipeline', 'store', '{new,contacted,demo,proposal,won,lost}', 0),
  ('compliance', 'Compliance Pipeline', 'shield-check', '{new,contacted,scoping,proposal,won,lost}', 1);

-- organizations.list moves from a fixed enum to a pipeline reference.
alter table public.organizations
  alter column list type text using list::text;

alter table public.organizations
  add constraint organizations_list_fkey
  foreign key (list) references public.pipelines (id);

drop type public.org_list;

alter table public.pipelines enable row level security;

create policy "pipelines_select" on public.pipelines
  for select to authenticated using (true);

create policy "pipelines_insert_owner" on public.pipelines
  for insert to authenticated with check (public.is_owner());

create policy "pipelines_update_owner" on public.pipelines
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

create policy "pipelines_delete_owner" on public.pipelines
  for delete to authenticated using (public.is_owner());

grant select, insert, update, delete on public.pipelines to authenticated;
grant all privileges on public.pipelines to service_role;
