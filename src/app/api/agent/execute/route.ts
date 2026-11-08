import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import { toolByName } from "@/lib/agent/tools";
import {
  AgentHistoryMessageSchema,
  PlanSchema,
  type AgentRun,
  type AgentState,
  type PlanStep,
  type StepResult,
} from "@/lib/agent/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAgentRun, getAgentRun, updateAgentRun } from "@/lib/agent/runs";

export const maxDuration = 60;

const BodySchema = z.object({
  goal: z.string().max(600).optional(),
  plan: PlanSchema.optional(),
  approved: z.array(z.number().int()).default([]),
  history: z.array(AgentHistoryMessageSchema).max(12).default([]),
  runId: z.number().int().positive().optional(),
  retry: z.boolean().default(false),
  skip: z.boolean().default(false),
});

async function callApi(
  request: Request,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null }> {
  const origin = new URL(request.url).origin;
  const cookie = request.headers.get("cookie") ?? "";
  const res = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, json };
}

function stepResult(
  tool: string,
  status: StepResult["status"],
  summary: string,
  data?: unknown
): StepResult {
  return { tool, status, summary, data };
}

type StepOutcome = {
  result: StepResult;
  importId?: number | null;
  pending?: boolean;
};

async function runSearch(
  request: Request,
  step: PlanStep,
  state: AgentState,
  importId: number | null | undefined
): Promise<StepOutcome> {
  let id = importId ?? null;
  if (!id) {
    const start = await callApi(request, "/api/leads/find", {
      source: "all",
      industry: typeof step.args.category === "string" ? step.args.category : undefined,
      location: typeof step.args.location === "string" ? step.args.location : undefined,
      employeeBand:
        typeof step.args.employeeBand === "string" ? step.args.employeeBand : undefined,
      count: Number(step.args.count ?? 10),
    });
    if (!start.ok || !start.json?.id) {
      return {
        result: stepResult(
          step.tool,
          "failed",
          String(start.json?.error ?? "Could not start the company search")
        ),
      };
    }
    id = Number(start.json.id);
  }

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const poll = await callApi(request, `/api/crunchbase/import?id=${id}`);
    const status = String(poll.json?.status ?? "");
    if (status === "ok") {
      const ids = Array.isArray(poll.json?.importedIds)
        ? (poll.json.importedIds as number[]).slice(0, 30)
        : [];
      state.companyIds = ids;
      return {
        result: stepResult(
          step.tool,
          "ok",
          `Imported ${Number(poll.json?.imported ?? ids.length)} companies (${Number(
            poll.json?.skipped ?? 0
          )} duplicates skipped)`,
          { imported: poll.json?.imported, skipped: poll.json?.skipped, companyIds: ids }
        ),
        importId: null,
      };
    }
    if (status === "failed") {
      return {
        result: stepResult(
          step.tool,
          "failed",
          String(poll.json?.error ?? "Company search failed")
        ),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }

  return {
    result: stepResult(step.tool, "pending", "Company search is still running"),
    importId: id,
    pending: true,
  };
}

async function runList(
  request: Request,
  step: PlanStep,
  state: AgentState,
  workspaceId: string
): Promise<StepOutcome> {
  const admin = createAdminClient();
  const limit = Math.min(30, Math.max(1, Number(step.args.limit ?? 10)));
  const minScore = Math.min(100, Math.max(0, Number(step.args.minScore ?? 0)));
  const pipeline =
    typeof step.args.pipeline === "string" ? step.args.pipeline : null;

  let query = admin
    .from("organizations")
    .select("id, name, score, grade, list")
    .eq("workspace_id", workspaceId)
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (pipeline) query = query.eq("list", pipeline);
  if (minScore > 0) query = query.gte("score", minScore);
  const { data, error } = await query;
  if (error) {
    return { result: stepResult(step.tool, "failed", error.message) };
  }
  const rows = data ?? [];
  state.companyIds = rows.map((row) => row.id as number);
  state.pipeline = pipeline;
  return {
    result: stepResult(
      step.tool,
      "ok",
      `Selected ${rows.length} companies`,
      {
        companies: rows.map((row) => ({
          id: row.id,
          name: row.name,
          score: row.score,
          grade: row.grade,
          pipeline: row.list,
        })),
      }
    ),
  };
}

async function runEnrich(
  request: Request,
  step: PlanStep,
  state: AgentState
): Promise<StepOutcome> {
  const limit = Math.min(5, Math.max(1, Number(step.args.limit ?? 3)));
  const orgIds = state.companyIds.slice(0, limit);
  if (orgIds.length === 0) {
    return { result: stepResult(step.tool, "failed", "No companies selected yet") };
  }
  const res = await callApi(request, "/api/leads/website-enrich", { orgIds });
  if (!res.ok || !res.json?.ok) {
    return {
      result: stepResult(
        step.tool,
        "failed",
        String(res.json?.error ?? "Website enrichment failed")
      ),
    };
  }
  const results = Array.isArray(res.json.results)
    ? (res.json.results as { contacts?: number; emails?: number; skipped?: string }[])
    : [];
  const contacts = results.reduce((sum, row) => sum + Number(row.contacts ?? 0), 0);
  const emails = results.reduce((sum, row) => sum + Number(row.emails ?? 0), 0);
  return {
    result: stepResult(
      step.tool,
      "ok",
      `Enriched ${orgIds.length} websites · ${contacts} contacts · ${emails} emails`,
      { results }
    ),
  };
}

async function runScore(
  request: Request,
  step: PlanStep,
  state: AgentState
): Promise<StepOutcome> {
  const limit = Math.min(10, Math.max(1, Number(step.args.limit ?? 5)));
  const orgIds = state.companyIds.slice(0, limit);
  if (orgIds.length === 0) {
    return { result: stepResult(step.tool, "failed", "No companies selected yet") };
  }
  const scores: { orgId: number; total?: number; grade?: string }[] = [];
  for (const orgId of orgIds) {
    const res = await callApi(request, "/api/scores/recompute", { orgId });
    const score = res.json?.score as { total?: number; grade?: string } | null;
    scores.push({ orgId, total: score?.total, grade: score?.grade });
  }
  const scored = scores.filter((row) => typeof row.total === "number");
  const avg =
    scored.length > 0
      ? Math.round(scored.reduce((sum, row) => sum + Number(row.total), 0) / scored.length)
      : 0;
  return {
    result: stepResult(
      step.tool,
      "ok",
      `Scored ${scored.length} companies · average ${avg}/100`,
      { scores }
    ),
  };
}

async function runDeepSearch(
  request: Request,
  step: PlanStep,
  state: AgentState
): Promise<StepOutcome> {
  const limit = Math.min(3, Math.max(1, Number(step.args.limit ?? 2)));
  const orgIds = state.companyIds.slice(0, limit);
  if (orgIds.length === 0) {
    return { result: stepResult(step.tool, "failed", "No companies selected yet") };
  }
  const started: { orgId: number; runId?: number; error?: string }[] = [];
  for (const orgId of orgIds) {
    const res = await callApi(request, "/api/deep-research", { orgId });
    started.push({
      orgId,
      runId: typeof res.json?.runId === "number" ? res.json.runId : undefined,
      error: res.ok ? undefined : String(res.json?.error ?? "Failed to start"),
    });
  }
  const ok = started.filter((row) => row.runId).length;
  return {
    result: stepResult(
      step.tool,
      ok > 0 ? "ok" : "failed",
      ok > 0
        ? `Started paid Deep Search for ${ok} companies — contacts will appear when finished`
        : "Deep Search could not start",
      { started }
    ),
  };
}

async function runDraft(
  request: Request,
  step: PlanStep,
  state: AgentState,
  workspaceId: string
): Promise<StepOutcome> {
  const limit = Math.min(2, Math.max(1, Number(step.args.limit ?? 2)));
  const flavor =
    typeof step.args.flavor === "string" ? step.args.flavor : "short-direct";
  const orgIds = state.companyIds.slice(0, limit);
  if (orgIds.length === 0) {
    return { result: stepResult(step.tool, "failed", "No companies selected yet") };
  }
  const admin = createAdminClient();
  const [orgsRes, contactsRes, companyEmailsRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .in("id", orgIds),
    admin
      .from("contacts")
      .select("id, org_id, name, email, is_decision_maker")
      .eq("workspace_id", workspaceId)
      .in("org_id", orgIds)
      .not("email", "is", null)
      .order("is_decision_maker", { ascending: false }),
    admin
      .from("company_emails")
      .select("org_id, email")
      .eq("workspace_id", workspaceId)
      .in("org_id", orgIds),
  ]);
  const orgNames = new Map(
    (orgsRes.data ?? []).map((row) => [row.id as number, row.name as string])
  );
  const contactByOrg = new Map<
    number,
    { id: number; name: string | null; email: string }
  >();
  for (const contact of contactsRes.data ?? []) {
    const orgId = contact.org_id as number;
    if (contactByOrg.has(orgId) || !contact.email) continue;
    contactByOrg.set(orgId, {
      id: contact.id as number,
      name: (contact.name as string | null) ?? null,
      email: contact.email as string,
    });
  }
  const companyEmailByOrg = new Map<number, string>();
  for (const row of companyEmailsRes.data ?? []) {
    const orgId = row.org_id as number;
    if (!companyEmailByOrg.has(orgId)) companyEmailByOrg.set(orgId, row.email as string);
  }

  const drafts: unknown[] = [];
  for (const orgId of orgIds) {
    const contact = contactByOrg.get(orgId);
    const to = contact?.email ?? companyEmailByOrg.get(orgId);
    if (!to) continue;
    const res = await callApi(request, "/api/email/draft", {
      orgId,
      contactId: contact?.id ?? null,
      flavor,
      to,
    });
    if (!res.ok || !res.json?.ok) continue;
    drafts.push({
      orgId,
      orgName: orgNames.get(orgId) ?? `#${orgId}`,
      contactId: contact?.id ?? null,
      to,
      subject: res.json.subject,
      body: res.json.body,
      recipient: res.json.recipient,
      quality: res.json.quality,
      alternatives: res.json.alternatives,
    });
  }
  return {
    result: stepResult(
      step.tool,
      drafts.length > 0 ? "ok" : "failed",
      drafts.length > 0
        ? `Drafted ${drafts.length} emails for review — nothing was sent`
        : "No selected company has an email address yet",
      { drafts }
    ),
  };
}

async function executeStep(
  request: Request,
  step: PlanStep,
  state: AgentState,
  workspaceId: string,
  importId: number | null | undefined
): Promise<StepOutcome> {
  if (!toolByName(step.tool)) {
    return { result: stepResult(step.tool, "failed", "Unknown tool") };
  }
  switch (step.tool) {
    case "search_companies":
      return runSearch(request, step, state, importId);
    case "list_companies":
      return runList(request, step, state, workspaceId);
    case "enrich_websites":
      return runEnrich(request, step, state);
    case "score_companies":
      return runScore(request, step, state);
    case "deep_search":
      return runDeepSearch(request, step, state);
    case "draft_emails":
      return runDraft(request, step, state, workspaceId);
  }
}

function resultsThrough(run: AgentRun, cursor: number, result: StepResult): StepResult[] {
  const results = run.results.slice(0, cursor);
  results.push(result);
  return results;
}

function runResponse(
  run: AgentRun,
  status: "continue" | "pending" | "done" | "failed",
  options?: { result?: StepResult; warning?: string }
) {
  return NextResponse.json({
    ok: true,
    runId: run.id,
    status,
    cursor: run.cursor,
    state: run.state,
    results: run.results,
    importId: run.importId,
    error: run.error,
    result: options?.result,
    warning: options?.warning,
  });
}

async function persist(
  run: AgentRun,
  actorId: string,
  workspaceId: string
): Promise<string | undefined> {
  const error = await updateAgentRun(run, actorId, workspaceId);
  return error ? `Run state may not be saved: ${error}` : undefined;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();

  const body = (await request.json().catch(() => null)) as unknown;
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid run request" }, { status: 400 });
  }
  const { goal, plan, approved, history, runId, retry, skip } = parsed.data;

  let run: AgentRun;
  if (runId) {
    const loaded = await getAgentRun(runId, userId, workspaceId);
    if (!loaded) {
      return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
    }
    run = loaded;
    if (run.status === "done") {
      return runResponse(run, "done");
    }
    const leased =
      run.status === "running" &&
      run.leaseUntil !== null &&
      Date.parse(run.leaseUntil) > Date.now();
    if (leased && !retry && !skip) {
      return NextResponse.json(
        {
          ok: false,
          busy: true,
          error: "This run is still executing. It will resume automatically in a moment.",
        },
        { status: 409 }
      );
    }
    if (skip) {
      if (run.cursor >= run.plan.steps.length) {
        return runResponse({ ...run, status: "done" }, "done");
      }
      const step = run.plan.steps[run.cursor];
      const nextCursor = run.cursor + 1;
      const nextRun: AgentRun = {
        ...run,
        cursor: nextCursor,
        results: resultsThrough(
          run,
          run.cursor,
          stepResult(step.tool, "skipped", "Skipped by user")
        ),
        importId: null,
        error: null,
        leaseUntil: null,
        status: nextCursor >= run.plan.steps.length ? "done" : "running",
      };
      const warning = await persist(nextRun, userId, workspaceId);
      return runResponse(
        nextRun,
        nextRun.status === "done" ? "done" : "continue",
        { warning }
      );
    }
    if (run.status === "failed" && !retry) {
      return runResponse(run, "failed", { warning: "Retry or skip the failed step to continue." });
    }
    if (retry) {
      run = {
        ...run,
        status: "running",
        error: null,
        leaseUntil: new Date(Date.now() + 65_000).toISOString(),
      };
    }
  } else {
    if (!goal?.trim() || !plan) {
      return NextResponse.json(
        { ok: false, error: "A goal and plan are required to start a run" },
        { status: 400 }
      );
    }
    const created = await createAgentRun({
      actorId: userId,
      workspaceId,
      goal: goal.trim(),
      plan,
      approved,
      history,
    });
    if (!created.run) {
      return NextResponse.json(
        { ok: false, error: created.error ?? "Could not start the run" },
        { status: 500 }
      );
    }
    run = created.run;
  }

  if (run.cursor >= run.plan.steps.length) {
    const done = { ...run, status: "done" as const, leaseUntil: null };
    const warning = await persist(done, userId, workspaceId);
    return runResponse(done, "done", { warning });
  }

  const step = run.plan.steps[run.cursor];
  const tool = toolByName(step.tool);
  const isApproved = !tool?.requiresApproval || run.approved.includes(run.cursor);
  if (!isApproved) {
    const nextCursor = run.cursor + 1;
    const nextRun: AgentRun = {
      ...run,
      cursor: nextCursor,
      results: resultsThrough(
        run,
        run.cursor,
        stepResult(step.tool, "skipped", "Skipped (not approved)")
      ),
      importId: null,
      error: null,
      leaseUntil: null,
      status: nextCursor >= run.plan.steps.length ? "done" : "running",
    };
    const warning = await persist(nextRun, userId, workspaceId);
    return runResponse(
      nextRun,
      nextRun.status === "done" ? "done" : "continue",
      { warning }
    );
  }

  run = {
    ...run,
    leaseUntil: new Date(Date.now() + 65_000).toISOString(),
  };
  const leaseWarning = await persist(run, userId, workspaceId);

  let outcome: StepOutcome;
  try {
    outcome = await executeStep(request, step, run.state, workspaceId, run.importId);
  } catch (err) {
    outcome = {
      result: stepResult(
        step.tool,
        "failed",
        err instanceof Error ? err.message : "Step failed unexpectedly"
      ),
    };
  }

  if (outcome.pending) {
    const nextRun: AgentRun = {
      ...run,
      results: resultsThrough(run, run.cursor, outcome.result),
      importId: outcome.importId ?? run.importId,
      error: null,
      leaseUntil: null,
      status: "running",
    };
    const warning = await persist(nextRun, userId, workspaceId);
    return runResponse(nextRun, "pending", {
      result: outcome.result,
      warning: leaseWarning ?? warning,
    });
  }

  if (outcome.result.status === "failed") {
    const nextRun: AgentRun = {
      ...run,
      results: resultsThrough(run, run.cursor, outcome.result),
      importId: null,
      error: outcome.result.summary,
      leaseUntil: null,
      status: "failed",
    };
    const warning = await persist(nextRun, userId, workspaceId);
    return runResponse(nextRun, "failed", {
      result: outcome.result,
      warning: leaseWarning ?? warning,
    });
  }

  const nextCursor = run.cursor + 1;
  const nextRun: AgentRun = {
    ...run,
    cursor: nextCursor,
    results: resultsThrough(run, run.cursor, outcome.result),
    importId: null,
    error: null,
    leaseUntil: null,
    status: nextCursor >= run.plan.steps.length ? "done" : "running",
  };
  const warning = await persist(nextRun, userId, workspaceId);
  return runResponse(
    nextRun,
    nextRun.status === "done" ? "done" : "continue",
    { result: outcome.result, warning: leaseWarning ?? warning }
  );
}
