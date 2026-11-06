import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { planFromIcp } from "@/lib/discovery";
import { createClient } from "@/lib/supabase/server";
import type { IcpCriterion } from "@/lib/intelligence";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as {
    icpId?: unknown;
    count?: unknown;
    detailed?: unknown;
    foundedAfter?: unknown;
  } | null;
  const icpId = typeof body?.icpId === "string" ? body.icpId : "";
  if (!icpId) return NextResponse.json({ ok: false, error: "Missing ICP" }, { status: 400 });

  const supabase = await createClient();
  const { data: icp } = await supabase
    .from("icp_profiles")
    .select("id")
    .eq("id", icpId)
    .maybeSingle();
  if (!icp) return NextResponse.json({ ok: false, error: "ICP not found" }, { status: 404 });

  const { data: criteria } = await supabase
    .from("icp_criteria")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);

  const count = Number(body?.count ?? 25);
  const detailed = body?.detailed !== false;
  const foundedAfter =
    typeof body?.foundedAfter === "string" && body.foundedAfter.trim()
      ? body.foundedAfter.trim()
      : null;

  const plan = planFromIcp((criteria ?? []) as IcpCriterion[], {
    count: Number.isFinite(count) ? count : 25,
    detailed,
    foundedAfter,
  });
  return NextResponse.json({ ok: true, plan });
}
