// Shared between the API route and the client form — no server-only imports.
export const CRUNCHBASE_COST_PER_RESULT_USD = 2 / 1000;
export const CRUNCHBASE_DETAILED_COST_PER_RESULT_USD = 7 / 1000;

export const EMPLOYEE_BANDS = [
  "1-10",
  "11-50",
  "51-100",
  "101-250",
  "251-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
] as const;

export const FUNDING_STAGES = [
  { value: "", label: "Any stage" },
  { value: "seed", label: "Seed" },
  { value: "early_stage_venture", label: "Early stage VC (A/B)" },
  { value: "late_stage_venture", label: "Late stage VC (C+)" },
  { value: "private_equity", label: "Private equity" },
] as const;

export const CRUNCHBASE_SORTS = [
  { value: "rank", label: "Best match" },
  { value: "last_funding", label: "Recently funded" },
  { value: "growth_score", label: "Fastest growing" },
  { value: "employees", label: "Largest headcount" },
  { value: "founded", label: "Newest companies" },
] as const;
