import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import { saveSendPolicy } from "@/lib/send-queue";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  timezone: z.string().min(1).max(80),
  window_start: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  window_end: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  daily_cap: z.number().int().min(1).max(30),
  domain_daily_cap: z.number().int().min(1).max(3),
  min_gap_minutes: z.number().int().min(1).max(60),
  max_gap_minutes: z.number().int().min(1).max(120),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.role !== "owner") {
    return NextResponse.json({ ok: false, error: "Only the workspace owner can change the send schedule" }, { status: 403 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Check the schedule values" }, { status: 400 });
  }
  try {
    const result = await saveSendPolicy(workspaceId, parsed.data);
    if (!result.policy) {
      return NextResponse.json({ ok: false, error: result.error ?? "Could not save" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, policy: result.policy });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save the schedule";
    const status = /email_send_|relation .* does not exist|schema cache/i.test(message) ? 503 : 500;
    return NextResponse.json(
      { ok: false, error: status === 503 ? "Apply the Phase 3 migration first." : message },
      { status }
    );
  }
}
