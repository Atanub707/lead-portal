import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { createClient } from "./supabase/server";
import { ensureProfile } from "./auth";
import {
  FALLBACK_PIPELINES,
  type CompanyEmail,
  type Contact,
  type EmailSettings,
  type EnrichmentRun,
  type EnrichmentRunWithOrg,
  type Interaction,
  type InteractionWithOrg,
  type OrgList,
  type Organization,
  type Pipeline,
  type Profile,
  type Workspace,
} from "./types";

// id -> display label for attribution ("who added this").
async function userLabels(): Promise<
  Map<string, { label: string; email: string | null; avatar: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar");
  const map = new Map<
    string,
    { label: string; email: string | null; avatar: string | null }
  >();
  for (const profile of data ?? []) {
    const firstWord = (profile.full_name ?? "").trim().split(/\s+/)[0];
    const label =
      firstWord || (profile.email ? profile.email.split("@")[0] : "Someone");
    map.set(profile.id, {
      label,
      email: profile.email ?? null,
      avatar: profile.avatar ?? null,
    });
  }
  return map;
}

export async function getDashboardStats(): Promise<{
  totalCompanies: number;
  perList: Record<string, number>;
  people: number;
  decisionMakers: number;
  emails: number;
  followUps: { overdue: number; today: number; soon: number };
}> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const workspaceId = await activeWorkspaceId();

  const [orgs, contacts, companyEmails] = await Promise.all([
    supabase
      .from("organizations")
      .select("list, follow_up_on")
      .eq("workspace_id", workspaceId),
    supabase
      .from("contacts")
      .select("email, is_decision_maker")
      .eq("workspace_id", workspaceId),
    supabase
      .from("company_emails")
      .select("id")
      .eq("workspace_id", workspaceId),
  ]);

  const orgRows = (orgs.data ?? []) as {
    list: string;
    follow_up_on: string | null;
  }[];
  const contactRows = (contacts.data ?? []) as {
    email: string | null;
    is_decision_maker: boolean;
  }[];

  const perList: Record<string, number> = {};
  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  for (const org of orgRows) {
    perList[org.list] = (perList[org.list] ?? 0) + 1;
    if (!org.follow_up_on) continue;
    if (org.follow_up_on < today) overdue += 1;
    else if (org.follow_up_on === today) dueToday += 1;
    else if (org.follow_up_on <= soon) dueSoon += 1;
  }

  return {
    totalCompanies: orgRows.length,
    perList,
    people: contactRows.length,
    decisionMakers: contactRows.filter((c) => c.is_decision_maker).length,
    emails:
      contactRows.filter((c) => c.email).length +
      (companyEmails.data?.length ?? 0),
    followUps: { overdue, today: dueToday, soon: dueSoon },
  };
}

export interface FollowUpItem {
  id: number;
  name: string;
  list: OrgList;
  follow_up_on: string;
  follow_up_note: string | null;
}

export async function getUpcomingFollowUps(
  limit = 6
): Promise<FollowUpItem[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, list, follow_up_on, follow_up_note")
    .eq("workspace_id", workspaceId)
    .not("follow_up_on", "is", null)
    .order("follow_up_on")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as FollowUpItem[];
}

export async function getRecentRuns(limit = 5): Promise<EnrichmentRunWithOrg[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("enrichment_runs")
    .select("*, organizations!inner(name, list)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EnrichmentRunWithOrg[];
}

export async function getPipelines(): Promise<Pipeline[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order")
    .order("created_at");
  if (error || !data || data.length === 0) return FALLBACK_PIPELINES;
  return (data as Pipeline[]).map((pipeline) => ({
    ...pipeline,
    stages: pipeline.stages ?? [],
  }));
}

export interface PipelineUsage {
  id: string;
  name: string;
  icon: string;
  pitch: string | null;
  value_props: string[];
  proof_points: string[];
  cta: string | null;
  default_flavor: string | null;
  count: number;
}

export async function getPipelineUsage(): Promise<PipelineUsage[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const [{ data: pipelines }, { data: orgs }] = await Promise.all([
    supabase
      .from("pipelines")
      .select(
        "id, name, icon, pitch, value_props, proof_points, cta, default_flavor"
      )
      .eq("workspace_id", workspaceId)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("organizations")
      .select("list")
      .eq("workspace_id", workspaceId),
  ]);
  const counts = new Map<string, number>();
  for (const org of orgs ?? []) {
    counts.set(org.list, (counts.get(org.list) ?? 0) + 1);
  }
  return (pipelines ?? []).map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    icon: pipeline.icon,
    pitch: pipeline.pitch ?? null,
    value_props: pipeline.value_props ?? [],
    proof_points: pipeline.proof_points ?? [],
    cta: pipeline.cta ?? null,
    default_flavor: pipeline.default_flavor ?? null,
    count: counts.get(pipeline.id) ?? 0,
  }));
}

export interface CompanyRow extends Organization {
  people_count: number;
  decision_maker_count: number;
  email_count: number;
  first_email: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
  created_by_avatar: string | null;
  last_sent_by: string | null;
  last_sent_by_name: string | null;
  last_sent_by_avatar: string | null;
  last_sent_at: string | null;
  last_sent_subject: string | null;
}

export async function getCompanies(opts: {
  list: OrgList;
  q?: string;
  kind?: string;
  follow?: string;
  starred?: boolean;
  page?: number;
  per?: number;
}): Promise<{ rows: CompanyRow[]; count: number }> {
  const supabase = await createClient();
  const per = opts.per && opts.per > 0 ? opts.per : 20;
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const from = (page - 1) * per;

  const today = new Date().toISOString().slice(0, 10);
  const dueSoon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const workspaceId = await activeWorkspaceId();
  let query = supabase
    .from("organizations")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("list", opts.list)
    .order("name")
    .range(from, from + per - 1);

  if (opts.kind) query = query.eq("kind", opts.kind);
  if (opts.q) query = query.ilike("name", `%${opts.q}%`);
  if (opts.starred) query = query.eq("bookmarked", true);
  if (opts.follow === "overdue") query = query.lt("follow_up_on", today);
  if (opts.follow === "soon") {
    query = query.gte("follow_up_on", today).lte("follow_up_on", dueSoon);
  }
  if (opts.follow === "none") query = query.is("follow_up_on", null);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Organization[];
  const stats = new Map<
    number,
    {
      people: number;
      decisionMakers: number;
      emails: number;
      firstEmail: string | null;
    }
  >();
  const ids = rows.map((row) => row.id);

  const sentByOrg = new Map<
    number,
    { sent_by: string | null; subject: string; created_at: string }
  >();

  if (ids.length > 0) {
    const [{ data: contactRows }, { data: companyEmailRows }, { data: sentRows }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("org_id, email, is_decision_maker")
          .eq("workspace_id", workspaceId)
          .in("org_id", ids),
        supabase
          .from("company_emails")
          .select("org_id, email")
          .eq("workspace_id", workspaceId)
          .in("org_id", ids),
        supabase
          .from("sent_emails")
          .select("org_id, sent_by, subject, created_at")
          .eq("workspace_id", workspaceId)
          .in("org_id", ids)
          .order("created_at", { ascending: false }),
      ]);

    for (const sent of sentRows ?? []) {
      if (!sentByOrg.has(sent.org_id)) {
        sentByOrg.set(sent.org_id, {
          sent_by: sent.sent_by,
          subject: sent.subject,
          created_at: sent.created_at,
        });
      }
    }

    for (const contact of contactRows ?? []) {
      const entry = stats.get(contact.org_id) ?? {
        people: 0,
        decisionMakers: 0,
        emails: 0,
        firstEmail: null,
      };
      entry.people += 1;
      if (contact.is_decision_maker) entry.decisionMakers += 1;
      if (contact.email) {
        entry.emails += 1;
        if (!entry.firstEmail) entry.firstEmail = contact.email;
      }
      stats.set(contact.org_id, entry);
    }

    for (const companyEmail of companyEmailRows ?? []) {
      const entry = stats.get(companyEmail.org_id) ?? {
        people: 0,
        decisionMakers: 0,
        emails: 0,
        firstEmail: null,
      };
      entry.emails += 1;
      if (!entry.firstEmail) entry.firstEmail = companyEmail.email;
      stats.set(companyEmail.org_id, entry);
    }
  }

  const labels = rows.length > 0 ? await userLabels() : new Map();

  const enriched: CompanyRow[] = rows.map((row) => {
    const entry = stats.get(row.id) ?? {
      people: 0,
      decisionMakers: 0,
      emails: 0,
      firstEmail: null,
    };
    return {
      ...row,
      people_count: entry.people,
      decision_maker_count: entry.decisionMakers,
      email_count: entry.emails,
      first_email: entry.firstEmail,
      created_by_name: row.created_by
        ? (labels.get(row.created_by)?.label ?? null)
        : null,
      created_by_email: row.created_by
        ? (labels.get(row.created_by)?.email ?? null)
        : null,
      created_by_avatar: row.created_by
        ? (labels.get(row.created_by)?.avatar ?? null)
        : null,
      last_sent_by: sentByOrg.get(row.id)?.sent_by ?? null,
      last_sent_by_name: sentByOrg.get(row.id)?.sent_by
        ? (labels.get(sentByOrg.get(row.id)?.sent_by ?? "")?.label ?? null)
        : null,
      last_sent_by_avatar: sentByOrg.get(row.id)?.sent_by
        ? (labels.get(sentByOrg.get(row.id)?.sent_by ?? "")?.avatar ?? null)
        : null,
      last_sent_at: sentByOrg.get(row.id)?.created_at ?? null,
      last_sent_subject: sentByOrg.get(row.id)?.subject ?? null,
    };
  });

  return { rows: enriched, count: count ?? 0 };
}

export async function getStatusCounts(
  list: OrgList
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("organizations")
    .select("status")
    .eq("workspace_id", workspaceId)
    .eq("list", list);
  if (error) throw new Error(error.message);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const s = (row as { status: string }).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

export async function getCompany(id: number): Promise<Organization | null> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Organization | null) ?? null;
}

export async function getContacts(orgId: number): Promise<Contact[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", workspaceId)
    .order("is_decision_maker", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Contact[];
}

export async function getCompanyEmails(orgId: number): Promise<CompanyEmail[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data, error } = await supabase
    .from("company_emails")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", workspaceId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as CompanyEmail[];
}

export async function getEnrichmentRuns(
  orgId: number
): Promise<EnrichmentRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrichment_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", await activeWorkspaceId())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as EnrichmentRun[];
}

export interface DeepResearchState {
  activeRunId: number | null;
  lastSuccessAt: string | null;
  latest: EnrichmentRun | null;
}

export async function getDeepResearchState(orgId: number): Promise<DeepResearchState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrichment_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", await activeWorkspaceId())
    .eq("kind", "deep_research")
    .order("created_at", { ascending: false })
    .limit(5);
  const runs = (data ?? []) as EnrichmentRun[];
  return {
    activeRunId:
      runs.find((r) => r.status === "running" || r.status === "reconciling")
        ?.id ?? null,
    lastSuccessAt: runs.find((r) => r.status === "ok")?.created_at ?? null,
    latest: runs[0] ?? null,
  };
}

export async function getDeepResearchMonthSpend(): Promise<number> {
  const supabase = await createClient();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("enrichment_runs")
    .select("cost_usd")
    .eq("workspace_id", await activeWorkspaceId())
    .eq("kind", "deep_research")
    .gte("created_at", monthStart.toISOString());
  return (data ?? []).reduce(
    (sum, run) => sum + Number(run.cost_usd ?? 0),
    0
  );
}

export async function getInteractions(orgId: number): Promise<Interaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .select("*")
    .eq("org_id", orgId)
    .eq("workspace_id", await activeWorkspaceId())
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Interaction[];
}

export async function getRecentInteractions(
  list: OrgList,
  limit = 6
): Promise<InteractionWithOrg[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .select("*, organizations!inner(name, list)")
    .eq("organizations.list", list)
    .eq("workspace_id", await activeWorkspaceId())
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InteractionWithOrg[];
}

export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("workspace_id", await activeWorkspaceId())
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

export interface ActivityRow {
  id: number;
  actor_id: string | null;
  action: string;
  org_id: number | null;
  target_type: string | null;
  target_id: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export async function getActivityLog(opts: {
  page?: number;
  per?: number;
  actorId?: string;
  group?: string;
}): Promise<{ rows: ActivityRow[]; count: number }> {
  const supabase = await createClient();
  const per = opts.per && opts.per > 0 ? opts.per : 20;
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const from = (page - 1) * per;

  let query = supabase
    .from("activity_log")
    .select("*", { count: "exact" })
    .eq("workspace_id", await activeWorkspaceId())
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + per - 1);

  if (opts.actorId) query = query.eq("actor_id", opts.actorId);
  if (opts.group) query = query.like("action", `${opts.group}.%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as ActivityRow[], count: count ?? 0 };
}

// Clerk-based: returns the signed-in user's profile, creating it on first login.
export async function getCurrentProfile(): Promise<Profile | null> {
  return ensureProfile();
}

// The acting user's workspace id — required for every data insert.
export async function requireWorkspaceId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile?.workspace_id) {
    throw new Error("No workspace on this profile");
  }
  return profile.workspace_id;
}

// The workspace the current view is scoped to. Super-admins can point the
// view_workspace cookie at any workspace (read-only by policy); everyone else
// is fixed to their own.
export async function activeWorkspaceId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile?.workspace_id) {
    throw new Error("No workspace on this profile");
  }
  if (profile.is_super_admin) {
    const store = await cookies();
    const viewed = store.get("view_workspace")?.value;
    if (viewed && /^[0-9a-fA-F-]{36}$/.test(viewed)) return viewed;
  }
  return profile.workspace_id;
}

// Workspace + permissions context (Plan 2 consumes canWrite for trial locks
// and the super-admin read-only mode).
export async function getWorkspaceContext(): Promise<{
  profile: Profile | null;
  workspace: Workspace | null;
  isSuperAdmin: boolean;
  canWrite: boolean;
  entitled: boolean;
  trialDaysLeft: number | null;
  trialEnded: boolean;
} | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  let workspace: Workspace | null = null;
  if (profile.workspace_id) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("workspaces")
      .select(
        "id, name, plan, trial_ends_at, created_at, seats, subscription_status, current_period_end"
      )
      .eq("id", profile.workspace_id)
      .maybeSingle();
    workspace = (data as Workspace | null) ?? null;
  }

  const trialOk =
    !!workspace &&
    workspace.plan === "trial" &&
    workspace.trial_ends_at !== null &&
    new Date(workspace.trial_ends_at) > new Date();

  const entitled =
    !!workspace &&
    (workspace.plan === "active" ||
      trialOk ||
      (workspace.plan === "paid" &&
        workspace.subscription_status === "active" &&
        workspace.current_period_end !== null &&
        new Date(workspace.current_period_end) > new Date()));

  const trialDaysLeft =
    workspace?.trial_ends_at && workspace.plan === "trial"
      ? Math.ceil(
          (new Date(workspace.trial_ends_at).getTime() - Date.now()) / 86_400_000
        )
      : null;
  const trialEnded = !!workspace && workspace.plan === "trial" && !trialOk;

  return {
    profile,
    workspace,
    isSuperAdmin: profile.is_super_admin,
    canWrite: entitled,
    entitled,
    trialDaysLeft,
    trialEnded,
  };
}

// All workspaces — super-admin only (RLS select allows them; others get []).
export async function getAllWorkspaces(): Promise<Workspace[]> {
  const profile = await getCurrentProfile();
  if (!profile?.is_super_admin) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select("id, name, plan, trial_ends_at, created_at")
    .order("created_at");
  if (error) return [];
  return (data as Workspace[]) ?? [];
}

// Own email sending settings, safe for the client: the encrypted SMTP password
// is never fetched. `configured` comes from a filtered count so the ciphertext
// never leaves the database.
export async function getMyEmailSettings(): Promise<EmailSettings> {
  const empty: EmailSettings = {
    configured: false,
    from_name: null,
    from_email: null,
    smtp_host: null,
    smtp_port: null,
    smtp_secure: false,
    smtp_user: null,
    signature_phone: null,
    signature_link: null,
  };

  const { userId } = await auth();
  if (!userId) return empty;

  const supabase = await createClient();
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase
      .from("user_email_settings")
      .select(
        "from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, signature_phone, signature_link"
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("user_email_settings")
      .select("user_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("smtp_password_enc", "is", null),
  ]);
  if (error || countError) {
    console.error(
      "[email-settings] read failed:",
      error?.message ?? countError?.message
    );
  }
  if (!data) return empty;

  return {
    configured: Boolean(data.smtp_host && data.smtp_user) && (count ?? 0) > 0,
    from_name: data.from_name ?? null,
    from_email: data.from_email ?? null,
    smtp_host: data.smtp_host ?? null,
    smtp_port: data.smtp_port ?? null,
    smtp_secure: data.smtp_secure ?? true,
    smtp_user: data.smtp_user ?? null,
    signature_phone: data.signature_phone ?? null,
    signature_link: data.signature_link ?? null,
  };
}

export interface BillingOverview {
  workspace: Workspace;
  isOwner: boolean;
  memberCount: number;
  payments: {
    id: number;
    amount_paise: number;
    kind: string;
    status: string;
    created_at: string;
    razorpay_payment_id: string;
  }[];
}

export async function getBillingOverview(): Promise<BillingOverview | null> {
  const profile = await getCurrentProfile();
  if (!profile?.workspace_id) return null;
  const supabase = await createClient();
  const [{ data: workspace }, { count }, { data: payments }] = await Promise.all([
    supabase
      .from("workspaces")
      .select(
        "id, name, plan, trial_ends_at, created_at, seats, subscription_status, current_period_end"
      )
      .eq("id", profile.workspace_id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", profile.workspace_id),
    supabase
      .from("payments")
      .select("id, amount_paise, kind, status, created_at, razorpay_payment_id")
      .eq("workspace_id", profile.workspace_id)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);
  if (!workspace) return null;
  return {
    workspace: workspace as Workspace,
    isOwner: profile.role === "owner",
    memberCount: count ?? 1,
    payments: payments ?? [],
  };
}
