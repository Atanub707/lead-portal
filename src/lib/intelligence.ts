// Shared, client-safe types and pure helpers for the intelligence layer.
// No server imports: used by settings forms, server actions and pipeline code.
import { EMPLOYEE_BANDS, FUNDING_STAGES } from "./crunchbase-options";

export interface BusinessProfile {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  service_categories: string[];
  positioning: string | null;
  differentiators: string[];
  outreach_angles: unknown;
  template_key: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface IcpProfile {
  id: string;
  workspace_id: string;
  business_profile_id: string | null;
  name: string;
  description: string | null;
  status: "active" | "paused" | "archived";
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export type IcpCriterionKind =
  | "firmographic"
  | "technographic"
  | "geo"
  | "persona"
  | "signal"
  | "exclusion";

export interface IcpCriterion {
  id: string;
  workspace_id: string;
  icp_id: string;
  kind: IcpCriterionKind;
  field: string;
  operator: "in" | "not_in" | "gte" | "lte" | "contains" | "exists";
  value: unknown;
  is_required: boolean;
  weight: number;
  label: string | null;
  sort_order: number;
}

export interface IcpPersona {
  id: string;
  workspace_id: string;
  icp_id: string;
  name: string;
  titles: string[];
  seniorities: string[];
  functions: string[];
  weight: number;
  is_primary: boolean;
}

export interface SignalDefinition {
  id: string;
  workspace_id: string;
  key: string;
  label: string;
  category: string;
  description: string | null;
  evidence_hint: string | null;
  source_key: string;
  query_config: unknown;
  default_weight: number;
  decay_days: number;
  is_builtin: boolean;
  is_active: boolean;
}

export interface ScoringModel {
  id: string;
  workspace_id: string;
  icp_id: string | null;
  name: string;
  version: number;
  weights: { fit?: number; intent?: number; reach?: number };
  threshold: number;
  is_active: boolean;
}

export interface Firmographics {
  org_id: number;
  workspace_id: string;
  industry: string | null;
  sub_industries: string[];
  employee_band: string | null;
  employee_count: number | null;
  founded_year: number | null;
  hq_country: string | null;
  hq_region: string | null;
  hq_city: string | null;
  funding_stage: string | null;
  last_funding_at: string | null;
  total_funding_usd: number | null;
  revenue_band: string | null;
  tech_stack: string[];
  data_sources: Record<string, unknown>;
  confidence: number;
  updated_at: string;
}

export const EMPLOYEE_BAND_OPTIONS = EMPLOYEE_BANDS;

export const FUNDING_STAGE_OPTIONS = FUNDING_STAGES.filter(
  (entry) => entry.value !== ""
);

const BAND_LIMITS: { band: string; min: number; max: number }[] = [
  { band: "1-10", min: 1, max: 10 },
  { band: "11-50", min: 11, max: 50 },
  { band: "51-100", min: 51, max: 100 },
  { band: "101-250", min: 101, max: 250 },
  { band: "251-500", min: 251, max: 500 },
  { band: "501-1000", min: 501, max: 1000 },
  { band: "1001-5000", min: 1001, max: 5000 },
  { band: "5001-10000", min: 5001, max: 10000 },
  { band: "10001+", min: 10001, max: Number.POSITIVE_INFINITY },
];

export function employeeBandFromCount(count: number | null): string | null {
  if (count === null || !Number.isFinite(count) || count <= 0) return null;
  return BAND_LIMITS.find((entry) => count >= entry.min && count <= entry.max)?.band ?? null;
}

export function parseEmployeeBandText(text: string | null): string | null {
  if (!text) return null;
  const normalized = text.trim().replace(/\s+/g, "");
  const match = BAND_LIMITS.find((entry) => entry.band === normalized);
  if (match) return match.band;
  const numeric = Number(normalized.replace(/[^0-9]/g, ""));
  if (Number.isFinite(numeric) && numeric > 0) {
    return employeeBandFromCount(numeric);
  }
  return null;
}

export function parseLocationText(text: string | null): {
  city: string | null;
  region: string | null;
  country: string | null;
} {
  if (!text) return { city: null, region: null, country: null };
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { city: null, region: null, country: null };
  if (parts.length === 1) {
    return { city: null, region: null, country: parts[0] };
  }
  if (parts.length === 2) {
    return { city: parts[0], region: null, country: parts[1] };
  }
  return {
    city: parts[0],
    region: parts.slice(1, -1).join(", "),
    country: parts[parts.length - 1],
  };
}

const FUNDING_STAGE_MATCHERS: { pattern: RegExp; value: string }[] = [
  { pattern: /pre[\s_-]?seed/i, value: "seed" },
  { pattern: /series[\s_-]?a/i, value: "series_a" },
  { pattern: /series[\s_-]?b/i, value: "series_b" },
  { pattern: /series[\s_-]?c/i, value: "series_c_plus" },
  { pattern: /series[\s_-]?d/i, value: "series_c_plus" },
  { pattern: /series[\s_-]?e/i, value: "series_c_plus" },
  { pattern: /private[\s_-]?equity/i, value: "private_equity" },
  { pattern: /\bseed\b/i, value: "seed" },
  { pattern: /angel/i, value: "seed" },
];

export function parseFundingStage(text: string | null): string | null {
  if (!text) return null;
  for (const matcher of FUNDING_STAGE_MATCHERS) {
    if (matcher.pattern.test(text)) return matcher.value;
  }
  return null;
}

export interface ParsedNotes {
  description: string | null;
  employees: string | null;
  location: string | null;
  funding: string | null;
  founders: string | null;
  email: string | null;
  phone: string | null;
  founded: string | null;
  crunchbaseUrl: string | null;
}

const NOTE_KEYS = new Set([
  "employees",
  "location",
  "funding",
  "founders",
  "email",
  "phone",
  "founded",
  "crunchbase",
]);

export function parseNotes(notes: string | null): ParsedNotes {
  const empty: ParsedNotes = {
    description: null,
    employees: null,
    location: null,
    funding: null,
    founders: null,
    email: null,
    phone: null,
    founded: null,
    crunchbaseUrl: null,
  };
  if (!notes) return empty;

  const lines = notes.split(/\r?\n/);
  const known: Record<string, string> = {};
  const descriptionLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z ]{1,20}):\s*(.+)$/);
    if (match && NOTE_KEYS.has(match[1].trim().toLowerCase())) {
      known[match[1].trim().toLowerCase()] = match[2].trim();
    } else if (line.trim()) {
      descriptionLines.push(line.trim());
    }
  }

  return {
    description: descriptionLines.length > 0 ? descriptionLines.join("\n") : null,
    employees: known.employees ?? null,
    location: known.location ?? null,
    funding: known.funding ?? null,
    founders: known.founders ?? null,
    email: known.email ?? null,
    phone: known.phone ?? null,
    founded: known.founded ?? null,
    crunchbaseUrl: known.crunchbase ?? null,
  };
}

export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function splitLines(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
