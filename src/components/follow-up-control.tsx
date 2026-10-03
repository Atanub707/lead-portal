"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, Loader2, X } from "lucide-react";
import { setFollowUp } from "@/lib/actions";

type FollowState = "none" | "overdue" | "today" | "upcoming";

function stateOf(date: string | null): FollowState {
  if (!date) return "none";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "none";
  if (parsed.getTime() < today.getTime()) return "overdue";
  if (parsed.getTime() === today.getTime()) return "today";
  return "upcoming";
}

function formatShort(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const CHIP_STYLE: Record<FollowState, string> = {
  none: "border-dashed border-zinc-300 bg-transparent text-zinc-400 hover:border-zinc-400 hover:text-zinc-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  today: "border-amber-200 bg-amber-50 text-amber-700",
  upcoming: "border-zinc-200 bg-white text-zinc-600",
};

export function FollowUpControl({
  orgId,
  date,
  note,
}: {
  orgId: number;
  date: string | null;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(date ?? "");
  const [noteValue, setNoteValue] = useState(note ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dateRef = useRef<HTMLInputElement>(null);

  const state = stateOf(date);

  useEffect(() => {
    if (!open) return;
    dateRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openPanel() {
    setValue(date ?? "");
    setNoteValue(note ?? "");
    setError("");
    setOpen(true);
  }

  function save(nextDate: string | null) {
    startTransition(async () => {
      const result = await setFollowUp(orgId, nextDate, nextDate ? noteValue : null);
      if (result.ok) {
        setOpen(false);
      } else {
        setError(result.message ?? "Could not save");
      }
    });
  }

  const label =
    state === "none"
      ? "Set"
      : state === "today"
        ? "Today"
        : date
          ? formatShort(date)
          : "Set";

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors ${CHIP_STYLE[state]}`}
        title={
          state === "none"
            ? "Set a follow-up date"
            : `${label}${note ? ` — ${note}` : ""}`
        }
      >
        <CalendarClock className="h-3 w-3" aria-hidden="true" />
        {label}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <button
            className="animate-overlay absolute inset-0 bg-zinc-900/20"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Follow-up"
            className="animate-panel relative w-full max-w-xs rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-zinc-900">
                Follow-up
              </p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor={`follow-date-${orgId}`}
                  className="label"
                >
                  Date
                </label>
                <input
                  ref={dateRef}
                  id={`follow-date-${orgId}`}
                  type="date"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label
                  htmlFor={`follow-note-${orgId}`}
                  className="label"
                >
                  Note (optional)
                </label>
                <input
                  id={`follow-note-${orgId}`}
                  value={noteValue}
                  onChange={(event) => setNoteValue(event.target.value)}
                  placeholder="e.g. Send pricing follow-up"
                  className="input"
                />
              </div>

              {error ? (
                <p role="alert" className="text-[12px] text-rose-700">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => save(value || null)}
                  disabled={pending || !value}
                  className="btn-primary flex-1 justify-center"
                >
                  {pending ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : null}
                  Save
                </button>
                {date ? (
                  <button
                    onClick={() => save(null)}
                    disabled={pending}
                    className="btn-ghost"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
