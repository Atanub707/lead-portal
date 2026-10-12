"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Send } from "lucide-react";

export function ReplyThread({ threadId }: { threadId: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [posting, startPosting] = useTransition();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    // Throttled background sync when the page opens.
    fetch("/api/email/sync", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [router]);

  function send() {
    if (!text.trim() || posting) return;
    setError("");
    startPosting(async () => {
      try {
        const res = await fetch("/api/email/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, text }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (data.ok) {
          setText("");
          router.refresh();
        } else {
          setError(data.error ?? "Send failed");
        }
      } catch {
        setError("Couldn't send the reply — try again.");
      }
    });
  }

  async function syncNow() {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/email/sync", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Couldn't check for new replies — try again.");
      }
    } catch {
      setError("Couldn't check for new replies — try again.");
    } finally {
      setSyncing(false);
      router.refresh();
    }
  }

  return (
    <div className="mt-4">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder="Write your reply…"
        aria-label="Reply message"
        className="input min-h-[110px] w-full resize-y"
      />
      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
        >
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
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
        <button
          type="button"
          onClick={send}
          disabled={posting || !text.trim()}
          aria-busy={posting}
          className="btn-primary"
        >
          {posting ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Send reply
        </button>
      </div>
    </div>
  );
}
