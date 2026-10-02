"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"" | "signin" | "signup" | "magic">("");
  const [error, setError] = useState("");
  const [magicSent, setMagicSent] = useState(false);

  async function handleSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("signin");
    setError("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
        setBusy("");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy("");
    }
  }

  async function handleSignUp() {
    setBusy("signup");
    setError("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setBusy("");
        return;
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(
        "Account created. Email confirmation is still ON in Supabase — turn it off (Authentication → Sign In / Providers → Email) and sign in with your password."
      );
      setBusy("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy("");
    }
  }

  async function handleMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("magic");
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
        setBusy("");
      } else {
        setMagicSent(true);
        setBusy("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy("");
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
          <div className="mb-5 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm font-medium">
            <button
              type="button"
              onClick={() => {
                setMode("password");
                setError("");
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                mode === "password"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Password
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("magic");
                setError("");
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                mode === "magic"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Magic link
            </button>
          </div>

          {mode === "password" ? (
            <form onSubmit={handleSignIn} className="space-y-4">
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
              <div>
                <label htmlFor="password" className="label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="current-password"
                  className="input"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={busy !== ""}
              >
                {busy === "signin" ? "Signing in…" : "Sign in"}
              </button>

              <button
                type="button"
                onClick={handleSignUp}
                className="btn-ghost w-full"
                disabled={busy !== ""}
              >
                {busy === "signup" ? "Creating…" : "Create account"}
              </button>

              <p className="text-center text-xs text-slate-400">
                No confirmation email needed — the first account becomes the
                owner, everyone else joins as editor.
              </p>
            </form>
          ) : magicSent ? (
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
                onClick={() => setMagicSent(false)}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-4">
              <div>
                <label htmlFor="magic-email" className="label">
                  Email
                </label>
                <input
                  id="magic-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                className="btn-primary w-full"
                disabled={busy !== ""}
              >
                {busy === "magic" ? "Sending…" : "Send magic link"}
              </button>

              <p className="text-center text-xs text-slate-400">
                Magic links are rate-limited by Supabase&apos;s built-in email —
                use a password instead if you hit the limit.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
