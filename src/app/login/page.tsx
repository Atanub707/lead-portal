"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message);
        setState("error");
      } else {
        setState("sent");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Lead Portal
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            POS sales &amp; compliance services
          </p>
        </div>

        <div className="card p-6">
          {state === "sent" ? (
            <div className="text-center">
              <p className="text-sm font-medium text-slate-900">
                Check your inbox
              </p>
              <p className="mt-1 text-sm text-slate-500">
                We sent a magic link to <strong>{email}</strong>. Open it on
                this device to sign in.
              </p>
              <button
                className="btn-ghost mt-4 w-full"
                onClick={() => setState("idle")}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="label">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              {state === "error" ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={state === "sending"}
              >
                {state === "sending" ? "Sending…" : "Send magic link"}
              </button>

              <p className="text-center text-xs text-slate-400">
                No password needed — we email you a one-time sign-in link.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
