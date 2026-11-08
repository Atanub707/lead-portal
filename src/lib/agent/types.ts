import { z } from "zod";

export const PlanStepSchema = z.object({
  tool: z.enum([
    "search_companies",
    "list_companies",
    "enrich_websites",
    "score_companies",
    "deep_search",
    "draft_emails",
  ]),
  reason: z.string().max(300),
  args: z.record(z.string(), z.unknown()).default({}),
});

export const PlanSchema = z.object({
  title: z.string().max(120),
  summary: z.string().max(500),
  steps: z.array(PlanStepSchema).min(1).max(6),
  warnings: z.array(z.string()).max(4).default([]),
});

export type AgentPlan = z.infer<typeof PlanSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;

export interface AgentState {
  companyIds: number[];
  pipeline: string | null;
}

export interface StepResult {
  tool: string;
  status: "ok" | "failed" | "skipped" | "pending";
  summary: string;
  data?: unknown;
}

export const StepResultSchema = z.object({
  tool: z.string(),
  status: z.enum(["ok", "failed", "skipped", "pending"]),
  summary: z.string(),
  data: z.unknown().optional(),
});

export const AgentHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(2000),
});

export type AgentHistoryMessage = z.infer<typeof AgentHistoryMessageSchema>;

export const AgentRunStatusSchema = z.enum(["running", "done", "failed", "paused"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

export interface AgentRun {
  id: number;
  summary: string;
  title: string;
  goal: string;
  plan: AgentPlan;
  approved: number[];
  state: AgentState;
  cursor: number;
  results: StepResult[];
  importId: number | null;
  status: AgentRunStatus;
  error: string | null;
  leaseUntil: string | null;
  history: AgentHistoryMessage[];
  createdAt: string;
  updatedAt: string | null;
}
