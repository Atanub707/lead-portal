export type OrgList = string;
export type OrgKind = "lead" | "partner" | "competitor" | "other";
export type PipelineStage =
  | "new"
  | "contacted"
  | "demo"
  | "scoping"
  | "proposal"
  | "won"
  | "lost";
export type UserRole = "owner" | "editor";
export type Priority = "high" | "medium" | "low";

export interface Pipeline {
  id: string;
  name: string;
  icon: string;
  stages: PipelineStage[];
  sort_order: number;
}

export const DEFAULT_STAGES: PipelineStage[] = [
  "new",
  "contacted",
  "proposal",
  "won",
  "lost",
];

export const PIPELINE_ICONS = [
  "layers",
  "store",
  "shield-check",
  "rocket",
  "briefcase",
  "building-2",
  "users",
  "shopping-cart",
  "bar-chart-3",
  "globe",
  "heart",
  "landmark",
  "package",
  "utensils",
  "car",
  "house",
  "zap",
] as const;

// Used when the pipelines table is unreachable (e.g. before the migration applies).
export const FALLBACK_PIPELINES: Pipeline[] = [
  {
    id: "pos",
    name: "POS Pipeline",
    icon: "store",
    stages: ["new", "contacted", "demo", "proposal", "won", "lost"],
    sort_order: 0,
  },
  {
    id: "compliance",
    name: "Compliance Pipeline",
    icon: "shield-check",
    stages: ["new", "contacted", "scoping", "proposal", "won", "lost"],
    sort_order: 1,
  },
];

export function pipelineName(pipelines: Pipeline[], id: string): string {
  return pipelines.find((pipeline) => pipeline.id === id)?.name ?? id;
}

export function pipelineStages(
  pipelines: Pipeline[],
  id: string
): PipelineStage[] {
  return pipelines.find((pipeline) => pipeline.id === id)?.stages ?? DEFAULT_STAGES;
}

export interface Organization {
  id: number;
  list: OrgList;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  linkedin_source: string | null;
  kind: OrgKind;
  status: PipelineStage;
  priority: Priority | null;
  next_action: string | null;
  last_contact: string | null;
  notes: string | null;
  bookmarked: boolean;
  follow_up_on: string | null;
  follow_up_note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CompanyEmail {
  id: number;
  org_id: number;
  email: string;
  kind: "general" | "personal" | "other";
  source: string;
  verified: boolean;
  created_at: string;
}

export interface EnrichmentRun {
  id: number;
  org_id: number;
  kind: string;
  source: string;
  status: string;
  people_found: number;
  emails_found: number;
  cost_usd: number;
  details: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface EnrichmentRunWithOrg extends EnrichmentRun {
  organizations: { name: string; list: OrgList } | null;
}

export interface Contact {
  id: number;
  org_id: number;
  name: string;
  title: string | null;
  linkedin_url: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  seniority: string | null;
  is_decision_maker: boolean;
  email_status: string | null;
  source: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Interaction {
  id: number;
  org_id: number;
  contact_id: number | null;
  occurred_on: string;
  channel: string | null;
  summary: string;
  outcome: string | null;
  logged_by: string | null;
  created_at: string;
}

export interface InteractionWithOrg extends Interaction {
  organizations: { name: string; list: OrgList } | null;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

export interface EmailSettings {
  configured: boolean;
  from_name: string | null;
  from_email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_secure: boolean;
  smtp_user: string | null;
  signature_phone: string | null;
  signature_link: string | null;
}

export const STATUS_LABEL: Record<PipelineStage, string> = {
  new: "New",
  contacted: "Contacted",
  demo: "Demo",
  scoping: "Scoping",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export const KIND_OPTIONS: OrgKind[] = ["lead", "partner", "competitor", "other"];

export const KIND_LABEL: Record<OrgKind, string> = {
  lead: "Lead",
  partner: "Partner",
  competitor: "Competitor",
  other: "Other",
};

export const PRIORITY_OPTIONS: Priority[] = ["high", "medium", "low"];

export const CHANNELS = ["Email", "LinkedIn", "Call", "Meeting", "Other"];

export function parseList(value: string | string[] | undefined): OrgList {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }
  return "pos";
}

export function str(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}
