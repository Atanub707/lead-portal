"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { addManualSignal } from "@/lib/intelligence-actions";
import type { Firmographics, SignalDefinition } from "@/lib/intelligence";

interface SignalRow {
  id: number;
  signal_key: string;
  value: unknown;
  evidence: unknown;
  source_key: string;
  confidence: number;
  observed_at: string;
  expires_at: string | null;
}

function evidenceText(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  return typeof record.snippet === "string"
    ? record.snippet
    : typeof record.note === "string"
      ? record.note
      : null;
}

function evidenceUrl(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const record = evidence as Record<string, unknown>;
  return typeof record.url === "string" && /^https?:\/\//i.test(record.url)
    ? record.url
    : null;
}

function shortDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function CompanyIntelligence({
  orgId,
  firmographics,
  signals,
  definitions,
  canWrite,
}: {
  orgId: number;
  firmographics: Firmographics | null;
  signals: SignalRow[];
  definitions: SignalDefinition[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const labels = new Map(definitions.map((entry) => [entry.key, entry]));

  async function scan() {
    setScanning(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/signals/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; created?: number; skipped?: string; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? json?.skipped ?? "Scan failed");
      } else {
        setMessage(
          json.skipped
            ? json.skipped
            : `Scan complete — ${json.created ?? 0} new signal${(json.created ?? 0) === 1 ? "" : "s"}`
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  const facts = firmographics
    ? [
        ["Industry", firmographics.industry],
        ["Employees", firmographics.employee_band],
        ["HQ", [firmographics.hq_city, firmographics.hq_region, firmographics.hq_country].filter(Boolean).join(", ") || null],
        ["Funding", firmographics.funding_stage],
        ["Founded", firmographics.founded_year ? String(firmographics.founded_year) : null],
        ["Tech", firmographics.tech_stack.length > 0 ? firmographics.tech_stack.join(", ") : null],
      ].filter(([, value]) => Boolean(value)) as [string, string][]
    : [];

  return (
    <div className="mt-3 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          <button
            type="button"
            onClick={scan}
            disabled={scanning}
            className="btn-ghost"
          >
            {scanning ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Radar className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {scanning ? "Scanning…" : "Scan signals"}
          </button>
        ) : null}
        {message ? (
          <span className="text-[11px] text-emerald-600">{message}</span>
        ) : null}
        {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
      </div>

      {facts.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2.5 sm:grid-cols-4">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                {label}
              </dt>
              <dd className="mt-1 text-[13px] text-zinc-800">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {signals.length === 0 ? (
        <p className="text-[13px] text-zinc-500">
          No signals yet. Scan the website or add one manually.
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((signal) => {
            const definition = labels.get(signal.signal_key);
            const snippet = evidenceText(signal.evidence);
            const url = evidenceUrl(signal.evidence);
            return (
              <li
                key={signal.id}
                className="rounded-lg border border-zinc-200 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-zinc-900">
                    {definition?.label ?? signal.signal_key}
                  </span>
                  <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                    {definition?.category ?? signal.source_key}
                  </span>
                  <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">
                    {Math.round(Number(signal.confidence) * 100)}% ·{" "}
                    {shortDate(signal.observed_at)}
                  </span>
                </div>
                {snippet ? (
                  <p className="mt-1 text-[12px] leading-relaxed text-zinc-600">
                    {snippet}
                    {url ? (
                      <>
                        {" "}
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                        >
                          source
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <form action={addManualSignal} className="space-y-2 border-t border-zinc-100 pt-3">
          <input type="hidden" name="org_id" value={orgId} />
          <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
            <select name="signal_key" className="input" defaultValue="" required>
              <option value="" disabled>
                Add a signal…
              </option>
              {definitions.map((definition) => (
                <option key={definition.key} value={definition.key}>
                  {definition.label}
                </option>
              ))}
            </select>
            <input
              name="evidence_url"
              type="url"
              className="input"
              placeholder="Evidence link (optional)"
            />
          </div>
          <textarea
            name="note"
            rows={2}
            required
            className="input"
            placeholder="What did you observe? e.g. Job post for a Security Engineer mentions SOC 2."
          />
          <div className="flex justify-end">
            <SubmitButton pendingText="Adding…">Add signal</SubmitButton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
