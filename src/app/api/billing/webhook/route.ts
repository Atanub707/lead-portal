import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/billing";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const SUBSCRIPTION_STATUS_EVENTS = new Set([
  "subscription.activated",
  "subscription.charged",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
]);

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
    if (
      subscription?.id &&
      event.event &&
      SUBSCRIPTION_STATUS_EVENTS.has(event.event)
    ) {
      const { data: workspace } = await admin
        .from("workspaces")
        .select("id, seats")
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
          patch.seats = Math.max(workspace.seats ?? 0, subscription.quantity ?? 0);
        }
        const { error } = await admin
          .from("workspaces")
          .update(patch)
          .eq("id", workspace.id);
        if (error) {
          console.error("[billing] workspace update failed:", error);
          return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
        }
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
        const { error } = await admin.from("payments").upsert(
          {
            workspace_id: workspaceId,
            razorpay_payment_id: payment.id,
            razorpay_order_id: payment.order_id ?? null,
            razorpay_subscription_id: payment.subscription_id ?? null,
            kind: payment.notes?.kind === "seat" ? "seat" : "subscription",
            amount_paise: payment.amount ?? 0,
            currency: payment.currency ?? "INR",
            status: payment.status ?? "captured",
            seats: payment.notes?.seats_after
              ? Number(payment.notes.seats_after)
              : (workspace?.seats ?? null),
            raw: event as unknown as Record<string, unknown>,
          },
          { onConflict: "razorpay_payment_id", ignoreDuplicates: true }
        );
        if (error) {
          console.error("[billing] payment upsert failed:", error);
          return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[billing] webhook failed:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
