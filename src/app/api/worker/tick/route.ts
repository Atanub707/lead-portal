import { NextResponse } from "next/server";
import { claimJobs, completeJob, failJob } from "@/lib/jobs";
import { scanCompanySignals } from "@/lib/signal-scan";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run() {
  const jobs = await claimJobs(5);
  const results: { id: number; kind: string; ok: boolean; detail?: string }[] = [];

  for (const job of jobs) {
    try {
      if (job.kind === "signal_scan") {
        const orgId = Number(job.payload?.orgId);
        if (!orgId) {
          await failJob(job, "signal_scan: missing orgId");
          results.push({ id: job.id, kind: job.kind, ok: false, detail: "missing orgId" });
          continue;
        }
        const result = await scanCompanySignals(orgId, job.workspace_id);
        if (!result.ok) {
          await failJob(job, result.skipped ?? "scan failed");
          results.push({ id: job.id, kind: job.kind, ok: false, detail: result.skipped });
          continue;
        }
        await completeJob(job.id);
        results.push({ id: job.id, kind: job.kind, ok: true, detail: `${result.created} signals` });
      } else {
        // Later phases add handlers here (score_recompute, campaign_tick, …).
        await failJob(job, `No handler for ${job.kind} yet`);
        results.push({ id: job.id, kind: job.kind, ok: false, detail: "no handler" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job, message);
      results.push({ id: job.id, kind: job.kind, ok: false, detail: message });
    }
  }

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
