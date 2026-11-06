import { activeWorkspaceId, getPipelines } from "./data";
import { getCampaigns, type CampaignSummary } from "./campaign-data";
import { createClient } from "./supabase/server";

export interface AnalyticsData {
  totals: {
    companies: number;
    enriched: number;
    qualified: number;
    contacted: number;
    replied: number;
    positive: number;
    won: number;
    contacts: number;
    contactsWithEmail: number;
    sent: number;
  };
  funnel: { key: string; label: string; value: number }[];
  pipelines: {
    id: string;
    name: string;
    companies: number;
    qualified: number;
    contacted: number;
    replied: number;
    won: number;
  }[];
  signals: {
    key: string;
    label: string;
    companies: number;
    contacted: number;
    replied: number;
  }[];
  discoverySources: { key: string; count: number }[];
  contactSources: { key: string; count: number }[];
  campaigns: CampaignSummary[];
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();

  const [orgsRes, firmRes, contactsRes, sentRes, threadsRes, eventsRes, signalsRes, defsRes, importsRes, pipelines, campaigns] =
    await Promise.all([
      supabase
        .from("organizations")
        .select("id, list, status, score, grade")
        .eq("workspace_id", workspaceId),
      supabase
        .from("company_firmographics")
        .select("org_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("contacts")
        .select("org_id, email, source")
        .eq("workspace_id", workspaceId),
      supabase
        .from("sent_emails")
        .select("org_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("email_threads")
        .select("org_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("campaign_events")
        .select("kind, org_id")
        .eq("workspace_id", workspaceId),
      supabase
        .from("company_signals")
        .select("org_id, signal_key")
        .eq("workspace_id", workspaceId),
      supabase
        .from("signal_definitions")
        .select("key, label")
        .eq("workspace_id", workspaceId),
      supabase
        .from("lead_imports")
        .select("source")
        .eq("workspace_id", workspaceId),
      getPipelines(),
      getCampaigns(),
    ]);

  const orgs = (orgsRes.data ?? []) as {
    id: number;
    list: string;
    status: string;
    score: number | null;
    grade: string | null;
  }[];
  const enriched = new Set((firmRes.data ?? []).map((row) => row.org_id as number));
  const qualified = new Set(
    orgs
      .filter(
        (org) =>
          org.score !== null && !["D", "excluded"].includes(org.grade ?? "")
      )
      .map((org) => org.id)
  );
  const contacted = new Set(
    (sentRes.data ?? [])
      .map((row) => row.org_id as number | null)
      .filter((value): value is number => Boolean(value))
  );
  const replied = new Set(
    (threadsRes.data ?? [])
      .map((row) => row.org_id as number | null)
      .filter((value): value is number => Boolean(value))
  );
  const positive = new Set(
    (eventsRes.data ?? [])
      .filter((row) => row.kind === "positive_reply")
      .map((row) => row.org_id as number | null)
      .filter((value): value is number => Boolean(value))
  );
  const won = orgs.filter((org) => org.status === "won").length;
  const contacts = (contactsRes.data ?? []) as {
    org_id: number;
    email: string | null;
    source: string | null;
  }[];

  const labels = new Map(
    (defsRes.data ?? []).map((row) => [row.key as string, row.label as string])
  );
  const signalsByOrg = new Map<number, Set<string>>();
  for (const row of signalsRes.data ?? []) {
    const orgId = row.org_id as number;
    if (!signalsByOrg.has(orgId)) signalsByOrg.set(orgId, new Set());
    signalsByOrg.get(orgId)?.add(row.signal_key as string);
  }

  const signalKeys = new Set<string>();
  for (const set of signalsByOrg.values()) {
    for (const key of set) signalKeys.add(key);
  }
  const signalStats = [...signalKeys].map((key) => {
    const companies = [...signalsByOrg.entries()].filter(([, set]) => set.has(key));
    return {
      key,
      label: labels.get(key) ?? key,
      companies: companies.length,
      contacted: companies.filter(([orgId]) => contacted.has(orgId)).length,
      replied: companies.filter(([orgId]) => replied.has(orgId)).length,
    };
  }).sort((a, b) => b.replied - a.replied || b.companies - a.companies);

  const discoveryCounts = new Map<string, number>();
  for (const row of importsRes.data ?? []) {
    const key = (row.source as string) ?? "unknown";
    discoveryCounts.set(key, (discoveryCounts.get(key) ?? 0) + 1);
  }
  const contactCounts = new Map<string, number>();
  for (const row of contacts) {
    const key = row.source ?? "unknown";
    contactCounts.set(key, (contactCounts.get(key) ?? 0) + 1);
  }

  const pipelineStats = pipelines.map((pipeline) => {
    const list = orgs.filter((org) => org.list === pipeline.id);
    return {
      id: pipeline.id,
      name: pipeline.name,
      companies: list.length,
      qualified: list.filter((org) => qualified.has(org.id)).length,
      contacted: list.filter((org) => contacted.has(org.id)).length,
      replied: list.filter((org) => replied.has(org.id)).length,
      won: list.filter((org) => org.status === "won").length,
    };
  });

  return {
    totals: {
      companies: orgs.length,
      enriched: enriched.size,
      qualified: qualified.size,
      contacted: contacted.size,
      replied: replied.size,
      positive: positive.size,
      won,
      contacts: contacts.length,
      contactsWithEmail: contacts.filter((row) => Boolean(row.email)).length,
      sent: sentRes.data?.length ?? 0,
    },
    funnel: [
      { key: "discovered", label: "Discovered", value: orgs.length },
      { key: "enriched", label: "Enriched", value: enriched.size },
      { key: "qualified", label: "Qualified", value: qualified.size },
      { key: "contacted", label: "Contacted", value: contacted.size },
      { key: "replied", label: "Replied", value: replied.size },
      { key: "positive", label: "Positive replies", value: positive.size },
      { key: "won", label: "Won", value: won },
    ],
    pipelines: pipelineStats,
    signals: signalStats,
    discoverySources: [...discoveryCounts.entries()].map(([key, count]) => ({ key, count })),
    contactSources: [...contactCounts.entries()].map(([key, count]) => ({ key, count })),
    campaigns,
  };
}
