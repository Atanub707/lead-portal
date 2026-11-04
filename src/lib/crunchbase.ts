import { startActorRun } from "./apify";
import {
  CRUNCHBASE_COST_PER_RESULT_USD,
  CRUNCHBASE_DETAILED_COST_PER_RESULT_USD,
  EMPLOYEE_BANDS,
  FOUNDED_AFTER_OPTIONS,
  FUNDING_STAGES,
  INDUSTRY_OPTIONS,
} from "./crunchbase-options";

export {
  CRUNCHBASE_COST_PER_RESULT_USD,
  CRUNCHBASE_DETAILED_COST_PER_RESULT_USD,
  EMPLOYEE_BANDS,
  FOUNDED_AFTER_OPTIONS,
  FUNDING_STAGES,
  INDUSTRY_OPTIONS,
};

// Filter-based Crunchbase actor: no search URL, no cookies, no Crunchbase
// login. It searches Crunchbase by structured filters and returns company
// profiles; detailed mode adds email/phone/founders/tech stack.
export const CRUNCHBASE_ACTOR = "omkar-cloud/crunchbase-scraper";

export interface CrunchbaseFilters {
  category?: string;
  location?: string;
  employeeCount?: string[];
  fundingStage?: string;
  foundedAfter?: string;
  detailed?: boolean;
}

export function hasCrunchbaseFilters(filters: CrunchbaseFilters): boolean {
  return Boolean(
    filters.category?.trim() ||
      filters.location?.trim() ||
      (filters.employeeCount?.length ?? 0) > 0 ||
      filters.fundingStage?.trim() ||
      filters.foundedAfter?.trim()
  );
}

export function crunchbaseFiltersSummary(filters: CrunchbaseFilters): string {
  const parts: string[] = [];
  if (filters.category?.trim()) parts.push(filters.category.trim());
  if (filters.location?.trim()) parts.push(`in ${filters.location.trim()}`);
  if (filters.employeeCount?.length) {
    parts.push(`${filters.employeeCount.join(", ")} employees`);
  }
  if (filters.fundingStage?.trim()) {
    parts.push(
      FUNDING_STAGES.find((entry) => entry.value === filters.fundingStage)
        ?.label ?? filters.fundingStage
    );
  }
  if (filters.foundedAfter?.trim()) {
    parts.push(
      FOUNDED_AFTER_OPTIONS.find((entry) => entry.value === filters.foundedAfter)
        ?.label ?? `founded ${filters.foundedAfter}`
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "All companies";
}

export function buildCrunchbaseInput(
  filters: CrunchbaseFilters,
  count: number
): Record<string, unknown> {
  // The actor's non-rank sorts return empty or only the first page, so always
  // use rank for predictable paging.
  const input: Record<string, unknown> = {
    operatingStatus: "active",
    sort: "rank",
    maxResultsPerSearch: count,
    scrapeCompanyDetails: filters.detailed !== false,
  };
  if (filters.category?.trim()) input.category = filters.category.trim();
  if (filters.location?.trim()) input.location = filters.location.trim();
  if (filters.employeeCount?.length) {
    input.employeeCount = filters.employeeCount;
  }
  if (filters.fundingStage?.trim()) input.fundingStage = filters.fundingStage;
  if (filters.foundedAfter?.trim()) input.foundedAfter = filters.foundedAfter;
  return input;
}

export async function startCrunchbaseActor(
  filters: CrunchbaseFilters,
  count: number
): Promise<{ runId: string; datasetId: string }> {
  return startActorRun(CRUNCHBASE_ACTOR, buildCrunchbaseInput(filters, count));
}

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
  for (const key of ["name", "label", "display_name", "value", "text", "url"]) {
    const text = asText(record[key]);
    if (text) return text;
  }
  return null;
}

function firstText(
  item: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const text = asText(item[key]);
    if (text) return text;
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function bareDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function normalizeCompanyName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeLinkedinUrl(
  value: string | null | undefined
): string | null {
  if (!value) return null;
  const match = value.match(
    /linkedin\.com\/(?:company|school|in)\/([^/?#]+)/i
  );
  if (!match) return null;
  return `linkedin.com/${match[0].split("/")[1].toLowerCase()}/${match[1].toLowerCase()}`;
}

function locationText(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return asText(value);
  const parts = [record.city, record.region, record.country]
    .map(asText)
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

function fundingText(item: Record<string, unknown>): string | null {
  const record = asRecord(item.funding);
  const parts: string[] = [];
  if (record) {
    const rounds = asText(record.rounds_count);
    if (rounds) parts.push(`${rounds} round${rounds === "1" ? "" : "s"}`);
    const investors = asText(record.investors_count);
    if (investors) parts.push(`${investors} investors`);
  }
  const last = firstText(item, ["last_funding_type", "lastFundingType"]);
  if (last) parts.push(`latest: ${last.replace(/_/g, " ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function foundersText(item: Record<string, unknown>): string | null {
  const founders = item.founders;
  if (!Array.isArray(founders)) return null;
  const names = founders
    .map((entry) => asText(entry))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? `Founders: ${names.join(", ")}` : null;
}

export function normalizeCrunchbaseCompany(
  item: unknown
): NormalizedCrunchbaseCompany | null {
  const record = asRecord(item);
  if (!record) return null;

  const name = firstText(record, ["name", "organizationName", "companyName"]);
  if (!name) {
    console.warn(
      "[crunchbase] skipping item without a recognizable name:",
      JSON.stringify(item).slice(0, 600)
    );
    return null;
  }

  const websiteCandidate = firstText(record, [
    "website",
    "websiteUrl",
    "homepage",
  ]);
  let crunchbaseUrl = firstText(record, [
    "link",
    "crunchbaseUrl",
    "crunchbase_url",
    "profileUrl",
  ]);
  let website: string | null = null;
  if (websiteCandidate && isHttpUrl(websiteCandidate)) {
    if (/crunchbase\.com/i.test(websiteCandidate)) {
      crunchbaseUrl = crunchbaseUrl ?? websiteCandidate;
    } else {
      website = websiteCandidate;
    }
  }

  const social = asRecord(record.social);
  const linkedin =
    asText(social?.linkedin) ??
    firstText(record, ["linkedin", "linkedinUrl", "linkedin_url"]);
  const description = firstText(record, [
    "short_description",
    "description",
    "about",
    "shortDescription",
  ]);
  const email = firstText(record, ["email", "contactEmail"]);
  const phone = firstText(record, ["phone", "phoneNumber"]);
  const employees = firstText(record, [
    "employee_count",
    "employeeCount",
    "numEmployeesEnum",
  ]);
  const founded = firstText(record, [
    "founded",
    "founded_on",
    "foundedOn",
    "foundedYear",
  ]);
  const location = locationText(record.location ?? record.headquarters);
  const funding = fundingText(record);
  const founders = foundersText(record);

  const lines: string[] = [];
  if (description) lines.push(description);
  if (funding) lines.push(`Funding: ${funding}`);
  if (employees) lines.push(`Employees: ${employees}`);
  if (location) lines.push(`Location: ${location}`);
  if (founders) lines.push(founders);
  if (email) lines.push(`Email: ${email}`);
  if (phone) lines.push(`Phone: ${phone}`);
  if (crunchbaseUrl) lines.push(`Crunchbase: ${crunchbaseUrl}`);
  const notes = lines.length > 0 ? lines.join("\n").slice(0, 4000) : null;

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
