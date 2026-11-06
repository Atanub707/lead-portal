// Workspace-level LinkedIn jobs scan → hiring signals on existing companies.
// The actor is run once per job signal definition (keyword set + country).
import { getActorRun, getDatasetItems, startActorRun } from "./apify";
import { normalizeCompanyName, normalizeLinkedinUrl } from "./crunchbase";
import { expiryFor, signalDedupeHash } from "./signals";
import { scoreOrg } from "./scoring";
import { createAdminClient } from "./supabase/admin";
import type { SignalDefinition } from "./intelligence";

export const JOB_ACTOR = "curious_coder/linkedin-jobs-scraper";
const MAX_DEFINITIONS = 3;
const MAX_RESULTS = 50;

export interface JobScanRun {
  key: string;
  label: string;
  runId: string;
  datasetId: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function keywordsOf(definition: SignalDefinition): string[] {
  const config = asRecord(definition.query_config);
  if (config && Array.isArray(config.keywords)) {
    return config.keywords.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
  }
  return [];
}

export function jobScanInput(
  definition: SignalDefinition,
  country: string | null
): Record<string, unknown> {
  const keywords = keywordsOf(definition).slice(0, 3);
  const config = asRecord(definition.query_config);
  const configCountries = config && Array.isArray(config.countries)
    ? config.countries.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    keywords: keywords.join(" OR "),
    location: country ?? configCountries[0] ?? "India",
    datePosted: "pastMonth",
    limitPerSource: MAX_RESULTS,
    scrapeCompany: true,
    autoConvertToAiSearch: true,
    splitByLocation: false,
  };
}

async function defaultCountry(workspaceId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: icp } = await admin
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  if (!icp?.id) return null;
  const { data: criterion } = await admin
    .from("icp_criteria")
    .select("value")
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icp.id)
    .eq("field", "country")
    .maybeSingle();
  const value = criterion?.value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : null;
}

export async function startJobScans(
  workspaceId: string
): Promise<{ runs: JobScanRun[]; skipped?: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("signal_definitions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("source_key", "linkedin_jobs");
  const definitions = (data ?? []) as SignalDefinition[];
  if (definitions.length === 0) {
    return { runs: [], skipped: "No hiring signals configured" };
  }

  const country = await defaultCountry(workspaceId);
  const runs: JobScanRun[] = [];
  for (const definition of definitions.slice(0, MAX_DEFINITIONS)) {
    try {
      const started = await startActorRun(
        JOB_ACTOR,
        jobScanInput(definition, country)
      );
      runs.push({
        key: definition.key,
        label: definition.label,
        runId: started.runId,
        datasetId: started.datasetId,
      });
    } catch (err) {
      console.error(
        "[job-signals] start failed:",
        definition.key,
        err instanceof Error ? err.message : err
      );
    }
  }
  return runs.length > 0 ? { runs } : { runs: [], skipped: "Could not start the job scan" };
}

export async function reconcileJobScan(
  workspaceId: string,
  runId: string,
  definitionKey: string
): Promise<{
  status: "running" | "ok" | "failed";
  scanned: number;
  created: number;
  matched: number;
  error?: string;
}> {
  const admin = createAdminClient();
  const info = await getActorRun(runId);
  const status = info.status.toUpperCase();
  if (status === "READY" || status === "RUNNING") {
    return { status: "running", scanned: 0, created: 0, matched: 0 };
  }
  if (status !== "SUCCEEDED") {
    return { status: "failed", scanned: 0, created: 0, matched: 0, error: "Job scan failed" };
  }

  const { data: definitionRow } = await admin
    .from("signal_definitions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("key", definitionKey)
    .maybeSingle();
  if (!definitionRow) {
    return { status: "failed", scanned: 0, created: 0, matched: 0, error: "Signal not configured" };
  }
  const definition = definitionRow as SignalDefinition;

  const items = (await getDatasetItems(info.datasetId, 100)) as unknown[];
  const { data: orgRows } = await admin
    .from("organizations")
    .select("id, name, linkedin_url")
    .eq("workspace_id", workspaceId);
  const byName = new Map<string, number>();
  const byLinkedin = new Map<string, number>();
  for (const org of orgRows ?? []) {
    byName.set(normalizeCompanyName(org.name as string), org.id as number);
    const linkedin = normalizeLinkedinUrl((org.linkedin_url as string | null) ?? null);
    if (linkedin) byLinkedin.set(linkedin, org.id as number);
  }

  const rows: Record<string, unknown>[] = [];
  const matchedOrgs = new Set<number>();
  let matched = 0;

  for (const item of items) {
    const record = asRecord(item);
    if (!record) continue;
    const company = asRecord(record.company) ?? asRecord(record.companyDetails) ?? null;
    const companyName =
      text(record, ["companyName", "company"]) ??
      (company ? text(company, ["name", "companyName"]) : null);
    const companyLinkedin =
      text(record, ["companyLinkedinUrl", "companyUrl", "companyLinkedin"]) ??
      (company ? text(company, ["linkedinUrl", "url", "linkedin"]) : null);
    const title = text(record, ["title", "jobTitle"]);
    const url = text(record, ["url", "jobUrl", "link", "jobUrlLinkedIn"]);
    const postedAt = text(record, ["postedAt", "postedDate", "publishedAt"]);

    let orgId: number | undefined;
    const linkedinKey = normalizeLinkedinUrl(companyLinkedin);
    if (linkedinKey) orgId = byLinkedin.get(linkedinKey);
    if (!orgId && companyName) orgId = byName.get(normalizeCompanyName(companyName));
    if (!orgId) continue;

    matched += 1;
    matchedOrgs.add(orgId);
    rows.push({
      workspace_id: workspaceId,
      org_id: orgId,
      signal_key: definition.key,
      value: { jobTitle: title ?? null },
      evidence: {
        source: "linkedin_jobs",
        title: title ?? null,
        url: url ?? null,
        company: companyName ?? null,
        postedAt: postedAt ?? null,
        snippet: [title, companyName].filter(Boolean).join(" · ").slice(0, 240),
      },
      source_key: "linkedin_jobs",
      confidence: 0.85,
      observed_at: new Date().toISOString(),
      expires_at: expiryFor(definition.decay_days),
      dedupe_hash: signalDedupeHash([
        orgId,
        definition.key,
        (url ?? `${companyName}:${title}`).toLowerCase(),
      ]),
    });
  }

  let created = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("company_signals")
      .upsert(rows, {
        onConflict: "org_id,signal_key,dedupe_hash",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.error("[job-signals] insert failed:", error.message);
      return { status: "failed", scanned: items.length, created: 0, matched, error: error.message };
    }
    created = data?.length ?? 0;
  }

  for (const orgId of matchedOrgs) {
    const { count } = await admin
      .from("company_signals")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("org_id", orgId);
    await admin
      .from("organizations")
      .update({ signal_count: count ?? 0, last_signal_at: new Date().toISOString() })
      .eq("id", orgId)
      .eq("workspace_id", workspaceId);
    await scoreOrg(orgId, workspaceId).catch(() => undefined);
  }

  return { status: "ok", scanned: items.length, created, matched };
}
