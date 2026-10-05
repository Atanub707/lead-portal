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
