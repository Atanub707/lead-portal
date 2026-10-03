"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, X } from "lucide-react";
import { renamePipeline } from "@/lib/actions";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary w-full justify-center"
      disabled={pending}
    >
      {pending ? "Saving…" : "Save name"}
    </button>
  );
}

export function RenamePipelineDialog({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Rename pipeline"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Rename {name}</span>
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
            aria-label="Rename pipeline"
            className="animate-panel relative w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-zinc-900">
                Rename pipeline
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

            <form action={renamePipeline} className="mt-4 space-y-4">
              <input type="hidden" name="id" value={id} />
              <div>
                <label htmlFor={`pipeline-name-${id}`} className="label">
                  Name
                </label>
                <input
                  ref={inputRef}
                  id={`pipeline-name-${id}`}
                  name="name"
                  required
                  maxLength={40}
                  defaultValue={name}
                  className="input"
                />
              </div>
              <SaveButton />
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
