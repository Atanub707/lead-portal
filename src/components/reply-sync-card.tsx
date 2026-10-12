"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

type SyncOutcome =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message: string };

export function ReplySyncCard({
  lastSyncAt,
  lastError,
}: {
  lastSyncAt: string | null;
  lastError: string | null;
}) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome>({ status: "idle" });

  const shownError =
    outcome.status === "error"
      ? outcome.message
      : outcome.status === "ok"
        ? null
        : lastError;

  async function syncNow() {
    setSyncing(true);
    try {
      const response = await fetch("/api/email/sync", { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setOutcome({ status: "ok" });
      } else {
        setOutcome({
          status: "error",
          message: data.error ?? "Sync failed.",
        });
      }
    } catch {
      setOutcome({
        status: "error",
        message: "Couldn't reach the server. Try again.",
      });
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  return (
    <section className="card mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">
            Email sync
          </h3>
          <p className="mt-1 text-[12px] text-zinc-500">
            {lastSyncAt
              ? `Last checked ${lastSyncAt.slice(0, 10)}`
              : "Not synced yet"}
          </p>
        </div>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          aria-busy={syncing}
          className="btn-ghost"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${
              syncing ? "animate-spin motion-reduce:animate-none" : ""
            }`}
            aria-hidden="true"
          />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {shownError ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] leading-relaxed text-rose-700"
        >
          {shownError}
        </p>
      ) : null}
    </section>
  );
}
