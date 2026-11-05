// Minimal durable job queue on the jobs table (PostgREST-safe claiming).
import { createAdminClient } from "./supabase/admin";

export type JobKind =
  | "discovery"
  | "signal_scan"
  | "score_recompute"
  | "campaign_tick"
  | "imap_sync"
  | "verification"
  | "brief";

export interface JobRow {
  id: number;
  workspace_id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
}

export async function enqueueJob(
  workspaceId: string,
  kind: JobKind,
  payload: Record<string, unknown>,
  runAfter?: string
): Promise<number | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("jobs")
    .insert({
      workspace_id: workspaceId,
      kind,
      payload,
      status: "queued",
      run_after: runAfter ?? new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[jobs] enqueue failed:", error?.message);
    return null;
  }
  return data.id as number;
}

export async function claimJobs(limit = 5): Promise<JobRow[]> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: candidates } = await admin
    .from("jobs")
    .select("id, workspace_id, kind, payload, status, attempts")
    .eq("status", "queued")
    .lte("run_after", now)
    .order("run_after", { ascending: true })
    .limit(limit);

  const claimed: JobRow[] = [];
  for (const candidate of candidates ?? []) {
    const { data } = await admin
      .from("jobs")
      .update({
        status: "running",
        locked_by: "worker",
        locked_at: now,
        attempts: Number(candidate.attempts ?? 0) + 1,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .select("id, workspace_id, kind, payload, status, attempts");
    if (data?.[0]) claimed.push(data[0] as JobRow);
  }
  return claimed;
}

export async function completeJob(id: number): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("jobs")
    .update({
      status: "done",
      locked_by: null,
      locked_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function failJob(job: JobRow, error: string): Promise<void> {
  const admin = createAdminClient();
  const attempts = Number(job.attempts ?? 1);
  const terminal = attempts >= 3;
  const backoffMs = Math.min(15 * 60_000, attempts * 60_000);
  await admin
    .from("jobs")
    .update({
      status: terminal ? "failed" : "queued",
      locked_by: null,
      locked_at: null,
      last_error: error.slice(0, 500),
      run_after: terminal
        ? new Date().toISOString()
        : new Date(Date.now() + backoffMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}
