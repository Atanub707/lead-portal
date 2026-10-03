"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

export function ConfirmSubmit({
  children,
  message,
  className,
  confirmLabel = "Delete",
  tone = "danger",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  confirmLabel?: string;
  tone?: "danger" | "neutral";
}) {
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  const confirmClass =
    tone === "neutral"
      ? "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[12px] font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-70"
      : "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-70";

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
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
            aria-label="Confirm"
            className="animate-panel relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <p className="text-[13px] leading-relaxed text-zinc-800">
              {message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" autoFocus disabled={pending} className={confirmClass}>
                {pending ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {pending ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
