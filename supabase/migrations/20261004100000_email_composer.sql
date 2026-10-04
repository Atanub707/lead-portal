-- Email composer: pipeline pitch, per-member SMTP settings (encrypted), sent history.

alter table public.pipelines
  add column if not exists pitch text,
  add column if not exists value_props text[] not null default '{}',
  add column if not exists proof_points text[] not null default '{}',
  add column if not exists cta text,
  add column if not exists default_flavor text;

create table public.user_email_settings (
  user_id text primary key references public.profiles (id) on delete cascade,
  from_name text,
  from_email text,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean not null default true,
  smtp_user text,
  smtp_password_enc text,
  signature_phone text,
  signature_link text,
  updated_at timestamptz not null default now()
);

alter table public.user_email_settings enable row level security;

create policy "user_email_settings_select_own" on public.user_email_settings
  for select to authenticated using (user_id = public.clerk_user_id());
create policy "user_email_settings_insert_own" on public.user_email_settings
  for insert to authenticated with check (user_id = public.clerk_user_id());
create policy "user_email_settings_update_own" on public.user_email_settings
  for update to authenticated using (user_id = public.clerk_user_id())
  with check (user_id = public.clerk_user_id());

grant select, insert, update on public.user_email_settings to authenticated;
grant all privileges on public.user_email_settings to service_role;

create table public.sent_emails (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  sent_by text references public.profiles (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index sent_emails_org_idx on public.sent_emails (org_id, created_at desc);

alter table public.sent_emails enable row level security;

create policy "sent_emails_select" on public.sent_emails
  for select to authenticated using (true);

grant select on public.sent_emails to authenticated;
grant all privileges on public.sent_emails to service_role;
