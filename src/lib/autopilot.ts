import { createAdminClient } from "./supabase/admin";
import { generateEmailDraft } from "./email";
import { approveAndSchedule, preflightSend } from "./send-queue";

const DRAFT_FLAVOR = "short-direct";
const MIN_QUALITY = 80;
const CONTACT_COOLDOWN_DAYS = 30;

export interface AutopilotSettings {
  workspace_id: string;
  enabled: boolean;
  pipeline_id: string | null;
  min_score: number;
  daily_draft_limit: number;
  run_interval_minutes: number;
  review_required: boolean;
  last_run_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface AutopilotRunRow {
  id: number;
  status: "running" | "completed" | "failed" | "skipped";
  trigger: "manual" | "schedule";
  reason: string | null;
  selected: number;
  drafted: number;
  skipped: number;
  error: string | null;
  details: { orgId?: number; name?: string; status?: string; reason?: string }[];
  started_at: string;
  finished_at: string | null;
}

export interface AutopilotOutboxRow {
  id: number;
  workspace_id: string;
  run_id: number | null;
  org_id: number;
  contact_id: number | null;
  to_email: string;
  subject: string;
  body: string;
  quality: { score?: number; words?: number; issues?: string[]; evidence?: string[] } | null;
  recipient: { type?: string; label?: string; strategyLabel?: string; verification?: string } | null;
  gate: { errors?: string[]; warnings?: string[] } | null;
  status: "pending" | "approved" | "rejected" | "held" | "failed";
  queue_id: number | null;
  coin_id: string | null;
  created_at: string;
  approved_at: string | null;
  org_name?: string;
}

export function defaultAutopilotSettings(workspaceId: string): AutopilotSettings {
  return {
    workspace_id: workspaceId,
    enabled: false,
    pipeline_id: null,
    min_score: 0,
    daily_draft_limit: 5,
    run_interval_minutes: 60,
    review_required: true,
    last_run_at: null,
    created_by: null,
    updated_by: null,
  };
}

export async function getAutopilotSettings(
  workspaceId: string
): Promise<AutopilotSettings> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("autopilot_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AutopilotSettings | null) ?? defaultAutopilotSettings(workspaceId);
}

export async function saveAutopilotSettings(
  workspaceId: string,
  userId: string,
  input: Partial<AutopilotSettings>
): Promise<AutopilotSettings> {
  const current = await getAutopilotSettings(workspaceId);
  const next = {
    workspace_id: workspaceId,
    enabled: input.enabled ?? current.enabled,
    pipeline_id:
      input.pipeline_id === undefined ? current.pipeline_id : input.pipeline_id || null,
    min_score: Math.min(100, Math.max(0, Number(input.min_score ?? current.min_score))),
    daily_draft_limit: Math.min(
      20,
      Math.max(1, Number(input.daily_draft_limit ?? current.daily_draft_limit))
    ),
    run_interval_minutes: Math.min(
      1440,
      Math.max(15, Number(input.run_interval_minutes ?? current.run_interval_minutes))
    ),
    review_required: input.review_required ?? current.review_required,
    created_by: current.created_by ?? userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("autopilot_settings")
    .upsert(next, { onConflict: "workspace_id" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not save Autopilot settings");
  return data as AutopilotSettings;
}

export async function listAutopilotRuns(
  workspaceId: string,
  limit = 10
): Promise<AutopilotRunRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("autopilot_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AutopilotRunRow[];
}

export async function listAutopilotOutbox(
  workspaceId: string,
  status?: AutopilotOutboxRow["status"]
): Promise<AutopilotOutboxRow[]> {
  const admin = createAdminClient();
  let query = admin
    .from("autopilot_outbox")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (status) query = query.eq("status", status);
  const { data } = await query;
  const rows = (data ?? []) as AutopilotOutboxRow[];
  const orgIds = [...new Set(rows.map((row) => row.org_id))];
  if (orgIds.length === 0) return rows;
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);
  const names = new Map((orgs ?? []).map((org) => [org.id as number, org.name as string]));
  return rows.map((row) => ({ ...row, org_name: names.get(row.org_id) }));
}

async function startRun(workspaceId: string, trigger: "manual" | "schedule") {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("autopilot_runs")
    .insert({ workspace_id: workspaceId, trigger, status: "running" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not start Autopilot run");
  return data as AutopilotRunRow;
}

async function finishRun(
  runId: number,
  patch: Partial<AutopilotRunRow>
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("autopilot_runs")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", runId);
}

function startOfUtcDay(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

export async function runAutopilot(
  workspaceId: string,
  userId: string,
  options?: { trigger?: "manual" | "schedule"; maxDrafts?: number }
): Promise<{ ok: boolean; run?: AutopilotRunRow; error?: string }> {
  const trigger = options?.trigger ?? "manual";
  const settings = await getAutopilotSettings(workspaceId);
  const admin = createAdminClient();

  const run = await startRun(workspaceId, trigger);
  const details: NonNullable<AutopilotRunRow["details"]> = [];
  let selected = 0;
  let drafted = 0;
  let skipped = 0;

  try {
    const dayStart = startOfUtcDay();
    const { count: draftedToday } = await admin
      .from("autopilot_outbox")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", dayStart)
      .neq("status", "rejected");
    const dailyRemaining = Math.max(
      0,
      settings.daily_draft_limit - (draftedToday ?? 0)
    );
    const limit = Math.min(
      dailyRemaining,
      Math.max(0, options?.maxDrafts ?? settings.daily_draft_limit)
    );
    if (limit === 0) {
      await finishRun(run.id, {
        status: "skipped",
        reason: "Daily draft limit reached",
        selected: 0,
        drafted: 0,
        skipped: 0,
        details,
      });
      return { ok: true, run: { ...run, status: "skipped", reason: "Daily draft limit reached" } };
    }

    let orgQuery = admin
      .from("organizations")
      .select("id, name, website, score, list")
      .eq("workspace_id", workspaceId)
      .not("website", "is", null)
      .gte("score", settings.min_score)
      .order("score", { ascending: false, nullsFirst: false })
      .limit(60);
    if (settings.pipeline_id) orgQuery = orgQuery.eq("list", settings.pipeline_id);
    const { data: orgRows, error: orgError } = await orgQuery;
    if (orgError) throw new Error(orgError.message);
    const candidates = orgRows ?? [];
    const orgIds = candidates.map((org) => org.id as number);
    if (orgIds.length === 0) {
      await finishRun(run.id, {
        status: "completed",
        reason: "No companies match the current pipeline and score",
        details,
      });
      return { ok: true, run: { ...run, status: "completed" } };
    }

    const cooldownStart = new Date(
      Date.now() - CONTACT_COOLDOWN_DAYS * 86_400_000
    ).toISOString();
    const [
      { data: pendingOutbox },
      { data: pendingQueue },
      { data: recentSent },
      { data: contacts },
      { data: companyEmails },
    ] = await Promise.all([
      admin
        .from("autopilot_outbox")
        .select("org_id")
        .eq("workspace_id", workspaceId)
        .in("status", ["pending", "approved"]),
      admin
        .from("email_send_queue")
        .select("org_id")
        .eq("workspace_id", workspaceId)
        .in("status", ["scheduled", "sending", "sent"]),
      admin
        .from("sent_emails")
        .select("org_id")
        .eq("workspace_id", workspaceId)
        .gte("created_at", cooldownStart),
      admin
        .from("contacts")
        .select("id, org_id, name, title, email, is_decision_maker")
        .eq("workspace_id", workspaceId)
        .in("org_id", orgIds)
        .not("email", "is", null)
        .order("is_decision_maker", { ascending: false }),
      admin
        .from("company_emails")
        .select("org_id, email")
        .eq("workspace_id", workspaceId)
        .in("org_id", orgIds),
    ]);
    const blocked = new Set<number>([
      ...((pendingOutbox ?? []).map((row) => row.org_id as number)),
      ...((pendingQueue ?? []).map((row) => row.org_id as number)),
      ...((recentSent ?? []).map((row) => row.org_id as number)),
    ]);
    const contactByOrg = new Map<
      number,
      { id: number; name: string; email: string }
    >();
    for (const contact of contacts ?? []) {
      const orgId = contact.org_id as number;
      if (contactByOrg.has(orgId) || !contact.email) continue;
      contactByOrg.set(orgId, {
        id: contact.id as number,
        name: (contact.name as string) ?? "",
        email: contact.email as string,
      });
    }
    const companyEmailByOrg = new Map<number, string>();
    for (const row of companyEmails ?? []) {
      const orgId = row.org_id as number;
      if (!companyEmailByOrg.has(orgId)) companyEmailByOrg.set(orgId, row.email as string);
    }

    const eligible = candidates.filter((org) => !blocked.has(org.id as number));
    selected = Math.min(eligible.length, limit);
    for (const org of eligible.slice(0, limit)) {
      const orgId = org.id as number;
      const contact = contactByOrg.get(orgId);
      const to = contact?.email ?? companyEmailByOrg.get(orgId);
      if (!to) {
        skipped += 1;
        details.push({ orgId, name: org.name as string, status: "skipped", reason: "No email found" });
        continue;
      }
      const draft = await generateEmailDraft({
        userId,
        orgId,
        contactId: contact?.id ?? null,
        flavor: DRAFT_FLAVOR,
        to,
        admin: true,
      });
      if (!draft.ok) {
        skipped += 1;
        details.push({ orgId, name: org.name as string, status: "skipped", reason: draft.error });
        continue;
      }
      if ((draft.quality?.score ?? 0) < MIN_QUALITY) {
        skipped += 1;
        details.push({
          orgId,
          name: org.name as string,
          status: "skipped",
          reason: `Draft quality ${draft.quality?.score ?? 0} below ${MIN_QUALITY}`,
        });
        continue;
      }
      const preflight = await preflightSend({
        workspaceId,
        userId,
        orgId,
        contactId: contact?.id ?? null,
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
      });
      if (!preflight.ok) {
        skipped += 1;
        details.push({
          orgId,
          name: org.name as string,
          status: "skipped",
          reason: preflight.errors.join(" · "),
        });
        continue;
      }
      const { error: insertError } = await admin.from("autopilot_outbox").insert({
        workspace_id: workspaceId,
        run_id: run.id,
        org_id: orgId,
        contact_id: contact?.id ?? null,
        to_email: draft.to.trim().toLowerCase(),
        subject: draft.subject,
        body: draft.body,
        quality: draft.quality,
        recipient: draft.recipient,
        gate: { warnings: preflight.warnings },
        status: "pending",
        created_by: userId,
      });
      if (insertError) {
        skipped += 1;
        details.push({
          orgId,
          name: org.name as string,
          status: "skipped",
          reason: insertError.message,
        });
        continue;
      }
      drafted += 1;
      details.push({ orgId, name: org.name as string, status: "drafted" });
    }

    await admin
      .from("autopilot_settings")
      .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
    await finishRun(run.id, {
      status: "completed",
      reason:
        drafted > 0
          ? `${drafted} draft${drafted === 1 ? "" : "s"} waiting for approval`
          : "No eligible companies produced a draft",
      selected,
      drafted,
      skipped,
      details,
    });
    return {
      ok: true,
      run: {
        ...run,
        status: "completed",
        selected,
        drafted,
        skipped,
        details,
        finished_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Autopilot run failed";
    await finishRun(run.id, {
      status: "failed",
      error: message,
      selected,
      drafted,
      skipped,
      details,
    });
    return { ok: false, error: message };
  }
}

export async function approveAutopilotOutbox(
  outboxId: number,
  workspaceId: string,
  userId: string,
  input?: { subject?: string; body?: string; timezone?: string }
): Promise<
  | { ok: true; queueId: number; coinId: string; scheduledFor: string }
  | { ok: false; error: string; errors?: string[] }
> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("autopilot_outbox")
    .select("*")
    .eq("id", outboxId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return { ok: false, error: "Outbox item not found" };
  if (data.status !== "pending") return { ok: false, error: "This item is not pending" };
  const row = data as AutopilotOutboxRow;
  const subject = input?.subject?.trim() || row.subject;
  const body = input?.body?.trim() || row.body;
  if (subject !== row.subject || body !== row.body) {
    await admin
      .from("autopilot_outbox")
      .update({ subject, body, updated_at: new Date().toISOString() })
      .eq("id", outboxId)
      .eq("workspace_id", workspaceId);
  }
  const result = await approveAndSchedule({
    workspaceId,
    userId,
    orgId: row.org_id,
    contactId: row.contact_id,
    to: row.to_email,
    subject,
    body,
    timezone: input?.timezone,
  });
  if (!result.ok) {
    await admin
      .from("autopilot_outbox")
      .update({
        gate: { errors: result.errors ?? [result.error] },
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);
    return { ok: false, error: result.error, errors: result.errors };
  }
  await admin
    .from("autopilot_outbox")
    .update({
      status: "approved",
      queue_id: result.approval.queue.id,
      coin_id: result.approval.coin.id,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      gate: { warnings: result.approval.warnings },
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboxId)
    .eq("workspace_id", workspaceId);
  return {
    ok: true,
    queueId: result.approval.queue.id,
    coinId: result.approval.coin.id,
    scheduledFor: result.approval.queue.scheduled_for,
  };
}

export async function updateAutopilotOutbox(
  outboxId: number,
  workspaceId: string,
  input: { subject?: string; body?: string }
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.subject === "string") patch.subject = input.subject.trim().slice(0, 200);
  if (typeof input.body === "string") patch.body = input.body.trim().slice(0, 8000);
  const { data, error } = await admin
    .from("autopilot_outbox")
    .update(patch)
    .eq("id", outboxId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only a pending draft can be edited" };
  return { ok: true };
}

export async function rejectAutopilotOutbox(
  outboxId: number,
  workspaceId: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("autopilot_outbox")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", outboxId)
    .eq("workspace_id", workspaceId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "This item is not pending" };
  return { ok: true };
}

export async function tickAutopilot(): Promise<{
  workspaces: number;
  runs: { workspaceId: string; drafted: number; error?: string }[];
}> {
  const admin = createAdminClient();
  const { data: settingsRows } = await admin
    .from("autopilot_settings")
    .select("*")
    .eq("enabled", true);
  const runs: { workspaceId: string; drafted: number; error?: string }[] = [];
  for (const row of (settingsRows ?? []) as AutopilotSettings[]) {
    const last = row.last_run_at ? new Date(row.last_run_at).getTime() : 0;
    if (Date.now() - last < row.run_interval_minutes * 60_000) continue;
    const actorId = row.created_by;
    if (!actorId) continue;
    const result = await runAutopilot(row.workspace_id, actorId, {
      trigger: "schedule",
      maxDrafts: 2,
    });
    runs.push({
      workspaceId: row.workspace_id,
      drafted: result.run?.drafted ?? 0,
      error: result.error,
    });
  }
  return { workspaces: runs.length, runs };
}
