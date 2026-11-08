"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Mail, MailPlus, Sparkles, X } from "lucide-react";
import { FLAVORS } from "@/lib/flavors";
import { isGenericEmail } from "@/lib/people";

export interface EmailRecipientOption {
  email: string;
  label: string;
  kind: "contact" | "company";
  contactId?: number | null;
}

export function EmailComposer({
  orgId,
  contactId = null,
  contactLabel = null,
  defaultTo = null,
  defaultFlavor = null,
  emailOptions = [],
  smtpConfigured,
  trigger = "icon",
  triggerLabel = "Draft email",
  triggerClassName = "",
}: {
  orgId: number;
  contactId?: number | null;
  contactLabel?: string | null;
  defaultTo?: string | null;
  defaultFlavor?: string | null;
  emailOptions?: EmailRecipientOption[];
  smtpConfigured: boolean;
  trigger?: "icon" | "button";
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [flavor, setFlavor] = useState("");
  const [subject, setSubject] = useState("");
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [quality, setQuality] = useState<{
    score: number;
    words: number;
    issues: string[];
    evidence: string[];
  } | null>(null);
  const [recipient, setRecipient] = useState<{
    type: "personal" | "shared" | "unknown";
    label: string;
    strategyLabel: string;
    verification: "verified" | "unverified" | "unknown";
    warning?: string;
  } | null>(null);
  const [body, setBody] = useState("");
  const [firstContact, setFirstContact] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const [customRecipient, setCustomRecipient] = useState(false);
  const toRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const recipientOptions = (() => {
    const map = new Map<string, EmailRecipientOption>();
    const add = (option: EmailRecipientOption) => {
      const key = option.email.trim().toLowerCase();
      if (!key || map.has(key)) return;
      map.set(key, option);
    };
    for (const option of emailOptions) add(option);
    if (defaultTo) {
      add({
        email: defaultTo,
        label: contactLabel ?? "Selected email",
        kind: contactId ? "contact" : "company",
        contactId,
      });
    }
    return [...map.values()];
  })();
  const hasMultipleRecipients = recipientOptions.length > 1;
  const selectedRecipient = recipientOptions.find(
    (option) => option.email.trim().toLowerCase() === to.trim().toLowerCase()
  );
  const activeContactId = customRecipient
    ? null
    : selectedRecipient?.contactId ??
      (to.trim().toLowerCase() === (defaultTo ?? "").trim().toLowerCase()
        ? contactId
        : null);

  useEffect(() => {
    if (!open) return;
    if (hasMultipleRecipients && !customRecipient) selectRef.current?.focus();
    else toRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !generating && !sending) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, generating, sending, customRecipient, hasMultipleRecipients]);

  function chooseRecipient(next: string) {
    if (next.trim().toLowerCase() === to.trim().toLowerCase()) return;
    setTo(next);
    setSubject("");
    setAlternatives([]);
    setQuality(null);
    setRecipient(null);
    setBody("");
    setFirstContact(false);
    setSent(false);
  }

  function onRecipientSelect(value: string) {
    if (value === "__custom") {
      setCustomRecipient(true);
      chooseRecipient("");
      setTo("");
      window.setTimeout(() => toRef.current?.focus(), 0);
      return;
    }
    setCustomRecipient(false);
    chooseRecipient(value);
  }

  function openDialog() {
    const fallback = defaultTo ?? recipientOptions[0]?.email ?? "";
    setTo(fallback);
    setCustomRecipient(recipientOptions.length === 0);
    setFlavor(
      FLAVORS.some((entry) => entry.id === defaultFlavor)
        ? (defaultFlavor ?? "")
        : ""
    );
    setSubject("");
    setAlternatives([]);
    setQuality(null);
    setRecipient(null);
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
        body: JSON.stringify({ orgId, contactId: activeContactId, flavor, to: to || null }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        to?: string;
        subject?: string;
        body?: string;
        firstContact?: boolean;
        alternatives?: string[];
        quality?: { score: number; words: number; issues: string[]; evidence: string[] } | null;
        recipient?: {
          type: "personal" | "shared" | "unknown";
          label: string;
          strategyLabel: string;
          verification: "verified" | "unverified" | "unknown";
          warning?: string;
        } | null;
        error?: string;
      };
      if (!data.ok) {
        setError(data.error ?? "Draft failed");
        return;
      }
      setSubject(data.subject ?? "");
      setAlternatives(data.alternatives ?? []);
      setQuality(data.quality ?? null);
      setRecipient(data.recipient ?? null);
      setBody(data.body ?? "");
      setFirstContact(data.firstContact === true);
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
        body: JSON.stringify({ orgId, contactId: activeContactId, to, subject, body }),
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
          className={
            triggerClassName ||
            "inline-flex items-center gap-1 text-[12px] text-zinc-500 transition-colors hover:text-zinc-900"
          }
        >
          <MailPlus className="h-3.5 w-3.5" aria-hidden="true" />
          {triggerLabel}
        </button>
      )}

      {open && typeof document !== "undefined"
        ? createPortal(
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
                {hasMultipleRecipients && !customRecipient ? (
                  <select
                    ref={selectRef}
                    id={`compose-to-${orgId}-${contactId ?? 0}`}
                    value={to}
                    onChange={(event) => onRecipientSelect(event.target.value)}
                    className="input"
                  >
                    {recipientOptions.map((option) => (
                      <option key={option.email} value={option.email}>
                        {option.label && option.label !== option.email
                          ? `${option.label} — ${option.email}`
                          : option.email}
                      </option>
                    ))}
                    <option value="__custom">Other email…</option>
                  </select>
                ) : (
                  <input
                    ref={toRef}
                    id={`compose-to-${orgId}-${contactId ?? 0}`}
                    type="email"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    placeholder="name@company.com"
                    className="input"
                  />
                )}
                {hasMultipleRecipients ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-400">
                    {recipientOptions.length} saved emails
                    {customRecipient ? (
                      <button
                        type="button"
                        onClick={() => {
                          const fallback = defaultTo ?? recipientOptions[0]?.email ?? "";
                          setCustomRecipient(false);
                          chooseRecipient(fallback);
                          setTo(fallback);
                        }}
                        className="font-medium text-zinc-600 underline-offset-2 hover:underline"
                      >
                        Use a saved email
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {recipient ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                        recipient.type === "personal"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : recipient.type === "shared"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600"
                      }`}
                    >
                      {recipient.type === "personal"
                        ? "Personal"
                        : recipient.type === "shared"
                          ? "Shared inbox"
                          : "Unknown"}
                    </span>
                    <span className="text-zinc-600">{recipient.label}</span>
                    <span className="text-zinc-400">· {recipient.strategyLabel}</span>
                    <span
                      className={
                        recipient.verification === "verified"
                          ? "font-medium text-emerald-600"
                          : recipient.verification === "unverified"
                            ? "font-medium text-amber-600"
                            : "font-medium text-zinc-400"
                      }
                    >
                      {recipient.verification === "verified"
                        ? "Verified"
                        : recipient.verification === "unverified"
                          ? "Unverified"
                          : "Unknown"}
                    </span>
                  </div>
                ) : null}

                {recipient?.type === "shared" ? (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-amber-800">
                      Shared inbox — delivery isn&apos;t guaranteed
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                      {recipient.label} is a shared team inbox. Your email can
                      still be delivered, but spam filters and low attention make
                      a reply less likely. The draft asks for the right person
                      instead of assuming who reads it.
                    </p>
                    {recipient.warning ? (
                      <p className="mt-1.5 text-[11px] font-medium text-amber-900">
                        {recipient.warning}
                      </p>
                    ) : (
                      <>
                        <p className="mt-1.5 text-[11px] font-medium text-amber-900">
                          To improve delivery:
                        </p>
                        <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-800">
                          <li>Use Deep Search on the company page to look for a personal address.</li>
                          <li>If a decision-maker&apos;s email appears, draft to that person.</li>
                          <li>No personal email? Send here — short, no links, one routing question.</li>
                        </ol>
                      </>
                    )}
                  </div>
                ) : recipient?.type === "personal" && recipient.verification !== "verified" ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {recipient.warning ??
                      "This personal address is not verified yet. Verify it before high-volume sending."}
                  </p>
                ) : recipient?.type === "personal" ? (
                  <p className="mt-1 text-[11px] text-emerald-700">
                    Personal address — a better chance of reaching the inbox and
                    getting a reply.
                  </p>
                ) : recipient?.type === "unknown" ? (
                  <p className="mt-1 text-[11px] text-amber-700">
                    {recipient.warning ??
                      "Recipient type is unclear. Verify the address before sending."}
                  </p>
                ) : null}
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
                    {alternatives.filter((entry) => entry !== subject).length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                          Other subjects
                        </span>
                        {alternatives
                          .filter((entry) => entry !== subject)
                          .map((entry) => (
                            <button
                              key={entry}
                              type="button"
                              onClick={() => setSubject(entry)}
                              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-900"
                            >
                              {entry}
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </div>
                  {quality ? (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-zinc-700">Email check</p>
                        <p
                          className={`text-[11px] font-medium tabular-nums ${
                            quality.score >= 85
                              ? "text-emerald-600"
                              : quality.score >= 70
                                ? "text-amber-600"
                                : "text-rose-600"
                          }`}
                        >
                          {quality.score}/100 · {quality.words} words
                        </p>
                      </div>
                      {quality.evidence.length > 0 ? (
                        <p className="mt-1 text-[10px] text-zinc-500">
                          Based on: {quality.evidence.join(" · ")}
                        </p>
                      ) : null}
                      {quality.issues.length > 0 ? (
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[10px] text-amber-700">
                          {quality.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-[10px] text-emerald-600">
                          Structure, length, CTA and evidence checks passed.
                        </p>
                      )}
                    </div>
                  ) : null}

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
                    {firstContact ? (
                      <p className="mt-1 text-[11px] text-zinc-400">
                        Link-free first email — signature links are added only
                        after the first reply, for better inbox placement.
                      </p>
                    ) : null}
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

              <p className="text-[10px] leading-relaxed text-zinc-400">
                Cold email can still be filtered. Sends are capped at 30/day,
                first emails avoid links, and follow-ups stop when someone
                replies.
              </p>

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
        </div>,
        document.body
      ) : null}
    </>
  );
}
