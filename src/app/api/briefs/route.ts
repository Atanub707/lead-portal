import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { generateCompanyBrief, latestBrief } from "@/lib/briefs";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const orgId = Number(new URL(request.url).searchParams.get("orgId"));
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });
  return NextResponse.json({ ok: true, brief: await latestBrief(orgId) });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as {
    orgId?: unknown;
    refresh?: unknown;
  } | null;
  const orgId = Number(body?.orgId);
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });

  const result = await generateCompanyBrief(
    orgId,
    workspaceId,
    userId,
    body?.refresh === true
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
