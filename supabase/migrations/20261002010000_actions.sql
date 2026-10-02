-- Table actions: bookmarks, follow-ups, and discoverable emails.

alter table public.organizations
  add column bookmarked boolean not null default false,
  add column follow_up_on date,
  add column follow_up_note text,
  add column emails text[] not null default '{}';

create index organizations_list_bookmarked_idx
  on public.organizations (list, bookmarked)
  where bookmarked;

create index organizations_list_follow_up_idx
  on public.organizations (list, follow_up_on);
