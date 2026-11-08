"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";

export function SendTicker({ available, hasScheduled }: { available: boolean; hasScheduled: boolean }) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [last, setLast] = useState("");
  const running = useRef(false);

  async function tick(manual: boolean) {
    if (!available || running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const res = await fetch("/api/sending/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; sent?: number; failed?: number; scheduled?: number; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        if (manual) setLast(json?.error ?? "Check failed");
        return;
      }
      setLast(
        `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${json.sent ?? 0} sent · ${json.scheduled ?? 0} rescheduled`
      );
      if ((json.sent ?? 0) > 0 || (json.failed ?? 0) > 0) router.refresh();
    } catch {
      if (manual) setLast("Check failed");
    } finally {
      running.current = false;
      setChecking(false);
    }
  }

  useEffect(() => {
    if (!available) return;
    const timer = window.setInterval(() => {
      void tick(false);
    }, 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, hasScheduled]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void tick(true)}
        disabled={!available || checking}
        className="btn-ghost"
      >
        {checking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        Check due sends
      </button>
      <span className="text-[10px] text-zinc-400">
        {last || (hasScheduled ? "Checks every minute while this page is open." : "No due sends.")}
      </span>
    </div>
  );
}
