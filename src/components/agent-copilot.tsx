"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy, Loader2, Play, Sparkles, TriangleAlert } from "lucide-react";
import { AGENT_TOOLS } from "@/lib/agent/tools";

interface PlanStep {
  tool: string;
  reason: string;
  args: Record<string, unknown>;
}

interface AgentPlan {
  title: string;
  summary: string;
  steps: PlanStep[];
  warnings: string[];
}

interface StepResult {
  tool: string;
  status: "ok" | "failed" | "skipped" | "pending";
  summary: string;
  data?: unknown;
}

interface Draft {
  orgId: number;
  orgName: string;
  to: string;
  subject: string;
  body: string;
  recipient?: { label: string; strategyLabel: string; verification: string };
  quality?: { score: number; words: number; issues: string[] };
}

interface RecentRun {
  id: number;
  summary: string;
  createdAt: string;
  steps: number;
  status: string;
}

const EXAMPLES = [
  "List the top 5 compliance companies and draft emails for 2 of them",
  "Find 5 SaaS companies in India, enrich their websites, score them and draft 2 emails",
  "Enrich websites for the top 3 companies and score them",
];

function toolMeta(name: string) {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

function argsLabel(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return "no options";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ");
}

function estimateFor(plan: AgentPlan): number {
  let total = 0;
  for (const step of plan.steps) {
    if (step.tool === "search_companies") {
      total += Number(step.args.count ?? 10) * (7 / 1000);
    }
    if (step.tool === "deep_search") {
      total += Number(step.args.limit ?? 2) * 0.15;
    }
  }
  return total;
}

export function AgentCopilot({ recentRuns }: { recentRuns: RecentRun[] }) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  async function makePlan() {
    if (!goal.trim() || planning) return;
    setPlanning(true);
    setError("");
    setResults([]);
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; plan?: AgentPlan; error?: string }
        | null;
      if (!res.ok || !json?.plan) {
        setError(json?.error ?? "Could not build a plan");
        return;
      }
      setPlan(json.plan);
      const next = new Set<number>();
      json.plan.steps.forEach((step, index) => {
        const tool = toolMeta(step.tool);
        if (!tool?.requiresApproval) next.add(index);
      });
      setApproved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a plan");
    } finally {
      setPlanning(false);
    }
  }

  function toggle(index: number) {
    setApproved((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function execute() {
    if (!plan || running) return;
    setRunning(true);
    setError("");
    setResults([]);
    let cursor = 0;
    let state: { companyIds: number[]; pipeline: string | null } = {
      companyIds: [],
      pipeline: null,
    };
    let importId: number | null = null;
    let guard = 0;
    try {
      while (cursor < plan.steps.length && guard < 40) {
        guard += 1;
        const res = await fetch("/api/agent/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goal,
            plan,
            cursor,
            approved: [...approved],
            state,
            importId,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              status?: "continue" | "pending" | "done";
              cursor?: number;
              state?: { companyIds: number[]; pipeline: string | null };
              importId?: number | null;
              result?: StepResult;
              error?: string;
            }
          | null;
        if (!res.ok || !json?.ok) {
          setError(json?.error ?? "The copilot could not finish that step");
          break;
        }
        if (json.result) {
          setResults((current) => [...current.filter((r) => r.tool !== "pending"), json.result as StepResult]);
        }
        if (json.status === "pending") {
          await new Promise((resolve) => window.setTimeout(resolve, 4000));
          continue;
        }
        state = json.state ?? state;
        cursor = json.cursor ?? cursor + 1;
        importId = null;
        if (json.status === "done") break;
      }
      if (cursor >= plan.steps.length) {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The copilot run failed");
    } finally {
      setRunning(false);
    }
  }

  async function copyDraft(draft: Draft) {
    await navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`).catch(() => undefined);
    setCopied(`${draft.orgId}-${draft.subject}`);
    setTimeout(() => setCopied(null), 2000);
  }

  const drafts = results.flatMap((result) => {
    const data = result.data as { drafts?: Draft[] } | undefined;
    return data?.drafts ?? [];
  });

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">Copilot</h2>
            <p className="text-[12px] text-zinc-500">
              Command the pipeline in plain English. It plans first, then asks you to approve.
            </p>
          </div>
        </div>

        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          rows={3}
          className="input mt-4"
          placeholder="e.g. Find 5 SaaS companies in India, enrich their websites, score them and draft 2 emails"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setGoal(example)}
              className="rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={makePlan}
            disabled={!goal.trim() || planning}
            className="btn-primary"
          >
            {planning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {planning ? "Planning…" : "Plan it"}
          </button>
          <span className="text-[11px] text-zinc-400">
            Phase 1: search, enrich, score, draft. No sending.
          </span>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            {error}
          </p>
        ) : null}
      </section>

      {plan ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900">{plan.title}</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{plan.summary}</p>
            </div>
            <p className="text-[11px] text-zinc-400 tabular-nums">
              est. ${estimateFor(plan).toFixed(2)}
            </p>
          </div>

          {plan.warnings.length > 0 ? (
            <div className="mt-3 space-y-1">
              {plan.warnings.map((warning) => (
                <p key={warning} className="flex items-start gap-1.5 text-[11px] text-amber-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <ol className="mt-4 space-y-2">
            {plan.steps.map((step, index) => {
              const tool = toolMeta(step.tool);
              const paid = Boolean(tool?.requiresApproval);
              return (
                <li key={`${step.tool}-${index}`} className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={approved.has(index)}
                    onChange={() => toggle(index)}
                    className="mt-1 h-3.5 w-3.5 rounded border-zinc-300"
                    aria-label={`Approve step ${index + 1}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-zinc-900">
                      {index + 1}. {tool?.label ?? step.tool}
                      {paid ? (
                        <span className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-700">
                          paid
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{step.reason}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-400">{argsLabel(step.args)}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={execute}
              disabled={running || approved.size === 0}
              className="btn-primary"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {running ? "Running…" : "Approve & run"}
            </button>
            <span className="text-[11px] text-zinc-400">
              {approved.size} of {plan.steps.length} steps approved
            </span>
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <section className="card p-5">
          <h3 className="text-[14px] font-semibold text-zinc-900">Run</h3>
          <ol className="mt-3 space-y-2">
            {results.map((result, index) => (
              <li key={`${result.tool}-${index}`} className="rounded-lg border border-zinc-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${result.status === "ok" ? "bg-emerald-500" : result.status === "pending" ? "bg-amber-500" : "bg-rose-500"}`} aria-hidden="true" />
                  <p className="text-[12px] font-medium text-zinc-800">
                    {toolMeta(result.tool)?.label ?? result.tool}
                  </p>
                  {result.status === "pending" ? (
                    <Loader2 className="h-3 w-3 animate-spin text-amber-500 motion-reduce:animate-none" aria-hidden="true" />
                  ) : null}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">{result.summary}</p>
              </li>
            ))}
          </ol>

          {drafts.length > 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-[12px] font-medium text-zinc-800">Drafts for review (nothing sent)</p>
              {drafts.map((draft) => (
                <article key={`${draft.orgId}-${draft.subject}`} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/companies/${draft.orgId}`} className="text-[12px] font-semibold text-zinc-900 hover:underline">
                      {draft.orgName}
                    </Link>
                    <span className="text-[11px] text-zinc-400">→ {draft.to}</span>
                    {draft.recipient ? (
                      <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">
                        {draft.recipient.label}
                      </span>
                    ) : null}
                    {draft.quality ? (
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {draft.quality.score}/100 · {draft.quality.words}w
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => copyDraft(draft)}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900"
                    >
                      {copied === `${draft.orgId}-${draft.subject}` ? (
                        <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3 w-3" aria-hidden="true" />
                      )}
                      {copied === `${draft.orgId}-${draft.subject}` ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="mt-2 text-[12px] font-medium text-zinc-800">{draft.subject}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-zinc-600">{draft.body}</p>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {recentRuns.length > 0 ? (
        <section className="card p-5">
          <h3 className="text-[14px] font-semibold text-zinc-900">Recent copilot runs</h3>
          <ul className="mt-3 space-y-2">
            {recentRuns.map((run) => (
              <li key={run.id} className="flex items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] text-zinc-800">{run.summary}</p>
                  <p className="text-[10px] text-zinc-400">
                    {run.steps} steps · {run.status}
                  </p>
                </div>
                <span className="text-[10px] text-zinc-400 tabular-nums">
                  {new Date(run.createdAt).toISOString().slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
