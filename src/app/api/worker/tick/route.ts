import { NextResponse } from "next/server";
import { claimJobs, completeJob, failJob, type JobRow } from "@/lib/jobs";
import { scanCompanySignals } from "@/lib/signal-scan";
import { recomputeWorkspaceScores, scoreOrg } from "@/lib/scoring";
import { enqueueStaleSignalScans } from "@/lib/signal-schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueJob } from "@/lib/jobs";
import { sendCampaignTick } from "@/lib/campaigns";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function reapStuckJobs() {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data } = await admin
    .from("jobs")
    .select("id, attempts")
    .eq("status", "running")
    .lt("locked_at", cutoff)
    .limit(20);
  for (const job of data ?? []) {
    const attempts = Number(job.attempts ?? 1);
    await admin
      .from("jobs")
      .update({
        status: attempts >= 3 ? "failed" : "queued",
        locked_by: null,
        locked_at: null,
        last_error: "worker timed out",
        run_after: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}

async function enqueueCampaignTicks() {
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("workspace_id")
    .eq("status", "active");
  const workspaces = [...new Set((campaigns ?? []).map((row) => row.workspace_id as string))];
  for (const workspaceId of workspaces) {
    const { data: queued } = await admin
      .from("jobs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("kind", "campaign_tick")
      .eq("status", "queued")
      .limit(1);
    if (queued && queued.length > 0) continue;
    await enqueueJob(workspaceId, "campaign_tick", {});
  }
}

async function run() {
  await reapStuckJobs().catch((err) => {
    console.error("[worker] reap failed:", err instanceof Error ? err.message : err);
  });

  // Refresh a few stale companies before claiming, so the daily cron also
  // performs scheduled scans in the same tick (Hobby cron runs once a day).
  await enqueueStaleSignalScans(3).catch((err) => {
    console.error("[worker] schedule failed:", err instanceof Error ? err.message : err);
  });
  await enqueueCampaignTicks().catch((err) => {
    console.error("[worker] campaign enqueue failed:", err instanceof Error ? err.message : err);
  });

  const jobs = await claimJobs(3);
  const results: { id: number; kind: string; ok: boolean; detail?: string }[] = [];

  async function runJob(job: JobRow) {
    try {
      if (job.kind === "signal_scan") {
        const orgId = Number(job.payload?.orgId);
        if (!orgId) {
          await failJob(job, "signal_scan: missing orgId");
          results.push({ id: job.id, kind: job.kind, ok: false, detail: "missing orgId" });
          return;
        }
        const result = await scanCompanySignals(orgId, job.workspace_id);
        if (!result.ok) {
          await failJob(job, result.skipped ?? "scan failed");
          results.push({ id: job.id, kind: job.kind, ok: false, detail: result.skipped });
          return;
        }
        await completeJob(job.id);
        results.push({ id: job.id, kind: job.kind, ok: true, detail: `${result.created} signals` });
      } else if (job.kind === "score_recompute") {
        const orgId = Number(job.payload?.orgId);
        if (orgId) {
          const score = await scoreOrg(orgId, job.workspace_id);
          await completeJob(job.id);
          results.push({ id: job.id, kind: job.kind, ok: true, detail: score ? `score ${score.total}` : "no ICP" });
        } else {
          const result = await recomputeWorkspaceScores(job.workspace_id);
          await completeJob(job.id);
          results.push({ id: job.id, kind: job.kind, ok: true, detail: `${result.scored} scored` });
        }
      } else if (job.kind === "campaign_tick") {
        const result = await sendCampaignTick(job.workspace_id);
        await completeJob(job.id);
        results.push({
          id: job.id,
          kind: job.kind,
          ok: true,
          detail: `${result.sent} sent · ${result.stopped} stopped`,
        });
      } else {
        await failJob(job, `No handler for ${job.kind} yet`);
        results.push({ id: job.id, kind: job.kind, ok: false, detail: "no handler" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job, message);
      results.push({ id: job.id, kind: job.kind, ok: false, detail: message });
    }
  }

  await Promise.all(jobs.map((job) => runJob(job)));
  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
