// Campaign sequence engine: daily tick sends due steps through the existing
// SMTP path, honoring caps, send windows, suppression, verification and
// stop-on-reply. AI drafts are generated with the admin client (no session).
import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";
import { generateEmailDraft, sendEmailViaSmtp } from "./email";
import { recordOutbound } from "./threads-db";

const GLOBAL_DAILY_CAP = 30;

interface CampaignRow {
  id: string;
  workspace_id: string;
  pipeline_id: string | null;
  name: string;
  status: string;
  daily_cap: number;
  send_window: unknown;
  stop_on_reply: boolean;
  min_score: number;
  created_by: string | null;
}

interface StepRow {
  step_no: number;
  channel: string;
  delay_days: number;
  flavor: string | null;
}

interface EnrollmentRow {
  id: number;
  org_id: number;
  contact_id: number | null;
  current_step: number;
}

function withinWindow(window: unknown): boolean {
  if (!window || typeof window !== "object" || Array.isArray(window)) return true;
  const record = window as { start?: unknown; end?: unknown; tz?: unknown };
  const start = typeof record.start === "string" ? record.start : "09:00";
  const end = typeof record.end === "string" ? record.end : "18:00";
  const tz = typeof record.tz === "string" ? record.tz : "UTC";
  try {
    const now = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(new Date());
    return now >= start && now < end;
  } catch {
    return true;
  }
}

async function replyDetected(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  email: string
): Promise<boolean> {
  const { data: threads } = await admin
    .from("email_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("counterparty_email", email)
    .limit(20);
  if (!threads || threads.length === 0) return false;
  const { count } = await admin
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .in("thread_id", threads.map((row) => row.id))
    .eq("direction", "in");
  return (count ?? 0) > 0;
}

async function stopEnrollment(
  admin: ReturnType<typeof createAdminClient>,
  campaign: CampaignRow,
  enrollment: EnrollmentRow,
  reason: string,
  kind: "reply" | "unsubscribe" | "bounce" | "stage_change"
) {
  await admin
    .from("campaign_enrollments")
    .update({
      status: "stopped",
      stop_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", enrollment.id);
  await admin.from("campaign_events").insert({
    workspace_id: campaign.workspace_id,
    campaign_id: campaign.id,
    enrollment_id: enrollment.id,
    org_id: enrollment.org_id,
    kind,
    payload: { reason },
  });
}

export async function sendCampaignTick(workspaceId: string): Promise<{
  sent: number;
  stopped: number;
  skipped: number;
}> {
  const admin = createAdminClient();
  const { data: campaigns } = await admin
    .from("campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  let sent = 0;
  let stopped = 0;
  let skipped = 0;

  for (const campaign of (campaigns ?? []) as CampaignRow[]) {
    const result = await runCampaign(admin, campaign);
    sent += result.sent;
    stopped += result.stopped;
    skipped += result.skipped;
  }
  return { sent, stopped, skipped };
}

async function runCampaign(
  admin: ReturnType<typeof createAdminClient>,
  campaign: CampaignRow
): Promise<{ sent: number; stopped: number; skipped: number }> {
  let sent = 0;
  let stopped = 0;
  let skipped = 0;

  if (!campaign.created_by) {
    return { sent, stopped, skipped: 1 };
  }
  if (!withinWindow(campaign.send_window)) {
    return { sent, stopped, skipped: 1 };
  }

  const { data: settings } = await admin
    .from("user_email_settings")
    .select("from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc")
    .eq("user_id", campaign.created_by)
    .maybeSingle();
  if (!settings?.smtp_host || !settings.smtp_user || !settings.smtp_password_enc) {
    return { sent, stopped, skipped: 1 };
  }

  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await admin
    .from("sent_emails")
    .select("id", { count: "exact", head: true })
    .eq("sent_by", campaign.created_by)
    .gte("created_at", dayStart.toISOString());
  const cap = Math.min(
    GLOBAL_DAILY_CAP,
    Number(campaign.daily_cap ?? GLOBAL_DAILY_CAP)
  );
  const remaining = Math.max(0, cap - (sentToday ?? 0));
  if (remaining === 0) return { sent, stopped, skipped: 1 };

  const { data: steps } = await admin
    .from("campaign_steps")
    .select("step_no, channel, delay_days, flavor")
    .eq("campaign_id", campaign.id)
    .order("step_no", { ascending: true });
  const stepRows = (steps ?? []) as StepRow[];
  if (stepRows.length === 0) return { sent, stopped, skipped: 1 };

  const { data: due } = await admin
    .from("campaign_enrollments")
    .select("id, org_id, contact_id, current_step")
    .eq("campaign_id", campaign.id)
    .eq("status", "active")
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(remaining);
  if (!due || due.length === 0) return { sent, stopped, skipped };

  let password: string;
  try {
    password = decryptSecret(settings.smtp_password_enc);
  } catch {
    return { sent, stopped, skipped: 1 };
  }

  for (const enrollment of due as EnrollmentRow[]) {
    const { data: org } = await admin
      .from("organizations")
      .select("id, name, website, workspace_id")
      .eq("id", enrollment.org_id)
      .maybeSingle();
    if (!org) {
      await stopEnrollment(admin, campaign, enrollment, "company_missing", "stage_change");
      stopped += 1;
      continue;
    }

    let contact: { id: number; email: string | null; name: string | null } | null = null;
    if (enrollment.contact_id) {
      const { data } = await admin
        .from("contacts")
        .select("id, email, name")
        .eq("id", enrollment.contact_id)
        .maybeSingle();
      contact = data
        ? { id: data.id as number, email: data.email as string | null, name: data.name as string | null }
        : null;
    }
    if (!contact?.email) {
      const { data } = await admin
        .from("contacts")
        .select("id, email, name")
        .eq("workspace_id", campaign.workspace_id)
        .eq("org_id", enrollment.org_id)
        .not("email", "is", null)
        .order("is_decision_maker", { ascending: false })
        .limit(1);
      if (data?.[0]) {
        contact = {
          id: data[0].id as number,
          email: data[0].email as string | null,
          name: data[0].name as string | null,
        };
      }
    }
    const to = contact?.email?.trim().toLowerCase() ?? "";
    if (!to) {
      await stopEnrollment(admin, campaign, enrollment, "no_email", "stage_change");
      stopped += 1;
      continue;
    }

    const { data: suppressed } = await admin
      .from("suppression_list")
      .select("id")
      .eq("workspace_id", campaign.workspace_id)
      .eq("email", to)
      .maybeSingle();
    if (suppressed) {
      await stopEnrollment(admin, campaign, enrollment, "suppressed", "unsubscribe");
      stopped += 1;
      continue;
    }

    const { data: verification } = await admin
      .from("email_verifications")
      .select("status")
      .eq("workspace_id", campaign.workspace_id)
      .eq("email", to)
      .maybeSingle();
    if (verification?.status === "invalid") {
      await stopEnrollment(admin, campaign, enrollment, "invalid_email", "bounce");
      stopped += 1;
      continue;
    }

    if (campaign.stop_on_reply && (await replyDetected(admin, campaign.workspace_id, to))) {
      await stopEnrollment(admin, campaign, enrollment, "replied", "reply");
      stopped += 1;
      continue;
    }

    const step = stepRows.find(
      (row) => row.step_no === enrollment.current_step + 1
    );
    if (!step) {
      await admin
        .from("campaign_enrollments")
        .update({ status: "done", updated_at: new Date().toISOString() })
        .eq("id", enrollment.id);
      continue;
    }
    if (step.channel !== "email") {
      skipped += 1;
      continue;
    }

    const draft = await generateEmailDraft({
      userId: campaign.created_by,
      orgId: enrollment.org_id,
      contactId: contact?.id ?? null,
      flavor: step.flavor ?? "short-direct",
      stepNo: step.step_no,
      to,
      admin: true,
    });
    if (!draft.ok) {
      skipped += 1;
      continue;
    }

    let messageId: string;
    try {
      ({ messageId } = await sendEmailViaSmtp(
        {
          host: settings.smtp_host as string,
          port: Number(settings.smtp_port ?? 587),
          secure: settings.smtp_secure !== false,
          user: settings.smtp_user as string,
          password,
          fromName: (settings.from_name as string | null) ?? null,
          fromEmail: (settings.from_email as string | null) ?? null,
        },
        { to, subject: draft.subject, body: draft.body }
      ));
    } catch (err) {
      console.error(
        "[campaigns] send failed:",
        campaign.id,
        err instanceof Error ? err.message : err
      );
      await admin
        .from("campaign_enrollments")
        .update({
          next_run_at: new Date(Date.now() + 86_400_000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", enrollment.id);
      skipped += 1;
      continue;
    }

    await admin.from("sent_emails").insert({
      org_id: enrollment.org_id,
      workspace_id: campaign.workspace_id,
      contact_id: contact?.id ?? null,
      sent_by: campaign.created_by,
      to_email: to,
      subject: draft.subject,
      body: draft.body,
      message_id: messageId,
    });
    await recordOutbound(admin, {
      workspaceId: campaign.workspace_id,
      userId: campaign.created_by,
      orgId: enrollment.org_id,
      contactId: contact?.id ?? null,
      fromEmail: (settings.from_email as string | null) ?? (settings.smtp_user as string),
      toEmail: to,
      subject: draft.subject,
      body: draft.body,
      messageId,
    }).catch((err) => {
      console.error("[campaigns] thread record failed:", err);
    });
    await admin.from("interactions").insert({
      org_id: enrollment.org_id,
      workspace_id: campaign.workspace_id,
      contact_id: contact?.id ?? null,
      channel: "email",
      summary: `Campaign email sent: ${draft.subject}`,
      logged_by: campaign.created_by,
    });

    const nextStep = stepRows.find(
      (row) => row.step_no === enrollment.current_step + 2
    );
    await admin
      .from("campaign_enrollments")
      .update({
        current_step: enrollment.current_step + 1,
        status: nextStep ? "active" : "done",
        next_run_at: nextStep
          ? new Date(
              Date.now() + Math.max(0, Number(nextStep.delay_days ?? 0)) * 86_400_000
            ).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);
    await admin.from("campaign_events").insert({
      workspace_id: campaign.workspace_id,
      campaign_id: campaign.id,
      enrollment_id: enrollment.id,
      org_id: enrollment.org_id,
      kind: "sent",
      payload: {
        step: step.step_no,
        subject: draft.subject,
        to,
        recipient_type: draft.recipient.type,
        inbox_category: draft.recipient.category,
        draft_strategy: draft.recipient.strategy,
        personalization_level: draft.recipient.personalizationLevel,
        cta_type: draft.recipient.ctaType,
      },
    });
    sent += 1;
    if (sent >= remaining) break;
  }

  return { sent, stopped, skipped };
}
