"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { saveEmailSettings } from "@/lib/actions";
import type { EmailSettings } from "@/lib/types";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

// Common providers — one click fills host, port and encryption. Every mail
// provider uses different servers, so there is no universal default.
const SMTP_PRESETS = [
  { id: "gmail", label: "Gmail", host: "smtp.gmail.com", port: "465", secure: true },
  {
    id: "outlook",
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: "587",
    secure: false,
  },
  { id: "zoho", label: "Zoho", host: "smtp.zoho.com", port: "465", secure: true },
] as const;

export function EmailSettingsForm({ initial }: { initial: EmailSettings }) {
  const [fromName, setFromName] = useState(initial.from_name ?? "");
  const [fromEmail, setFromEmail] = useState(initial.from_email ?? "");
  const [host, setHost] = useState(initial.smtp_host ?? "");
  const [port, setPort] = useState(
    initial.smtp_port ? String(initial.smtp_port) : "587"
  );
  const [secure, setSecure] = useState(
    initial.smtp_port ? initial.smtp_secure : false
  );
  const [user, setUser] = useState(initial.smtp_user ?? "");
  const [password, setPassword] = useState("");
  const [signaturePhone, setSignaturePhone] = useState(
    initial.signature_phone ?? ""
  );
  const [signatureLink, setSignatureLink] = useState(
    initial.signature_link ?? ""
  );
  const [testState, setTestState] = useState<TestState>({ status: "idle" });

  const testing = testState.status === "testing";
  const canTest =
    Boolean(host.trim() && user.trim()) &&
    (Boolean(password) || initial.configured) &&
    !testing;

  function onPortChange(value: string) {
    setPort(value);
    const parsed = Number(value);
    if (parsed === 465) setSecure(true);
    else if (parsed === 587) setSecure(false);
  }

  async function sendTest() {
    if (!canTest) return;
    setTestState({ status: "testing" });
    try {
      const response = await fetch("/api/email/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          port: Number(port) || 587,
          secure,
          user: user.trim(),
          password: password || undefined,
          to: fromEmail.trim() || undefined,
          fromName: fromName.trim() || undefined,
          fromEmail: fromEmail.trim() || undefined,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        note?: string;
        error?: string;
        secure?: boolean;
      };
      if (data.ok) {
        if (typeof data.secure === "boolean") setSecure(data.secure);
        setTestState({
          status: "ok",
          message:
            data.note ??
            (fromEmail.trim()
              ? `Test email sent to ${fromEmail.trim()}.`
              : "Connection verified."),
        });
      } else {
        setTestState({
          status: "error",
          message: data.error ?? "Couldn't connect — check the details above.",
        });
      }
    } catch {
      setTestState({
        status: "error",
        message: "Couldn't reach the server. Try again.",
      });
    }
  }

  return (
    <form
      action={saveEmailSettings}
      className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
    >
      <section className="card p-5 lg:col-start-2 lg:row-start-1">
        <h2 className="text-[13px] font-semibold text-zinc-900">Sender</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          How your emails appear to recipients.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="from_name" className="label">
              Sender name
            </label>
            <input
              id="from_name"
              name="from_name"
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
              placeholder="Your name"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="from_email" className="label">
              Sender email
            </label>
            <input
              id="from_email"
              name="from_email"
              type="email"
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </div>
        </div>
      </section>

      <section className="card p-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <h2 className="text-[13px] font-semibold text-zinc-900">SMTP</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          The mail server your emails are sent through.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Provider
          </span>
          {SMTP_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={host === preset.host}
              onClick={() => {
                setHost(preset.host);
                setPort(preset.port);
                setSecure(preset.secure);
                if (!user.trim() && fromEmail.trim()) setUser(fromEmail.trim());
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                host === preset.host
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <span className="text-[11px] text-zinc-400">
            or fill the server details below
          </span>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="smtp_host" className="label">
              SMTP host
            </label>
            <input
              id="smtp_host"
              name="smtp_host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="smtp.example.com"
              autoComplete="off"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="smtp_port" className="label">
              Port
            </label>
            <input
              id="smtp_port"
              name="smtp_port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => onPortChange(event.target.value)}
              placeholder="587"
              className="input"
            />
          </div>
          <div>
            <span className="label">Encryption</span>
            <label className="flex h-[34px] items-center gap-2 text-[13px] text-zinc-700">
              <input
                type="checkbox"
                checked={secure}
                onChange={(event) => setSecure(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 accent-zinc-900"
              />
              SSL/TLS
            </label>
            <p className="mt-1 text-[11px] text-zinc-400">
              465 = SSL · 587 = STARTTLS — the toggle sets itself.
            </p>
          </div>
          <div>
            <label htmlFor="smtp_user" className="label">
              Username
            </label>
            <input
              id="smtp_user"
              name="smtp_user"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              placeholder="you@company.com"
              autoComplete="off"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="smtp_password" className="label">
              Password
              {initial.configured ? (
                <span className="ml-1.5 font-normal text-zinc-400">
                  Leave blank to keep the saved password
                </span>
              ) : null}
            </label>
            <input
              id="smtp_password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                initial.configured ? "••••••••" : "Your SMTP password"
              }
              autoComplete="new-password"
              className="input"
            />
          </div>
        </div>
      </section>

      <section className="card p-5 lg:col-start-2 lg:row-start-2">
        <h2 className="text-[13px] font-semibold text-zinc-900">Signature</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          Appended to the emails you generate.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="signature_phone" className="label">
              Signature phone
            </label>
            <input
              id="signature_phone"
              name="signature_phone"
              value={signaturePhone}
              onChange={(event) => setSignaturePhone(event.target.value)}
              placeholder="+1 555 000 0000"
              className="input"
            />
          </div>
          <div>
            <label htmlFor="signature_link" className="label">
              Signature link (calendar / portfolio)
            </label>
            <input
              id="signature_link"
              name="signature_link"
              value={signatureLink}
              onChange={(event) => setSignatureLink(event.target.value)}
              placeholder="cal.com/you"
              className="input"
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={sendTest}
            disabled={!canTest}
            aria-busy={testing}
            className="btn-ghost"
          >
            {testing ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {testing ? "Testing…" : "Send test email"}
          </button>
          {testState.status === "ok" ? (
            <p role="status" className="text-[12px] text-emerald-700">
              {testState.message}
            </p>
          ) : testState.status === "error" ? (
            <p role="alert" className="text-[12px] text-rose-700">
              {testState.message}
            </p>
          ) : null}
        </div>

        <input
          type="hidden"
          name="smtp_secure"
          value={secure ? "true" : "false"}
        />
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}
