import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDeepResearchState } from "@/lib/data";
import {
  failTimedOutRun,
  isFreshReconcileClaim,
  reconcileDeepResearch,
  resetStaleReconcileClaim,
  startDeepResearch,
} from "@/lib/deep-research";

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
    .select("id, status, created_at, details")
    .eq("id", state.activeRunId)
    .maybeSingle();
  if (!run) return NextResponse.json({ ok: true, status: "idle" });

  const ageMs = Date.now() - new Date(run.created_at).getTime();

  if (run.status === "reconciling") {
    // A fresh claim belongs to another tab: keep the UI polling without
    // polling Apify twice.
    if (isFreshReconcileClaim(run.details)) {
      return NextResponse.json({ ok: true, status: "running" });
    }
    // A stale claim on a run past the 15-min wall takes the timeout path:
    // resetting would let a zombie cycle reset→claim forever and never be
    // observed as timed out.
    if (ageMs > RUN_TIMEOUT_MS) {
      await failTimedOutRun(run);
      return NextResponse.json({ ok: true, status: "failed", error: "timed out" });
    }
    // Claim-value CAS: release only the exact claim observed above. 0 rows
    // means another request reset (or re-claimed) first, or the claim was
    // unverifiable — leave the row alone and keep polling.
    const released = await resetStaleReconcileClaim(run);
    if (!released) return NextResponse.json({ ok: true, status: "running" });
  } else if (run.status === "running" && ageMs > RUN_TIMEOUT_MS) {
    // Record whatever in-flight Apify cost is fetchable before failing.
    await failTimedOutRun(run);
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
