"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

export function RecomputeScores() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function run() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/scores/recompute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; scored?: number; failed?: number; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Could not recompute scores");
      } else {
        setMessage(
          `Scored ${json.scored ?? 0} companies${json.failed ? ` · ${json.failed} failed` : ""}`
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not recompute scores");
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
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {busy ? "Recomputing…" : "Recompute scores"}
      </button>
      {message ? <span className="text-[11px] text-emerald-600">{message}</span> : null}
      {error ? <span className="text-[11px] text-rose-600">{error}</span> : null}
    </div>
  );
}
