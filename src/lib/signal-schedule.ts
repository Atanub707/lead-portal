// Daily refresh: queue website signal scans for companies not scanned recently.
// Keeps signal-backed scores fresh without user action. Bounded for Hobby cron.
import { enqueueJob } from "./jobs";
import { createAdminClient } from "./supabase/admin";

const STALE_DAYS = 30;
const MAX_QUEUED = 25;

export async function enqueueStaleSignalScans(limit = 5): Promise<number> {
  const admin = createAdminClient();
  const { count: queuedCount } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", "signal_scan")
    .eq("status", "queued");
  if ((queuedCount ?? 0) >= MAX_QUEUED) return 0;

  const cutoff = new Date(Date.now() - STALE_DAYS * 86_400_000).toISOString();
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, workspace_id, last_signal_at")
    .not("website", "is", null)
    .or(`last_signal_at.is.null,last_signal_at.lt.${cutoff}`)
    .order("last_signal_at", { ascending: true, nullsFirst: true })
    .limit(limit * 3);
  if (!orgs || orgs.length === 0) return 0;

  const { data: queued } = await admin
    .from("jobs")
    .select("payload")
    .eq("kind", "signal_scan")
    .eq("status", "queued");
  const queuedOrgIds = new Set(
    (queued ?? [])
      .map((row) => Number((row.payload as { orgId?: unknown } | null)?.orgId))
      .filter((id) => Number.isFinite(id))
  );

  let enqueued = 0;
  for (const org of orgs) {
    if (enqueued >= limit) break;
    if (queuedOrgIds.has(org.id as number)) continue;
    const jobId = await enqueueJob(org.workspace_id as string, "signal_scan", {
      orgId: org.id,
      scheduled: true,
    });
    if (jobId) enqueued += 1;
  }
  return enqueued;
}
