import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { scanCompanySignals } from "@/lib/signal-scan";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as { orgId?: unknown } | null;
  const orgId = Number(body?.orgId);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });
  }

  // Confirm the company belongs to this workspace through RLS before scanning.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) {
    return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });
  }

  const result = await scanCompanySignals(orgId, workspaceId);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
