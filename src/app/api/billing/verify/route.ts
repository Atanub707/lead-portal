import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { razorpayConfigured, verifyCheckoutSignature } from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (!razorpayConfigured()) {
      return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 503 });
    }

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

    const admin = createAdminClient();
    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id, razorpay_subscription_id, plan, subscription_status, current_period_end")
      .eq("id", me.workspace_id)
      .maybeSingle();
    if (workspaceError) {
      console.error("[billing] failed to read workspace:", workspaceError);
      return NextResponse.json(
        { error: "Couldn't verify your subscription." },
        { status: 500 }
      );
    }
    if (
      !workspace ||
      !body.razorpay_subscription_id ||
      body.razorpay_subscription_id !== workspace.razorpay_subscription_id
    ) {
      return NextResponse.json(
        { error: "This payment doesn't match your subscription." },
        { status: 400 }
      );
    }

    const periodEndMs = workspace.current_period_end
      ? new Date(workspace.current_period_end).getTime()
      : 0;
    if (
      workspace.plan === "paid" &&
      workspace.subscription_status === "active" &&
      periodEndMs > Date.now()
    ) {
      return NextResponse.json({ ok: true });
    }

    const nextPeriodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const { error } = await admin
      .from("workspaces")
      .update({
        plan: "paid",
        subscription_status: "active",
        current_period_end: nextPeriodEnd,
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
  } catch (err) {
    console.error("[billing] verify failed:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
