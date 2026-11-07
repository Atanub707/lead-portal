import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { enrichCompanyFromWebsite } from "@/lib/website-enrich";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as { orgIds?: unknown } | null;
  const orgIds = Array.isArray(body?.orgIds)
    ? body.orgIds.map(Number).filter((id) => Number.isFinite(id)).slice(0, 5)
    : [];
  if (orgIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No companies to enrich" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id")
    .in("id", orgIds);
  const allowed = new Set((orgs ?? []).map((row) => row.id as number));

  const results = await Promise.allSettled(
    [...allowed].map((orgId) => enrichCompanyFromWebsite(orgId, workspaceId, userId))
  );
  return NextResponse.json({
    ok: true,
    results: results.map((entry) =>
      entry.status === "fulfilled"
        ? entry.value
        : { ok: false, contacts: 0, emails: 0, skipped: "failed" }
    ),
  });
}
