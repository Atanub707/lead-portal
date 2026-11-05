// One-time (and re-runnable) backfill: fills company_firmographics from
// existing organizations.notes and the latest deep-research run details, and
// ensures every workspace has a default ICP.
//
// Usage: node scripts/backfill-firmographics.mjs
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local.

import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const key = env.match(/SUPABASE_SECRET_KEY=(.+)/)[1].trim();
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const BANDS = [
  ["1-10", 1, 10],
  ["11-50", 11, 50],
  ["51-100", 51, 100],
  ["101-250", 101, 250],
  ["251-500", 251, 500],
  ["501-1000", 501, 1000],
  ["1001-5000", 1001, 5000],
  ["5001-10000", 5001, 10000],
  ["10001+", 10001, Infinity],
];

function bandFromCount(count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return BANDS.find(([, min, max]) => count >= min && count <= max)?.[0] ?? null;
}

function parseBand(text) {
  if (!text) return null;
  const normalized = text.trim().replace(/\s+/g, "");
  if (BANDS.some(([band]) => band === normalized)) return normalized;
  const numeric = Number(normalized.replace(/[^0-9]/g, ""));
  return Number.isFinite(numeric) ? bandFromCount(numeric) : null;
}

function parseFundingStage(text) {
  if (!text) return null;
  if (/private[\s_-]?equity/i.test(text)) return "private_equity";
  if (/series[\s_-]?c|series[\s_-]?d|series[\s_-]?e/i.test(text)) return "series_c_plus";
  if (/series[\s_-]?b/i.test(text)) return "series_b";
  if (/series[\s_-]?a/i.test(text)) return "series_a";
  if (/pre[\s_-]?seed|seed|angel/i.test(text)) return "seed";
  return null;
}

function parseLocation(text) {
  if (!text) return { city: null, region: null, country: null };
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: null, region: null, country: null };
  if (parts.length === 1) return { city: null, region: null, country: parts[0] };
  if (parts.length === 2) return { city: parts[0], region: null, country: parts[1] };
  return {
    city: parts[0],
    region: parts.slice(1, -1).join(", "),
    country: parts[parts.length - 1],
  };
}

function parseNotes(notes) {
  const out = { employees: null, location: null, funding: null };
  if (!notes) return out;
  for (const line of notes.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z ]{1,20}):\s*(.+)$/);
    if (!match) continue;
    const keyName = match[1].trim().toLowerCase();
    if (keyName === "employees") out.employees = match[2].trim();
    if (keyName === "location") out.location = match[2].trim();
    if (keyName === "funding") out.funding = match[2].trim();
  }
  return out;
}

async function rest(path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
  if (res.status === 204 || text.length === 0) return null;
  return JSON.parse(text);
}

async function main() {
  const workspaces = await rest("/rest/v1/workspaces?select=id,name,created_by");
  const orgs = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `/rest/v1/organizations?select=id,workspace_id,notes&order=id&offset=${from}&limit=1000`
    );
    orgs.push(...page);
    if (page.length < 1000) break;
  }

  const runs = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `/rest/v1/enrichment_runs?select=org_id,details,created_at&kind=eq.deep_research&order=created_at.desc&offset=${from}&limit=1000`
    );
    runs.push(...page);
    if (page.length < 1000) break;
  }
  const latestRun = new Map();
  for (const run of runs) {
    if (!latestRun.has(run.org_id)) latestRun.set(run.org_id, run);
  }

  const existingRows = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `/rest/v1/company_firmographics?select=*&order=org_id&offset=${from}&limit=1000`
    );
    existingRows.push(...page);
    if (page.length < 1000) break;
  }
  const existing = new Map(existingRows.map((row) => [row.org_id, row]));

  const upserts = [];
  for (const org of orgs) {
    if (!org.workspace_id) continue;
    const notes = parseNotes(org.notes);
    const run = latestRun.get(org.id);
    const company = run?.details?.company ?? {};
    const current = existing.get(org.id) ?? {};

    const employeeCount =
      typeof company.employees === "number" ? company.employees : current.employee_count ?? null;
    const band =
      parseBand(notes.employees) ??
      bandFromCount(employeeCount) ??
      current.employee_band ??
      null;
    const location = parseLocation(notes.location ?? company.address ?? null);
    const fundingStage =
      parseFundingStage(notes.funding) ?? current.funding_stage ?? null;
    const founded =
      typeof company.founded === "number" ? company.founded : current.founded_year ?? null;

    const row = {
      org_id: org.id,
      workspace_id: org.workspace_id,
      industry: current.industry ?? null,
      sub_industries: current.sub_industries ?? [],
      employee_band: band,
      employee_count: employeeCount,
      founded_year: founded,
      hq_city: location.city ?? current.hq_city ?? null,
      hq_region: location.region ?? current.hq_region ?? null,
      hq_country: location.country ?? current.hq_country ?? null,
      funding_stage: fundingStage,
      last_funding_at: current.last_funding_at ?? null,
      total_funding_usd: current.total_funding_usd ?? null,
      revenue_band: current.revenue_band ?? null,
      tech_stack: current.tech_stack ?? [],
      data_sources: {
        ...(current.data_sources ?? {}),
        backfill: true,
        ...(run ? { deep_research: true } : {}),
        ...(notes.employees || notes.location || notes.funding ? { notes: true } : {}),
      },
      confidence: current.confidence ?? 0.6,
    };
    if (
      row.employee_band ||
      row.employee_count ||
      row.hq_country ||
      row.hq_city ||
      row.funding_stage ||
      row.founded_year
    ) {
      upserts.push(row);
    }
  }

  if (upserts.length > 0) {
    await rest("/rest/v1/company_firmographics?on_conflict=org_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(upserts),
    });
  }

  // Ensure every workspace has a default ICP.
  let createdIcps = 0;
  for (const workspace of workspaces) {
    const icps = await rest(
      `/rest/v1/icp_profiles?select=id,is_default&workspace_id=eq.${workspace.id}`
    );
    if (!icps.some((icp) => icp.is_default)) {
      await rest("/rest/v1/icp_profiles", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          workspace_id: workspace.id,
          name: "Default ICP",
          description: "Configure who this workspace targets.",
          status: "active",
          is_default: true,
          created_by: workspace.created_by ?? null,
        }),
      });
      createdIcps += 1;
    }
  }

  console.log(
    `backfilled ${upserts.length}/${orgs.length} companies; default ICPs created: ${createdIcps}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
