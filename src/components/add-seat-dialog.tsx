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
            try {
              const verify = await fetch("/api/billing/seat/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(response),
              });
              const result = (await verify.json()) as { ok?: boolean; error?: string };
              if (result.ok) onPaid();
              else setError(result.error ?? "Payment verification failed.");
            } catch {
              setError("Payment succeeded but activation failed — try again or contact support.");
            }
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
