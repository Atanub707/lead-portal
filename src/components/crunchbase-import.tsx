"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Rocket, X } from "lucide-react";
import {
  CRUNCHBASE_COST_PER_RESULT_USD,
  CRUNCHBASE_DETAILED_COST_PER_RESULT_USD,
  EMPLOYEE_BANDS,
  FOUNDED_AFTER_OPTIONS,
  FUNDING_STAGES,
  INDUSTRY_OPTIONS,
} from "@/lib/crunchbase-options";

type Status = "idle" | "posting" | "running" | "done";

interface ImportSummary {
  imported: number;
  skipped: number;
}

export function CrunchbaseImport({
  list,
  variant = "dialog",
  pipelines,
}: {
  list: string;
  variant?: "dialog" | "page";
  pipelines?: { id: string; name: string }[];
}) {
  const isPage = variant === "page";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("all");
  const [pipeline, setPipeline] = useState(pipelines?.[0]?.id ?? list);
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [employees, setEmployees] = useState<string[]>([]);
  const [fundingStage, setFundingStage] = useState("");
  const [foundedAfter, setFoundedAfter] = useState("");
  const [detailed, setDetailed] = useState(true);
  const [count, setCount] = useState("25");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  const hasFilter = Boolean(
    category.trim() ||
      location.trim() ||
      employees.length > 0 ||
      fundingStage ||
      foundedAfter
  );

  function resetForm() {
    setSource("all");
    setCategory("");
    setLocation("");
    setEmployees([]);
    setFundingStage("");
    setFoundedAfter("");
    setDetailed(true);
    setCount("25");
    setStatus("idle");
    setError("");
    setResult(null);
    setImportId(null);
    setElapsed(0);
    startedAt.current = null;
  }

  function openModal() {
    resetForm();
    setOpen(true);
  }

  useEffect(() => {
    if (!open || isPage) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isPage]);

  useEffect(() => {
    if ((!open && !isPage) || status !== "running" || importId === null) return;
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch(`/api/crunchbase/import?id=${importId}`);
        const json = (await res.json().catch(() => null)) as
          | {
              status?: string;
              imported?: number;
              skipped?: number;
              importedIds?: number[];
              error?: string | null;
            }
          | null;
        if (stopped) return;
        if (!res.ok && json?.status !== "running") {
          setError(json?.error ?? `Request failed (${res.status})`);
          setStatus("idle");
          setImportId(null);
        } else if (json?.status === "ok") {
          setResult({
            imported: Number(json.imported ?? 0),
            skipped: Number(json.skipped ?? 0),
          });
          setStatus("done");
          router.refresh();
        } else if (json?.status === "failed") {
          setError(json.error ?? "The import failed. Please try again.");
          setStatus("idle");
          setImportId(null);
        }
      } catch {
        // A transient poll failure keeps polling.
      }
    }

    const timer = window.setInterval(poll, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, isPage, status, importId, router]);

  useEffect(() => {
    if (status !== "running") return;
    const timer = window.setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [status]);

  const requested = Number(count);
  const safeCount = Number.isFinite(requested)
    ? Math.min(100, Math.max(1, Math.round(requested)))
    : 25;
  const perResult = detailed
    ? CRUNCHBASE_DETAILED_COST_PER_RESULT_USD
    : CRUNCHBASE_COST_PER_RESULT_USD;
  const estimate = (safeCount * perResult).toFixed(2);

  function toggleBand(band: string) {
    setEmployees((current) =>
      current.includes(band)
        ? current.filter((entry) => entry !== band)
        : [...current, band]
    );
  }

  async function start() {
    if (!hasFilter || status === "posting" || status === "running") return;
    setStatus("posting");
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/crunchbase/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            category: category.trim() || undefined,
            location: location.trim() || undefined,
            employeeCount: employees.length > 0 ? employees : undefined,
            fundingStage: fundingStage || undefined,
            foundedAfter: foundedAfter || undefined,
            detailed,
          },
          count: safeCount,
          pipelineId: pipeline,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: number; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.id) {
        setError(json?.error ?? `Request failed (${res.status})`);
        setStatus("idle");
        return;
      }
      setImportId(Number(json.id));
      startedAt.current = Date.now();
      setElapsed(0);
      setStatus("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  const panel = (
    <div
      role={isPage ? undefined : "dialog"}
      aria-modal={isPage ? undefined : true}
      aria-label="Find leads from Crunchbase"
      className={
        isPage
          ? "card overflow-hidden"
          : "animate-panel relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
      }
    >
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
          <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-zinc-900">
            Find leads
          </p>
          <p className="truncate text-[11px] text-zinc-500">
            Pick a source, then filter — no login or cookies needed
          </p>
        </div>
        {isPage ? null : (
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {status === "running" ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <Loader2
            className="h-6 w-6 animate-spin text-zinc-400 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <div aria-live="polite">
            <p className="text-[13px] font-medium text-zinc-800">
              Searching Crunchbase…
            </p>
            <p className="mt-1 text-[12px] text-zinc-500 tabular-nums">
              {elapsed}s elapsed · {safeCount} companies requested
            </p>
            <p className="mt-1 text-[12px] text-zinc-500">
              Fetching profiles, deduping and adding them to your pipeline.
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
                Imported {result.imported}{" "}
                {result.imported === 1 ? "company" : "companies"} ·{" "}
                {result.skipped}{" "}
                {result.skipped === 1 ? "duplicate" : "duplicates"} skipped
              </p>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                They&apos;re ready for Deep Research and the Email Composer.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Link
              href={`/companies?list=${encodeURIComponent(pipeline)}`}
              className="btn-primary"
              onClick={() => {
                if (!isPage) setOpen(false);
              }}
            >
              View pipeline
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
            <button onClick={resetForm} className="btn-ghost">
              Import more
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <div>
            <label htmlFor="cb-source" className="mb-1.5 block text-[12px] font-medium text-zinc-700">
              Source
            </label>
            <select
              id="cb-source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="input"
            >
              <option value="all">All sources (base)</option>
              <option value="crunchbase">Crunchbase</option>
              <option value="apollo" disabled>Apollo — coming soon</option>
            </select>
          </div>

          {pipelines && pipelines.length > 0 ? (
            <div>
              <label
                htmlFor="cb-pipeline"
                className="mb-1.5 block text-[12px] font-medium text-zinc-700"
              >
                Import into pipeline
              </label>
              <select
                id="cb-pipeline"
                value={pipeline}
                onChange={(event) => setPipeline(event.target.value)}
                className="input"
              >
                {pipelines.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label
              htmlFor="cb-category"
              className="mb-1.5 block text-[12px] font-medium text-zinc-700"
            >
              Industry
            </label>
            <select
              id="cb-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="input"
            >
              <option value="">Any industry</option>
              {INDUSTRY_OPTIONS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="cb-location"
              className="mb-1.5 block text-[12px] font-medium text-zinc-700"
            >
              Location
            </label>
            <input
              id="cb-location"
              type="text"
              autoComplete="off"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="e.g. India, Bengaluru, United States"
              className="input"
            />
          </div>

          <div>
            <p className="mb-1.5 text-[12px] font-medium text-zinc-700">
              Headcount
            </p>
            <p className="mb-1.5 text-[11px] leading-relaxed text-zinc-500">
              Newly formed companies are usually 1–10.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EMPLOYEE_BANDS.map((band) => {
                const active = employees.includes(band);
                return (
                  <button
                    key={band}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleBand(band)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white"
                        : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                    }`}
                  >
                    {band}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cb-stage"
                className="mb-1.5 block text-[12px] font-medium text-zinc-700"
              >
                Funding stage
              </label>
              <select
                id="cb-stage"
                value={fundingStage}
                onChange={(event) => setFundingStage(event.target.value)}
                className="input"
              >
                {FUNDING_STAGES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="cb-founded"
                className="mb-1.5 block text-[12px] font-medium text-zinc-700"
              >
                Founded
              </label>
              <select
                id="cb-founded"
                value={foundedAfter}
                onChange={(event) => setFoundedAfter(event.target.value)}
                className="input"
              >
                {FOUNDED_AFTER_OPTIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2.5">
            <input
              type="checkbox"
              checked={detailed}
              onChange={(event) => setDetailed(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300"
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-zinc-800">
                Full profiles
              </span>
              <span className="block text-[11px] leading-relaxed text-zinc-500">
                Adds email, phone, founders and tech stack.
              </span>
            </span>
          </label>

          <div>
            <label
              htmlFor="cb-count"
              className="mb-1.5 block text-[12px] font-medium text-zinc-700"
            >
              Max results
            </label>
            <input
              id="cb-count"
              type="number"
              min={1}
              max={100}
              step={1}
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className="input w-24 tabular-nums"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-500 tabular-nums">
            ${detailed ? "7" : "2"} per 1,000 companies — about ${estimate} for{" "}
            {safeCount}.
          </p>

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
            >
              <p className="text-[12px] text-rose-700">{error}</p>
            </div>
          ) : null}

          <button
            onClick={start}
            disabled={!hasFilter || status === "posting"}
            className="btn-primary w-full justify-center"
          >
            {status === "posting" ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Start import
          </button>
          {!hasFilter ? (
            <p className="text-center text-[11px] text-zinc-500">
              Add at least one filter to start.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );

  const dialog = isPage ? (
    panel
  ) : (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        className="animate-overlay absolute inset-0 bg-zinc-900/30"
        aria-label="Close"
        onClick={() => setOpen(false)}
      />
      {panel}
    </div>
  );

  if (isPage) {
    return dialog;
  }

  return (
    <>
      <button onClick={openModal} className="btn-ghost">
        <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
        Find leads
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(dialog, document.body)
        : null}
    </>
  );
}
