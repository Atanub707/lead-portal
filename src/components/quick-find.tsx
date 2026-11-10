"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { finishLeadPipeline } from "@/lib/client-pipeline";

const BANDS = [
  { value: "", label: "Any size" },
  { value: "1-10", label: "1–10" },
  { value: "11-50", label: "11–50" },
  { value: "51-100", label: "51–100" },
  { value: "101-250", label: "101–250" },
  { value: "251-500", label: "251–500" },
  { value: "501-1000", label: "501–1,000" },
] as const;

type Stage =
  | "idle"
  | "searching"
  | "importing"
  | "signals"
  | "briefs"
  | "done";

export function QuickFind() {
  const router = useRouter();
  const [source, setSource] = useState("all");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [band, setBand] = useState("");
  const [count, setCount] = useState("10");
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const busy = stage !== "idle" && stage !== "done";
  const canSearch = Boolean(industry.trim() || location.trim() || band);

  async function find() {
    if (!canSearch || busy) return;
    setStage("searching");
    setError("");
    setMessage("Searching companies…");
    try {
      const requested = Number(count);
      const res = await fetch("/api/leads/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          industry: industry.trim() || undefined,
          location: location.trim() || undefined,
          employeeBand: band || undefined,
          count: Number.isFinite(requested) ? requested : 10,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; id?: number; error?: string }
        | null;
      if (!res.ok || !json?.id) {
        setError(json?.error ?? "Search failed");
        setStage("idle");
        return;
      }
      const importId = json.id;
      setStage("importing");
      setMessage("Reading company profiles…");

      let importedIds: number[] = [];
      let imported = 0;
      let done = false;
      for (let i = 0; i < 48 && !done; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const poll = await fetch(`/api/crunchbase/import?id=${importId}`);
        const state = (await poll.json().catch(() => null)) as
          | { status?: string; imported?: number; importedIds?: number[]; error?: string }
          | null;
        if (state?.status === "ok") {
          done = true;
          imported = Number(state.imported ?? 0);
          importedIds = state.importedIds ?? [];
        } else if (state?.status === "failed") {
          setError(state.error ?? "The search failed");
          setStage("idle");
          return;
        }
      }
      if (!done) {
        setError("This is taking longer than expected — check Companies in a minute.");
        setStage("idle");
        return;
      }
      if (importedIds.length === 0) {
        router.push(`/leads?run=${importId}`);
        return;
      }

      setStage("signals");
      setMessage(`Checking signals and writing AI briefs for ${importedIds.length} companies…`);
      const pipeline = await finishLeadPipeline(importedIds, (message) => {
        setMessage(message);
        if (message.startsWith("Writing")) setStage("briefs");
      });
      setStage("done");
      setMessage(
        `Pipeline complete: ${pipeline.websites} websites · ${pipeline.signals} signal scans · ${pipeline.briefs} AI briefs${
          pipeline.failures > 0 ? ` · ${pipeline.failures} partial failures` : ""
        }`
      );
      router.push(`/leads?run=${importId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setStage("idle");
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-zinc-100 px-4 py-3">
        <p className="text-[13px] font-semibold text-zinc-900">Find companies</p>
        <p className="text-[11px] text-zinc-500">
          We bring back companies, people, emails and LinkedIn automatically.
        </p>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div>
          <label htmlFor="qf-source" className="label">
            Source
          </label>
          <select
            id="qf-source"
            className="input"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            disabled={busy}
          >
            <option value="all">All sources (base)</option>
            <option value="crunchbase">Crunchbase</option>
            <option value="apollo" disabled>Apollo — coming soon</option>
          </select>
        </div>
        <div>
          <label htmlFor="qf-industry" className="label">
            Who do you want to reach?
          </label>
          <input
            id="qf-industry"
            className="input"
            placeholder="e.g. SaaS, FinTech, restaurants, marketing agencies"
            value={industry}
            onChange={(event) => setIndustry(event.target.value)}
            disabled={busy}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="qf-location" className="label">
              Location
            </label>
            <input
              id="qf-location"
              className="input"
              placeholder="India"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <label htmlFor="qf-size" className="label">
              Company size
            </label>
            <select
              id="qf-size"
              className="input"
              value={band}
              onChange={(event) => setBand(event.target.value)}
              disabled={busy}
            >
              {BANDS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="qf-count" className="label">
              How many companies
            </label>
            <input
              id="qf-count"
              type="number"
              min={1}
              max={15}
              className="input tabular-nums"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500">
          We scan each company&apos;s website automatically for details, people,
          emails and LinkedIn. Deep Search is manual only — it runs when you
          click it and uses paid credits.
        </p>

        {message ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2" aria-live="polite">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400 motion-reduce:animate-none" aria-hidden="true" />
            ) : null}
            <p className="text-[12px] text-zinc-700">{message}</p>
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="text-[12px] text-rose-700">{error}</p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={find}
          disabled={!canSearch || busy}
          className="btn-primary w-full justify-center"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Search className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {busy ? "Working…" : "Find leads & emails"}
        </button>
        {!canSearch ? (
          <p className="text-center text-[11px] text-zinc-500">
            Add an industry, location or company size to start.
          </p>
        ) : null}
      </div>
    </div>
  );
}
