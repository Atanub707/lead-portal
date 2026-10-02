import { createClient } from "./supabase/server";
import type {
  Contact,
  Interaction,
  InteractionWithOrg,
  OrgList,
  Organization,
  Profile,
} from "./types";

export async function getCompanies(opts: {
  list: OrgList;
  status?: string;
  kind?: string;
  priority?: string;
  q?: string;
}): Promise<Organization[]> {
  const supabase = await createClient();
  let query = supabase
    .from("organizations")
    .select("*, contacts(count)")
    .eq("list", opts.list)
    .order("name");

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.kind) query = query.eq("kind", opts.kind);
  if (opts.priority) query = query.eq("priority", opts.priority);
  if (opts.q) query = query.ilike("name", `%${opts.q}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Organization[];
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

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}
