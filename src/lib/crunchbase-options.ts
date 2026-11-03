// Shared between the API route and the client form — no server-only imports.
export const CRUNCHBASE_COST_PER_RESULT_USD = 12.99 / 1000;

// Crunchbase industry names accepted by the actor (exact strings).
export const INDUSTRY_OPTIONS = [
  "Information Technology",
  "Software",
  "SaaS",
  "Enterprise Software",
  "FinTech",
  "Financial Services",
  "Health Care",
  "Biotechnology",
  "Cyber Security",
  "Cloud Computing",
  "Artificial Intelligence (AI)",
  "Human Resources",
  "Legal",
  "Manufacturing",
  "E-Commerce",
  "Telecommunications",
  "Insurance",
  "Medical Device",
  "Pharmaceutical",
  "Real Estate",
] as const;

export const EMPLOYEE_BANDS = [
  "1-10",
  "11-50",
  "51-100",
  "101-250",
  "251-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10000+",
] as const;

export const FUNDING_STAGES = [
  { value: "", label: "Any stage", types: [] as string[] },
  { value: "seed", label: "Seed", types: ["Seed", "Pre-Seed"] },
  { value: "series_a", label: "Series A", types: ["Series A"] },
  { value: "series_b", label: "Series B", types: ["Series B"] },
  {
    value: "series_c_plus",
    label: "Series C or later",
    types: ["Series C", "Series D", "Series E", "Series F"],
  },
  { value: "private_equity", label: "Private equity", types: ["Private Equity"] },
] as const;
