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
  RUN_TIMEOUT_MS,
} from "@/lib/deep-research";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const orgId = Number(new URL(request.url).searchParams.get("orgId"));
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const state = await getDeepResearchState(orgId);
  if (!state.activeRunId) {
    // A run that just finished should report its final result once, so the UI
    // can show "Found N people" instead of silently reverting to idle.
    const latest = state.latest;
    const recent =
      latest &&
      (latest.status === "ok" || latest.status === "failed") &&
      Date.now() - new Date(latest.created_at).getTime() < 15 * 60_000;
    if (recent) {
      return NextResponse.json({
        ok: true,
        status: latest.status,
        summary: {
          people: Number(latest.people_found ?? 0),
          emails: Number(latest.emails_found ?? 0),
          cost: Number(latest.cost_usd ?? 0),
        },
      });
    }
    return NextResponse.json({ ok: true, status: "idle" });
  }

  const { data: run } = await supabase
    .from("enrichment_runs")
    .select("id, status, created_at, details, people_found, emails_found")
    .eq("id", state.activeRunId)
    .maybeSingle();
  if (!run) return NextResponse.json({ ok: true, status: "idle" });

  const ageMs = Date.now() - new Date(run.created_at).getTime();
  const people = Number(run.people_found ?? 0);
  const emails = Number(run.emails_found ?? 0);
  const partial = people > 0 || emails > 0 ? { people, emails } : null;
  const running = () =>
    NextResponse.json(
      partial
        ? { ok: true, status: "running", partial }
        : { ok: true, status: "running" }
    );

  if (run.status === "reconciling") {
    // A fresh claim belongs to another tab: keep the UI polling without
    // polling Apify twice.
    if (isFreshReconcileClaim(run.details)) {
      return running();
    }
    // A stale claim on a run past the 10-min wall takes the timeout path:
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
    if (!released) return running();
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
