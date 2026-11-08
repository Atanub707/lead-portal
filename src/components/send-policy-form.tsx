"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2 } from "lucide-react";
import type { SendPolicy } from "@/lib/send-queue";

const COMMON_ZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

export function SendPolicyForm({
  policy,
  canEdit,
}: {
  policy: SendPolicy;
  canEdit: boolean;
}) {
  const router = useRouter();
  const zones = [...new Set([policy.timezone, ...COMMON_ZONES])];
  const [timezone, setTimezone] = useState(policy.timezone);
  const [start, setStart] = useState(policy.window_start);
  const [end, setEnd] = useState(policy.window_end);
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(policy.weekdays));
  const [dailyCap, setDailyCap] = useState(String(policy.daily_cap));
  const [domainCap, setDomainCap] = useState(String(policy.domain_daily_cap));
  const [minGap, setMinGap] = useState(String(policy.min_gap_minutes));
  const [maxGap, setMaxGap] = useState(String(policy.max_gap_minutes));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  function toggleDay(day: number) {
    setWeekdays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function save() {
    if (!canEdit || saving) return;
    setSaving(true);
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/sending/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone,
          window_start: start,
          window_end: end,
          weekdays: [...weekdays],
          daily_cap: Number(dailyCap),
          domain_daily_cap: Number(domainCap),
          min_gap_minutes: Number(minGap),
          max_gap_minutes: Number(maxGap),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Could not save the schedule");
        return;
      }
      setSaved("Schedule saved. Future approvals use these rules.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        <div>
          <h2 className="text-[14px] font-semibold text-zinc-900">Send schedule</h2>
          <p className="text-[11px] text-zinc-500">
            Humans approve each email. The queue only delivers inside these safe windows.
          </p>
        </div>
      </div>

      <fieldset disabled={!canEdit || saving} className="mt-4 grid gap-3 disabled:opacity-70 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="send-timezone" className="label">Timezone</label>
          <select
            id="send-timezone"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="input"
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>{zone}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="send-start" className="label">Window starts</label>
          <input id="send-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="send-end" className="label">Window ends</label>
          <input id="send-end" type="time" value={end} onChange={(event) => setEnd(event.target.value)} className="input" />
        </div>
        <div className="sm:col-span-2">
          <p className="label">Send days</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {WEEKDAYS.map((day) => (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                aria-pressed={weekdays.has(day.value)}
                className={`h-8 rounded-md border px-3 text-[11px] font-medium transition-colors ${
                  weekdays.has(day.value)
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                }`}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="send-daily" className="label">Daily coin cap</label>
          <input id="send-daily" type="number" min={1} max={30} value={dailyCap} onChange={(event) => setDailyCap(event.target.value)} className="input" />
          <p className="mt-1 text-[10px] text-zinc-400">Warm-up applies 10/day, then 20/day, then this cap.</p>
        </div>
        <div>
          <label htmlFor="send-domain" className="label">Per-domain daily cap</label>
          <input id="send-domain" type="number" min={1} max={3} value={domainCap} onChange={(event) => setDomainCap(event.target.value)} className="input" />
          <p className="mt-1 text-[10px] text-zinc-400">Never more than one cold email per company domain by default.</p>
        </div>
        <div>
          <label htmlFor="send-min-gap" className="label">Minimum gap (minutes)</label>
          <input id="send-min-gap" type="number" min={1} max={60} value={minGap} onChange={(event) => setMinGap(event.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="send-max-gap" className="label">Maximum gap (minutes)</label>
          <input id="send-max-gap" type="number" min={1} max={120} value={maxGap} onChange={(event) => setMaxGap(event.target.value)} className="input" />
        </div>
      </fieldset>

      {!canEdit ? (
        <p className="mt-3 text-[11px] text-zinc-400">Only the workspace owner can change these settings.</p>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}
      {saved ? <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{saved}</p> : null}

      {canEdit ? (
        <div className="mt-4">
          <button type="button" onClick={save} disabled={saving || weekdays.size === 0} className="btn-primary">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
