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
