# Razorpay Billing & Paywall — Design

**Date:** 2026-10-05 · **Status:** approved for planning
**Goal:** Turn Lead Portal into a paid product: 1-day free trial, then ₹499/month per user, auto-renewing via Razorpay. Comped workspaces (HI Labs only) never pay.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Trial | **1 day** from workspace creation (was 14 days) |
| Price | **₹499 / month / seat**, INR |
| Payer | **Owner pays for every seat**; invite requires payment first |
| Renewal | **Auto-renew** — Razorpay Subscriptions (UPI AutoPay / card e-mandate) |
| Gateway | **Razorpay** (KYC by owner; test mode until live keys) |
| Comped | **HI Labs only** (`plan='active'`, never gated, no billing UI) |
| Vyrazu Labs | Normal customer flow (grandfathered: their current trial end date stands) |

## Data model (migration `20261005120000_billing.sql`)

`workspaces` additions:
- `plan` — `'trial' | 'active' | 'paid'` (default `'trial'`; `'active'` = comped)
- `seats` — int not null default 1 (paid seats; bill = seats × ₹499)
- `razorpay_subscription_id` — text null
- `subscription_status` — text null (mirrors Razorpay: created / authenticated / active / pending / halted / cancelled / completed / expired)
- `current_period_end` — timestamptz null

New `payments` table:
- `id` bigint identity pk · `workspace_id` uuid ref workspaces
- `razorpay_payment_id` text **unique** (idempotency) · `razorpay_order_id` text null · `razorpay_subscription_id` text null
- `kind` text — `'subscription' | 'seat'`
- `amount_paise` int · `currency` text default `'INR'` · `status` text
- `seats` int null (seat count after this payment) · `created_by` text null · `raw` jsonb
- RLS: workspace members read; **service role only** writes.

Entitlement — single rule, implemented twice (app helper + SQL backstop):
```
entitled = plan = 'active'
        OR (plan = 'trial' AND trial_ends_at > now())
        OR (plan = 'paid'  AND subscription_status = 'active' AND current_period_end > now())
```
- SQL: new `workspace_entitled(ws uuid)` replaces `trial_active()` in write policies.
- App: `getWorkspaceContext()` returns `entitled` (used by the layout gate + UI).

Onboarding change: `trial_ends_at = now + 1 day` (single constant).

## Flows

1. **Signup → onboarding** → workspace `plan='trial'`, `trial_ends_at=+1d`, `seats=1`. App usable immediately.
2. **Trial ends** → `(app)/layout` gate: `if (!entitled) redirect('/billing')`. `/billing` renders outside the gated layout (minimal chrome): owner sees Subscribe; members see "Ask your workspace owner to activate".
3. **Subscribe** → `/billing` → `POST /api/billing/subscribe` creates a Razorpay Subscription (plan_id, quantity=seats, total_count=120, customer_notify) → Razorpay Checkout → `POST /api/billing/verify` checks the checkout signature → optimistic unlock (`plan='paid'`, status active, period end +30d) → webhook confirms and extends.
4. **Webhooks** — `POST /api/billing/webhook`, raw-body HMAC SHA256 with `RAZORPAY_WEBHOOK_SECRET`:
   - `subscription.activated` / `subscription.charged` → status `active`, `current_period_end` from payload, `plan='paid'`, record payment
   - `subscription.pending` / `halted` → status mirrored (gate applies only once period ends)
   - `subscription.cancelled` / `completed` → mirrored; access runs to `current_period_end`
   - `payment.captured` → record payment (unique payment id)
5. **Seat add** — invite when `profiles.count >= seats`: `inviteUser` returns `seat_required` → UI opens "Add a seat — ₹499/month" dialog → `POST /api/billing/seat` (one-time ₹499 order) → Checkout → `seat/verify` → `seats += 1`, record payment, then the invite proceeds. Subscription quantity +1 (fire-and-forget, logged on failure).
6. **Cancel** — `/billing` → server action → Razorpay cancel at cycle end; access continues to `current_period_end`.
7. **Receipts** — `/billing` lists `payments`.

## Razorpay integration

- No SDK: REST via `fetch` to `api.razorpay.com/v1` (basic auth key_id:key_secret); signature checks with `node:crypto` HMAC.
- Envs: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
- Routes: `POST /api/billing/subscribe`, `POST /api/billing/verify`, `POST /api/billing/seat`, `POST /api/billing/seat/verify`, `POST /api/billing/webhook`; cancel via server action.
- Checkout: `checkout.razorpay.com/v1/checkout.js` client-side; `subscription_id` (subscribe) or `order_id` (seat).

## UI

- **`/billing`** (outside the gated layout, minimal chrome): paywall for expired workspaces; manage view when entitled (plan, seats, renewal date, receipts, cancel).
- **(app)/layout gate** — the single enforcement point; redirect to `/billing`.
- **TrialBanner** — copy updated for a 1-day trial ("Trial: ends today").
- **Settings → General** — owner-only Billing card (plan · seats · renewal) with "Manage billing →" link.
- **Members** — add-seat dialog when inviting beyond paid seats.

## Anti-abuse (multiple accounts)

1-day trial is the main lever; one workspace per account (already); Clerk email verification (already). Later hardening (not in this scope): disposable-domain blocking, phone verification, payment-instrument dedupe.

## Testing

- Razorpay **test mode**; E2E harness drives gates via service-key DB edits + **signed webhook posts** (no manual checkout needed for logic):
  - trial expiry → redirect to `/billing` (owner) / member message
  - subscribe → unlock; webhook charge extends period; webhook idempotency
  - seat gate: invite blocked at seats=1 → after seat payment → invite works
  - cancel → entitled until period end → gate after
  - HI Labs (comped) never gated, no billing card
- Manual smoke: real test-mode Checkout once with a test UPI/card.

## Out of scope v1

GST invoices / tax details, coupons, annual plans, dunning emails, Clerk production switch (deferred), BYO-Supabase.

## Owner setup checklist (when going live)

1. Razorpay account + KYC
2. Create Plan: ₹499/month (monthly interval) → note `plan_id`
3. API keys + webhook URL (`/api/billing/webhook`) + secret
4. Hand me test keys first → I build + verify → then swap to live keys in Vercel
