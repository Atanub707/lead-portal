import { createClient } from "./supabase/server";
import { ensureProfile } from "./auth";
import {
  FALLBACK_PIPELINES,
  type Contact,
  type Interaction,
  type InteractionWithOrg,
  type OrgList,
  type Organization,
  type Pipeline,
  type Profile,
} from "./types";

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

export interface CompanyRow extends Organization {
  people_count: number;
  email_count: number;
  first_email: string | null;
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
    { people: number; emails: number; firstEmail: string | null }
  >();
  const ids = rows.map((row) => row.id);

  if (ids.length > 0) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("org_id, email")
      .in("org_id", ids);
    for (const contact of contactRows ?? []) {
      const entry = stats.get(contact.org_id) ?? {
        people: 0,
        emails: 0,
        firstEmail: null,
      };
      entry.people += 1;
      if (contact.email) {
        entry.emails += 1;
        if (!entry.firstEmail) entry.firstEmail = contact.email;
      }
      stats.set(contact.org_id, entry);
    }
  }

  const enriched: CompanyRow[] = rows.map((row) => {
    const entry = stats.get(row.id) ?? {
      people: 0,
      emails: 0,
      firstEmail: null,
    };
    const orgEmails = row.emails ?? [];
    return {
      ...row,
      people_count: entry.people,
      email_count: entry.emails + orgEmails.length,
      first_email: entry.firstEmail ?? orgEmails[0] ?? null,
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
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Contact[];
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
