"use client";

import { useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { findContactLinkedIn } from "@/lib/actions";

export function FindLinkedInButton({
  contactId,
  orgId,
}: {
  contactId: number;
  orgId: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function run() {
    setMessage("");
    startTransition(async () => {
      const result = await findContactLinkedIn(contactId, orgId);
      if (!result.ok && result.message) setMessage(result.message);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-900 disabled:opacity-50"
      >
        {pending ? (
          <Loader2
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <Search className="h-3 w-3" aria-hidden="true" />
        )}
        {pending ? "Searching…" : "Find LinkedIn"}
      </button>
      {message ? (
        <span className="text-[11px] text-zinc-400">{message}</span>
      ) : null}
    </span>
  );
}
