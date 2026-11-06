import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { reconcileJobScan, startJobScans } from "@/lib/job-signals";

export const maxDuration = 60;

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const result = await startJobScans(workspaceId);
  if (result.runs.length === 0) {
    return NextResponse.json({ ok: false, error: result.skipped ?? "Could not start the scan" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, runs: result.runs });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const params = new URL(request.url).searchParams;
  const runId = params.get("runId");
  const definitionKey = params.get("key");
  if (!runId || !definitionKey) {
    return NextResponse.json({ ok: false, error: "Missing run" }, { status: 400 });
  }
  try {
    const result = await reconcileJobScan(workspaceId, runId, definitionKey);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[job-signals] reconcile failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Could not check the job scan" }, { status: 502 });
  }
}
