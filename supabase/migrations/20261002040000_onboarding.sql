-- Onboarding gate: invited users must finish the welcome screen before entering the app.
-- Existing accounts are treated as onboarded; new invites default to false.

alter table public.profiles add column onboarded boolean not null default true;
alter table public.profiles alter column onboarded set default false;
