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
