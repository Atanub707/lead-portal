"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";

interface Brief {
  summary: string;
  priorities: string[];
  likely_objections: string[];
  suggested_angle: string;
  stakeholder_notes: { name: string; title: string; note: string }[];
  created_at: string;
}

export function CompanyBrief({
  orgId,
  initialBrief,
  canWrite,
  showAction = true,
}: {
  orgId: number;
  initialBrief: Brief | null;
  canWrite: boolean;
  showAction?: boolean;
}) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(initialBrief);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, refresh: true }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; brief?: Brief; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.brief) {
        setError(json?.error ?? "Could not generate the brief");
      } else {
        setBrief(json.brief);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the brief");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && showAction ? (
          <button type="button" onClick={generate} disabled={busy} className="btn-ghost">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {busy ? "Researching…" : brief ? "Refresh brief" : "Generate brief"}
          </button>
        ) : null}
        {brief ? (
          <span className="text-[11px] text-zinc-400">
            Generated {new Date(brief.created_at).toISOString().slice(0, 10)} · grounded in stored evidence
          </span>
        ) : null}
        {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
      </div>

      {brief ? (
        <div className="max-w-[90ch] space-y-3 text-[14px] leading-relaxed text-zinc-700">
          <p>{brief.summary}</p>
          {brief.suggested_angle ? (
            <p>
              <span className="font-medium text-zinc-900">Suggested angle: </span>
              {brief.suggested_angle}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {brief.priorities.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Priorities</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px]">
                  {brief.priorities.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {brief.likely_objections.length > 0 ? (
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Likely objections</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px]">
                  {brief.likely_objections.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {brief.stakeholder_notes.length > 0 ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Stakeholders</p>
              <ul className="mt-1 space-y-1 text-[12px]">
                {brief.stakeholder_notes.map((entry) => (
                  <li key={`${entry.name}-${entry.title}`}>
                    <span className="font-medium text-zinc-800">{entry.name}</span>
                    {entry.title ? <span className="text-zinc-500"> · {entry.title}</span> : null}
                    {entry.note ? <span className="text-zinc-600"> — {entry.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-zinc-500">
          No brief yet. Generate one from firmographics, signals and contacts —
          it&apos;s also used to personalize email drafts.
        </p>
      )}
    </div>
  );
}
