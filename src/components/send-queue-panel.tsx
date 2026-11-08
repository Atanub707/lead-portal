"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Loader2, X } from "lucide-react";
import type { SendOverview } from "@/lib/send-queue";

const STATUS_STYLES: Record<string, string> = {
  scheduled: "border-sky-200 bg-sky-50 text-sky-700",
  sending: "border-amber-200 bg-amber-50 text-amber-700",
  sent: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-500",
  skipped: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

function formatSlot(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

export function SendQueuePanel({
  items,
  timezone,
}: {
  items: SendOverview["queue"];
  timezone: string;
}) {
  const router = useRouter();
  const [cancelled, setCancelled] = useState<Set<number>>(new Set());
  const [canceling, setCanceling] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function cancel(queueId: number) {
    if (canceling) return;
    setCanceling(queueId);
    setError("");
    try {
      const res = await fetch("/api/sending/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queueId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Could not cancel this send");
        return;
      }
      setCancelled((current) => new Set(current).add(queueId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel this send");
    } finally {
      setCanceling(null);
    }
  }

  const visible = items.filter((item) => !cancelled.has(item.id));
  const scheduled = visible.filter((item) => item.status === "scheduled" || item.status === "sending");
  const history = visible.filter((item) => item.status !== "scheduled" && item.status !== "sending");

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        <div>
          <h2 className="text-[14px] font-semibold text-zinc-900">Send queue</h2>
          <p className="text-[11px] text-zinc-500">
            Approved emails wait for a safe slot. Nothing sends twice.
          </p>
        </div>
      </div>

      {error ? <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}

      {scheduled.length === 0 ? (
        <p className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3 text-[12px] text-zinc-500">
          No scheduled sends. Approve a Copilot draft to mint a send coin.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {scheduled.map((item) => (
            <li key={item.id} className="rounded-lg border border-zinc-200 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/companies/${item.org_id}`} className="text-[12px] font-semibold text-zinc-900 hover:underline">
                  {item.org_name ?? `Company #${item.org_id}`}
                </Link>
                <span className="text-[11px] text-zinc-400">→ {item.to_email}</span>
                <span className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-medium ${STATUS_STYLES[item.status] ?? STATUS_STYLES.scheduled}`}>
                  {item.status === "sending" ? "Sending" : "Scheduled"}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-zinc-700">{item.subject}</p>
              <p className="mt-0.5 text-[10px] text-zinc-400">{formatSlot(item.scheduled_for, timezone)}</p>
              {item.status === "scheduled" ? (
                <button
                  type="button"
                  onClick={() => cancel(item.id)}
                  disabled={canceling === item.id}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-rose-600"
                >
                  {canceling === item.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
                  Cancel send
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 ? (
        <div className="mt-5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Recent</p>
          <ul className="mt-2 space-y-1.5">
            {history.slice(0, 12).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-700">
                  {item.org_name ?? `#${item.org_id}`} · {item.subject}
                </span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] ${STATUS_STYLES[item.status] ?? ""}`}>
                  {item.status}
                </span>
                <span className="text-[10px] text-zinc-400 tabular-nums">
                  {formatSlot(item.sent_at ?? item.scheduled_for, timezone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
