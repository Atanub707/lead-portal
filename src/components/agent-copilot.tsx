"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CalendarClock,
  Check,
  Coins,
  Copy,
  History,
  Loader2,
  Play,
  RotateCcw,
  RotateCw,
  SkipForward,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { AGENT_TOOLS } from "@/lib/agent/tools";
import type {
  AgentHistoryMessage,
  AgentPlan,
  AgentRun,
  StepResult,
} from "@/lib/agent/types";
import type { SendDayBalance, SendOverview, SendQueueItem } from "@/lib/send-queue";

interface Draft {
  orgId: number;
  orgName: string;
  contactId?: number | null;
  to: string;
  subject: string;
  body: string;
  recipient?: { label: string; strategyLabel: string; verification: string };
  quality?: { score: number; words: number; issues: string[] };
}

type RunStatus = "idle" | "running" | "done" | "failed";

const EXAMPLES = [
  "List the top 5 compliance companies and draft emails for 2 of them",
  "Find 5 SaaS companies in India, enrich their websites, score them and draft 2 emails",
  "Enrich websites for the top 3 companies and score them",
];

const STATUS_STYLES: Record<string, string> = {
  running: "border-sky-200 bg-sky-50 text-sky-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  idle: "border-zinc-200 bg-zinc-50 text-zinc-600",
};

function toolMeta(name: string) {
  return AGENT_TOOLS.find((tool) => tool.name === name);
}

function argsLabel(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
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

function defaultApprovals(plan: AgentPlan): Set<number> {
  const next = new Set<number>();
  plan.steps.forEach((step, index) => {
    if (!toolMeta(step.tool)?.requiresApproval) next.add(index);
  });
  return next;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function statusLabel(status: string): string {
  if (status === "running") return "Running";
  if (status === "failed") return "Failed";
  if (status === "paused") return "Paused";
  return "Done";
}

function formatSlot(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function AgentCopilot({
  recentRuns,
  activeRun,
  sendOverview,
}: {
  recentRuns: AgentRun[];
  activeRun: AgentRun | null;
  sendOverview: SendOverview | null;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [messages, setMessages] = useState<AgentHistoryMessage[]>([]);
  const [instruction, setInstruction] = useState("");
  const [planning, setPlanning] = useState(false);
  const [refining, setRefining] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  const [day, setDay] = useState<SendDayBalance | null>(
    sendOverview?.days[0] ?? null
  );
  const [draftEdits, setDraftEdits] = useState<
    Record<string, { to: string; subject: string; body: string }>
  >({});
  const [scheduled, setScheduled] = useState<Record<string, SendQueueItem>>({});
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({});
  const [sendWarnings, setSendWarnings] = useState<Record<string, string[]>>({});
  const [approving, setApproving] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<string | null>(null);
  const runningRef = useRef(false);

  function beginPlan(nextPlan: AgentPlan) {
    setPlan(nextPlan);
    setApproved(defaultApprovals(nextPlan));
    setRunId(null);
    setResults([]);
    setStatus("idle");
  }

  async function makePlan() {
    if (!goal.trim() || planning || running) return;
    setPlanning(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), history: messages }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; plan?: AgentPlan; ai?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.plan) {
        setError(json?.error ?? "Could not build a plan");
        return;
      }
      beginPlan(json.plan);
      setMessages((current) => [
        ...current,
        { role: "user", text: goal.trim() },
        { role: "assistant", text: `Plan ready: ${json.plan?.title ?? "Untitled plan"}` },
      ]);
      if (json.ai === false) {
        setNotice("AI planning was unavailable, so this is a safe default plan.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build a plan");
    } finally {
      setPlanning(false);
    }
  }

  async function refinePlan() {
    if (!plan || !instruction.trim() || refining || running) return;
    setRefining(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim() || plan.title,
          plan,
          instruction: instruction.trim(),
          history: messages,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            plan?: AgentPlan;
            refined?: boolean;
            warning?: string;
            error?: string;
          }
        | null;
      if (!res.ok || !json?.plan) {
        setError(json?.error ?? "Could not refine the plan");
        return;
      }
      beginPlan(json.plan);
      const changed = json.refined !== false;
      setMessages((current) => [
        ...current,
        { role: "user", text: instruction.trim() },
        {
          role: "assistant",
          text: changed
            ? `Plan updated: ${json.plan?.title ?? "Untitled plan"}`
            : "Plan unchanged.",
        },
      ]);
      setInstruction("");
      if (json.warning) setNotice(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refine the plan");
    } finally {
      setRefining(false);
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

  async function runLoop(
    existingRunId: number | null,
    options?: { retry?: boolean; skip?: boolean }
  ) {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    setError("");
    setNotice("");
    let rid = existingRunId;
    let first = true;
    try {
      for (let guard = 0; guard < 40; guard += 1) {
        const payload: Record<string, unknown> = rid
          ? { runId: rid }
          : {
              goal: goal.trim(),
              plan,
              approved: [...approved],
              history: messages,
            };
        if (rid && first && options?.retry) payload.retry = true;
        if (rid && first && options?.skip) payload.skip = true;

        const res = await fetch("/api/agent/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              busy?: boolean;
              runId?: number;
              status?: "continue" | "pending" | "done" | "failed";
              results?: StepResult[];
              warning?: string;
              error?: string;
            }
          | null;
        if (res.status === 409 && json?.busy) {
          setNotice("This run is still executing. Reconnecting…");
          await wait(5000);
          first = false;
          continue;
        }
        if (!res.ok || !json?.ok) {
          setError(json?.error ?? "The copilot could not finish that step");
          if (rid) setStatus("failed");
          return;
        }
        if (typeof json.runId === "number") {
          rid = json.runId;
          setRunId(json.runId);
        }
        if (Array.isArray(json.results)) setResults(json.results);
        if (json.warning) setNotice(json.warning);
        if (json.status === "failed") {
          setStatus("failed");
          setError(json.error ?? "A step failed. Retry it or skip it.");
          return;
        }
        if (json.status === "done") {
          setStatus("done");
          router.refresh();
          return;
        }
        if (json.status === "pending") {
          setStatus("running");
          await wait(4000);
          first = false;
          continue;
        }
        setStatus("running");
        first = false;
      }
      setError("This run is taking longer than expected. Open it from Recent runs to resume.");
      if (rid) setStatus("failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The copilot run failed");
      if (rid) setStatus("failed");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function loadRun(run: AgentRun, resume: boolean) {
    if (running) return;
    setGoal(run.goal);
    setPlan(run.plan);
    setApproved(new Set(run.approved));
    setMessages(run.history);
    setResults(run.results);
    setRunId(run.id);
    setStatus(run.status === "paused" ? "running" : run.status);
    setError(run.error ?? "");
    setNotice("");
    setDismissedRun(run.id);
    if (resume && run.status === "running") {
      void runLoop(run.id);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetPlan() {
    setPlan(null);
    setApproved(new Set());
    setMessages([]);
    setInstruction("");
    setResults([]);
    setRunId(null);
    setStatus("idle");
    setError("");
    setNotice("");
  }

  function draftKey(draft: Draft): string {
    return `${runId ?? 0}:${draft.orgId}`;
  }

  function draftEdit(draft: Draft) {
    const key = draftKey(draft);
    return draftEdits[key] ?? { to: draft.to, subject: draft.subject, body: draft.body };
  }

  function updateDraft(draft: Draft, patch: Partial<{ to: string; subject: string; body: string }>) {
    const key = draftKey(draft);
    setDraftEdits((current) => ({
      ...current,
      [key]: { ...draftEdit(draft), ...patch },
    }));
  }

  function queueForDraft(draft: Draft): SendQueueItem | null {
    const key = draftKey(draft);
    if (scheduled[key]) return scheduled[key];
    const match = sendOverview?.queue.find(
      (item) =>
        item.agent_run_id === runId &&
        item.org_id === draft.orgId &&
        ["scheduled", "sending", "sent"].includes(item.status)
    );
    return match ?? null;
  }

  async function copyDraft(draft: Draft) {
    const key = draftKey(draft);
    const edit = draftEdit(draft);
    await navigator.clipboard
      .writeText(`${edit.subject}\n\n${edit.body}`)
      .catch(() => undefined);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function approveDraft(draft: Draft) {
    const key = draftKey(draft);
    if (approving || running) return;
    if (!sendOverview?.available) {
      setSendErrors((current) => ({
        ...current,
        [key]: "Sending is not set up yet. Configure it in Sending first.",
      }));
      return;
    }
    const edit = draftEdit(draft);
    setApproving(key);
    setSendErrors((current) => ({ ...current, [key]: "" }));
    setSendWarnings((current) => ({ ...current, [key]: [] }));
    try {
      const res = await fetch("/api/sending/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: draft.orgId,
          contactId: draft.contactId ?? null,
          to: edit.to,
          subject: edit.subject,
          body: edit.body,
          agentRunId: runId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            queue?: SendQueueItem;
            day?: SendDayBalance;
            warnings?: string[];
            error?: string;
            errors?: string[];
          }
        | null;
      if (!res.ok || !json?.ok || !json.queue) {
        setSendErrors((current) => ({
          ...current,
          [key]: json?.errors?.join(" · ") ?? json?.error ?? "Could not schedule this send",
        }));
        return;
      }
      setScheduled((current) => ({ ...current, [key]: json.queue as SendQueueItem }));
      if (json.day) setDay(json.day);
      setSendWarnings((current) => ({ ...current, [key]: json.warnings ?? [] }));
      router.refresh();
    } catch (err) {
      setSendErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Could not schedule this send",
      }));
    } finally {
      setApproving(null);
    }
  }

  async function cancelDraft(draft: Draft) {
    const key = draftKey(draft);
    const queue = queueForDraft(draft);
    if (!queue || canceling) return;
    setCanceling(key);
    setSendErrors((current) => ({ ...current, [key]: "" }));
    try {
      const res = await fetch("/api/sending/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId: queue.id }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setSendErrors((current) => ({
          ...current,
          [key]: json?.error ?? "Could not cancel this send",
        }));
        return;
      }
      setScheduled((current) => ({
        ...current,
        [key]: { ...queue, status: "cancelled" },
      }));
      router.refresh();
    } catch (err) {
      setSendErrors((current) => ({
        ...current,
        [key]: err instanceof Error ? err.message : "Could not cancel this send",
      }));
    } finally {
      setCanceling(null);
    }
  }

  const drafts = results.flatMap((result) => {
    const data = result?.data as { drafts?: Draft[] } | undefined;
    return data?.drafts ?? [];
  });
  const locked = runId !== null;
  const steps = plan?.steps.length ?? 0;
  const currentStep = plan ? Math.min(steps, results.length + (running ? 1 : 0)) : 0;
  const showActiveBanner =
    activeRun && activeRun.id !== runId && activeRun.id !== dismissedRun && !running;

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
              Describe the outcome. Review the plan, then approve the steps you want.
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
            disabled={!goal.trim() || planning || running}
            className="btn-primary"
          >
            {planning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {planning ? "Planning…" : plan ? "Plan again" : "Plan it"}
          </button>
          <span className="text-[11px] text-zinc-400">
            Phase 1–2: search, enrich, score, draft. No sending.
          </span>
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
            {notice}
          </p>
        ) : null}
      </section>

      {showActiveBanner && activeRun ? (
        <section className="card border-sky-200 bg-sky-50/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-sky-700">
                Unfinished run
              </p>
              <p className="mt-1 truncate text-[12px] text-zinc-800">{activeRun.goal}</p>
              <p className="text-[10px] text-zinc-500">
                {statusLabel(activeRun.status)} · step {Math.min(activeRun.cursor + 1, activeRun.plan.steps.length)} of{" "}
                {activeRun.plan.steps.length}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => loadRun(activeRun, activeRun.status === "running")}
                className="btn-primary"
              >
                {activeRun.status === "running" ? "Resume run" : "Review failed run"}
              </button>
              <button
                type="button"
                onClick={() => setDismissedRun(activeRun.id)}
                className="rounded-md p-2 text-zinc-400 hover:bg-white hover:text-zinc-700"
                aria-label="Dismiss unfinished run"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {plan ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-zinc-900">{plan.title}</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-500">{plan.summary}</p>
            </div>
            <div className="flex items-center gap-2">
              {locked ? (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.idle}`}>
                  {running ? "Running" : statusLabel(status)}
                </span>
              ) : null}
              <p className="text-[11px] text-zinc-400 tabular-nums">
                est. ${estimateFor(plan).toFixed(2)}
              </p>
            </div>
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

          {locked ? (
            <p className="mt-3 text-[11px] text-zinc-400">
              Saved run #{runId} · step {Math.min(currentStep, steps)} of {steps}
              {running ? " — safe to leave; resume from Recent runs." : ""}
            </p>
          ) : null}

          <ol className="mt-4 space-y-2">
            {plan.steps.map((step, index) => {
              const tool = toolMeta(step.tool);
              const paid = Boolean(tool?.requiresApproval);
              const result = results[index];
              return (
                <li key={`${step.tool}-${index}`} className="flex items-start gap-3 rounded-lg border border-zinc-200 px-3 py-2.5">
                  {locked ? (
                    <span className="mt-0.5 flex h-4 w-4 items-center justify-center">
                      {result?.status === "ok" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                      ) : result?.status === "failed" ? (
                        <X className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                      ) : result?.status === "skipped" ? (
                        <span className="text-[11px] text-zinc-400">–</span>
                      ) : result?.status === "pending" ? (
                        <Loader2 className="h-3 w-3 animate-spin text-amber-500 motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" aria-hidden="true" />
                      )}
                    </span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={approved.has(index)}
                      onChange={() => toggle(index)}
                      className="mt-1 h-3.5 w-3.5 rounded border-zinc-300"
                      aria-label={`Approve step ${index + 1}`}
                    />
                  )}
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
                    {result && result.status !== "ok" ? (
                      <p className="mt-0.5 text-[10px] text-zinc-500">{result.summary}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {!locked ? (
            <>
              <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
                <label htmlFor="agent-refine" className="text-[11px] font-medium text-zinc-700">
                  Refine this plan
                </label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                  <input
                    id="agent-refine"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void refinePlan();
                      }
                    }}
                    className="input flex-1"
                    placeholder='e.g. "only 3 companies", "skip scoring", "warmer tone"'
                  />
                  <button
                    type="button"
                    onClick={refinePlan}
                    disabled={!instruction.trim() || refining}
                    className="btn-ghost"
                  >
                    {refining ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {refining ? "Refining…" : "Refine"}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => runLoop(null)}
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
            </>
          ) : (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {status === "failed" && runId ? (
                <>
                  <button
                    type="button"
                    onClick={() => runLoop(runId, { retry: true })}
                    disabled={running}
                    className="btn-primary"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    Retry step
                  </button>
                  <button
                    type="button"
                    onClick={() => runLoop(runId, { skip: true })}
                    disabled={running}
                    className="btn-ghost"
                  >
                    <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                    Skip step
                  </button>
                </>
              ) : null}
              {status === "done" ? (
                <button type="button" onClick={resetPlan} className="btn-ghost">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Start a new plan
                </button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}

      {runId !== null || results.length > 0 ? (
        <section className="card p-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-zinc-900">
              {status === "done"
                ? "Run complete"
                : status === "failed"
                  ? "Run stopped"
                  : "Run in progress"}
            </h3>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.idle}`}>
              {statusLabel(status)}
            </span>
          </div>
          <ol className="mt-3 space-y-2">
            {results.map((result, index) => (
              <li key={`${result.tool}-${index}`} className="rounded-lg border border-zinc-200 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      result.status === "ok"
                        ? "bg-emerald-500"
                        : result.status === "pending"
                          ? "bg-amber-500"
                          : result.status === "skipped"
                            ? "bg-zinc-400"
                            : "bg-rose-500"
                    }`}
                    aria-hidden="true"
                  />
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
            <div className="mt-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-medium text-zinc-800">Drafts for review</p>
                <Link href="/sending" className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900">
                  <Coins className="h-3 w-3" aria-hidden="true" />
                  {sendOverview?.available && day
                    ? `${day.remaining}/${day.cap} send coins left · ${day.date}`
                    : "Set up send coins"}
                </Link>
              </div>
              <p className="text-[10px] text-zinc-400">
                Edit the draft, then approve it. Approval mints one send coin; delivery waits for a human-paced slot.
              </p>
              {drafts.map((draft) => {
                const key = draftKey(draft);
                const edit = draftEdit(draft);
                const queued = queueForDraft(draft);
                const queuedStatus = queued?.status;
                const lockedDraft =
                  queuedStatus === "scheduled" ||
                  queuedStatus === "sending" ||
                  queuedStatus === "sent";
                const draftError = sendErrors[key];
                const warnings = sendWarnings[key] ?? [];
                return (
                  <article key={key} className="rounded-lg border border-zinc-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/companies/${draft.orgId}`} className="text-[12px] font-semibold text-zinc-900 hover:underline">
                        {draft.orgName}
                      </Link>
                      <span className="text-[11px] text-zinc-400">→ {edit.to}</span>
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
                      {queuedStatus ? (
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                            queuedStatus === "sent"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : queuedStatus === "failed"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : queuedStatus === "cancelled"
                                  ? "border-zinc-200 bg-zinc-50 text-zinc-500"
                                  : "border-sky-200 bg-sky-50 text-sky-700"
                          }`}
                        >
                          {queuedStatus === "scheduled"
                            ? "Coin minted"
                            : queuedStatus === "sending"
                              ? "Sending"
                              : queuedStatus}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => copyDraft(draft)}
                        className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900"
                      >
                        {copied === key ? (
                          <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        )}
                        {copied === key ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <div className="mt-2 grid gap-2">
                      <div>
                        <label htmlFor={`send-to-${key}`} className="label">To</label>
                        <input
                          id={`send-to-${key}`}
                          type="email"
                          value={edit.to}
                          onChange={(event) => updateDraft(draft, { to: event.target.value })}
                          disabled={lockedDraft}
                          className="input"
                        />
                      </div>
                      <div>
                        <label htmlFor={`send-subject-${key}`} className="label">Subject</label>
                        <input
                          id={`send-subject-${key}`}
                          value={edit.subject}
                          onChange={(event) => updateDraft(draft, { subject: event.target.value })}
                          disabled={lockedDraft}
                          className="input"
                        />
                      </div>
                      <div>
                        <label htmlFor={`send-body-${key}`} className="label">Body</label>
                        <textarea
                          id={`send-body-${key}`}
                          rows={7}
                          value={edit.body}
                          onChange={(event) => updateDraft(draft, { body: event.target.value })}
                          disabled={lockedDraft}
                          className="input"
                        />
                      </div>
                    </div>

                    {queued && (queuedStatus === "scheduled" || queuedStatus === "sending") ? (
                      <div className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-sky-800">
                          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                          {queuedStatus === "sending"
                            ? "Sending now"
                            : `Scheduled ${formatSlot(queued.scheduled_for, sendOverview?.policy.timezone ?? "UTC")}`}
                        </p>
                        <p className="mt-0.5 text-[10px] text-sky-700">
                          One send coin used. Cancel before delivery to edit again.
                        </p>
                        {queuedStatus === "scheduled" ? (
                          <button
                            type="button"
                            onClick={() => cancelDraft(draft)}
                            disabled={canceling === key}
                            className="mt-1 text-[11px] font-medium text-sky-800 underline-offset-2 hover:underline disabled:opacity-50"
                          >
                            {canceling === key ? "Cancelling…" : "Cancel schedule"}
                          </button>
                        ) : null}
                      </div>
                    ) : queuedStatus === "sent" ? (
                      <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                        Sent · send coin used. Replies appear in Emails.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => approveDraft(draft)}
                          disabled={Boolean(approving) || running || !sendOverview?.available}
                          className="btn-primary"
                        >
                          {approving === key ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                          ) : (
                            <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {approving === key ? "Approving…" : "Approve & schedule"}
                        </button>
                        <span className="text-[10px] text-zinc-400">
                          Uses 1 send coin · nothing sends immediately
                        </span>
                      </div>
                    )}

                    {draftError ? (
                      <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{draftError}</p>
                    ) : null}
                    {warnings.length > 0 ? (
                      <ul className="mt-2 space-y-0.5">
                        {warnings.map((warning) => (
                          <li key={warning} className="flex items-start gap-1.5 text-[10px] text-amber-700">
                            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            {warning}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {recentRuns.length > 0 ? (
        <section className="card p-5">
          <div className="flex items-center gap-2">
            <History className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            <h3 className="text-[14px] font-semibold text-zinc-900">Recent runs</h3>
          </div>
          <ul className="mt-3 space-y-2">
            {recentRuns.map((run) => {
              const doneSteps = Math.min(run.cursor, run.plan.steps.length);
              return (
                <li key={run.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-100 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-zinc-800">{run.goal || run.summary}</p>
                    <p className="text-[10px] text-zinc-400">
                      {doneSteps}/{run.plan.steps.length} steps · {run.plan.title}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${STATUS_STYLES[run.status] ?? STATUS_STYLES.idle}`}>
                    {statusLabel(run.status)}
                  </span>
                  <span className="text-[10px] text-zinc-400 tabular-nums">
                    {new Date(run.createdAt).toISOString().slice(0, 10)}
                  </span>
                  <button
                    type="button"
                    onClick={() => loadRun(run, run.status === "running")}
                    disabled={running || run.id === runId}
                    className="text-[11px] font-medium text-zinc-600 hover:text-zinc-900 disabled:text-zinc-300"
                  >
                    {run.id === runId
                      ? "Open"
                      : run.status === "running"
                        ? "Resume"
                        : run.status === "failed"
                          ? "Review"
                          : "Open"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
