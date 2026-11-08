"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Radar, Search, Sparkles } from "lucide-react";
import { EmailComposer, type EmailRecipientOption } from "@/components/email-composer";

type Busy = "contacts" | "brief" | "signals" | null;

export function CompanyActions({
  orgId,
  email,
  contactId,
  contactLabel,
  emailOptions = [],
  smtpConfigured,
  canWrite,
}: {
  orgId: number;
  email: string | null;
  contactId: number | null;
  contactLabel: string | null;
  emailOptions?: EmailRecipientOption[];
  smtpConfigured: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function findContacts() {
    setBusy("contacts");
    setError("");
    setStatus("Finding people and emails…");
    try {
      const res = await fetch("/api/deep-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Could not start contact discovery");
        setBusy(null);
        return;
      }
      for (let i = 0; i < 72; i += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 5000));
        const poll = await fetch(`/api/deep-research?orgId=${orgId}`);
        const state = (await poll.json().catch(() => null)) as
          | { status?: string; summary?: { people: number; emails: number }; error?: string }
          | null;
        if (state?.status === "ok") {
          const people = state.summary?.people ?? 0;
          const emails = state.summary?.emails ?? 0;
          setStatus(`Found ${people} people · ${emails} emails`);
          router.refresh();
          break;
        }
        if (state?.status === "failed" || state?.status === "idle") {
          setError(state.error ?? "Contact discovery finished without results");
          break;
        }
        if (i % 6 === 5) setStatus(`Still searching… ${(i + 1) * 5}s`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contact discovery failed");
    } finally {
      setBusy(null);
    }
  }

  async function generateBrief() {
    setBusy("brief");
    setError("");
    setStatus("Writing account brief…");
    try {
      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, refresh: true }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Could not generate the brief");
      } else {
        setStatus("Brief ready");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate the brief");
    } finally {
      setBusy(null);
    }
  }

  async function scanSignals() {
    setBusy("signals");
    setError("");
    setStatus("Scanning website signals…");
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
        setStatus(
          json.skipped ?? `Added ${json.created ?? 0} new signal${(json.created ?? 0) === 1 ? "" : "s"}`
        );
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setBusy(null);
    }
  }

  const hasEmail = Boolean(email);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite && hasEmail ? (
          <EmailComposer
            orgId={orgId}
            contactId={contactId}
            contactLabel={contactLabel}
            defaultTo={email}
            emailOptions={emailOptions}
            smtpConfigured={smtpConfigured}
            trigger="button"
            triggerLabel="Draft email"
            triggerClassName="btn-primary"
          />
        ) : null}
        {canWrite ? (
          <>
            <button
              type="button"
              onClick={findContacts}
              disabled={busy !== null}
              title="Manual only — uses paid credits. Not automatic."
              className={hasEmail ? "btn-ghost" : "btn-primary"}
            >
              {busy === "contacts" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Deep Search
            </button>
            <button
              type="button"
              onClick={generateBrief}
              disabled={busy !== null}
              title="Summarize priorities, objections and the best angle"
              className="btn-ghost"
            >
              {busy === "brief" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              AI brief
            </button>
            <button
              type="button"
              onClick={scanSignals}
              disabled={busy !== null}
              title="Refresh buying signals from the website and news"
              className="btn-ghost"
            >
              {busy === "signals" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Signals
            </button>
          </>
        ) : null}
        <Link href={`/companies/${orgId}/edit`} className="btn-ghost">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Edit
        </Link>
      </div>
      <p className="text-[11px] text-zinc-500">
        Website details and emails are filled automatically. Deep Search is
        manual only and uses paid credits.
      </p>
      {status ? <p className="text-[11px] text-emerald-600">{status}</p> : null}
      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}
