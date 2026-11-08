import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import { decryptSecret } from "./crypto";
import { sendEmailViaSmtp } from "./email";
import { classifyRecipient } from "./recipient";
import { recordOutbound } from "./threads-db";
import { logActivity } from "./activity";
import {
  addDaysToKey,
  dateKey,
  dayRangeUtc,
  daysBetweenKeys,
  isWithinWindow,
  isValidTimezone,
  localTimeLabel,
  weekdayForKey,
  windowForDateKey,
} from "./send-time";

const DEFAULT_TIMEZONE = "UTC";
const DEFAULT_WINDOW_START = "09:30";
const DEFAULT_WINDOW_END = "17:30";
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const DEFAULT_DAILY_CAP = 30;
const DEFAULT_DOMAIN_CAP = 1;
const DEFAULT_MIN_GAP = 4;
const DEFAULT_MAX_GAP = 10;
const PRIOR_CONTACT_DAYS = 30;

export interface SendPolicy {
  workspace_id: string;
  timezone: string;
  window_start: string;
  window_end: string;
  weekdays: number[];
  daily_cap: number;
  domain_daily_cap: number;
  min_gap_minutes: number;
  max_gap_minutes: number;
  configured: boolean;
}

export interface SendQueueItem {
  id: number;
  workspace_id: string;
  coin_id: string;
  user_id: string;
  org_id: number;
  contact_id: number | null;
  to_email: string;
  subject: string;
  body: string;
  content_hash: string;
  scheduled_for: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_email_id: number | null;
  agent_run_id: number | null;
  created_at: string;
  sent_at: string | null;
}

export interface SendCoinItem {
  id: string;
  for_date: string;
  expires_at: string;
  status: string;
  created_at: string;
}

export interface SendDayBalance {
  date: string;
  cap: number;
  sent: number;
  scheduled: number;
  remaining: number;
  domainCap: number;
  warmup: boolean;
}

export interface SendOverview {
  available: boolean;
  policy: SendPolicy;
  days: SendDayBalance[];
  queue: (SendQueueItem & { coin?: SendCoinItem | null; org_name?: string })[];
  first_activity_at: string | null;
  note?: string;
}

export interface SendApproval {
  coin: SendCoinItem;
  queue: SendQueueItem;
  warnings: string[];
  day: SendDayBalance;
}

interface PlannedSlot {
  scheduledFor: Date;
  dateKey: string;
  gapMinutes: number;
}

function policyDefaults(workspaceId: string, timezone?: string): SendPolicy {
  return {
    workspace_id: workspaceId,
    timezone:
      timezone && isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
    window_start: DEFAULT_WINDOW_START,
    window_end: DEFAULT_WINDOW_END,
    weekdays: DEFAULT_WEEKDAYS,
    daily_cap: DEFAULT_DAILY_CAP,
    domain_daily_cap: DEFAULT_DOMAIN_CAP,
    min_gap_minutes: DEFAULT_MIN_GAP,
    max_gap_minutes: DEFAULT_MAX_GAP,
    configured: false,
  };
}

export async function getSendPolicy(
  workspaceId: string,
  timezone?: string
): Promise<SendPolicy> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("email_send_policies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data) return data as SendPolicy;

  const defaults = policyDefaults(workspaceId, timezone);
  const { data: created } = await admin
    .from("email_send_policies")
    .insert({
      workspace_id: workspaceId,
      timezone: defaults.timezone,
      window_start: defaults.window_start,
      window_end: defaults.window_end,
      weekdays: defaults.weekdays,
      daily_cap: defaults.daily_cap,
      domain_daily_cap: defaults.domain_daily_cap,
      min_gap_minutes: defaults.min_gap_minutes,
      max_gap_minutes: defaults.max_gap_minutes,
      configured: false,
    })
    .select("*")
    .maybeSingle();
  return (created as SendPolicy | null) ?? defaults;
}

export async function saveSendPolicy(
  workspaceId: string,
  input: Partial<SendPolicy>
): Promise<{ policy?: SendPolicy; error?: string }> {
  const current = await getSendPolicy(workspaceId);
  const timezone =
    typeof input.timezone === "string" && isValidTimezone(input.timezone)
      ? input.timezone
      : current.timezone;
  const windowStart = input.window_start ?? current.window_start;
  const windowEnd = input.window_end ?? current.window_end;
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : current.weekdays;
  const dailyCap = Math.min(
    DEFAULT_DAILY_CAP,
    Math.max(1, Number(input.daily_cap ?? current.daily_cap))
  );
  const domainCap = Math.min(
    3,
    Math.max(1, Number(input.domain_daily_cap ?? current.domain_daily_cap))
  );
  const minGap = Math.min(
    60,
    Math.max(1, Number(input.min_gap_minutes ?? current.min_gap_minutes))
  );
  const maxGap = Math.min(
    120,
    Math.max(minGap, Number(input.max_gap_minutes ?? current.max_gap_minutes))
  );
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(windowStart)) {
    return { error: "Start time must be HH:MM (24-hour)" };
  }
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(windowEnd)) {
    return { error: "End time must be HH:MM (24-hour)" };
  }
  if (windowStart >= windowEnd) return { error: "End time must be after start time" };
  if (weekdays.length === 0) return { error: "Pick at least one send day" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_send_policies")
    .upsert({
      workspace_id: workspaceId,
      timezone,
      window_start: windowStart,
      window_end: windowEnd,
      weekdays,
      daily_cap: dailyCap,
      domain_daily_cap: domainCap,
      min_gap_minutes: minGap,
      max_gap_minutes: maxGap,
      configured: true,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not save the schedule" };
  return { policy: data as SendPolicy };
}

function warmupCap(policy: SendPolicy, firstActivityAt: string | null, forDate: string): {
  cap: number;
  warmup: boolean;
} {
  if (!firstActivityAt) return { cap: Math.min(10, policy.daily_cap), warmup: true };
  const startKey = dateKey(new Date(firstActivityAt), policy.timezone);
  const day = Math.max(0, daysBetweenKeys(startKey, forDate));
  if (day < 7) return { cap: Math.min(10, policy.daily_cap), warmup: true };
  if (day < 14) return { cap: Math.min(20, policy.daily_cap), warmup: true };
  return { cap: policy.daily_cap, warmup: false };
}

async function firstActivityAt(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const [{ data: sent }, { data: coin }] = await Promise.all([
    admin
      .from("sent_emails")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("sent_by", userId)
      .order("created_at", { ascending: true })
      .limit(1),
    admin
      .from("email_send_coins")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  const dates = [sent?.[0]?.created_at, coin?.[0]?.created_at].filter(
    (value): value is string => typeof value === "string"
  );
  return dates.sort()[0] ?? null;
}

function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

async function usageForDay(
  workspaceId: string,
  userId: string,
  timezone: string,
  forDate: string,
  excludeQueueId?: number
): Promise<{
  sent: { to_email: string; created_at: string }[];
  scheduled: { to_email: string; scheduled_for: string }[];
  lastScheduledAt: string | null;
  lastSentAt: string | null;
}> {
  const admin = createAdminClient();
  const { start, end } = dayRangeUtc(forDate, timezone);
  const [{ data: sent }, { data: scheduled }] = await Promise.all([
    admin
      .from("sent_emails")
      .select("to_email, created_at")
      .eq("workspace_id", workspaceId)
      .eq("sent_by", userId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false }),
    admin
      .from("email_send_queue")
      .select("to_email, scheduled_for")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .in("status", ["scheduled", "sending"])
      .neq("id", excludeQueueId ?? 0)
      .gte("scheduled_for", start.toISOString())
      .lt("scheduled_for", end.toISOString())
      .order("scheduled_for", { ascending: false }),
  ]);
  const sentRows = (sent ?? []) as { to_email: string; created_at: string }[];
  const scheduledRows = (scheduled ?? []) as {
    to_email: string;
    scheduled_for: string;
  }[];
  return {
    sent: sentRows,
    scheduled: scheduledRows,
    lastScheduledAt: scheduledRows[0]?.scheduled_for ?? null,
    lastSentAt: sentRows[0]?.created_at ?? null,
  };
}

function dayBalance(
  policy: SendPolicy,
  firstAt: string | null,
  forDate: string,
  sent: { to_email: string; created_at: string }[],
  scheduled: { to_email: string; scheduled_for: string }[]
): SendDayBalance {
  const capInfo = warmupCap(policy, firstAt, forDate);
  const used = sent.length + scheduled.length;
  return {
    date: forDate,
    cap: capInfo.cap,
    sent: sent.length,
    scheduled: scheduled.length,
    remaining: Math.max(0, capInfo.cap - used),
    domainCap: policy.domain_daily_cap,
    warmup: capInfo.warmup,
  };
}

export async function getSendOverview(
  workspaceId: string,
  userId: string,
  timezone?: string
): Promise<SendOverview> {
  try {
    const policy = await getSendPolicy(workspaceId, timezone);
    const firstAt = await firstActivityAt(workspaceId, userId);
    const today = dateKey(new Date(), policy.timezone);
    const days: SendDayBalance[] = [];
    for (let offset = 0; offset < 14 && days.length < 5; offset += 1) {
      const key = addDaysToKey(today, offset);
      if (!policy.weekdays.includes(weekdayForKey(key))) continue;
      const usage = await usageForDay(workspaceId, userId, policy.timezone, key);
      days.push(dayBalance(policy, firstAt, key, usage.sent, usage.scheduled));
    }
    const admin = createAdminClient();
    const { data: queue } = await admin
      .from("email_send_queue")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("scheduled_for", { ascending: false })
      .limit(30);
    const { data: coins } = await admin
      .from("email_send_coins")
      .select("id, for_date, expires_at, status, created_at")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    const coinMap = new Map(
      ((coins ?? []) as SendCoinItem[]).map((coin) => [coin.id, coin])
    );
    const queueRows = (queue ?? []) as SendQueueItem[];
    const orgIds = [...new Set(queueRows.map((item) => item.org_id))];
    const { data: orgs } = orgIds.length
      ? await admin.from("organizations").select("id, name").in("id", orgIds)
      : { data: [] };
    const orgNames = new Map(
      (orgs ?? []).map((row) => [row.id as number, row.name as string])
    );
    return {
      available: true,
      policy,
      days,
      queue: queueRows.map((item) => ({
        ...item,
        coin: coinMap.get(item.coin_id) ?? null,
        org_name: orgNames.get(item.org_id) ?? undefined,
      })),
      first_activity_at: firstAt,
    };
  } catch (err) {
    return {
      available: false,
      policy: policyDefaults(workspaceId, timezone),
      days: [],
      queue: [],
      first_activity_at: null,
      note:
        err instanceof Error
          ? "Send coins are not set up yet — apply the Phase 3 migration."
          : "Send coins are not set up yet.",
    };
  }
}

async function findSlot(input: {
  workspaceId: string;
  userId: string;
  policy: SendPolicy;
  domain: string;
  excludeQueueId?: number;
}): Promise<PlannedSlot> {
  const { workspaceId, userId, policy, domain, excludeQueueId } = input;
  const firstAt = await firstActivityAt(workspaceId, userId);
  const now = Date.now();
  const today = dateKey(new Date(now), policy.timezone);

  for (let offset = 0; offset < 21; offset += 1) {
    const key = addDaysToKey(today, offset);
    if (!policy.weekdays.includes(weekdayForKey(key))) continue;
    const usage = await usageForDay(
      workspaceId,
      userId,
      policy.timezone,
      key,
      excludeQueueId
    );
    const balance = dayBalance(policy, firstAt, key, usage.sent, usage.scheduled);
    if (balance.remaining <= 0) continue;
    const domainUsed =
      usage.sent.filter((row) => domainOf(row.to_email) === domain).length +
      usage.scheduled.filter((row) => domainOf(row.to_email) === domain).length;
    if (domainUsed >= policy.domain_daily_cap) continue;

    const window = windowForDateKey(
      key,
      policy.timezone,
      policy.window_start,
      policy.window_end
    );
    if (window.end.getTime() <= now) continue;
    const minGapMs = policy.min_gap_minutes * 60_000;
    const maxGapMs = policy.max_gap_minutes * 60_000;
    const randomGap =
      minGapMs + Math.floor(Math.random() * Math.max(1, maxGapMs - minGapMs));
    let slot = Math.max(now + minGapMs, window.start.getTime());
    const previous = Math.max(
      Date.parse(usage.lastSentAt ?? "") || 0,
      Date.parse(usage.lastScheduledAt ?? "") || 0
    );
    if (previous > 0) slot = Math.max(slot, previous + randomGap);
    else slot += Math.floor(Math.random() * 90_000);
    if (slot >= window.end.getTime()) continue;
    return {
      scheduledFor: new Date(slot),
      dateKey: key,
      gapMinutes: Math.round(randomGap / 60_000),
    };
  }
  throw new Error("No safe send slot is available in the next three weeks");
}

export interface PreflightInput {
  workspaceId: string;
  userId: string;
  orgId: number;
  contactId?: number | null;
  to: string;
  subject: string;
  body: string;
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  contactId: number | null;
  recipient?: ReturnType<typeof classifyRecipient>;
  orgName?: string;
}

const SPAM_RE =
  /\b(act now|limited time|risk[- ]free|100%|click here|buy now|no obligation|winner|congratulations|urgent action|make money|earn money|crypto|guaranteed|guarantee)\b/i;

export async function preflightSend(input: PreflightInput): Promise<PreflightResult> {
  const { workspaceId, userId, orgId } = input;
  const to = input.to.trim().toLowerCase();
  const subject = input.subject.trim();
  const body = input.body.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const admin = createAdminClient();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) errors.push("Enter a valid recipient email.");
  if (!subject) errors.push("Subject is required.");
  if (!body) errors.push("Email body is required.");
  if (/\r|\n/.test(subject)) errors.push("Subject cannot contain line breaks.");
  if (subject.length > 90) errors.push("Subject must be 90 characters or fewer.");
  const subjectWords = subject.split(/\s+/).filter(Boolean);
  if (subjectWords.length > 8) errors.push("Keep the subject to 8 words or fewer.");
  if (/!/.test(subject) || /!/.test(body)) errors.push("Exclamation marks look promotional — remove them.");
  if (/<[^>]+>/.test(body)) errors.push("Use plain text only (no HTML).");
  if (/https?:\/\/|www\./i.test(body)) errors.push("Remove links from cold first-contact email.");
  if (SPAM_RE.test(`${subject}\n${body}`)) {
    errors.push("Remove promotional spam phrases (free, guarantee, urgent, etc.).");
  }
  const bodyWords = body.split(/\s+/).filter(Boolean).length;
  if (bodyWords < 35) errors.push("Write at least 35 words so the email has substance.");
  if (bodyWords > 200) errors.push("Keep the email under 200 words.");
  const letters = subject.replace(/[^A-Za-z]/g, "");
  if (letters.length > 8 && letters === letters.toUpperCase()) {
    errors.push("Do not use an all-caps subject.");
  }

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, workspace_id")
    .eq("id", orgId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!org) {
    return { ok: false, errors: ["Company not found in this workspace"], warnings, contactId: null };
  }

  const { data: settings } = await admin
    .from("user_email_settings")
    .select("from_email, smtp_host, smtp_user, smtp_password_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings?.smtp_host || !settings.smtp_user || !settings.smtp_password_enc) {
    errors.push("Set up email sending first in Settings → Email.");
  }
  const fromEmail = String(settings?.from_email ?? settings?.smtp_user ?? "").toLowerCase();
  if (fromEmail && to === fromEmail) errors.push("You cannot send to your own mailbox.");

  const [{ data: contacts }, { data: companyEmails }, { data: suppressed }] =
    await Promise.all([
      admin
        .from("contacts")
        .select("id, email, name, title, email_status")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId)
        .not("email", "is", null),
      admin
        .from("company_emails")
        .select("email")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId),
      admin
        .from("suppression_list")
        .select("id, reason")
        .eq("workspace_id", workspaceId)
        .eq("email", to)
        .maybeSingle(),
    ]);

  const contactRows = (contacts ?? []) as {
    id: number;
    email: string;
    name: string | null;
    title: string | null;
    email_status: string | null;
  }[];
  const matchedContact =
    contactRows.find(
      (contact) =>
        contact.email.trim().toLowerCase() === to &&
        (!input.contactId || contact.id === input.contactId)
    ) ??
    contactRows.find((contact) => contact.email.trim().toLowerCase() === to) ??
    null;
  const companyEmail = (companyEmails ?? []).some(
    (row) => String(row.email).trim().toLowerCase() === to
  );
  if (!matchedContact && !companyEmail) {
    errors.push(
      "That address is not saved for this company. Add it as a contact first so sends stay intentional."
    );
  }
  if (suppressed) errors.push("This recipient is on the suppression list.");

  if (to) {
    const { data: verification } = await admin
      .from("email_verifications")
      .select("status")
      .eq("workspace_id", workspaceId)
      .eq("email", to)
      .maybeSingle();
    if (verification?.status === "invalid") {
      errors.push("This address is marked invalid — verify or replace it.");
    } else if (verification?.status === "risky") {
      warnings.push("This address is marked risky by verification.");
    } else if (!verification) {
      warnings.push("Email is unverified — delivery is not guaranteed.");
    }
  }

  const cutoff = new Date(
    Date.now() - PRIOR_CONTACT_DAYS * 86_400_000
  ).toISOString();
  const [{ data: priorEmail }, { data: priorOrg }, { data: queuedEmail }, { data: queuedOrg }] =
    await Promise.all([
      admin
        .from("sent_emails")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("to_email", to)
        .gte("created_at", cutoff)
        .limit(1),
      admin
        .from("sent_emails")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId)
        .gte("created_at", cutoff)
        .limit(1),
      admin
        .from("email_send_queue")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("to_email", to)
        .in("status", ["scheduled", "sending"])
        .limit(1),
      admin
        .from("email_send_queue")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId)
        .in("status", ["scheduled", "sending"])
        .limit(1),
    ]);
  if (priorEmail?.length || priorOrg?.length) {
    errors.push(`This company was contacted in the last ${PRIOR_CONTACT_DAYS} days.`);
  }
  if (queuedEmail?.length || queuedOrg?.length) {
    errors.push("This company or address already has a scheduled send.");
  }

  const { data: threads } = await admin
    .from("email_threads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("counterparty_email", to)
    .limit(20);
  if (threads?.length) {
    const { count } = await admin
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .in("thread_id", threads.map((row) => row.id))
      .eq("direction", "in");
    if ((count ?? 0) > 0) errors.push("This recipient already replied — continue in the thread instead.");
  }

  const recipient = classifyRecipient({
    email: to,
    contactName: matchedContact?.name ?? null,
    contactTitle: matchedContact?.title ?? null,
    emailStatus: matchedContact?.email_status ?? null,
  });
  if (recipient.strategy === "do_not_contact") {
    errors.push("This looks like a no-reply address — choose a real person or team inbox.");
  }
  if (recipient.type === "shared") {
    warnings.push("Shared inbox — delivery is possible but a reply is less likely.");
  }
  if (recipient.type === "unknown") {
    warnings.push("Unknown inbox type — the recipient may not read this.");
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    contactId: matchedContact?.id ?? null,
    recipient,
    orgName: String(org.name ?? "Company"),
  };
}

export function contentHash(to: string, subject: string, body: string): string {
  return createHash("sha256")
    .update(`${to.trim().toLowerCase()}\n${subject.trim()}\n${body.trim()}`)
    .digest("hex");
}

export async function approveAndSchedule(input: PreflightInput & {
  timezone?: string;
  agentRunId?: number | null;
}): Promise<
  | { ok: true; approval: SendApproval }
  | { ok: false; error: string; errors?: string[]; warnings?: string[] }
> {
  const preflight = await preflightSend(input);
  if (!preflight.ok) {
    return {
      ok: false,
      error: preflight.errors[0] ?? "This email is not ready to send",
      errors: preflight.errors,
      warnings: preflight.warnings,
    };
  }

  const admin = createAdminClient();
  const policy = await getSendPolicy(input.workspaceId, input.timezone);
  const to = input.to.trim().toLowerCase();
  const subject = input.subject.trim();
  const body = input.body.trim();
  let agentRunId: number | null = null;
  if (input.agentRunId) {
    const { data: run } = await admin
      .from("activity_log")
      .select("id")
      .eq("id", input.agentRunId)
      .eq("actor_id", input.userId)
      .eq("workspace_id", input.workspaceId)
      .eq("action", "agent.run")
      .maybeSingle();
    if (run) agentRunId = Number(run.id);
  }

  const slot = await findSlot({
    workspaceId: input.workspaceId,
    userId: input.userId,
    policy,
    domain: domainOf(to),
  });
  const hash = contentHash(to, subject, body);
  const expiresAt = new Date(
    slot.scheduledFor.getTime() + 72 * 3_600_000
  ).toISOString();

  const { data: coin, error: coinError } = await admin
    .from("email_send_coins")
    .insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      org_id: input.orgId,
      contact_id: preflight.contactId,
      to_email: to,
      subject,
      body,
      content_hash: hash,
      status: "queued",
      for_date: slot.dateKey,
      expires_at: expiresAt,
      agent_run_id: agentRunId,
    })
    .select("id, for_date, expires_at, status, created_at")
    .single();
  if (coinError || !coin) {
    return { ok: false, error: coinError?.message ?? "Could not mint the send coin" };
  }

  const { data: queue, error: queueError } = await admin
    .from("email_send_queue")
    .insert({
      workspace_id: input.workspaceId,
      coin_id: coin.id,
      user_id: input.userId,
      org_id: input.orgId,
      contact_id: preflight.contactId,
      to_email: to,
      subject,
      body,
      content_hash: hash,
      scheduled_for: slot.scheduledFor.toISOString(),
      status: "scheduled",
      agent_run_id: agentRunId,
    })
    .select("*")
    .single();
  if (queueError || !queue) {
    await admin.from("email_send_coins").delete().eq("id", coin.id);
    return { ok: false, error: queueError?.message ?? "Could not schedule the send" };
  }

  const firstAt = await firstActivityAt(input.workspaceId, input.userId);
  const usage = await usageForDay(
    input.workspaceId,
    input.userId,
    policy.timezone,
    slot.dateKey
  );
  const day = dayBalance(policy, firstAt, slot.dateKey, usage.sent, usage.scheduled);

  await logActivity({
    actorId: input.userId,
    action: "email.coin",
    orgId: input.orgId,
    targetType: "company",
    targetId: input.orgId,
    summary: `Approved send coin for ${preflight.orgName} → ${to} · ${localTimeLabel(
      slot.scheduledFor,
      policy.timezone
    )}`,
    details: {
      coin_id: coin.id,
      queue_id: queue.id,
      scheduled_for: slot.scheduledFor.toISOString(),
      timezone: policy.timezone,
      recipient_type: preflight.recipient?.type,
      recipient_strategy: preflight.recipient?.strategy,
      warnings: preflight.warnings,
    },
  });

  return {
    ok: true,
    approval: {
      coin: coin as SendCoinItem,
      queue: queue as SendQueueItem,
      warnings: preflight.warnings,
      day,
    },
  };
}

export async function cancelSend(
  queueId: number,
  userId: string,
  workspaceId: string
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: queue } = await admin
    .from("email_send_queue")
    .select("*")
    .eq("id", queueId)
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!queue) return { ok: false, error: "Scheduled send not found" };
  if (queue.status !== "scheduled") {
    return { ok: false, error: "Only a scheduled send can be cancelled" };
  }
  const { error } = await admin
    .from("email_send_queue")
    .update({
      status: "cancelled",
      last_error: "Cancelled by user before sending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", queueId)
    .eq("status", "scheduled");
  if (error) return { ok: false, error: error.message };
  await admin
    .from("email_send_coins")
    .update({ status: "cancelled" })
    .eq("id", queue.coin_id)
    .eq("status", "queued");
  await logActivity({
    actorId: userId,
    action: "email.coin_cancel",
    orgId: Number(queue.org_id),
    targetType: "company",
    targetId: Number(queue.org_id),
    summary: `Cancelled scheduled email to ${queue.to_email}`,
    details: { queue_id: queueId, coin_id: queue.coin_id },
  });
  return { ok: true };
}

async function rescheduleQueue(
  queue: SendQueueItem,
  policy: SendPolicy,
  reason: string
): Promise<"scheduled" | "failed"> {
  const admin = createAdminClient();
  try {
    if (new Date(queue.scheduled_for).getTime() > Date.now() + 60_000) {
      await admin
        .from("email_send_queue")
        .update({
          status: "scheduled",
          last_error: reason.slice(0, 300),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queue.id);
      return "scheduled";
    }
    const slot = await findSlot({
      workspaceId: queue.workspace_id,
      userId: queue.user_id,
      policy,
      domain: domainOf(queue.to_email),
      excludeQueueId: queue.id,
    });
    await admin
      .from("email_send_queue")
      .update({
        scheduled_for: slot.scheduledFor.toISOString(),
        status: "scheduled",
        last_error: reason.slice(0, 300),
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue.id);
    await admin
      .from("email_send_coins")
      .update({
        for_date: slot.dateKey,
        expires_at: new Date(
          slot.scheduledFor.getTime() + 72 * 3_600_000
        ).toISOString(),
      })
      .eq("id", queue.coin_id);
    return "scheduled";
  } catch (err) {
    await admin
      .from("email_send_queue")
      .update({
        status: "failed",
        last_error:
          err instanceof Error ? err.message : "Could not reschedule the send",
        updated_at: new Date().toISOString(),
      })
      .eq("id", queue.id);
    await admin
      .from("email_send_coins")
      .update({ status: "failed" })
      .eq("id", queue.coin_id);
    return "failed";
  }
}

async function sendQueueItem(queue: SendQueueItem): Promise<
  "sent" | "failed" | "scheduled" | "skipped"
> {
  const admin = createAdminClient();
  const now = new Date();
  const { data: claimed } = await admin
    .from("email_send_queue")
    .update({
      status: "sending",
      attempts: Number(queue.attempts ?? 0) + 1,
      updated_at: now.toISOString(),
    })
    .eq("id", queue.id)
    .eq("status", "scheduled")
    .select("*")
    .maybeSingle();
  if (!claimed) return "skipped";
  const item = claimed as SendQueueItem;
  const fail = async (reason: string): Promise<"failed"> => {
    await admin
      .from("email_send_queue")
      .update({
        status: "failed",
        last_error: reason.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    await admin
      .from("email_send_coins")
      .update({ status: "failed" })
      .eq("id", item.coin_id)
      .eq("status", "queued");
    await logActivity({
      actorId: item.user_id,
      action: "email.send_failed",
      orgId: item.org_id,
      targetType: "company",
      targetId: item.org_id,
      summary: `Scheduled email to ${item.to_email} failed: ${reason.slice(0, 160)}`,
      details: { queue_id: item.id, coin_id: item.coin_id, reason },
    });
    return "failed";
  };

  const { data: coin } = await admin
    .from("email_send_coins")
    .select("*")
    .eq("id", item.coin_id)
    .maybeSingle();
  if (!coin || coin.status !== "queued") return fail("The send coin is no longer valid");
  if (new Date(String(coin.expires_at)).getTime() < Date.now()) {
    return fail("The approval coin expired before sending");
  }
  if (
    contentHash(item.to_email, item.subject, item.body) !== item.content_hash ||
    item.content_hash !== coin.content_hash
  ) {
    return fail("The approved content changed — approve the draft again");
  }

  const policy = await getSendPolicy(item.workspace_id);
  if (
    !isWithinWindow(
      now,
      policy.timezone,
      policy.weekdays,
      policy.window_start,
      policy.window_end
    )
  ) {
    return (await rescheduleQueue(item, policy, "Outside the send window")) ===
      "scheduled"
      ? "scheduled"
      : "failed";
  }

  const today = dateKey(now, policy.timezone);
  const usage = await usageForDay(
    item.workspace_id,
    item.user_id,
    policy.timezone,
    today,
    item.id
  );
  const firstAt = await firstActivityAt(item.workspace_id, item.user_id);
  const capInfo = warmupCap(policy, firstAt, today);
  if (usage.sent.length >= capInfo.cap) {
    return (await rescheduleQueue(item, policy, "Daily send allowance reached")) ===
      "scheduled"
      ? "scheduled"
      : "failed";
  }
  const domainSent = usage.sent.filter(
    (row) => domainOf(row.to_email) === domainOf(item.to_email)
  ).length;
  if (domainSent >= policy.domain_daily_cap) {
    return (await rescheduleQueue(item, policy, "Daily domain limit reached")) ===
      "scheduled"
      ? "scheduled"
      : "failed";
  }
  const lastSent = Date.parse(usage.lastSentAt ?? "") || 0;
  if (lastSent > 0 && now.getTime() - lastSent < policy.min_gap_minutes * 60_000) {
    return (await rescheduleQueue(item, policy, "Human-paced gap between sends")) ===
      "scheduled"
      ? "scheduled"
      : "failed";
  }

  const { data: suppressed } = await admin
    .from("suppression_list")
    .select("id")
    .eq("workspace_id", item.workspace_id)
    .eq("email", item.to_email)
    .maybeSingle();
  if (suppressed) return fail("Recipient is on the suppression list");
  const { data: verification } = await admin
    .from("email_verifications")
    .select("status")
    .eq("workspace_id", item.workspace_id)
    .eq("email", item.to_email)
    .maybeSingle();
  if (verification?.status === "invalid") return fail("Recipient address is invalid");
  const { data: threads } = await admin
    .from("email_threads")
    .select("id")
    .eq("workspace_id", item.workspace_id)
    .eq("counterparty_email", item.to_email)
    .limit(20);
  if (threads?.length) {
    const { count } = await admin
      .from("email_messages")
      .select("id", { count: "exact", head: true })
      .in("thread_id", threads.map((row) => row.id))
      .eq("direction", "in");
    if ((count ?? 0) > 0) return fail("Recipient already replied — send cancelled");
  }

  const { data: settings } = await admin
    .from("user_email_settings")
    .select(
      "from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc"
    )
    .eq("user_id", item.user_id)
    .maybeSingle();
  if (
    !settings?.smtp_host ||
    !settings.smtp_user ||
    !settings.smtp_password_enc
  ) {
    return fail("Email sending is not configured for this sender");
  }
  let password: string;
  try {
    password = decryptSecret(settings.smtp_password_enc);
  } catch {
    return fail("Saved SMTP password could not be read");
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
      { to: item.to_email, subject: item.subject, body: item.body }
    ));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "SMTP send failed");
  }

  const { data: sent } = await admin
    .from("sent_emails")
    .insert({
      org_id: item.org_id,
      workspace_id: item.workspace_id,
      contact_id: item.contact_id,
      sent_by: item.user_id,
      to_email: item.to_email,
      subject: item.subject,
      body: item.body,
      message_id: messageId,
    })
    .select("id")
    .maybeSingle();

  await admin
    .from("email_send_queue")
    .update({
      status: "sent",
      sent_email_id: sent?.id ?? null,
      sent_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", item.id);
  await admin
    .from("email_send_coins")
    .update({ status: "sent", used_at: new Date().toISOString() })
    .eq("id", item.coin_id);

  await recordOutbound(admin, {
    workspaceId: item.workspace_id,
    userId: item.user_id,
    orgId: item.org_id,
    contactId: item.contact_id,
    fromEmail:
      (settings.from_email as string | null) ?? (settings.smtp_user as string),
    toEmail: item.to_email,
    subject: item.subject,
    body: item.body,
    messageId,
  }).catch((err) => {
    console.error("[send-queue] thread record failed:", err);
  });
  await admin.from("interactions").insert({
    org_id: item.org_id,
    workspace_id: item.workspace_id,
    contact_id: item.contact_id,
    channel: "email",
    summary: `Scheduled email sent: ${item.subject}`,
    logged_by: item.user_id,
  });
  const recipient = classifyRecipient({ email: item.to_email });
  await logActivity({
    actorId: item.user_id,
    action: "email.sent",
    orgId: item.org_id,
    targetType: "company",
    targetId: item.org_id,
    summary: `Sent “${item.subject}” to ${item.to_email} (approved coin)`,
    details: {
      source: "send_coin",
      coin_id: item.coin_id,
      queue_id: item.id,
      scheduled_for: item.scheduled_for,
      recipient_type: recipient.type,
      inbox_category: recipient.category,
      draft_strategy: recipient.strategy,
    },
  });
  return "sent";
}

export async function processDueSends(options?: {
  workspaceId?: string;
  limit?: number;
}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  scheduled: number;
  skipped: number;
}> {
  const admin = createAdminClient();
  const now = new Date();
  const staleCutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin
    .from("email_send_queue")
    .update({
      status: "scheduled",
      last_error: "Worker restarted after an interrupted send",
      updated_at: now.toISOString(),
    })
    .eq("status", "sending")
    .lt("updated_at", staleCutoff);

  let query = admin
    .from("email_send_queue")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(Math.min(10, Math.max(1, options?.limit ?? 3)));
  if (options?.workspaceId) query = query.eq("workspace_id", options.workspaceId);
  const { data } = await query;
  const due = (data ?? []) as SendQueueItem[];
  const result = { processed: due.length, sent: 0, failed: 0, scheduled: 0, skipped: 0 };
  for (const item of due) {
    const outcome = await sendQueueItem(item);
    result[outcome] += 1;
  }
  return result;
}
