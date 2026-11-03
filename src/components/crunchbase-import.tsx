"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Rocket, X } from "lucide-react";

type Status = "idle" | "posting" | "running" | "done";

interface ImportSummary {
  imported: number;
  skipped: number;
}

export function CrunchbaseImport({ list }: { list: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchUrl, setSearchUrl] = useState("");
  const [count, setCount] = useState("25");
  const [cookies, setCookies] = useState("");
  const [configured, setConfigured] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [importId, setImportId] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const startedAt = useRef<number | null>(null);

  function openModal() {
    setSearchUrl("");
    setCount("25");
    setCookies("");
    setStatus("idle");
    setError("");
    setResult(null);
    setImportId(null);
    setElapsed(0);
    startedAt.current = null;
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/crunchbase/import")
      .then((res) => res.json())
      .then((json: { configured?: boolean } | null) => {
        if (!cancelled) setConfigured(Boolean(json?.configured));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || status !== "running" || importId === null) return;
    let stopped = false;

    async function poll() {
      try {
        const res = await fetch(`/api/crunchbase/import?id=${importId}`);
        const json = (await res.json().catch(() => null)) as
          | {
              status?: string;
              imported?: number;
              skipped?: number;
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
        // A transient poll failure keeps the dialog polling.
      }
    }

    const timer = window.setInterval(poll, 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [open, status, importId, router]);

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
  const estimate = (safeCount * 0.0025).toFixed(2);

  async function start() {
    const url = searchUrl.trim();
    if (!url || status === "posting" || status === "running") return;
    setStatus("posting");
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/crunchbase/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchUrl: url,
          count: safeCount,
          cookies: cookies.trim() || undefined,
          pipelineId: list,
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
      if (cookies.trim()) setConfigured(true);
      setCookies("");
      setImportId(Number(json.id));
      startedAt.current = Date.now();
      setElapsed(0);
      setStatus("running");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  const dialog = (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        className="animate-overlay absolute inset-0 bg-zinc-900/30"
        aria-label="Close"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import from Crunchbase"
        className="animate-panel relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
            <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-zinc-900">
              Import from Crunchbase
            </p>
            <p className="truncate text-[11px] text-zinc-500">
              Search results in, companies out
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {status === "running" ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <Loader2
              className="h-6 w-6 animate-spin text-zinc-400 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div aria-live="polite">
              <p className="text-[13px] font-medium text-zinc-800">
                Reading Crunchbase results…
              </p>
              <p className="mt-1 text-[12px] text-zinc-500 tabular-nums">
                {elapsed}s elapsed · {safeCount} results requested
              </p>
              <p className="mt-1 text-[12px] text-zinc-500">
                Scraping, deduping and adding them to your pipeline.
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
                href={`/companies?list=${encodeURIComponent(list)}`}
                className="btn-primary"
                onClick={() => setOpen(false)}
              >
                View pipeline
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <button onClick={openModal} className="btn-ghost">
                Import more
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-5">
            <div>
              <label
                htmlFor="cb-search-url"
                className="mb-1.5 block text-[12px] font-medium text-zinc-700"
              >
                Crunchbase search URL
              </label>
              <input
                ref={inputRef}
                id="cb-search-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={searchUrl}
                onChange={(event) => setSearchUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    start();
                  }
                }}
                placeholder="https://www.crunchbase.com/discover/organization.companies/…"
                className="input"
              />
            </div>

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

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label
                  htmlFor="cb-cookies"
                  className="block text-[12px] font-medium text-zinc-700"
                >
                  Cookies
                </label>
                {configured ? (
                  <span className="text-[11px] font-medium text-emerald-600">
                    Cookies saved ✓
                  </span>
                ) : null}
              </div>
              <textarea
                id="cb-cookies"
                rows={4}
                autoComplete="off"
                spellCheck={false}
                value={cookies}
                onChange={(event) => setCookies(event.target.value)}
                placeholder="Paste the Cookie-Editor JSON export"
                className="input min-h-[96px] resize-y font-mono text-[11px]"
              />
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Saved encrypted — you can leave this empty next time.
              </p>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-500 tabular-nums">
              $2.50 per 1,000 results — about ${estimate} for {safeCount}.
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
              disabled={!searchUrl.trim() || status === "posting"}
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
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button onClick={openModal} className="btn-ghost">
        <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
        Crunchbase leads
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(dialog, document.body)
        : null}
    </>
  );
}
