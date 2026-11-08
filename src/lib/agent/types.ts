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
