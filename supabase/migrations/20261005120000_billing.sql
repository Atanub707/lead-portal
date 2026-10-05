-- Billing: seat-based subscriptions (Razorpay).
-- Entitlement = comped OR trial running OR paid subscription active.

alter table public.workspaces
  add column if not exists seats int not null default 1,
  add column if not exists razorpay_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  razorpay_payment_id text not null unique,
  razorpay_order_id text,
  razorpay_subscription_id text,
  kind text not null default 'subscription',
  amount_paise integer not null,
  currency text not null default 'INR',
  status text not null,
  seats integer,
  created_by text,
  raw jsonb,
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;
grant select on public.payments to authenticated;
grant all privileges on public.payments to service_role;

drop policy if exists "payments_select" on public.payments;
create policy "payments_select" on public.payments
  for select to authenticated using (
    workspace_id = public.my_workspace() or public.is_super_admin()
  );

-- Single source of truth for the paywall.
create or replace function public.workspace_entitled(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = ws and (
      w.plan = 'active'
      or (w.plan = 'trial' and (w.trial_ends_at is null or w.trial_ends_at > now()))
      or (
        w.plan = 'paid'
        and w.subscription_status = 'active'
        and w.current_period_end is not null
        and w.current_period_end > now()
      )
    )
  );
$$;

grant execute on function public.workspace_entitled to authenticated;

-- Every existing write policy calls trial_active(); redefine it so the RLS
-- backstop matches the new entitlement rule without touching each policy.
create or replace function public.trial_active(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.workspace_entitled(ws);
$$;
