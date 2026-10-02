export type OrgList = "pos" | "compliance";
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

export interface Organization {
  id: number;
  list: OrgList;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  kind: OrgKind;
  status: PipelineStage;
  priority: Priority | null;
  next_action: string | null;
  last_contact: string | null;
  notes: string | null;
  emails: string[];
  bookmarked: boolean;
  follow_up_on: string | null;
  follow_up_note: string | null;
  created_at: string;
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

export const LIST_LABEL: Record<OrgList, string> = {
  pos: "POS Pipeline",
  compliance: "Compliance Pipeline",
};

export const LIST_SHORT: Record<OrgList, string> = {
  pos: "POS",
  compliance: "Compliance",
};

export const STATUS_STAGES: Record<OrgList, PipelineStage[]> = {
  pos: ["new", "contacted", "demo", "proposal", "won", "lost"],
  compliance: ["new", "contacted", "scoping", "proposal", "won", "lost"],
};

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
  return value === "compliance" ? "compliance" : "pos";
}

export function str(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}
