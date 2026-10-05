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
