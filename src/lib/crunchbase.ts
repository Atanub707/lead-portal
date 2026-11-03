import { startActorRun } from "./apify";

export const CRUNCHBASE_ACTOR = "curious_coder/crunchbase-scraper";
export const CRUNCHBASE_SEARCH_PREFIX = "https://www.crunchbase.com/";
export const CRUNCHBASE_COST_PER_RESULT_USD = 2.5 / 1000;

export interface NormalizedCrunchbaseCompany {
  name: string;
  website: string | null;
  linkedin: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  employees: string | null;
  founded: string | null;
  location: string | null;
  funding: string | null;
  notes: string | null;
  crunchbaseUrl: string | null;
  nameKey: string;
  domainKey: string | null;
}

const NAME_KEYS = ["name", "organizationName", "companyName", "title"];
const WEBSITE_KEYS = ["website", "websiteUrl", "homepage", "url"];
const LINKEDIN_KEYS = ["linkedin", "linkedinUrl", "linkedin_url"];
const DESCRIPTION_KEYS = ["shortDescription", "description", "about"];
const EMAIL_KEYS = ["contactEmail", "email"];
const PHONE_KEYS = ["phoneNumber", "phone"];
const EMPLOYEE_KEYS = ["numEmployeesEnum", "numEmployees", "employeeCount"];
const FOUNDED_KEYS = ["foundedOn", "founded", "foundedYear"];
const LOCATION_KEYS = ["locationIdentifiers", "location", "headquarters"];
const FUNDING_KEYS = ["fundingStage", "lastFundingType", "fundingTotal"];
const CRUNCHBASE_URL_KEYS = [
  "crunchbaseUrl",
  "crunchbase_url",
  "crunchbaseProfileUrl",
  "organizationUrl",
  "profileUrl",
];
const CRUNCHBASE_ID_KEYS = [
  "identifier",
  "uuid",
  "slug",
  "permalink",
  "id",
];
const NESTED_KEYS = ["organization", "company", "properties", "data"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(asText)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const record = asRecord(value);
  if (!record) return null;
  for (const key of [
    "name",
    "label",
    "display_name",
    "value",
    "text",
    "url",
    "city",
    "region",
    "state",
    "country",
    "location",
    "location_identifier",
    "identifier",
  ]) {
    const part = asText(record[key]);
    if (part) return part;
  }
  try {
    const json = JSON.stringify(value);
    return json && json !== "{}" && json !== "[]" ? json : null;
  } catch {
    return null;
  }
}

function pick(item: unknown, keys: string[]): string | null {
  const record = asRecord(item);
  if (!record) return null;
  for (const key of keys) {
    const value = asText(record[key]);
    if (value) return value;
  }
  for (const nestedKey of NESTED_KEYS) {
    const nested = asRecord(record[nestedKey]);
    if (!nested) continue;
    for (const key of keys) {
      const value = asText(nested[key]);
      if (value) return value;
    }
  }
  return null;
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

export function bareDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(isHttpUrl(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function normalizeCompanyName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeLinkedinUrl(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const bare = value
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "");
  return bare || null;
}

export async function startCrunchbaseActor(opts: {
  searchUrl: string;
  count: number;
  cookies?: string | null;
}): Promise<{ runId: string; datasetId: string }> {
  const input: Record<string, unknown> = {
    "search.url": opts.searchUrl,
    count: opts.count,
    minDelay: 1,
    maxDelay: 5,
  };
  if (opts.cookies) input.cookie = opts.cookies;
  return startActorRun(CRUNCHBASE_ACTOR, input);
}

export function normalizeCrunchbaseCompany(
  item: unknown
): NormalizedCrunchbaseCompany | null {
  const name = pick(item, NAME_KEYS);
  if (!name) {
    console.warn(
      "[crunchbase] skipping item without a recognizable name:",
      JSON.stringify(item).slice(0, 600)
    );
    return null;
  }

  const websiteCandidate = pick(item, WEBSITE_KEYS);
  let crunchbaseUrl = pick(item, CRUNCHBASE_URL_KEYS);
  let website: string | null = null;
  if (websiteCandidate && isHttpUrl(websiteCandidate)) {
    if (/crunchbase\.com/i.test(websiteCandidate)) {
      crunchbaseUrl = crunchbaseUrl ?? websiteCandidate;
    } else {
      website = websiteCandidate;
    }
  }

  const linkedin = pick(item, LINKEDIN_KEYS);
  const description = pick(item, DESCRIPTION_KEYS);
  const email = pick(item, EMAIL_KEYS);
  const phone = pick(item, PHONE_KEYS);
  const employees = pick(item, EMPLOYEE_KEYS);
  const founded = pick(item, FOUNDED_KEYS);
  const location = pick(item, LOCATION_KEYS);
  const funding = pick(item, FUNDING_KEYS);
  const crunchbaseId = pick(item, CRUNCHBASE_ID_KEYS);

  const lines: string[] = [];
  if (description) lines.push(description);
  if (funding) lines.push(`Funding: ${funding}`);
  if (employees) lines.push(`Employees: ${employees}`);
  if (location) lines.push(`Location: ${location}`);
  const crunchbaseRef = crunchbaseUrl ?? crunchbaseId;
  if (crunchbaseRef) lines.push(`Crunchbase: ${crunchbaseRef}`);
  const notes = lines.length > 0 ? lines.join("\n").slice(0, 4000) : null;

  if (
    !website &&
    !linkedin &&
    !description &&
    !email &&
    !phone &&
    !employees &&
    !founded &&
    !location &&
    !funding &&
    !crunchbaseRef
  ) {
    console.warn(
      "[crunchbase] company mapped with a name only — unmapped item shape:",
      JSON.stringify(item).slice(0, 600)
    );
  }

  return {
    name,
    website,
    linkedin,
    description,
    email,
    phone,
    employees,
    founded,
    location,
    funding,
    notes,
    crunchbaseUrl,
    nameKey: normalizeCompanyName(name),
    domainKey: bareDomain(website),
  };
}

export function normalizeCrunchbaseItems(items: unknown[]): {
  companies: NormalizedCrunchbaseCompany[];
  dropped: number;
} {
  const companies: NormalizedCrunchbaseCompany[] = [];
  let dropped = 0;
  for (const item of items) {
    const company = normalizeCrunchbaseCompany(item);
    if (company) companies.push(company);
    else dropped += 1;
  }
  return { companies, dropped };
}
