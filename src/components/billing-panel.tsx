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
  const paidActive = workspace.plan === "paid" && entitled;
  const trialActive = workspace.plan === "trial" && entitled;

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
            try {
              const verify = await fetch("/api/billing/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(response),
              });
              const result = (await verify.json()) as { ok?: boolean; error?: string };
              if (result.ok) router.refresh();
              else setError(result.error ?? "Payment verification failed.");
            } catch {
              setError("Payment succeeded but activation failed — try again or contact support.");
            }
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
      try {
        const res = await fetch("/api/billing/cancel", { method: "POST" });
        if (!res.ok) {
          setError("Couldn't cancel right now.");
          return;
        }
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (data.ok) router.refresh();
        else setError(data.error ?? "Couldn't cancel right now.");
      } catch {
        setError("Couldn't cancel right now. Try again.");
      }
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
          {paidActive
            ? "Billing"
            : trialActive
              ? "Your trial is running"
              : "Your trial has ended"}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
          {paidActive
            ? `You're on the monthly plan — ${rupees(PRICE_PAISE)} per user per month.`
            : trialActive && workspace.trial_ends_at
              ? `Your trial ends ${workspace.trial_ends_at.slice(0, 10)} — subscribe to keep using Lead Portal after it ends.`
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
            {entitled
              ? "Billing is managed by your workspace owner."
              : "Ask your workspace owner to activate the plan."}
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {paidActive ? (
              workspace.cancel_at_period_end ? (
                <p className="text-[12px] text-zinc-500">
                  Cancels on {workspace.current_period_end?.slice(0, 10) ?? "the end of the period"}.
                </p>
              ) : (
                <button type="button" onClick={cancel} disabled={posting} className="btn-ghost">
                  {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  Cancel subscription
                </button>
              )
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
                <span
                  className={`flex items-center gap-1.5 text-[13px] tabular-nums ${
                    payment.status === "captured" ? "text-zinc-800" : "text-zinc-500"
                  }`}
                >
                  {payment.status === "captured" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  ) : null}
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
