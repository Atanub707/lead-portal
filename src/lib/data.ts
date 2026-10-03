import { createClient } from "./supabase/server";
import { ensureProfile } from "./auth";
import {
  FALLBACK_PIPELINES,
  type CompanyEmail,
  type Contact,
  type EnrichmentRun,
  type EnrichmentRunWithOrg,
  type Interaction,
  type InteractionWithOrg,
  type OrgList,
  type Organization,
  type Pipeline,
  type Profile,
} from "./types";

// id -> display label for attribution ("who added this").
async function userLabels(): Promise<
  Map<string, { label: string; email: string | null }>
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name");
  const map = new Map<string, { label: string; email: string | null }>();
  for (const profile of data ?? []) {
    const firstWord = (profile.full_name ?? "").trim().split(/\s+/)[0];
    const label =
      firstWord || (profile.email ? profile.email.split("@")[0] : "Someone");
    map.set(profile.id, { label, email: profile.email ?? null });
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

  const [orgs, contacts, companyEmails] = await Promise.all([
    supabase.from("organizations").select("list, follow_up_on"),
    supabase.from("contacts").select("email, is_decision_maker"),
    supabase.from("company_emails").select("id"),
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
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, list, follow_up_on, follow_up_note")
    .not("follow_up_on", "is", null)
    .order("follow_up_on")
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as FollowUpItem[];
}

export async function getRecentRuns(limit = 5): Promise<EnrichmentRunWithOrg[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrichment_runs")
    .select("*, organizations!inner(name, list)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as EnrichmentRunWithOrg[];
}

export async function getPipelines(): Promise<Pipeline[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
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
  count: number;
}

export async function getPipelineUsage(): Promise<PipelineUsage[]> {
  const supabase = await createClient();
  const [{ data: pipelines }, { data: orgs }] = await Promise.all([
    supabase
      .from("pipelines")
      .select("id, name, icon")
      .order("sort_order")
      .order("created_at"),
    supabase.from("organizations").select("list"),
  ]);
  const counts = new Map<string, number>();
  for (const org of orgs ?? []) {
    counts.set(org.list, (counts.get(org.list) ?? 0) + 1);
  }
  return (pipelines ?? []).map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    icon: pipeline.icon,
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

  let query = supabase
    .from("organizations")
    .select("*", { count: "exact" })
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

  if (ids.length > 0) {
    const [{ data: contactRows }, { data: companyEmailRows }] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("org_id, email, is_decision_maker")
          .in("org_id", ids),
        supabase.from("company_emails").select("org_id, email").in("org_id", ids),
      ]);

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
    };
  });

  return { rows: enriched, count: count ?? 0 };
}

export async function getStatusCounts(
  list: OrgList
): Promise<Record<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("status")
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
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Organization | null) ?? null;
}

export async function getContacts(orgId: number): Promise<Contact[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("org_id", orgId)
    .order("is_decision_maker", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Contact[];
}

export async function getCompanyEmails(orgId: number): Promise<CompanyEmail[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_emails")
    .select("*")
    .eq("org_id", orgId)
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
    .eq("kind", "deep_research")
    .order("created_at", { ascending: false })
    .limit(5);
  const runs = (data ?? []) as EnrichmentRun[];
  return {
    activeRunId: runs.find((r) => r.status === "running")?.id ?? null,
    lastSuccessAt: runs.find((r) => r.status === "ok")?.created_at ?? null,
    latest: runs[0] ?? null,
  };
}

export async function getInteractions(orgId: number): Promise<Interaction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("interactions")
    .select("*")
    .eq("org_id", orgId)
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
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
}

// Clerk-based: returns the signed-in user's profile, creating it on first login.
export async function getCurrentProfile(): Promise<Profile | null> {
  return ensureProfile();
}
