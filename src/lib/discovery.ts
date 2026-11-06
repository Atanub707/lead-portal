// Translates a saved ICP into Crunchbase actor filters. Pure and client-safe.
import {
  CRUNCHBASE_COST_PER_RESULT_USD,
  CRUNCHBASE_DETAILED_COST_PER_RESULT_USD,
  EMPLOYEE_BANDS,
  FUNDING_STAGES,
  INDUSTRY_OPTIONS,
} from "./crunchbase-options";
import type { CrunchbaseFilters } from "./crunchbase";
import type { IcpCriterion } from "./intelligence";

export interface DiscoveryPlan {
  filters: CrunchbaseFilters;
  summary: string;
  estimatedCostUsd: number;
  warnings: string[];
  requestedIndustries: string[];
  mappedIndustries: string[];
  country: string | null;
  bands: string[];
  fundingStage: string | null;
  foundedAfter: string | null;
  detailed: boolean;
  count: number;
}

function listValues(criteria: IcpCriterion[], field: string): string[] {
  const values: string[] = [];
  for (const criterion of criteria) {
    if (criterion.kind === "signal" || criterion.kind === "exclusion") continue;
    if (criterion.field !== field) continue;
    if (Array.isArray(criterion.value)) {
      for (const entry of criterion.value) {
        if (typeof entry === "string" && entry.trim()) values.push(entry.trim());
      }
    }
  }
  return [...new Set(values)];
}

function industryValue(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  const match = INDUSTRY_OPTIONS.find(
    (entry) =>
      entry.value === normalized || entry.label.toLowerCase() === normalized
  );
  if (match) return match.value;
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || null;
}

export function planFromIcp(
  criteria: IcpCriterion[],
  opts: {
    count: number;
    detailed: boolean;
    foundedAfter?: string | null;
  }
): DiscoveryPlan {
  const warnings: string[] = [];
  const count = Math.min(100, Math.max(1, Math.round(opts.count || 25)));

  const industries = listValues(criteria, "industry");
  const mapped = industries
    .map(industryValue)
    .filter((value): value is string => Boolean(value));
  if (industries.length > 0 && mapped.length === 0) {
    warnings.push("No ICP industry maps to a supported Crunchbase category — searching without an industry filter.");
  }
  if (mapped.length > 1) {
    warnings.push(`Crunchbase accepts one category per run — using “${mapped[0]}”. Run again for the others.`);
  }

  const geo = listValues(criteria, "country");
  if (geo.length > 1) {
    warnings.push(`One location per run — using “${geo[0]}”. Run again for the other countries.`);
  }

  const bands = listValues(criteria, "employee_band").filter((band) =>
    (EMPLOYEE_BANDS as readonly string[]).includes(band)
  );
  const stages = listValues(criteria, "funding_stage").filter((stage) =>
    FUNDING_STAGES.some((entry) => entry.value === stage)
  );
  if (stages.length > 1) {
    warnings.push(`One funding stage per run — using “${stages[0]}”.`);
  }

  const filters: CrunchbaseFilters = {};
  if (mapped[0]) filters.category = mapped[0];
  if (geo[0]) filters.location = geo[0];
  if (bands.length > 0) filters.employeeCount = bands;
  if (stages[0]) filters.fundingStage = stages[0];
  if (opts.foundedAfter) filters.foundedAfter = opts.foundedAfter;
  filters.detailed = opts.detailed;

  const industryLabel =
    INDUSTRY_OPTIONS.find((entry) => entry.value === mapped[0])?.label ??
    mapped[0] ??
    null;
  const parts = [
    industryLabel ?? "Any industry",
    geo[0] ? `in ${geo[0]}` : null,
    bands.length > 0 ? `${bands.join(", ")} employees` : null,
    stages[0]
      ? (FUNDING_STAGES.find((entry) => entry.value === stages[0])?.label ??
        stages[0])
      : null,
    opts.foundedAfter ? `founded ${opts.foundedAfter.slice(0, 4)}+` : null,
  ].filter(Boolean);

  const estimatedCostUsd =
    count *
    (opts.detailed
      ? CRUNCHBASE_DETAILED_COST_PER_RESULT_USD
      : CRUNCHBASE_COST_PER_RESULT_USD);

  return {
    filters,
    summary: parts.join(" · "),
    estimatedCostUsd,
    warnings,
    requestedIndustries: industries,
    mappedIndustries: mapped,
    country: geo[0] ?? null,
    bands,
    fundingStage: stages[0] ?? null,
    foundedAfter: opts.foundedAfter ?? null,
    detailed: opts.detailed,
    count,
  };
}
