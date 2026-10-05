-- Display picture: a chosen avatar preset id on profiles (null = auto-generated
-- from the user id). Purely cosmetic; used everywhere the person appears.
alter table public.profiles add column if not exists avatar text;
