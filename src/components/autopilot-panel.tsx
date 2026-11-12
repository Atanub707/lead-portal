"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  Check,
  Loader2,
  Play,
  Save,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  AutopilotOutboxRow,
  AutopilotRunRow,
  AutopilotSettings,
} from "@/lib/autopilot";

function statusStyle(status: string): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "running") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

export function AutopilotPanel({
  available,
  initialSettings,
  initialRuns,
  initialOutbox,
  pipelines,
}: {
  available: boolean;
  initialSettings: AutopilotSettings;
  initialRuns: AutopilotRunRow[];
  initialOutbox: AutopilotOutboxRow[];
  pipelines: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [runs] = useState(initialRuns);
  const [outbox, setOutbox] = useState(initialOutbox);
  const [edits, setEdits] = useState<
    Record<number, { subject: string; body: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const pending = outbox.filter((item) => item.status === "pending");

  async function save(next: Partial<AutopilotSettings>) {
    if (!available) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const merged = { ...settings, ...next };
      setSettings(merged);
      const res = await fetch("/api/autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: merged.enabled,
          pipeline_id: merged.pipeline_id,
          min_score: merged.min_score,
          daily_draft_limit: merged.daily_draft_limit,
          run_interval_minutes: merged.run_interval_minutes,
          review_required: merged.review_required,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; settings?: AutopilotSettings; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.settings) {
        setError(json?.error ?? "Could not save settings");
        return;
      }
      setSettings(json.settings);
      setMessage("Autopilot settings saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    if (!available || running) return;
    setRunning(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/autopilot/run", { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; run?: AutopilotRunRow; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Autopilot run failed");
        return;
      }
      setMessage(
        json.run?.drafted
          ? `${json.run.drafted} draft${json.run.drafted === 1 ? "" : "s"} added to the Outbox.`
          : json.run?.reason ?? "No drafts were produced."
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Autopilot run failed");
    } finally {
      setRunning(false);
    }
  }

  function editFor(item: AutopilotOutboxRow) {
    return edits[item.id] ?? { subject: item.subject, body: item.body };
  }

  function updateEdit(item: AutopilotOutboxRow, patch: { subject?: string; body?: string }) {
    setEdits((current) => ({
      ...current,
      [item.id]: { ...editFor(item), ...patch },
    }));
  }

  async function act(
    item: AutopilotOutboxRow,
    action: "approve" | "reject" | "edit"
  ) {
    if (!available || busyId) return;
    setBusyId(item.id);
    setError("");
    setMessage("");
    const edit = editFor(item);
    try {
      const res = await fetch("/api/autopilot/outbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          action,
          subject: edit.subject,
          body: edit.body,
          timezone:
            typeof window !== "undefined"
              ? Intl.DateTimeFormat().resolvedOptions().timeZone
              : undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            errors?: string[];
            scheduledFor?: string;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.errors?.join(" · ") ?? json?.error ?? "Outbox action failed");
        return;
      }
      if (action === "approve") {
        setMessage(
          json.scheduledFor
            ? `Approved and scheduled for ${new Date(json.scheduledFor).toLocaleString()}.`
            : "Approved and scheduled."
        );
        setOutbox((current) =>
          current.map((row) => (row.id === item.id ? { ...row, status: "approved" } : row))
        );
      } else if (action === "reject") {
        setMessage("Draft rejected.");
        setOutbox((current) => current.filter((row) => row.id !== item.id));
      } else {
        setMessage("Draft saved.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Outbox action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!available) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
        <p className="font-medium">Autopilot needs the database tables.</p>
        <p className="mt-1">
          Apply `supabase/migrations/20261110120000_autopilot_assist.sql` in the
          Supabase SQL Editor, then reload this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">
                Autopilot Assist
              </h2>
              <p className="mt-0.5 text-[12px] text-zinc-500">
                Drafts are generated automatically. Sending always requires review.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void save({ enabled: !settings.enabled })}
            disabled={saving}
            className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-[12px] font-medium ${
              settings.enabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-zinc-200 bg-white text-zinc-600"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                settings.enabled ? "bg-emerald-500" : "bg-zinc-300"
              }`}
              aria-hidden="true"
            />
            {settings.enabled ? "On" : "Off"}
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="ap-pipeline" className="label">Pipeline</label>
            <select
              id="ap-pipeline"
              className="input"
              value={settings.pipeline_id ?? ""}
              onChange={(event) =>
                void save({ pipeline_id: event.target.value || null })
              }
            >
              <option value="">All pipelines</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-score" className="label">Minimum score</label>
            <input
              id="ap-score"
              type="number"
              min={0}
              max={100}
              className="input"
              value={settings.min_score}
              onChange={(event) =>
                void save({ min_score: Number(event.target.value) })
              }
            />
          </div>
          <div>
            <label htmlFor="ap-limit" className="label">Drafts per day</label>
            <input
              id="ap-limit"
              type="number"
              min={1}
              max={20}
              className="input"
              value={settings.daily_draft_limit}
              onChange={(event) =>
                void save({ daily_draft_limit: Number(event.target.value) })
              }
            />
          </div>
          <div>
            <label htmlFor="ap-interval" className="label">Run every (minutes)</label>
            <input
              id="ap-interval"
              type="number"
              min={15}
              max={1440}
              className="input"
              value={settings.run_interval_minutes}
              onChange={(event) =>
                void save({ run_interval_minutes: Number(event.target.value) })
              }
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={runNow}
            disabled={!settings.enabled || running}
            className="btn-primary"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {running ? "Running…" : "Run now"}
          </button>
          <span className="flex items-center gap-1 text-[11px] text-zinc-400">
            <Save className="h-3 w-3" aria-hidden="true" />
            {saving ? "Saving settings…" : "Settings save automatically"}
          </span>
          {settings.last_run_at ? (
            <span className="text-[11px] text-zinc-400">
              Last run {new Date(settings.last_run_at).toLocaleString()}
            </span>
          ) : null}
        </div>

        {error ? <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
        {message ? <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{message}</p> : null}
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          <div>
            <h2 className="text-[14px] font-semibold text-zinc-900">Outbox</h2>
            <p className="text-[11px] text-zinc-500">
              {pending.length} draft{pending.length === 1 ? "" : "s"} waiting for your approval.
            </p>
          </div>
        </div>

        {pending.length === 0 ? (
          <p className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-4 text-[12px] text-zinc-500">
            No pending drafts. Turn Autopilot on and press Run now.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {pending.map((item) => {
              const edit = editFor(item);
              return (
                <article key={item.id} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/companies/${item.org_id}`}
                      className="text-[12px] font-semibold text-zinc-900 hover:underline"
                    >
                      {item.org_name ?? `Company #${item.org_id}`}
                    </Link>
                    <span className="text-[11px] text-zinc-400">→ {item.to_email}</span>
                    {item.recipient?.label ? (
                      <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-zinc-500">
                        {item.recipient.label}
                      </span>
                    ) : null}
                    {item.quality?.score ? (
                      <span className="text-[10px] text-zinc-400 tabular-nums">
                        {item.quality.score}/100 · {item.quality.words ?? 0}w
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-2">
                    <div>
                      <label htmlFor={`ap-subject-${item.id}`} className="label">Subject</label>
                      <input
                        id={`ap-subject-${item.id}`}
                        className="input"
                        value={edit.subject}
                        onChange={(event) => updateEdit(item, { subject: event.target.value })}
                      />
                    </div>
                    <div>
                      <label htmlFor={`ap-body-${item.id}`} className="label">Body</label>
                      <textarea
                        id={`ap-body-${item.id}`}
                        rows={7}
                        className="input"
                        value={edit.body}
                        onChange={(event) => updateEdit(item, { body: event.target.value })}
                      />
                    </div>
                  </div>
                  {(item.gate?.warnings?.length ?? 0) > 0 ? (
                    <ul className="mt-2 space-y-0.5">
                      {item.gate?.warnings?.map((warning) => (
                        <li key={warning} className="flex items-start gap-1.5 text-[10px] text-amber-700">
                          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          {warning}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void act(item, "approve")}
                      disabled={busyId === item.id}
                      className="btn-primary"
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Approve & schedule
                    </button>
                    <button
                      type="button"
                      onClick={() => void act(item, "reject")}
                      disabled={busyId === item.id}
                      className="btn-ghost"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Reject
                    </button>
                    <span className="text-[10px] text-zinc-400">
                      Edits are used when you approve.
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-[14px] font-semibold text-zinc-900">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-[12px] text-zinc-500">No runs yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-100 px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${statusStyle(run.status)}`}>
                  {run.status}
                </span>
                <span className="text-[11px] text-zinc-700">
                  {run.drafted} drafted · {run.skipped} skipped
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                  {run.reason ?? run.error ?? ""}
                </span>
                <span className="text-[10px] text-zinc-400 tabular-nums">
                  {new Date(run.started_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
