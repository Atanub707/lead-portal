# Razorpay Billing & Paywall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1-day free trial, then ₹499/month per seat via Razorpay auto-renewing subscriptions; owner pays all seats; HI Labs comped forever.

**Architecture:** Entitlement is one rule implemented twice — a TypeScript helper (`entitled` in `getWorkspaceContext`) for the app gate, and a SQL function (`workspace_entitled`) as the RLS backstop. Razorpay is called via REST (`fetch` + Basic auth), signatures verified with `node:crypto` HMAC (no SDK). Payments/state live in `workspaces` billing columns + a `payments` table. The app gate lives in `(app)/layout.tsx`; `/billing` renders outside the gated layout.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres + RLS), Clerk, Razorpay Checkout (client script) + REST API, Playwright harness for E2E (existing pattern).

## Global Constraints

- Price: **₹499/month per seat** = `PRICE_PAISE = 49_900`; currency `INR`. Never hardcode the price anywhere else.
- Trial: **1 day** from workspace creation (`86_400_000` ms).
- Comped: `plan = 'active'` (only HI Labs) — never gated, no billing UI.
- Entitlement (verbatim, both languages):
  `plan='active' OR (plan='trial' AND trial_ends_at > now()) OR (plan='paid' AND subscription_status='active' AND current_period_end > now())`
- Owner-only for subscribe/cancel/seat actions. Members see "ask your workspace owner".
- No new npm dependencies (REST + crypto only).
- Razorpay env names: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
- All user-facing copy in sentence case, no vendor jargon ("Billing", "Subscribe", "Add a seat").
- Every task ends with `npm run lint && npm run build` passing and a commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261005120000_billing.sql` | New columns, `payments` table + RLS, `workspace_entitled()`, redefine `trial_active()` |
| `src/lib/billing.ts` | Pricing constants, Razorpay REST calls, signature verification |
| `src/lib/checkout.ts` | Client helper: load Razorpay Checkout script |
| `src/lib/types.ts` | `Workspace` billing fields |
| `src/lib/data.ts` | `getWorkspaceContext().entitled`, `getBillingOverview()` |
| `src/lib/actions.ts` | 1-day trial, seat check in `inviteUser`, `cancelBilling` action |
| `src/app/api/billing/subscribe/route.ts` | Create subscription |
| `src/app/api/billing/verify/route.ts` | Verify checkout signature → unlock |
| `src/app/api/billing/webhook/route.ts` | Razorpay webhooks → state + payments |
| `src/app/api/billing/seat/route.ts` | Create ₹499 order |
| `src/app/api/billing/seat/verify/route.ts` | Verify order signature → seats+1 |
| `src/app/billing/page.tsx` | Billing page (outside gated layout) |
| `src/components/billing-panel.tsx` | Client: subscribe / manage / receipts / cancel |
| `src/components/add-seat-dialog.tsx` | Client: pay for a seat |
| `src/components/invite-form.tsx` | Seat-required → AddSeatDialog → retry invite |
| `src/app/(app)/layout.tsx` | Entitlement gate → redirect `/billing` |
| `src/app/(app)/settings/page.tsx` | Owner billing card |
| `src/components/trial-banner.tsx` | 1-day copy |
| `src/proxy.ts` | Webhook public route |

---

### Task 1: Migration + entitlement foundation

**Files:**
- Create: `supabase/migrations/20261005120000_billing.sql`
- Modify: `src/lib/types.ts` (Workspace interface, ~line 241)
- Modify: `src/lib/data.ts` (`getWorkspaceContext`, ~lines 606-650)
- Modify: `src/lib/actions.ts` (`createWorkspace`, line ~654)
- Modify: `src/components/trial-banner.tsx`
- Test: apply migration + SQL probes via Management API

**Interfaces:**
- Produces: `workspace_entitled(ws uuid) → boolean` (SQL); `Workspace.seats: number`, `Workspace.subscription_status: string | null`, `Workspace.current_period_end: string | null`; `getWorkspaceContext()` return gains `entitled: boolean`.

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply the migration via the Management API**

```bash
node -e '
const fs = require("fs");
(async () => {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error("Set SUPABASE_ACCESS_TOKEN (sbp_…)"); process.exit(1); }
  const sql = fs.readFileSync("supabase/migrations/20261005120000_billing.sql", "utf8");
  const res = await fetch("https://api.supabase.com/v1/projects/goxbvyrmzrhiegpqjere/database/query", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  console.log("apply:", res.status, (await res.text()).slice(0, 200));
  const rec = await fetch("https://api.supabase.com/v1/projects/goxbvyrmzrhiegpqjere/database/query", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "insert into supabase_migrations.schema_migrations (version, name) values (\x2720261005120000\x27, \x27billing\x27) on conflict (version) do nothing;" }),
  });
  console.log("record:", rec.status);
})();'
```

Expected: `apply: 201` and `record: 201`.

- [ ] **Step 3: Verify entitlement SQL**

```bash
node -e '
const fs = require("fs");
(async () => {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const q = async (query) => (await (await fetch("https://api.supabase.com/v1/projects/goxbvyrmzrhiegpqjere/database/query", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  })).json());
  console.log("HI Labs entitled (expect true):", JSON.stringify(await q("select public.workspace_entitled(\x2700000000-0000-4000-8000-000000000001\x27) as e;")));
  console.log("Vyrazu entitled (expect true, trial):", JSON.stringify(await q("select public.workspace_entitled(id) as e from workspaces where name=\x27Vyrazu Labs\x27;")));
  console.log("columns:", JSON.stringify(await q("select column_name from information_schema.columns where table_name=\x27workspaces\x27 and column_name in (\x27seats\x27,\x27razorpay_subscription_id\x27,\x27subscription_status\x27,\x27current_period_end\x27);")));
})();'
```

Expected: HI Labs `true`, Vyrazu `true`, 4 columns listed.

- [ ] **Step 4: Extend `Workspace` in types.ts**

```ts
export interface Workspace {
  id: string;
  name: string;
  plan: string;
  trial_ends_at: string | null;
  created_at: string;
  seats: number;
  subscription_status: string | null;
  current_period_end: string | null;
}
```

- [ ] **Step 5: Extend `getWorkspaceContext` in data.ts**

Replace the workspace select and computed flags:

```ts
    const { data } = await supabase
      .from("workspaces")
      .select(
        "id, name, plan, trial_ends_at, created_at, seats, subscription_status, current_period_end"
      )
      .eq("id", profile.workspace_id)
      .maybeSingle();
    workspace = (data as Workspace | null) ?? null;
  }

  const trialOk =
    !!workspace &&
    workspace.plan === "trial" &&
    workspace.trial_ends_at !== null &&
    new Date(workspace.trial_ends_at) > new Date();

  const entitled =
    !!workspace &&
    (workspace.plan === "active" ||
      trialOk ||
      (workspace.plan === "paid" &&
        workspace.subscription_status === "active" &&
        workspace.current_period_end !== null &&
        new Date(workspace.current_period_end) > new Date()));

  const trialDaysLeft =
    workspace?.trial_ends_at && workspace.plan === "trial"
      ? Math.ceil(
          (new Date(workspace.trial_ends_at).getTime() - Date.now()) / 86_400_000
        )
      : null;
  const trialEnded = !!workspace && workspace.plan === "trial" && !trialOk;

  return {
    profile,
    workspace,
    isSuperAdmin: profile.is_super_admin,
    canWrite: entitled,
    entitled,
    trialDaysLeft,
    trialEnded,
  };
```

Update the function's return type annotation to add `entitled: boolean;`.

- [ ] **Step 6: 1-day trial in `createWorkspace` (actions.ts)**

```ts
  const trialEndsAt = new Date(Date.now() + 86_400_000).toISOString();
```

(Only the constant changes: `14 * 86_400_000` → `86_400_000`.)

- [ ] **Step 7: Trial banner copy (trial-banner.tsx)**

Change `"Trial: last day"` → `"Trial: ends today"` and keep the rest.

- [ ] **Step 8: Lint + build + commit**

```bash
npm run lint && npm run build
git add supabase/migrations/20261005120000_billing.sql src/lib/types.ts src/lib/data.ts src/lib/actions.ts src/components/trial-banner.tsx
git commit -m "feat(billing): entitlement foundation — workspace billing fields, payments table, workspace_entitled RLS, 1-day trial"
```

---

### Task 2: Billing library (Razorpay REST + signatures)

**Files:**
- Create: `src/lib/billing.ts`
- Create: `src/lib/checkout.ts`

**Interfaces:**
- Produces: `PRICE_PAISE`, `CURRENCY`, `razorpayConfigured()`, `createSubscription({seats})`, `createSeatOrder({workspaceId, seats})`, `cancelSubscription(id)`, `updateSubscriptionQuantity(id, quantity)`, `verifyCheckoutSignature({paymentId, subscriptionId?, orderId?, signature})`, `verifyWebhookSignature(rawBody, signature)`, `loadRazorpayCheckout()`.

- [ ] **Step 1: Write `src/lib/billing.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const PRICE_PAISE = 49_900; // ₹499
export const CURRENCY = "INR";
export const PLAN_TOTAL_COUNT = 120; // 10 years of monthly cycles

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function razorpayConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      process.env.RAZORPAY_PLAN_ID
  );
}

async function razorpayFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const auth = Buffer.from(
    `${env("RAZORPAY_KEY_ID")}:${env("RAZORPAY_KEY_SECRET")}`
  ).toString("base64");
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { description?: string } })
    | null;
  if (!response.ok) {
    throw new Error(
      json?.error?.description ?? `Razorpay ${path} failed (${response.status})`
    );
  }
  return json as T;
}

export function createSubscription(input: {
  seats: number;
  workspaceId: string;
}) {
  return razorpayFetch<{ id: string; status: string }>("subscriptions", {
    method: "POST",
    body: {
      plan_id: env("RAZORPAY_PLAN_ID"),
      quantity: input.seats,
      total_count: PLAN_TOTAL_COUNT,
      customer_notify: 1,
      notes: { workspace_id: input.workspaceId },
    },
  });
}

export function createSeatOrder(input: { workspaceId: string; seats: number }) {
  return razorpayFetch<{ id: string; amount: number; currency: string }>(
    "orders",
    {
      method: "POST",
      body: {
        amount: PRICE_PAISE,
        currency: CURRENCY,
        notes: {
          kind: "seat",
          workspace_id: input.workspaceId,
          seats_after: String(input.seats),
        },
      },
    }
  );
}

export function cancelSubscription(subscriptionId: string) {
  return razorpayFetch<{ id: string; status: string }>(
    `subscriptions/${subscriptionId}/cancel`,
    { method: "POST", body: { cancel_at_cycle_end: 1 } }
  );
}

export function updateSubscriptionQuantity(
  subscriptionId: string,
  quantity: number
) {
  return razorpayFetch(`subscriptions/${subscriptionId}`, {
    method: "PATCH",
    body: { quantity },
  });
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// Checkout handler: subscriptions sign "payment_id|subscription_id",
// orders sign "order_id|payment_id".
export function verifyCheckoutSignature(input: {
  paymentId: string;
  subscriptionId?: string | null;
  orderId?: string | null;
  signature: string;
}): boolean {
  const payload = input.subscriptionId
    ? `${input.paymentId}|${input.subscriptionId}`
    : `${input.orderId}|${input.paymentId}`;
  const expected = createHmac("sha256", env("RAZORPAY_KEY_SECRET"))
    .update(payload)
    .digest("hex");
  return safeEqual(expected, input.signature);
}

export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const expected = createHmac("sha256", env("RAZORPAY_WEBHOOK_SECRET"))
    .update(rawBody)
    .digest("hex");
  return safeEqual(expected, signature);
}
```

- [ ] **Step 2: Write `src/lib/checkout.ts`**

```ts
"use client";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function loadRazorpayCheckout(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}
```

- [ ] **Step 3: Lint + build + commit**

```bash
npm run lint && npm run build
git add src/lib/billing.ts src/lib/checkout.ts
git commit -m "feat(billing): Razorpay REST client, checkout signatures, webhook verification"
```

---

### Task 3: Billing page, gate, settings card

**Files:**
- Create: `src/app/billing/page.tsx`
- Create: `src/components/billing-panel.tsx`
- Modify: `src/lib/data.ts` (add `getBillingOverview`)
- Modify: `src/app/(app)/layout.tsx` (gate after onboarding check)
- Modify: `src/app/(app)/settings/page.tsx` (owner billing card)

**Interfaces:**
- Consumes: `entitled`, `PRICE_PAISE`, `razorpayConfigured()`.
- Produces: `/billing` route; `getBillingOverview(): Promise<BillingOverview | null>` where `BillingOverview = { workspace: Workspace; isOwner: boolean; memberCount: number; payments: { id: number; amount_paise: number; kind: string; status: string; created_at: string; razorpay_payment_id: string }[] }`.

- [ ] **Step 1: Add `getBillingOverview` to data.ts**

```ts
export interface BillingOverview {
  workspace: Workspace;
  isOwner: boolean;
  memberCount: number;
  payments: {
    id: number;
    amount_paise: number;
    kind: string;
    status: string;
    created_at: string;
    razorpay_payment_id: string;
  }[];
}

export async function getBillingOverview(): Promise<BillingOverview | null> {
  const profile = await getCurrentProfile();
  if (!profile?.workspace_id) return null;
  const supabase = await createClient();
  const [{ data: workspace }, { count }, { data: payments }] = await Promise.all([
    supabase
      .from("workspaces")
      .select(
        "id, name, plan, trial_ends_at, created_at, seats, subscription_status, current_period_end"
      )
      .eq("id", profile.workspace_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id),
    supabase
      .from("payments")
      .select("id, amount_paise, kind, status, created_at, razorpay_payment_id")
      .eq("workspace_id", profile.workspace_id)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);
  if (!workspace) return null;
  return {
    workspace: workspace as Workspace,
    isOwner: profile.role === "owner",
    memberCount: count ?? 1,
    payments: payments ?? [],
  };
}
```

- [ ] **Step 2: Write `src/app/billing/page.tsx`**

```tsx
import Link from "next/link";
import { getBillingOverview } from "@/lib/data";
import { BillingPanel } from "@/components/billing-panel";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const overview = await getBillingOverview();

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#F7F7F8] px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold tracking-tight text-zinc-900">
            Lead Portal
          </p>
          <Link
            href="/dashboard"
            className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-800"
          >
            Back to app →
          </Link>
        </div>
        <div className="mt-6">
          <BillingPanel overview={overview} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/billing-panel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import type { BillingOverview } from "@/lib/data";
import { PRICE_PAISE } from "@/lib/billing";
import { loadRazorpayCheckout } from "@/lib/checkout";

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function BillingPanel({ overview }: { overview: BillingOverview | null }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [posting, startPosting] = useTransition();

  if (!overview) {
    return (
      <section className="card p-5">
        <p className="text-[13px] text-zinc-600">No workspace found for this account.</p>
      </section>
    );
  }

  const { workspace, isOwner, memberCount, payments } = overview;
  const entitled =
    workspace.plan === "active" ||
    (workspace.plan === "paid" &&
      workspace.subscription_status === "active" &&
      workspace.current_period_end !== null &&
      new Date(workspace.current_period_end) > new Date()) ||
    (workspace.plan === "trial" &&
      workspace.trial_ends_at !== null &&
      new Date(workspace.trial_ends_at) > new Date());

  async function subscribe() {
    setError("");
    startPosting(async () => {
      try {
        const res = await fetch("/api/billing/subscribe", { method: "POST" });
        const data = (await res.json()) as {
          keyId?: string;
          subscriptionId?: string;
          error?: string;
        };
        if (!data.subscriptionId || !data.keyId) {
          setError(data.error ?? "Couldn't start checkout.");
          return;
        }
        const loaded = await loadRazorpayCheckout();
        if (!loaded || !window.Razorpay) {
          setError("Couldn't load the payment window. Check your connection.");
          return;
        }
        const rzp = new window.Razorpay({
          key: data.keyId,
          subscription_id: data.subscriptionId,
          name: "Lead Portal",
          description: `Monthly plan — ${rupees(PRICE_PAISE)}/month`,
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_subscription_id: string;
            razorpay_signature: string;
          }) => {
            const verify = await fetch("/api/billing/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = (await verify.json()) as { ok?: boolean; error?: string };
            if (result.ok) router.refresh();
            else setError(result.error ?? "Payment verification failed.");
          },
        });
        rzp.open();
      } catch {
        setError("Couldn't start checkout. Try again.");
      }
    });
  }

  function cancel() {
    setError("");
    startPosting(async () => {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) router.refresh();
      else setError(data.error ?? "Couldn't cancel right now.");
    });
  }

  if (workspace.plan === "active") {
    return (
      <section className="card p-5">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Billing
        </h1>
        <p className="mt-1 text-[13px] text-zinc-600">
          This workspace is comped — no billing needed.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          {entitled ? "Billing" : "Your trial has ended"}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
          {entitled
            ? `You're on the monthly plan — ${rupees(PRICE_PAISE)} per user per month.`
            : `Subscribe to keep using Lead Portal — ${rupees(PRICE_PAISE)} per user per month.`}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Seats</dt>
            <dd className="mt-0.5 text-[13px] text-zinc-800 tabular-nums">
              {memberCount} of {workspace.seats} used
            </dd>
          </div>
          {workspace.current_period_end ? (
            <div>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Renews</dt>
              <dd className="mt-0.5 text-[13px] text-zinc-800 tabular-nums">
                {workspace.current_period_end.slice(0, 10)}
              </dd>
            </div>
          ) : null}
        </dl>

        {!isOwner ? (
          <p className="mt-4 text-[12px] text-zinc-500">
            Ask your workspace owner to activate the plan.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {entitled ? (
              <button type="button" onClick={cancel} disabled={posting} className="btn-ghost">
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Cancel subscription
              </button>
            ) : (
              <button type="button" onClick={subscribe} disabled={posting} className="btn-primary">
                {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Subscribe — {rupees(PRICE_PAISE)}/month
              </button>
            )}
          </div>
        )}
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-700">
            {error}
          </p>
        ) : null}
      </section>

      {payments.length > 0 ? (
        <section className="card overflow-hidden">
          <p className="border-b border-zinc-100 px-5 py-3 text-[13px] font-semibold text-zinc-900">
            Receipts
          </p>
          <ul className="divide-y divide-zinc-100">
            {payments.map((payment) => (
              <li key={payment.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-[12px] text-zinc-500 tabular-nums">
                  {payment.created_at.slice(0, 10)}
                  <span className="mx-1.5 text-zinc-300">·</span>
                  {payment.kind === "seat" ? "Seat" : "Subscription"}
                </span>
                <span className="flex items-center gap-1.5 text-[13px] text-zinc-800 tabular-nums">
                  <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  {rupees(payment.amount_paise)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
```

Note: cancel calls the route directly (Task 6 creates it); no server action needed.

- [ ] **Step 4: Gate in `(app)/layout.tsx`**

After the onboarding redirect block and before building the Shell, add:

```ts
  const [pipelines, context] = await Promise.all([
    getPipelines(),
    getWorkspaceContext(),
  ]);

  // Paywall: an expired trial / lapsed subscription blocks the app.
  if (context && !context.entitled) {
    redirect("/billing");
  }
```

(The existing `Promise.all` already fetches both — this only adds the check after it.)

- [ ] **Step 5: Owner billing card in Settings → General**

Inside the workspace card (after the trial description paragraph), add for owners:

```tsx
          {profile?.role === "owner" ? (
            <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3">
              <p className="text-[12px] text-zinc-500">
                {workspaceCtx.workspace.plan === "active"
                  ? "Comped — no billing."
                  : `${workspaceCtx.workspace.seats} seat${
                      workspaceCtx.workspace.seats === 1 ? "" : "s"
                    } · ₹499/month`}
              </p>
              <Link
                href="/billing"
                className="text-[12px] font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
              >
                Manage billing →
              </Link>
            </div>
          ) : null}
```

(Add `import Link from "next/link";` at the top of the settings page.)

- [ ] **Step 6: Lint + build + deploy + verify gate**

```bash
npm run lint && npm run build
git add -A && git commit -m "feat(billing): /billing page, entitlement gate, owner billing card" && git push
```

E2E (harness pattern; base = `https://lead-portal-9siz.vercel.app`):
1. HI Labs test user → `/dashboard` loads (never redirected to `/billing`).
2. Create a test workspace via service key with `plan='trial', trial_ends_at=now()-1h`; test user in it → visiting `/dashboard` lands on `/billing`, body contains "Your trial has ended"; the user is an owner → sees "Subscribe — ₹499/month".
3. Same workspace, editor user → `/billing` shows "Ask your workspace owner to activate the plan."
4. Clean up test users/workspace.

---

### Task 4: Subscribe flow + webhooks

**Files:**
- Create: `src/app/api/billing/subscribe/route.ts`
- Create: `src/app/api/billing/verify/route.ts`
- Create: `src/app/api/billing/webhook/route.ts`
- Modify: `src/proxy.ts` (webhook public)

**Interfaces:**
- Consumes: `createSubscription`, `verifyCheckoutSignature`, `verifyWebhookSignature`, `PRICE_PAISE`.
- Produces: workspace state transitions (`plan='paid'`, `subscription_status`, `current_period_end`) + `payments` rows.

- [ ] **Step 1: `subscribe` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSubscription, razorpayConfigured } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!razorpayConfigured()) {
    return NextResponse.json(
      { error: "Billing isn't configured yet — add your Razorpay keys." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner" || !me.workspace_id) {
    return NextResponse.json({ error: "Only the owner can subscribe" }, { status: 403 });
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, seats, plan, subscription_status")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (!workspace) {
    return NextResponse.json({ error: "No workspace" }, { status: 400 });
  }
  if (workspace.plan === "paid" && workspace.subscription_status === "active") {
    return NextResponse.json({ error: "This workspace is already subscribed." }, { status: 409 });
  }

  try {
    const subscription = await createSubscription({
      seats: workspace.seats ?? 1,
      workspaceId: workspace.id,
    });
    await supabase
      .from("workspaces")
      .update({
        razorpay_subscription_id: subscription.id,
        subscription_status: subscription.status ?? "created",
      })
      .eq("id", workspace.id);
    return NextResponse.json({
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID,
      subscriptionId: subscription.id,
    });
  } catch (err) {
    console.error("[billing] subscribe failed:", err);
    return NextResponse.json({ error: "Couldn't start checkout. Try again." }, { status: 502 });
  }
}
```

- [ ] **Step 2: `verify` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { verifyCheckoutSignature } from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    razorpay_payment_id?: string;
    razorpay_subscription_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };
  if (!body.razorpay_payment_id || !body.razorpay_signature) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }
  const valid = verifyCheckoutSignature({
    paymentId: body.razorpay_payment_id,
    subscriptionId: body.razorpay_subscription_id ?? null,
    orderId: body.razorpay_order_id ?? null,
    signature: body.razorpay_signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Signature check failed" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner" || !me.workspace_id) {
    return NextResponse.json({ error: "Only the owner can subscribe" }, { status: 403 });
  }

  const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const { error } = await supabase
    .from("workspaces")
    .update({
      plan: "paid",
      subscription_status: "active",
      current_period_end: periodEnd,
    })
    .eq("id", me.workspace_id);
  if (error) {
    return NextResponse.json({ error: "Couldn't activate the plan" }, { status: 500 });
  }

  await logActivity({
    actorId: userId,
    action: "billing.subscribe",
    targetType: "workspace",
    targetId: me.workspace_id,
    summary: "Subscribed to the monthly plan",
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `webhook` route**

```ts
import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface RazorpayWebhook {
  event?: string;
  payload?: {
    subscription?: { entity?: { id?: string; status?: string; current_end?: number; quantity?: number } };
    payment?: { entity?: { id?: string; amount?: number; currency?: string; status?: string; order_id?: string; subscription_id?: string; notes?: Record<string, string> } };
  };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as RazorpayWebhook;
  const admin = createAdminClient();
  const subscription = event.payload?.subscription?.entity;
  const payment = event.payload?.payment?.entity;

  try {
    if (subscription?.id) {
      const { data: workspace } = await admin
        .from("workspaces")
        .select("id")
        .eq("razorpay_subscription_id", subscription.id)
        .maybeSingle();
      if (workspace) {
        const patch: Record<string, unknown> = {
          subscription_status: subscription.status ?? undefined,
        };
        if (
          (event.event === "subscription.activated" ||
            event.event === "subscription.charged") &&
          subscription.current_end
        ) {
          patch.plan = "paid";
          patch.subscription_status = "active";
          patch.current_period_end = new Date(subscription.current_end * 1000).toISOString();
          if (typeof subscription.quantity === "number") patch.seats = subscription.quantity;
        }
        await admin.from("workspaces").update(patch).eq("id", workspace.id);
      }
    }

    if (payment?.id) {
      const { data: workspace } = payment.subscription_id
        ? await admin
            .from("workspaces")
            .select("id, seats")
            .eq("razorpay_subscription_id", payment.subscription_id)
            .maybeSingle()
        : { data: null };
      const workspaceId =
        workspace?.id ?? (payment.notes?.workspace_id as string | undefined);
      if (workspaceId) {
        await admin.from("payments").upsert(
          {
            workspace_id: workspaceId,
            razorpay_payment_id: payment.id,
            razorpay_order_id: payment.order_id ?? null,
            razorpay_subscription_id: payment.subscription_id ?? null,
            kind: payment.notes?.kind === "seat" ? "seat" : "subscription",
            amount_paise: payment.amount ?? 0,
            currency: payment.currency ?? "INR",
            status: payment.status ?? "captured",
            seats: workspace?.seats ?? null,
            raw: event as unknown as Record<string, unknown>,
          },
          { onConflict: "razorpay_payment_id", ignoreDuplicates: true }
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[billing] webhook failed:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Make the webhook public in `src/proxy.ts`**

```ts
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/billing/webhook",
]);
```

- [ ] **Step 5: Lint + build + commit + deploy**

```bash
npm run lint && npm run build
git add -A && git commit -m "feat(billing): subscribe + verify + Razorpay webhooks" && git push
```

- [ ] **Step 6: E2E — signed webhook drives entitlement**

Set `RAZORPAY_WEBHOOK_SECRET` in Vercel (test value) first. Harness script:

```js
import { createHmac } from "node:crypto";
const base = "https://lead-portal-9siz.vercel.app";
const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

async function post(event) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const res = await fetch(base + "/api/billing/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": signature },
    body,
  });
  return res.status;
}

// 1. Prepare: test workspace with plan='paid', subscription id 'sub_test1', period past
//    (service key) → expect gate.
// 2. POST subscription.charged with current_end = now+30d → workspace entitled again.
// 3. POST same payment.captured twice → exactly one payments row (idempotent).
// 4. POST subscription.halted + set period past → gate again.
// 5. Bad signature → 401.
```

Expected: all assertions pass; payments row count 1 for the test payment id.

---

### Task 5: Seat add flow

**Files:**
- Modify: `src/lib/actions.ts` (`InviteResult` + seat check in `inviteUser`)
- Create: `src/app/api/billing/seat/route.ts`
- Create: `src/app/api/billing/seat/verify/route.ts`
- Create: `src/components/add-seat-dialog.tsx`
- Modify: `src/components/invite-form.tsx`

**Interfaces:**
- Produces: `InviteResult.code?: "seat_required"`; seats increment; `payments` row `kind='seat'`.

- [ ] **Step 1: Extend `InviteResult` and add the seat check**

```ts
export interface InviteResult {
  ok: boolean;
  emailed?: boolean;
  link?: string;
  error?: string;
  code?: "seat_required";
}
```

In `inviteUser`, after `const workspaceId = await requireWorkspaceId();`:

```ts
  const [{ count: memberCount }, { data: seatRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase.from("workspaces").select("seats").eq("id", workspaceId).maybeSingle(),
  ]);
  const seats = (seatRow as { seats: number } | null)?.seats ?? 1;
  if ((memberCount ?? 0) >= seats) {
    return {
      ok: false,
      error: "Seats are full — add a seat to invite more people.",
      code: "seat_required",
    };
  }
```

- [ ] **Step 2: `seat` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createSeatOrder, razorpayConfigured } from "@/lib/billing";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  }
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner" || !me.workspace_id) {
    return NextResponse.json({ error: "Only the owner can add seats" }, { status: 403 });
  }
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, seats")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  try {
    const order = await createSeatOrder({
      workspaceId: workspace.id,
      seats: (workspace.seats ?? 1) + 1,
    });
    return NextResponse.json({
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
    });
  } catch (err) {
    console.error("[billing] seat order failed:", err);
    return NextResponse.json({ error: "Couldn't start the payment." }, { status: 502 });
  }
}
```

- [ ] **Step 3: `seat/verify` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  PRICE_PAISE,
  updateSubscriptionQuantity,
  verifyCheckoutSignature,
} from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as {
    razorpay_payment_id?: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };
  if (!body.razorpay_payment_id || !body.razorpay_order_id || !body.razorpay_signature) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }
  const valid = verifyCheckoutSignature({
    paymentId: body.razorpay_payment_id,
    orderId: body.razorpay_order_id,
    signature: body.razorpay_signature,
  });
  if (!valid) return NextResponse.json({ error: "Signature check failed" }, { status: 400 });

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner" || !me.workspace_id) {
    return NextResponse.json({ error: "Only the owner can add seats" }, { status: 403 });
  }
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, seats, razorpay_subscription_id")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const newSeats = (workspace.seats ?? 1) + 1;
  const { error } = await supabase
    .from("workspaces")
    .update({ seats: newSeats })
    .eq("id", workspace.id);
  if (error) return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });

  if (workspace.razorpay_subscription_id) {
    updateSubscriptionQuantity(workspace.razorpay_subscription_id, newSeats).catch(
      (err) => console.error("[billing] quantity update failed:", err)
    );
  }

  await supabase.from("payments").upsert(
    {
      workspace_id: workspace.id,
      razorpay_payment_id: body.razorpay_payment_id,
      razorpay_order_id: body.razorpay_order_id,
      kind: "seat",
      amount_paise: PRICE_PAISE,
      currency: "INR",
      status: "captured",
      seats: newSeats,
      created_by: userId,
    },
    { onConflict: "razorpay_payment_id", ignoreDuplicates: true }
  );

  await logActivity({
    actorId: userId,
    action: "billing.seat_add",
    targetType: "workspace",
    targetId: workspace.id,
    summary: `Added a seat — now ${newSeats}`,
  });
  return NextResponse.json({ ok: true, seats: newSeats });
}
```

- [ ] **Step 4: `add-seat-dialog.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { loadRazorpayCheckout } from "@/lib/checkout";
import { PRICE_PAISE } from "@/lib/billing";

export function AddSeatDialog({
  open,
  onClose,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [error, setError] = useState("");
  const [posting, startPosting] = useTransition();
  if (!open) return null;

  function pay() {
    setError("");
    startPosting(async () => {
      try {
        const res = await fetch("/api/billing/seat", { method: "POST" });
        const data = (await res.json()) as {
          keyId?: string;
          orderId?: string;
          amount?: number;
          error?: string;
        };
        if (!data.orderId || !data.keyId) {
          setError(data.error ?? "Couldn't start the payment.");
          return;
        }
        const loaded = await loadRazorpayCheckout();
        if (!loaded || !window.Razorpay) {
          setError("Couldn't load the payment window.");
          return;
        }
        const rzp = new window.Razorpay({
          key: data.keyId,
          order_id: data.orderId,
          amount: data.amount ?? PRICE_PAISE,
          currency: "INR",
          name: "Lead Portal",
          description: "Additional seat — ₹499/month",
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) => {
            const verify = await fetch("/api/billing/seat/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = (await verify.json()) as { ok?: boolean; error?: string };
            if (result.ok) onPaid();
            else setError(result.error ?? "Payment verification failed.");
          },
        });
        rzp.open();
      } catch {
        setError("Couldn't start the payment. Try again.");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
      <button
        type="button"
        className="animate-overlay absolute inset-0 bg-zinc-900/30"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a seat"
        className="animate-panel relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold text-zinc-900">Add a seat</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-600">
          Inviting a teammate adds a seat — ₹499 per month on your bill. You
          pay for this seat now, and it renews with your subscription.
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={posting}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={pay} disabled={posting}>
            {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            Pay ₹499 & continue
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire `invite-form.tsx`**

Add state + dialog + retry:

```tsx
const [seatRequired, setSeatRequired] = useState(false);
```

In `submit()`, replace the `if (!res.ok)` branch:

```tsx
      if (!res.ok) {
        if (res.code === "seat_required") {
          setSeatRequired(true);
          return;
        }
        setError(res.error ?? "Invite failed");
        return;
      }
```

Render at the end (inside the fragment):

```tsx
      <AddSeatDialog
        open={seatRequired}
        onClose={() => setSeatRequired(false)}
        onPaid={() => {
          setSeatRequired(false);
          submit();
        }}
      />
```

Import `AddSeatDialog`. Keep the email filled on `seat_required` (do not clear).

- [ ] **Step 6: Lint + build + commit + verify**

```bash
npm run lint && npm run build
git add -A && git commit -m "feat(billing): seat gate on invites + add-seat payment dialog" && git push
```

E2E:
1. Workspace `seats=1`, 1 profile, owner tries invite → response `code:"seat_required"`, dialog appears (screenshot).
2. Service-key set `seats=2` → invite succeeds (existing flow).
3. `seat/verify` signature path smoke-tested with real Razorpay test keys when available (manual).

---

### Task 6: Cancel + receipts polish + full E2E + docs

**Files:**
- Create: `src/app/api/billing/cancel/route.ts`
- Modify: `src/components/billing-panel.tsx` (cancel → route; already wired)
- Modify: `README.md` (env rows) + `.superpowers/sdd/progress.md`

- [ ] **Step 1: `cancel` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cancelSubscription } from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role, workspace_id")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner" || !me.workspace_id) {
    return NextResponse.json({ error: "Only the owner can cancel" }, { status: 403 });
  }
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, razorpay_subscription_id")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (!workspace?.razorpay_subscription_id) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400 });
  }
  try {
    await cancelSubscription(workspace.razorpay_subscription_id);
    await supabase
      .from("workspaces")
      .update({ cancel_at_period_end: true })
      .eq("id", workspace.id);
    await logActivity({
      actorId: userId,
      action: "billing.cancel",
      targetType: "workspace",
      targetId: workspace.id,
      summary: "Cancelled the subscription (runs to period end)",
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[billing] cancel failed:", err);
    return NextResponse.json({ error: "Couldn't cancel right now." }, { status: 502 });
  }
}
```

Access runs to `current_period_end`; the webhook `subscription.cancelled` (fires at cycle end) flips `subscription_status` → gate applies. No status change now.

- [ ] **Step 2: Full E2E pass (harness)**

Run the complete sequence on a disposable workspace + users:
1. comped HI Labs never gated ✓
2. expired trial → `/billing`, owner subscribe CTA, member message ✓
3. signed `subscription.charged` → entitled; duplicate `payment.captured` → one payments row ✓
4. `subscription.halted` + period past → gated ✓
5. invite blocked at seats=1 → seats=2 (service key) → invite works ✓
6. cancel route (with test keys) → `cancel_at_period_end=true`, access until period end ✓
7. receipts render on `/billing` ✓
8. Clean up all test artifacts.

- [ ] **Step 3: Docs**

- `README.md`: add the five `RAZORPAY_*` env rows + "Billing" section (how to set up Razorpay: KYC → Plan ₹499/month → webhook `/api/billing/webhook` with events `subscription.*`, `payment.captured`).
- Ledger: append the billing feature summary + verification results + "owner: create Razorpay plan + keys when ready".

- [ ] **Step 4: Final commit**

```bash
npm run lint && npm run build
git add -A && git commit -m "feat(billing): cancel-at-period-end, receipts, docs + full E2E" && git push
```

---

## Self-Review Notes

- Spec coverage: trial 1-day ✓ (Task 1), ₹499/seat ✓ (Task 2/5), owner-pays ✓ (Task 5), auto-renew ✓ (Task 4), comped HI Labs ✓ (Task 3 panel + entitlement), gate ✓ (Task 3), webhooks ✓ (Task 4), cancel ✓ (Task 6), receipts ✓ (Task 3/6), anti-abuse (trial length only) ✓.
- Types: `BillingOverview` used by panel is produced by Task 3's data function; `InviteResult.code` produced in Task 5 matches the client check; `cancel_at_period_end` column created in Task 1 and set in Task 6.
