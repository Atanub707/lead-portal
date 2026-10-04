"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Mail, MailPlus, Sparkles, X } from "lucide-react";
import { FLAVORS } from "@/lib/flavors";

export function EmailComposer({
  orgId,
  contactId = null,
  contactLabel = null,
  defaultTo = null,
  defaultFlavor = null,
  smtpConfigured,
  trigger = "icon",
  triggerLabel = "Draft email",
}: {
  orgId: number;
  contactId?: number | null;
  contactLabel?: string | null;
  defaultTo?: string | null;
  defaultFlavor?: string | null;
  smtpConfigured: boolean;
  trigger?: "icon" | "button";
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [flavor, setFlavor] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    toRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !generating && !sending) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, sending]);

  function openDialog() {
    setTo(defaultTo ?? "");
    setFlavor(
      FLAVORS.some((entry) => entry.id === defaultFlavor)
        ? (defaultFlavor ?? "")
        : ""
    );
    setSubject("");
    setBody("");
    setError(null);
    setCopied(false);
    setSent(false);
    setOpen(true);
  }

  async function generate() {
    if (!flavor || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/email/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, contactId, flavor }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        to?: string;
        subject?: string;
        body?: string;
        error?: string;
      };
      if (!data.ok) {
        setError(data.error ?? "Draft failed");
        return;
      }
      setSubject(data.subject ?? "");
      setBody(data.body ?? "");
      setTo((prev) => prev || data.to || "");
    } catch {
      setError("Couldn't draft this email. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — user can select manually.
    }
  }

  async function send() {
    if (sending || !to || !subject || !body) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, contactId, to, subject, body }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Send failed");
        return;
      }
      setSent(true);
      router.refresh();
      setTimeout(() => setOpen(false), 1400);
    } catch {
      setError("Couldn't send this email. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {trigger === "icon" ? (
        <button
          type="button"
          onClick={openDialog}
          title={defaultTo ? `Draft email to ${defaultTo}` : "Draft email"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Draft email</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openDialog}
          className="inline-flex items-center gap-1 text-[12px] text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <MailPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {triggerLabel}
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <button
            type="button"
            className="animate-overlay absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => {
              if (!generating && !sending) setOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Draft email"
            className="animate-panel relative max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-zinc-900">
                  Draft email
                </p>
                {contactLabel ? (
                  <p className="truncate text-[11px] text-zinc-500">
                    To {contactLabel}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                disabled={generating || sending}
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor={`compose-to-${orgId}-${contactId ?? 0}`} className="label">
                  To
                </label>
                <input
                  ref={toRef}
                  id={`compose-to-${orgId}-${contactId ?? 0}`}
                  type="email"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  placeholder="name@company.com"
                  className="input"
                />
              </div>

              <div>
                <span className="label">
                  Flavor <span className="text-rose-500">*</span>
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {FLAVORS.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setFlavor(entry.id)}
                      aria-pressed={flavor === entry.id}
                      title={entry.brief}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        flavor === entry.id
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
                      }`}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={generate}
                  disabled={!flavor || generating}
                  className="btn-primary"
                >
                  {generating ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {generating
                    ? "Drafting…"
                    : subject || body
                      ? "Regenerate"
                      : "Generate draft"}
                </button>
                {!flavor ? (
                  <span className="text-[11px] text-zinc-400">
                    Pick a flavor to generate
                  </span>
                ) : null}
              </div>

              {subject || body ? (
                <>
                  <div>
                    <label
                      htmlFor={`compose-subject-${orgId}-${contactId ?? 0}`}
                      className="label"
                    >
                      Subject
                    </label>
                    <input
                      id={`compose-subject-${orgId}-${contactId ?? 0}`}
                      type="text"
                      value={subject}
                      onChange={(event) => setSubject(event.target.value)}
                      className="input"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor={`compose-body-${orgId}-${contactId ?? 0}`}
                      className="label"
                    >
                      Body
                    </label>
                    <textarea
                      id={`compose-body-${orgId}-${contactId ?? 0}`}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      rows={9}
                      className="input min-h-[160px] resize-y font-normal"
                    />
                  </div>
                </>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
                >
                  {error}
                </p>
              ) : null}

              {sent ? (
                <p
                  role="status"
                  className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Sent
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={copy}
                    disabled={!subject && !body}
                    className="btn-ghost"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {smtpConfigured ? (
                    <button
                      type="button"
                      onClick={send}
                      disabled={sending || sent || !to || !subject || !body}
                      className="btn-primary"
                    >
                      {sending ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : null}
                      {sending ? "Sending…" : "Send"}
                    </button>
                  ) : (
                    <Link
                      href="/settings/email"
                      className="text-[12px] font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
                    >
                      Set up email sending to send →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
