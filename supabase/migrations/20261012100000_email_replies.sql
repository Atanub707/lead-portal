-- Email replies: in-app conversations (personal per member, reply-only capture).
alter table public.sent_emails add column if not exists message_id text;
alter table public.sent_emails add column if not exists in_reply_to text;
alter table public.sent_emails add column if not exists references_ids text;

alter table public.user_email_settings
  add column if not exists imap_host text,
  add column if not exists imap_last_uid bigint,
  add column if not exists imap_uidvalidity bigint,
  add column if not exists imap_last_sync_at timestamptz,
  add column if not exists imap_last_error text;

create table if not exists public.email_threads (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id text not null,
  org_id bigint references public.organizations (id) on delete set null,
  contact_id bigint references public.contacts (id) on delete set null,
  subject_norm text not null,
  counterparty_email text not null,
  last_message_at timestamptz not null default now(),
  unread integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists email_threads_user_idx on public.email_threads (user_id, last_message_at desc);

create table if not exists public.email_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.email_threads (id) on delete cascade,
  workspace_id uuid not null,
  user_id text not null,
  direction text not null check (direction in ('out', 'in')),
  from_email text not null,
  to_email text not null,
  subject text,
  body text not null,
  message_id text not null unique,
  in_reply_to text,
  references_ids text,
  has_attachments boolean not null default false,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on public.email_messages (thread_id, sent_at);

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

create policy "email_threads_personal" on public.email_threads
  for select to authenticated using (
    user_id = public.clerk_user_id() and workspace_id = public.my_workspace()
  );
create policy "email_messages_personal" on public.email_messages
  for select to authenticated using (
    user_id = public.clerk_user_id() and workspace_id = public.my_workspace()
  );

grant select on public.email_threads, public.email_messages to authenticated;
grant all privileges on public.email_threads, public.email_messages to service_role;
