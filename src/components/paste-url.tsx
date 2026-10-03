"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Globe, Loader2, Sparkles, X } from "lucide-react";
import { FALLBACK_PIPELINES, type OrgList, type Pipeline } from "@/lib/types";

interface PasteResult {
  created: boolean;
  company: { id: number; name: string; list: OrgList };
  listLabel: string;
  contactsAdded: number;
  contactsSkipped: number;
  linkedinProfilesFound: number;
  linkedinUrl: string | null;
  linkedinSource: "site" | "search" | null;
  unverifiedLinkedin: string | null;
  warning?: string;
  stillMissing: string[];
}

export function PasteUrl({
  list,
  pipelines,
}: {
  list: OrgList;
  pipelines: Pipeline[];
}) {
  const router = useRouter();
  const listOptions = pipelines.length > 0 ? pipelines : FALLBACK_PIPELINES;
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<OrgList>(list);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState("");
  const [errorDetail, setErrorDetail] = useState("");
  const [result, setResult] = useState<PasteResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openModal() {
    setUrl("");
    setTarget(list);
    setStatus("idle");
    setError("");
    setErrorDetail("");
    setResult(null);
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

  async function go() {
    const value = url.trim();
    if (!value || status === "loading") return;
    setStatus("loading");
    setError("");
    setErrorDetail("");
    try {
      const res = await fetch("/api/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value, list: target }),
      });
      const json = (await res.json().catch(() => null)) as
        | (PasteResult & { error?: string; detail?: string })
        | null;
      if (!res.ok) {
        setError(json?.error ?? `Request failed (${res.status})`);
        setErrorDetail(json?.detail ?? "");
        setStatus("idle");
        return;
      }
      setResult(json);
      setStatus("done");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  return (
    <>
      <button onClick={openModal} className="btn-ghost">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Paste URL with AI
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <button
            className="animate-overlay absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Paste URL with AI"
            className="animate-panel relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-900">
                  Paste URL with AI
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  One website in, a full pipeline record out
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

            {status === "loading" ? (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                <Loader2
                  className="h-6 w-6 animate-spin text-zinc-400 motion-reduce:animate-none"
                  aria-hidden="true"
                />
                <div aria-live="polite">
                  <p className="text-[13px] font-medium text-zinc-800">
                    Researching and adding to{" "}
                    {listOptions.find((pipeline) => pipeline.id === target)
                      ?.name ?? target}
                    …
                  </p>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    Fetching pages, extracting company data and people, saving
                    the record. This usually takes 10–30 seconds.
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
                    <p className="text-[13px] font-semibold text-zinc-900">
                      {result.created ? "Added to" : "Updated in"}{" "}
                      {result.listLabel}
                    </p>
                    <p className="truncate text-[13px] text-zinc-600">
                      {result.company.name}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600 tabular-nums">
                    {result.contactsAdded > 0
                      ? `+${result.contactsAdded} ${
                          result.contactsAdded === 1 ? "contact" : "contacts"
                        }`
                      : "No new contacts"}
                  </span>
                  {result.contactsSkipped > 0 ? (
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600 tabular-nums">
                      {result.contactsSkipped} already on file
                    </span>
                  ) : null}
                  {result.linkedinProfilesFound > 0 ? (
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600 tabular-nums">
                      +{result.linkedinProfilesFound} LinkedIn{" "}
                      {result.linkedinProfilesFound === 1 ? "profile" : "profiles"}
                    </span>
                  ) : null}
                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-600">
                    {result.linkedinUrl
                      ? result.linkedinSource === "search"
                        ? "LinkedIn found via search (verified)"
                        : "LinkedIn found on their site"
                      : "No LinkedIn URL"}
                  </span>
                </div>

                {result.stillMissing.length > 0 ? (
                  <p className="text-[12px] text-zinc-500">
                    Still missing: {result.stillMissing.join(", ")}. You can add
                    them by hand on the company page.
                  </p>
                ) : null}

                {result.unverifiedLinkedin ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    Found a LinkedIn link on the site that doesn&apos;t match
                    this company — not saved: {result.unverifiedLinkedin}
                  </p>
                ) : null}

                {result.warning ? (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                    {result.warning}
                  </p>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                  <Link
                    href={`/companies/${result.company.id}`}
                    className="btn-primary"
                  >
                    Open company
                  </Link>
                  <button
                    onClick={() => {
                      setUrl("");
                      setStatus("idle");
                      setError("");
                      setErrorDetail("");
                      setResult(null);
                      inputRef.current?.focus();
                    }}
                    className="btn-ghost"
                  >
                    Paste another
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 px-5 py-5">
                <div>
                  <label
                    htmlFor="paste-url"
                    className="mb-1.5 block text-[12px] font-medium text-zinc-700"
                  >
                    Website URL
                  </label>
                  <div className="relative">
                    <Globe
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                      aria-hidden="true"
                    />
                    <input
                      ref={inputRef}
                      id="paste-url"
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          go();
                        }
                      }}
                      placeholder="https://company.com"
                      className="input pl-9"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="paste-list"
                    className="mb-1.5 block text-[12px] font-medium text-zinc-700"
                  >
                    Add to pipeline
                  </label>
                  <select
                    id="paste-list"
                    value={target}
                    onChange={(event) =>
                      setTarget(event.target.value as OrgList)
                    }
                    className="input"
                  >
                    {listOptions.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.name}
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-[11px] leading-relaxed text-zinc-500">
                  The assistant fetches the site (plus /about, /team, /contact),
                  extracts the company, LinkedIn URL, emails and published team
                  members — and finds each person&apos;s LinkedIn profile (free)
                  — then saves everything. Duplicates are skipped.
                </p>

                {error ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2"
                  >
                    <p className="text-[12px] text-rose-700">{error}</p>
                    {errorDetail ? (
                      <p className="mt-0.5 break-words text-[11px] text-rose-500">
                        {errorDetail}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <button
                  onClick={go}
                  disabled={!url.trim()}
                  className="btn-primary w-full justify-center"
                >
                  Go
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
