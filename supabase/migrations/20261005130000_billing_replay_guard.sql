-- Billing replay guard: remember the checkout payment that last activated the
-- plan so an old signature cannot re-activate (for free) after a lapse.
alter table public.workspaces
  add column if not exists last_verified_payment_id text;
