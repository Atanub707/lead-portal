import { createAdminClient } from "./supabase/admin";

export interface ActivityEntry {
  actorId?: string | null;
  action: string;          // e.g. "company.create"
  orgId?: number | null;
  targetType?: string;     // company | contact | pipeline | user | profile | research
  targetId?: string | number | null;
  summary: string;         // human sentence, e.g. Added company “Acme”
  details?: Record<string, unknown>;
}

// Fire-and-forget audit trail. MUST never throw or break the calling action.
export async function logActivity(entry: ActivityEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("activity_log").insert({
      actor_id: entry.actorId ?? null,
      action: entry.action,
      org_id: entry.orgId ?? null,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId != null ? String(entry.targetId) : null,
      summary: entry.summary,
      details: entry.details ?? null,
    });
    if (error) console.error("[activity] log failed:", error.message);
  } catch (err) {
    console.error("[activity] log failed:", err instanceof Error ? err.message : err);
  }
}
