"use client";

import { useEffect, useState } from "react";

export function ConfirmSubmit({
  children,
  message,
  className,
  confirmLabel = "Delete",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm"
            className="relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <p className="text-[13px] leading-relaxed text-zinc-800">
              {message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                autoFocus
                onClick={() => setOpen(false)}
                className="inline-flex h-8 items-center justify-center rounded-md bg-rose-600 px-3 text-[12px] font-medium text-white transition-colors hover:bg-rose-700"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
