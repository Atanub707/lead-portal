"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Radar, Rocket, Settings2 } from "lucide-react";
import type { DiscoveryPlan } from "@/lib/discovery";

type Status = "idle" | "previewing" | "posting" | "running" | "done";

export function IcpDiscovery({
  icp,
  initialPlan,
  pipelines,
  defaultPipelineId,
  canWrite,
}: {
  icp: { id: string; name: string } | null;
  initialPlan: DiscoveryPlan | null;
  pipelines: { id: string; name: string }[];
  defaultPipelineId: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<DiscoveryPlan | null>(initialPlan);
  const [pipelineId, setPipelineId] = useState(
    defaultPipelineId ?? pipelines[0]?.id ?? ""
  );
  const [count, setCount] = useState("25");
  const [detailed, setDetailed] = useState(true);
  const [foundedAfter, setFoundedAfter] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [scanNote, setScanNote] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const busy = status === "previewing" || status === "posting" || status === "running";

  function params() {
    const parsed = Number(count);
    return {
      icpId: icp?.id ?? "",
      count: Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.round(parsed))) : 25,
      detailed,
      foundedAfter: foundedAfter || null,
    };
  }

  async function preview() {
    if (!icp) return;
    setStatus("previewing");
    setError("");
    try {
      const res = await fetch("/api/discovery/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params()),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; plan?: DiscoveryPlan; error?: string }
        | null;
      if (!res.ok || !json?.plan) {
        setError(json?.error ?? "Could not build the plan");
      } else {
        setPlan(json.plan);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the plan");
    } finally {
      setStatus("idle");
    }
  }

  async function start() {
    if (!icp || !pipelineId) return;
    setStatus("posting");
    setError("");
    setResult(null);
    setScanNote("");
    setElapsed(0);
    try {
      const res = await fetch("/api/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params(), pipelineId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: number; plan?: DiscoveryPlan; error?: string }
        | null;
      if (!res.ok || !json?.id) {
        setError(json?.error ?? "Could not start the discovery run");
        setStatus("idle");
        return;
      }
      if (json.plan) setPlan(json.plan);
      setStatus("running");
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      let finished = false;
      for (let i = 0; i < 60 && !finished; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const poll = await fetch(`/api/crunchbase/import?id=${json.id}`);
        const state = (await poll.json().catch(() => null)) as
          | { status?: string; imported?: number; skipped?: number; importedIds?: number[]; error?: string }
          | null;
        if (state?.status === "ok") {
          finished = true;
          window.clearInterval(timer);
          setResult({
            imported: Number(state.imported ?? 0),
            skipped: Number(state.skipped ?? 0),
          });
          const ids = (state.importedIds ?? []).slice(0, 5);
          if (ids.length > 0) {
            setScanNote(`Scanning signals for ${ids.length} company${ids.length === 1 ? "" : "ies"}…`);
            const scans = await Promise.allSettled(
              ids.map((orgId) =>
                fetch("/api/signals/scan", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ orgId }),
                })
              )
            );
            const ok = scans.filter((entry) => entry.status === "fulfilled").length;
            const total = Number(state.imported ?? 0);
            setScanNote(
              `Signals scanned for ${ok} of ${total} imported companies${total > ok ? " — the rest are queued." : "."}`
            );
          }
          setStatus("done");
          router.refresh();
        } else if (state?.status === "failed") {
          finished = true;
          window.clearInterval(timer);
          setError(state.error ?? "The discovery run failed");
          setStatus("idle");
        }
      }
      if (!finished) {
        window.clearInterval(timer);
        setError("The run is taking longer than expected — check the pipeline in a minute.");
        setStatus("idle");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the discovery run");
      setStatus("idle");
    }
  }

  if (!icp) {
    return (
      <div className="card p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">
          Discover by ICP
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          No ICP configured yet. Define who you target — industries, headcount,
          geography, funding stage, personas and signals — and discovery will
          build and rank the list automatically.
        </p>
        <Link href="/settings/business" className="btn-primary mt-3">
          <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
          Configure ICP
        </Link>
      </div>
    );
  }

  const parsedCount = Number(count);
  const safeCount = Number.isFinite(parsedCount)
    ? Math.min(100, Math.max(1, Math.round(parsedCount)))
    : 25;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
          <Radar className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-900">Discover by ICP</p>
          <p className="truncate text-[11px] text-zinc-500">
            {icp.name} · imports, scores and queues signal scans
          </p>
        </div>
        <Link
          href="/settings/business"
          className="text-[11px] text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
        >
          Edit ICP
        </Link>
      </div>

      {status === "running" ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Loader2
            className="h-6 w-6 animate-spin text-zinc-400 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div aria-live="polite">
            <p className="text-[13px] font-medium text-zinc-800">Discovering companies…</p>
            <p className="mt-1 text-[12px] text-zinc-500 tabular-nums">
              {elapsed}s elapsed · up to {safeCount} results
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Fetching profiles, deduping, scoring, then scanning signals.
            </p>
          </div>
        </div>
      ) : status === "done" && result ? (
        <div className="space-y-4 px-5 py-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-zinc-900 tabular-nums">
                Imported {result.imported} {result.imported === 1 ? "company" : "companies"} ·{" "}
                {result.skipped} {result.skipped === 1 ? "duplicate" : "duplicates"} skipped
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Scored against your ICP.{scanNote ? ` ${scanNote}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Link
              href={`/companies?list=${encodeURIComponent(pipelineId)}&sort=score`}
              className="btn-primary"
            >
              View ranked pipeline
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setResult(null);
                setScanNote("");
              }}
              className="btn-ghost"
            >
              Discover more
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="icp-pipeline" className="label">
                Import into pipeline
              </label>
              <select
                id="icp-pipeline"
                value={pipelineId}
                onChange={(event) => setPipelineId(event.target.value)}
                className="input"
                disabled={!canWrite}
              >
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="icp-count" className="label">
                Max results
              </label>
              <input
                id="icp-count"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                className="input tabular-nums"
                disabled={!canWrite}
              />
            </div>
            <div>
              <label htmlFor="icp-founded" className="label">
                Founded
              </label>
              <select
                id="icp-founded"
                value={foundedAfter}
                onChange={(event) => setFoundedAfter(event.target.value)}
                className="input"
                disabled={!canWrite}
              >
                <option value="">Any time</option>
                <option value="2026-01-01">2026 (this year)</option>
                <option value="2025-01-01">2025 or later</option>
                <option value="2024-01-01">2024 or later</option>
                <option value="2023-01-01">2023 or later</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={detailed}
              onChange={(event) => setDetailed(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300"
              disabled={!canWrite}
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-zinc-800">Full profiles</span>
              <span className="block text-[11px] leading-relaxed text-zinc-500">
                Adds email, phone, founders and tech stack ($7/1k vs $2/1k).
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-zinc-800">
                {plan ? plan.summary : "Configure filters to preview"}
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                ≈ ${(plan ? plan.estimatedCostUsd : safeCount * (detailed ? 0.007 : 0.002)).toFixed(2)}
              </p>
            </div>
            {plan?.warnings?.length ? (
              <ul className="mt-1.5 space-y-0.5">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="text-[11px] text-amber-700">
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1 text-[11px] text-zinc-400">
              Signals and scoring are applied automatically after import.
            </p>
          </div>

          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
              <p className="text-[12px] text-rose-700">{error}</p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={start}
              disabled={!canWrite || !pipelineId || busy}
              className="btn-primary"
            >
              {status === "posting" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Run discovery
            </button>
            <button type="button" onClick={preview} disabled={busy} className="btn-ghost">
              {status === "previewing" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
              Preview plan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
