-- Consumed checkout payment ids (verify is single-use per payment).
create table if not exists public.checkout_verifications (
  razorpay_payment_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.checkout_verifications enable row level security;
grant all privileges on public.checkout_verifications to service_role;
