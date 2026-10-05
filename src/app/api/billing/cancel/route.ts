import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { cancelSubscription, razorpayConfigured } from "@/lib/billing";
import { logActivity } from "@/lib/activity";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
    return NextResponse.json({ error: "Only the owner can cancel" }, { status: 403 });
  }

  // Billing state writes use the service-role client: workspaces_update_owner
  // RLS requires workspace_entitled(id), and a lapsed workspace cannot update
  // itself — exactly the case where cancel is needed.
  const admin = createAdminClient();
  const { data: workspace, error: readError } = await admin
    .from("workspaces")
    .select("id, razorpay_subscription_id, cancel_at_period_end")
    .eq("id", me.workspace_id)
    .maybeSingle();
  if (readError) {
    console.error("[billing] cancel workspace read failed:", readError);
    return NextResponse.json({ error: "Couldn't cancel right now." }, { status: 500 });
  }
  if (workspace?.cancel_at_period_end) {
    // Already scheduled: idempotent no-op, and calling Razorpay again would be
    // rejected as an already-cancelled subscription.
    return NextResponse.json({ ok: true });
  }
  if (!workspace?.razorpay_subscription_id) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400 });
  }

  try {
    await cancelSubscription(workspace.razorpay_subscription_id);
  } catch (err) {
    console.error("[billing] cancel failed:", err);
    return NextResponse.json({ error: "Couldn't cancel right now." }, { status: 502 });
  }

  const { error: updateError } = await admin
    .from("workspaces")
    .update({ cancel_at_period_end: true })
    .eq("id", workspace.id);
  if (updateError) {
    console.error("[billing] cancel update failed:", updateError);
    return NextResponse.json({ error: "Couldn't cancel right now." }, { status: 500 });
  }

  await logActivity({
    actorId: userId,
    action: "billing.cancel",
    targetType: "workspace",
    targetId: workspace.id,
    summary: "Cancelled the subscription (runs to period end)",
  });
  return NextResponse.json({ ok: true });
}
