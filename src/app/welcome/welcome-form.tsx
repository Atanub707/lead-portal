"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { completeOnboarding } from "@/lib/actions";

export function WelcomeForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function finish() {
    await completeOnboarding();
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      await finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function handleSkip() {
    setBusy(true);
    try {
      await finish();
    } catch {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="input"
            placeholder="••••••••"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
          >
            {error}
          </p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Saving…" : "Set password & continue"}
        </button>
      </form>

      <button
        type="button"
        onClick={handleSkip}
        disabled={busy}
        className="mt-3 w-full text-center text-[12px] text-zinc-500 transition-colors hover:text-zinc-900 disabled:opacity-50"
      >
        Skip for now →
      </button>
    </>
  );
}
