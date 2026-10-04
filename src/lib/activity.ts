import { createAdminClient } from "./supabase/admin";

export interface ActivityEntry {
  actorId?: string | null;
  action: string;          // e.g. "company.create"
  orgId?: number | null;
  targetType?: string;     // company | contact | pipeline | user | profile | research
  targetId?: string | number | null;
  summary: string;         // human sentence, e.g. Added company “Acme”
  details?: Record<string, unknown>;
  workspaceId?: string | null; // explicit override (e.g. super-admin events)
}

// Fire-and-forget audit trail. MUST never throw or break the calling action.
export async function logActivity(entry: ActivityEntry): Promise<void> {
  try {
    const admin = createAdminClient();

    // Resolve the workspace: actor's profile first, then the org's, then the
    // explicit override — activity_log.workspace_id is NOT NULL.
    let workspaceId: string | null = null;
    if (entry.actorId) {
      const { data: profile } = await admin
        .from("profiles")
        .select("workspace_id")
        .eq("id", entry.actorId)
        .maybeSingle();
      workspaceId = (profile?.workspace_id as string | null) ?? null;
    }
    if (!workspaceId && entry.orgId) {
      const { data: org } = await admin
        .from("organizations")
        .select("workspace_id")
        .eq("id", entry.orgId)
        .maybeSingle();
      workspaceId = (org?.workspace_id as string | null) ?? null;
    }
    if (!workspaceId) workspaceId = entry.workspaceId ?? null;

    const { error } = await admin.from("activity_log").insert({
      actor_id: entry.actorId ?? null,
      workspace_id: workspaceId,
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
