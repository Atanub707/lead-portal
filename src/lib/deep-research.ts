import type { SupabaseClient } from "@supabase/supabase-js";
import { startActorRun } from "./apify";

export interface NormalizedLead {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  companyFounded: number | null;
  employeeCount: number | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fromRecord(value: unknown, keys: string[]): string | null {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    for (const key of keys) {
      const found = str(record[key]);
      if (found) return found;
    }
  }
  return null;
}

export function normalizeApolloLead(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  return {
    name,
    title: str(r.title) ?? str(r.jobTitle) ?? str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.linkedin) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      str(r.companyLinkedinUrl) ?? str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}

export function needsDeepResearch(input: {
  contacts: {
    is_decision_maker: boolean;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
  }[];
  companyEmailCount: number;
  activeRunId: number | null;
  lastSuccessAt: string | null;
}): boolean {
  if (input.activeRunId) return true; // show the running card instead of the button
  const decisionMaker = input.contacts.some((c) => c.is_decision_maker);
  if (decisionMaker) return false;
  const reachable = input.contacts.filter(
    (c) => c.email || c.phone || c.linkedin_url
  ).length;
  const thin =
    input.contacts.length === 0 || reachable === 0 || input.companyEmailCount === 0;
  if (!thin) return false;
  if (
    input.lastSuccessAt &&
    Date.now() - new Date(input.lastSuccessAt).getTime() < 7 * 86_400_000
  ) {
    return false;
  }
  return true;
}

export function normalizeLinkedInEmployee(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  const positions = r.currentPosition ?? r.currentPositions;
  return {
    name,
    title:
      str(r.title) ??
      str(r.jobTitle) ??
      fromRecord(positions, ["title"]) ??
      fromRecord(r.experience, ["position", "title"]) ??
      str(r.position) ??
      str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.profileUrl) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      fromRecord(positions, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      fromRecord(r.experience, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      str(r.companyLinkedinUrl) ??
      str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}

export const APOLLO_ACTOR = "pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe";
export const LINKEDIN_EMPLOYEES_ACTOR = "harvestapi/linkedin-company-employees";
export const DEEP_RESEARCH_MONTHLY_CAP_USD = 5;

export function apolloInput(company: { name: string; website: string | null }) {
  let domain: string | null = null;
  if (company.website) {
    try {
      domain = new URL(company.website).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }
  return {
    totalResults: 10,
    personTitleIncludes: [
      "Founder",
      "Co-Founder",
      "CEO",
      "Owner",
      "Managing Director",
    ],
    includeTitleVariants: true,
    seniorityIncludes: ["c_suite", "owner"],
    hasEmail: true,
    companyDomainIncludes: domain ? [domain] : undefined,
    companyDomainMatchMode: "strict",
    companyNameIncludes: domain ? undefined : [company.name],
    companyNameMatchMode: "phrase",
    dontSaveProgress: true,
    countOnly: false,
  };
}

export function linkedinEmployeesInput(companyLinkedinUrl: string) {
  return {
    companies: [companyLinkedinUrl],
    maxItems: 25,
    profileScraperMode: "Short ($4 per 1k)",
  };
}

export type StartDeepResearchResult =
  | { ok: true; runId: number }
  | { ok: false; error: string };

interface DeepResearchCompany {
  id: number;
  name: string;
  website: string | null;
  linkedin_url: string | null;
}

const DAY_MS = 86_400_000;

export async function startDeepResearch(
  supabase: SupabaseClient,
  opts: { orgId: number; userId: string; company: DeepResearchCompany }
): Promise<StartDeepResearchResult> {
  const { orgId, userId, company } = opts;

  // Guard 1: one active run per company.
  const { data: activeRuns } = await supabase
    .from("enrichment_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .eq("status", "running")
    .limit(1);
  if (activeRuns && activeRuns.length > 0) {
    return {
      ok: false,
      error: "Deep research is already running for this company.",
    };
  }

  // Guard 2: 7-day cooldown after the last successful run.
  const { data: successRuns } = await supabase
    .from("enrichment_runs")
    .select("created_at")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastSuccessAt = successRuns?.[0]?.created_at as string | undefined;
  if (lastSuccessAt) {
    const remaining =
      7 * DAY_MS - (Date.now() - new Date(lastSuccessAt).getTime());
    if (remaining > 0) {
      const days = Math.ceil(remaining / DAY_MS);
      return {
        ok: false,
        error: `Deep research ran recently — try again in ${days} day${
          days === 1 ? "" : "s"
        }.`,
      };
    }
  }

  // Guard 3: hard monthly budget across all companies.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthRuns } = await supabase
    .from("enrichment_runs")
    .select("cost_usd")
    .eq("kind", "deep_research")
    .gte("created_at", monthStart.toISOString());
  const monthSpend = (monthRuns ?? []).reduce(
    (sum, run) => sum + Number(run.cost_usd ?? 0),
    0
  );
  if (monthSpend >= DEEP_RESEARCH_MONTHLY_CAP_USD) {
    return {
      ok: false,
      error: `Monthly deep research budget ($${DEEP_RESEARCH_MONTHLY_CAP_USD}) reached.`,
    };
  }

  // Lock the company before spending: insert the running row first.
  const { data: run, error: insertError } = await supabase
    .from("enrichment_runs")
    .insert({
      org_id: orgId,
      kind: "deep_research",
      source: "apify",
      status: "running",
      details: { actors: [] },
      created_by: userId,
    })
    .select("id")
    .single();
  if (insertError || !run) {
    console.error("[deep-research] run insert failed:", insertError?.message);
    return {
      ok: false,
      error: "Couldn't start deep research. Please try again.",
    };
  }

  const actors: { slug: string; runId: string; datasetId: string }[] = [];
  try {
    const apollo = await startActorRun(APOLLO_ACTOR, apolloInput(company));
    actors.push({ slug: APOLLO_ACTOR, ...apollo });
    if (company.linkedin_url) {
      const linkedin = await startActorRun(
        LINKEDIN_EMPLOYEES_ACTOR,
        linkedinEmployeesInput(company.linkedin_url)
      );
      actors.push({ slug: LINKEDIN_EMPLOYEES_ACTOR, ...linkedin });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deep-research] actor start failed:", message);
    await supabase
      .from("enrichment_runs")
      .update({ status: "failed", details: { actors, error: message } })
      .eq("id", run.id);
    return {
      ok: false,
      error: "Couldn't start deep research. Please try again.",
    };
  }

  await supabase
    .from("enrichment_runs")
    .update({ details: { actors } })
    .eq("id", run.id);

  return { ok: true, runId: run.id as number };
}
