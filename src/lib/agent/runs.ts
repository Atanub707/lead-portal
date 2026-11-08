import { createAdminClient } from "@/lib/supabase/admin";
import {
  AgentHistoryMessageSchema,
  PlanSchema,
  StepResultSchema,
  type AgentHistoryMessage,
  type AgentPlan,
  type AgentRun,
  type AgentRunStatus,
  type AgentState,
  type StepResult,
} from "./types";

interface RunRow {
  id: number;
  summary: string;
  created_at: string;
  details: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStatus(value: unknown): AgentRunStatus {
  return value === "running" || value === "failed" || value === "paused"
    ? value
    : "done";
}

function normalizeState(value: unknown): AgentState {
  if (!isRecord(value)) return { companyIds: [], pipeline: null };
  return {
    companyIds: Array.isArray(value.companyIds)
      ? value.companyIds.filter((id): id is number => typeof id === "number")
      : [],
    pipeline: typeof value.pipeline === "string" ? value.pipeline : null,
  };
}

function normalizeResults(value: unknown): StepResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => StepResultSchema.safeParse(entry))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

export function toAgentRun(row: RunRow): AgentRun | null {
  if (!isRecord(row.details)) return null;
  const details = row.details;
  const parsedPlan = PlanSchema.safeParse(details.plan);
  if (!parsedPlan.success) return null;
  const results = normalizeResults(details.results);
  const legacy =
    results.length === 0 && isRecord(details.result)
      ? normalizeResults([details.result])
      : results;
  const history = Array.isArray(details.history)
    ? details.history
        .map((entry) => AgentHistoryMessageSchema.safeParse(entry))
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data)
    : [];
  return {
    id: row.id,
    summary: row.summary,
    title: typeof details.title === "string" ? details.title : parsedPlan.data.title,
    goal: typeof details.goal === "string" ? details.goal : row.summary,
    plan: parsedPlan.data,
    approved: Array.isArray(details.approved)
      ? details.approved.filter((index): index is number => typeof index === "number")
      : [],
    state: normalizeState(details.state),
    cursor:
      typeof details.cursor === "number" && Number.isFinite(details.cursor)
        ? Math.max(0, Math.trunc(details.cursor))
        : legacy.length,
    results: legacy,
    importId: typeof details.importId === "number" ? details.importId : null,
    status: normalizeStatus(details.status),
    error: typeof details.error === "string" ? details.error : null,
    leaseUntil: typeof details.leaseUntil === "string" ? details.leaseUntil : null,
    history,
    createdAt: row.created_at,
    updatedAt: typeof details.updatedAt === "string" ? details.updatedAt : null,
  };
}

export async function createAgentRun(input: {
  actorId: string;
  workspaceId: string;
  goal: string;
  plan: AgentPlan;
  approved: number[];
  history: AgentHistoryMessage[];
}): Promise<{ run?: AgentRun; error?: string }> {
  const admin = createAdminClient();
  const state: AgentState = { companyIds: [], pipeline: null };
  const now = new Date().toISOString();
  const details = {
    title: input.plan.title,
    goal: input.goal,
    plan: input.plan,
    approved: input.approved,
    state,
    cursor: 0,
    results: [] as StepResult[],
    importId: null,
    status: "running" as const,
    error: null,
    leaseUntil: new Date(Date.now() + 65_000).toISOString(),
    history: input.history,
    updatedAt: now,
  };
  const { data, error } = await admin
    .from("activity_log")
    .insert({
      actor_id: input.actorId,
      workspace_id: input.workspaceId,
      action: "agent.run",
      target_type: "agent",
      target_id: crypto.randomUUID(),
      summary: input.goal.trim().slice(0, 200) || input.plan.title,
      details,
    })
    .select("id, summary, created_at, details")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not save the run" };
  const run = toAgentRun(data as RunRow);
  return run ? { run } : { error: "Could not read the saved run" };
}

export async function updateAgentRun(
  run: AgentRun,
  actorId: string,
  workspaceId: string
): Promise<string | null> {
  const admin = createAdminClient();
  const details = {
    title: run.title,
    goal: run.goal,
    plan: run.plan,
    approved: run.approved,
    state: run.state,
    cursor: run.cursor,
    results: run.results,
    importId: run.importId,
    status: run.status,
    error: run.error,
    leaseUntil: run.leaseUntil,
    history: run.history,
    updatedAt: new Date().toISOString(),
  };
  const { error } = await admin
    .from("activity_log")
    .update({ summary: run.summary, details })
    .eq("id", run.id)
    .eq("actor_id", actorId)
    .eq("workspace_id", workspaceId)
    .eq("action", "agent.run");
  return error?.message ?? null;
}

export async function getAgentRun(
  id: number,
  actorId: string,
  workspaceId: string
): Promise<AgentRun | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("activity_log")
    .select("id, summary, created_at, details")
    .eq("id", id)
    .eq("actor_id", actorId)
    .eq("workspace_id", workspaceId)
    .eq("action", "agent.run")
    .maybeSingle();
  if (error || !data) return null;
  return toAgentRun(data as RunRow);
}

export async function listAgentRuns(
  actorId: string,
  workspaceId: string,
  limit = 6
): Promise<AgentRun[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("activity_log")
    .select("id, summary, created_at, details")
    .eq("actor_id", actorId)
    .eq("workspace_id", workspaceId)
    .eq("action", "agent.run")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as RunRow[])
    .map((row) => toAgentRun(row))
    .filter((run): run is AgentRun => Boolean(run));
}
