import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { planFromIcp } from "@/lib/discovery";
import { startCrunchbaseActor } from "@/lib/crunchbase";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { IcpCriterion } from "@/lib/intelligence";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();

  const body = (await request.json().catch(() => null)) as {
    icpId?: unknown;
    pipelineId?: unknown;
    count?: unknown;
    detailed?: unknown;
    foundedAfter?: unknown;
  } | null;
  const icpId = typeof body?.icpId === "string" ? body.icpId : "";
  const pipelineId = typeof body?.pipelineId === "string" ? body.pipelineId : "";
  if (!icpId) return NextResponse.json({ ok: false, error: "Missing ICP" }, { status: 400 });
  if (!pipelineId) {
    return NextResponse.json({ ok: false, error: "Choose a pipeline for these leads." }, { status: 400 });
  }

  const supabase = await createClient();
  const [icpRes, pipelineRes, criteriaRes] = await Promise.all([
    supabase.from("icp_profiles").select("id, name").eq("id", icpId).maybeSingle(),
    supabase.from("pipelines").select("id").eq("id", pipelineId).maybeSingle(),
    supabase.from("icp_criteria").select("*").eq("workspace_id", workspaceId).eq("icp_id", icpId),
  ]);
  if (!icpRes.data) return NextResponse.json({ ok: false, error: "ICP not found" }, { status: 404 });
  if (!pipelineRes.data) return NextResponse.json({ ok: false, error: "Unknown pipeline." }, { status: 400 });

  const count = Number(body?.count ?? 25);
  const detailed = body?.detailed !== false;
  const foundedAfter =
    typeof body?.foundedAfter === "string" && body.foundedAfter.trim()
      ? body.foundedAfter.trim()
      : null;
  const plan = planFromIcp((criteriaRes.data ?? []) as IcpCriterion[], {
    count: Number.isFinite(count) ? count : 25,
    detailed,
    foundedAfter,
  });

  if (
    !plan.filters.category &&
    !plan.filters.location &&
    !plan.filters.employeeCount &&
    !plan.filters.fundingStage
  ) {
    return NextResponse.json(
      { ok: false, error: "Your ICP has no targeting filters yet. Configure it in Settings → Business profile." },
      { status: 400 }
    );
  }

  let run: { runId: string; datasetId: string };
  try {
    run = await startCrunchbaseActor(plan.filters, plan.count);
  } catch (err) {
    console.error(
      "[discovery] actor start failed:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { ok: false, error: "Couldn't start the discovery run. Please try again." },
      { status: 502 }
    );
  }

  const admin = createAdminClient();
  const { data: created, error } = await admin
    .from("lead_imports")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      pipeline_id: pipelineId,
      source: "icp_discovery",
      icp_id: icpId,
      search_url: plan.summary,
      requested_count: plan.count,
      actor_run_id: run.runId,
      dataset_id: run.datasetId,
      status: "running",
      details: { filters: plan.filters, icp_id: icpId, warnings: plan.warnings },
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[discovery] import row insert failed:", error?.message);
    return NextResponse.json(
      { ok: false, error: "The run started but couldn't be tracked. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: created.id, plan });
}
