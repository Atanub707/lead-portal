import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  PRICE_PAISE,
  razorpayConfigured,
  updateSubscriptionQuantity,
  verifyCheckoutSignature,
} from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
  }
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

  const admin = createAdminClient();
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("id, seats, razorpay_subscription_id")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (workspaceError) {
    console.error("[billing] seat verify workspace read failed:", workspaceError);
    return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });
  }
  if (!workspace) return NextResponse.json({ error: "No workspace" }, { status: 400 });

  const currentSeats = workspace.seats ?? 1;

  const { data: existingPayment, error: paymentReadError } = await admin
    .from("payments")
    .select("id")
    .eq("razorpay_payment_id", body.razorpay_payment_id)
    .maybeSingle();
  if (paymentReadError) {
    console.error("[billing] seat verify payment read failed:", paymentReadError);
    return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });
  }
  if (existingPayment) {
    return NextResponse.json({ ok: true, seats: currentSeats, already: true });
  }

  const expectedSeats = currentSeats + 1;
  const { error: paymentError } = await admin.from("payments").upsert(
    {
      workspace_id: workspace.id,
      razorpay_payment_id: body.razorpay_payment_id,
      razorpay_order_id: body.razorpay_order_id,
      kind: "seat",
      amount_paise: PRICE_PAISE,
      currency: "INR",
      status: "captured",
      seats: expectedSeats,
      created_by: userId,
    },
    { onConflict: "razorpay_payment_id", ignoreDuplicates: true }
  );
  if (paymentError) {
    console.error("[billing] seat verify payment upsert failed:", paymentError);
    return NextResponse.json({ error: "Couldn't record the payment." }, { status: 500 });
  }

  let finalSeats: number;
  const { data: updated, error: updateError } = await admin
    .from("workspaces")
    .update({ seats: expectedSeats })
    .eq("id", workspace.id)
    .eq("seats", currentSeats)
    .select("seats")
    .maybeSingle();
  if (updateError) {
    console.error("[billing] seat verify update failed:", updateError);
    return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });
  }

  if (updated) {
    finalSeats = updated.seats as number;
  } else {
    const { data: fresh, error: freshError } = await admin
      .from("workspaces")
      .select("seats")
      .eq("id", workspace.id)
      .maybeSingle();
    if (freshError) {
      console.error("[billing] seat verify re-read failed:", freshError);
      return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });
    }
    const freshSeats = (fresh?.seats as number | undefined) ?? currentSeats;
    if (freshSeats === expectedSeats) {
      finalSeats = freshSeats;
    } else {
      const { data: retried, error: retryError } = await admin
        .from("workspaces")
        .update({ seats: freshSeats + 1 })
        .eq("id", workspace.id)
        .eq("seats", freshSeats)
        .select("seats")
        .maybeSingle();
      if (retryError) {
        console.error("[billing] seat verify retry failed:", retryError);
        return NextResponse.json({ error: "Couldn't add the seat" }, { status: 500 });
      }
      if (!retried) {
        return NextResponse.json({ error: "Seats changed — try again." }, { status: 409 });
      }
      finalSeats = retried.seats as number;
    }
  }

  if (workspace.razorpay_subscription_id) {
    updateSubscriptionQuantity(workspace.razorpay_subscription_id, finalSeats).catch(
      (err) => console.error("[billing] quantity update failed:", err)
    );
  }

  await logActivity({
    actorId: userId,
    action: "billing.seat_add",
    targetType: "workspace",
    targetId: workspace.id,
    summary: `Added a seat — now ${finalSeats}`,
  });
  return NextResponse.json({ ok: true, seats: finalSeats });
}
