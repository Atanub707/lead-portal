import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { startCrunchbaseActor } from "@/lib/crunchbase";
import { EMPLOYEE_BANDS, INDUSTRY_OPTIONS } from "@/lib/crunchbase-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function industryValue(text: string): string | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  const match = INDUSTRY_OPTIONS.find(
    (entry) =>
      entry.value === normalized || entry.label.toLowerCase() === normalized
  );
  if (match) return match.value;
  return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || null;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as {
    industry?: unknown;
    location?: unknown;
    employeeBand?: unknown;
    count?: unknown;
  } | null;

  const industry =
    typeof body?.industry === "string" ? industryValue(body.industry) : null;
  const location =
    typeof body?.location === "string" ? body.location.trim() : "";
  const band =
    typeof body?.employeeBand === "string" &&
    (EMPLOYEE_BANDS as readonly string[]).includes(body.employeeBand)
      ? body.employeeBand
      : null;
  if (!industry && !location && !band) {
    return NextResponse.json(
      { ok: false, error: "Type what you're looking for, or pick a location/size." },
      { status: 400 }
    );
  }

  const requested = Number(body?.count ?? 10);
  const count = Number.isFinite(requested)
    ? Math.min(15, Math.max(1, Math.round(requested)))
    : 10;

  const filters = {
    ...(industry ? { category: industry } : {}),
    ...(location ? { location } : {}),
    ...(band ? { employeeCount: [band] } : {}),
    detailed: true,
  };

  // Default pipeline: the one linked to the default ICP, else the first.
  const supabase = await createClient();
  const { data: icp } = await supabase
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  const { data: pipelines } = await supabase
    .from("pipelines")
    .select("id, icp_id")
    .eq("workspace_id", workspaceId)
    .order("sort_order");
  const pipeline =
    (pipelines ?? []).find((row) => row.icp_id === icp?.id)?.id ??
    (pipelines ?? [])[0]?.id;
  if (!pipeline) {
    return NextResponse.json(
      { ok: false, error: "Create a pipeline first in Settings." },
      { status: 400 }
    );
  }

  let run: { runId: string; datasetId: string };
  try {
    run = await startCrunchbaseActor(filters, count);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[quick-find] start failed:", raw);
    const tokenInvalid = /\b401\b|user-or-token-not-found|authentication token is not valid/i.test(raw);
    return NextResponse.json(
      {
        ok: false,
        error: tokenInvalid
          ? "Apify rejected the API token. Generate a new token in Apify Console and update APIFY_API_TOKEN in Vercel, then redeploy."
          : "Couldn't start the search. Please try again.",
      },
      { status: 502 }
    );
  }

  const label =
    INDUSTRY_OPTIONS.find((entry) => entry.value === industry)?.label ??
    (typeof body?.industry === "string" ? body.industry.trim() : "");
  const summary = [
    label || "Any industry",
    location ? `in ${location}` : null,
    band ? `${band} employees` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("lead_imports")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      pipeline_id: pipeline,
      source: "quick_search",
      search_url: summary,
      requested_count: count,
      actor_run_id: run.runId,
      dataset_id: run.datasetId,
      status: "running",
      details: { filters },
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json(
      { ok: false, error: "The search started but couldn't be tracked. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: created.id, count, summary });
}
