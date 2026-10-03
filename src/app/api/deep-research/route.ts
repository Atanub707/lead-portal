import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDeepResearchState } from "@/lib/data";
import { reconcileDeepResearch, startDeepResearch } from "@/lib/deep-research";

const RUN_TIMEOUT_MS = 15 * 60_000;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const orgId = Number(new URL(request.url).searchParams.get("orgId"));
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const state = await getDeepResearchState(orgId);
  if (!state.activeRunId) return NextResponse.json({ ok: true, status: "idle" });

  const { data: run } = await supabase
    .from("enrichment_runs")
    .select("id, created_at, details")
    .eq("id", state.activeRunId)
    .maybeSingle();
  if (!run) return NextResponse.json({ ok: true, status: "idle" });

  if (Date.now() - new Date(run.created_at).getTime() > RUN_TIMEOUT_MS) {
    // Run-row writes need the admin client: enrichment_runs has no RLS UPDATE policy.
    const admin = createAdminClient();
    await admin
      .from("enrichment_runs")
      .update({
        status: "failed",
        details: { ...((run.details as Record<string, unknown> | null) ?? {}), error: "timed out" },
      })
      .eq("id", run.id);
    return NextResponse.json({ ok: true, status: "failed", error: "timed out" });
  }

  try {
    const result = await reconcileDeepResearch(supabase, state.activeRunId);
    return NextResponse.json(result);
  } catch (err) {
    console.error(
      "[deep-research] reconcile failed:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { ok: false, error: "Couldn't check deep research status. Please try again." },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const { orgId } = (await request.json()) as { orgId?: number };
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("organizations")
    .select("id, name, website, linkedin_url")
    .eq("id", orgId)
    .maybeSingle();
  if (!company) return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });

  const result = await startDeepResearch(supabase, { orgId, userId, company });
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
