// Shared between the API route and the client form — no server-only imports.
export const CRUNCHBASE_COST_PER_RESULT_USD = 2 / 1000;
export const CRUNCHBASE_DETAILED_COST_PER_RESULT_USD = 7 / 1000;

// Crunchbase category permalinks (the actor accepts permalinks reliably).
export const INDUSTRY_OPTIONS = [
  { value: "information-technology", label: "Information Technology" },
  { value: "software", label: "Software" },
  { value: "saas", label: "SaaS" },
  { value: "enterprise-software", label: "Enterprise Software" },
  { value: "fintech", label: "FinTech" },
  { value: "financial-services", label: "Financial Services" },
  { value: "health-care", label: "Health Care" },
  { value: "biotechnology", label: "Biotechnology" },
  { value: "cyber-security", label: "Cyber Security" },
  { value: "cloud-computing", label: "Cloud Computing" },
  { value: "artificial-intelligence", label: "Artificial Intelligence" },
  { value: "human-resources", label: "Human Resources" },
  { value: "legal", label: "Legal" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "e-commerce", label: "E-Commerce" },
  { value: "telecommunications", label: "Telecommunications" },
  { value: "insurance", label: "Insurance" },
  { value: "medical-device", label: "Medical Device" },
  { value: "pharmaceutical", label: "Pharmaceutical" },
  { value: "real-estate", label: "Real Estate" },
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
  "10001+",
] as const;

export const FOUNDED_AFTER_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "2026-01-01", label: "2026 (this year)" },
  { value: "2025-01-01", label: "2025 or later" },
  { value: "2024-01-01", label: "2024 or later" },
  { value: "2023-01-01", label: "2023 or later" },
] as const;

export const FUNDING_STAGES = [
  { value: "", label: "Any stage" },
  { value: "seed", label: "Seed" },
  { value: "early_stage_venture", label: "Early stage VC (A/B)" },
  { value: "late_stage_venture", label: "Late stage VC (C+)" },
  { value: "private_equity", label: "Private equity" },
] as const;
