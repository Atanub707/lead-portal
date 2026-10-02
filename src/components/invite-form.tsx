"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Link2 } from "lucide-react";
import { inviteUser } from "@/lib/actions";

export function InviteForm() {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    link: string;
    note?: string;
    emailed?: boolean;
    emailError?: string;
    to?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function submit() {
    const value = email.trim();
    if (!value || pending) return;
    setError("");
    setResult(null);
    setCopied(false);
    startTransition(async () => {
      const res = await inviteUser(value);
      if (!res.ok || !res.link) {
        setError(res.error ?? "Could not create the invite link");
        return;
      }
      setResult({
        link: res.link,
        note: res.note,
        emailed: res.emailed,
        emailError: res.emailError,
        to: value,
      });
      setEmail("");
    });
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the input can be selected manually.
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="partner@company.com"
          aria-label="Partner email"
          className="input max-w-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!email.trim() || pending}
          className="btn-primary"
        >
          {pending ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Create invite link
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
          {result.emailed ? (
            <p className="text-[12px] text-emerald-900">
              Invite emailed to <strong>{result.to}</strong> — they set their
              password from the link in the email.
            </p>
          ) : (
            <p className="text-[12px] text-emerald-900">
              Invite link ready — send it to them via WhatsApp, Slack, or
              email. They will be asked to set a password when they open it.
            </p>
          )}
          {result.emailError ? (
            <p className="mt-1 text-[11px] text-amber-800">
              The email couldn&apos;t be sent ({result.emailError}) — copy the
              link below and send it yourself.
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={result.link}
              aria-label="Invite link"
              onFocus={(event) => event.currentTarget.select()}
              className="input flex-1 bg-white font-mono text-[11px]"
            />
            <button type="button" onClick={copy} className="btn-ghost">
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {result.note ? (
            <p className="mt-2 text-[11px] text-emerald-800">{result.note}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
