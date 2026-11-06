"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Radar } from "lucide-react";

interface Run {
  key: string;
  label: string;
  runId: string;
}

export function JobSignalsScan() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/signals/jobs-scan", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; runs?: Run[]; error?: string }
        | null;
      if (!res.ok || !json?.runs?.length) {
        setError(json?.error ?? "Could not start the scan");
        setBusy(false);
        return;
      }
      setMessage(`Scanning ${json.runs.length} keyword set${json.runs.length === 1 ? "" : "s"}…`);
      const totals = { created: 0, matched: 0, scanned: 0 };
      const pending = new Map(json.runs.map((entry) => [entry.runId, entry]));
      for (let round = 0; round < 72 && pending.size > 0; round += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        for (const [runId, entry] of [...pending.entries()]) {
          const poll = await fetch(
            `/api/signals/jobs-scan?runId=${encodeURIComponent(runId)}&key=${encodeURIComponent(entry.key)}`
          );
          const state = (await poll.json().catch(() => null)) as
            | { status?: string; created?: number; matched?: number; scanned?: number; error?: string }
            | null;
          if (state?.status === "ok") {
            totals.created += state.created ?? 0;
            totals.matched += state.matched ?? 0;
            totals.scanned += state.scanned ?? 0;
            pending.delete(runId);
          } else if (state?.status === "failed") {
            pending.delete(runId);
            setError(state.error ?? "A job scan failed");
          }
        }
        if (pending.size > 0) {
          setMessage(
            `${totals.created} signals so far · ${pending.size} scan${pending.size === 1 ? "" : "s"} still running…`
          );
        }
      }
      setMessage(
        `Scanned ${totals.scanned} job posts · ${totals.created} new hiring signals across ${totals.matched} job matches`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the scan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className="btn-ghost">
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Radar className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {busy ? "Scanning…" : "Scan hiring signals"}
      </button>
      {message ? <span className="text-[11px] text-emerald-600">{message}</span> : null}
      {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
    </div>
  );
}
