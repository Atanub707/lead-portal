"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import { inviteUser } from "@/lib/actions";
import type { UserRole } from "@/lib/types";
import { AddSeatDialog } from "@/components/add-seat-dialog";

export function InviteButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ to: string; link?: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [seatRequired, setSeatRequired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function openDialog() {
    setEmail("");
    setRole("editor");
    setResult(null);
    setError("");
    setCopied(false);
    setOpen(true);
  }

  function submit() {
    const value = email.trim();
    if (!value || pending) return;
    setError("");
    setResult(null);
    startTransition(async () => {
      const res = await inviteUser(value, role);
      if (!res.ok) {
        if (res.code === "seat_required") {
          setSeatRequired(true);
          return;
        }
        setError(res.error ?? "Invite failed");
        return;
      }
      setResult({ to: value, link: res.link });
      setEmail("");
    });
  }

  async function copy() {
    if (!result?.link) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the input can be selected manually.
    }
  }

  return (
    <>
      <button type="button" onClick={openDialog} className="btn-primary">
        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Invite team member
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <button
            type="button"
            className="animate-overlay absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Invite team member"
            className="animate-panel relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-zinc-900">
                Invite team member
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            {result ? (
              <div className="mt-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <p className="min-w-0 truncate text-[13px] text-zinc-800">
                    Invitation emailed to <strong>{result.to}</strong>
                  </p>
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  It now appears in the People list — you can revoke it anytime.
                  If the email doesn&apos;t arrive, copy the link and send it
                  yourself.
                </p>

                {result.link ? (
                  <button
                    type="button"
                    onClick={copy}
                    className="btn-ghost mt-2"
                  >
                    {copied ? (
                      <Check
                        className="h-3.5 w-3.5 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={openDialog}
                  className="btn-ghost mt-3"
                >
                  Invite another
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="invite-email" className="label">
                    Email
                  </label>
                  <input
                    ref={inputRef}
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                      }
                    }}
                    placeholder="name@company.com"
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor="invite-role" className="label">
                    Role
                  </label>
                  <select
                    id="invite-role"
                    value={role}
                    onChange={(event) =>
                      setRole(event.target.value as UserRole)
                    }
                    className="input"
                  >
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={submit}
                  disabled={!email.trim() || pending}
                  className="btn-primary w-full justify-center"
                >
                  {pending ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : null}
                  Send invite
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <AddSeatDialog
        open={seatRequired}
        onClose={() => setSeatRequired(false)}
        onPaid={() => {
          setSeatRequired(false);
          submit();
        }}
      />
    </>
  );
}
