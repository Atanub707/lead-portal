"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

interface DeepResearchSummary {
  people: number;
  emails: number;
  cost: number;
}

interface StatusResponse {
  ok?: boolean;
  status?: "idle" | "running" | "ok" | "failed";
  partial?: { people: number; emails: number };
  summary?: DeepResearchSummary;
  error?: string;
}

type Phase = "idle" | "running" | "done" | "failed";

const POLL_MS = 5000;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function DeepResearch({
  orgId,
  initialActiveRun,
  monthSpend,
}: {
  orgId: number;
  initialActiveRun: boolean;
  monthSpend: number;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    initialActiveRun ? "running" : "idle"
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [failedError, setFailedError] = useState("Deep research failed");
  const [summary, setSummary] = useState<DeepResearchSummary | null>(null);
  const [partial, setPartial] = useState<{
    people: number;
    emails: number;
  } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Ensures the terminal transition (and its router.refresh) runs only once.
  const settledRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!dialogOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !posting) setDialogOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, posting]);

  useEffect(() => {
    if (phase !== "running") return;
    const startedAt = startedAtRef.current ?? Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running") return;
    let cancelled = false;

    async function tick() {
      if (cancelled || settledRef.current) return;
      try {
        const res = await fetch(`/api/deep-research?orgId=${orgId}`);
        const json = (await res.json().catch(() => null)) as StatusResponse | null;
        if (cancelled || settledRef.current || !json || json.ok !== true) return;
        if (json.status === "ok") {
          settledRef.current = true;
          setSummary(json.summary ?? { people: 0, emails: 0, cost: 0 });
          setPhase("done");
          router.refresh();
        } else if (json.status === "failed") {
          settledRef.current = true;
          setFailedError(json.error?.trim() || "Deep research failed");
          setPhase("failed");
        } else if (json.status === "idle") {
          // Another tab/request finalized the run; refresh to pick up the
          // server's view (card stays or disappears per needsDeepResearch).
          settledRef.current = true;
          setPhase("idle");
          router.refresh();
        } else if (json.status === "running" && json.partial?.people) {
          // Counts only grow within a run, so a stale response can't shrink them.
          setPartial(json.partial);
        }
      } catch {
        // Transient failure — keep polling.
      }
    }

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, orgId, router]);

  async function startRun(fromDialog: boolean) {
    if (posting) return;
    setPosting(true);
    if (fromDialog) setDialogError("");
    try {
      const res = await fetch("/api/deep-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const json = (await res.json().catch(() => null)) as StatusResponse | null;
      if (!res.ok || json?.ok !== true) {
        const message =
          json?.error?.trim() ||
          "Couldn't start deep research. Please try again.";
        if (fromDialog) setDialogError(message);
        else setFailedError(message);
        return;
      }
      settledRef.current = false;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setSummary(null);
      setPartial(null);
      setDialogError("");
      setFailedError("Deep research failed");
      setDialogOpen(false);
      setPhase("running");
    } catch {
      const message = "Couldn't start deep research. Please try again.";
      if (fromDialog) setDialogError(message);
      else setFailedError(message);
    } finally {
      setPosting(false);
    }
  }

  if (phase === "running") {
    return (
      <div className="card animate-rise animate-rise-1 p-5" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <Loader2
              className="h-4 w-4 animate-spin text-zinc-400 motion-reduce:animate-none"
              aria-hidden="true"
            />
          </span>
          <div>
            <p className="text-[13px] font-medium text-zinc-800">
              Searching B2B databases… usually 1–3 minutes.
              <span
                className="ml-1.5 font-normal text-zinc-400 tabular-nums"
                aria-hidden="true"
              >
                {formatElapsed(elapsed)}
              </span>
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              You can leave this page — results are saved.
            </p>
            {partial && partial.people > 0 ? (
              <p className="mt-1 text-[12px] text-zinc-600">
                {`${partial.people} found so far — they're already in People below.`}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const foundNothing =
      summary !== null && summary.people === 0 && summary.emails === 0;
    return (
      <div className="card animate-rise animate-rise-1 p-5" aria-live="polite">
        {foundNothing ? (
          <p className="text-[13px] text-zinc-600">
            {
              "No new contacts found — these databases don't have this company yet. You can try again anytime."
            }
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-zinc-700">
            <Check
              className="h-4 w-4 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
            {summary
              ? `Found ${summary.people} people · ${summary.emails} emails · $${summary.cost.toFixed(2)}`
              : "Deep research finished."}
          </p>
        )}
        <div className="mt-3">
          <button
            type="button"
            disabled={posting}
            onClick={() => startRun(false)}
            className="btn-ghost"
          >
            {posting ? (
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                <Loader2
                  className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              </span>
            ) : null}
            Run again
          </button>
        </div>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="card animate-rise animate-rise-1 p-5">
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
        >
          {failedError}
        </p>
        <div className="mt-3">
          <button
            type="button"
            disabled={posting}
            onClick={() => startRun(false)}
            className="btn-primary"
          >
            <span
              className="inline-flex h-3.5 w-3.5 items-center justify-center"
              aria-hidden="true"
            >
              {posting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              ) : null}
            </span>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card animate-rise animate-rise-1 p-5">
        <p className="text-[13px] font-semibold text-zinc-900">
          Deep Research
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
          Searches premium B2B data sources for decision makers only —
          founders and executives — with their emails and phone numbers.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setDialogError("");
              setDialogOpen(true);
            }}
          >
            Deep Research
          </button>
          <p className="text-[11px] text-zinc-400">
            Runs on premium data sources — capped at ~$0.15 per run.
          </p>
        </div>
      </div>

      {dialogOpen
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
              <button
                type="button"
                className="animate-overlay absolute inset-0 bg-zinc-900/30"
                aria-label="Close"
                onClick={() => {
                  if (!posting) setDialogOpen(false);
                }}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Run deep research"
                className="animate-panel relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
              >
                <h2 className="text-sm font-semibold tracking-tight text-zinc-900">
                  Run deep research?
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">
                  Deep research searches premium B2B data sources for decision
                  makers, emails and phone numbers. It usually takes 1–3
                  minutes. Runs on premium data sources — capped at ~$0.15 per
                  run.
                </p>
                <p className="mt-3 text-[12px] text-zinc-500 tabular-nums">
                  {`This month's deep research spend: $${monthSpend.toFixed(2)} of $5.00`}
                </p>
                {dialogError ? (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
                  >
                    {dialogError}
                  </p>
                ) : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={posting}
                    onClick={() => setDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    autoFocus
                    disabled={posting}
                    onClick={() => startRun(true)}
                    className="btn-primary"
                  >
                    <span
                      className="inline-flex h-3.5 w-3.5 items-center justify-center"
                      aria-hidden="true"
                    >
                      {posting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                      ) : null}
                    </span>
                    Run deep research
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
