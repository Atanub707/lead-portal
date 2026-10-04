"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, X } from "lucide-react";
import { createPipeline } from "@/lib/actions";
import { PIPELINE_ICONS } from "@/lib/types";
import { PipelineIcon } from "@/components/pipeline-icon";
import { PipelinePitchFields } from "@/components/pipeline-pitch-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn-primary w-full justify-center"
      disabled={pending}
    >
      {pending ? "Creating…" : "Create pipeline"}
    </button>
  );
}

export function NewPipelineButton({ collapsed = false }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState<string>("layers");
  const [name, setName] = useState("");
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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIcon("layers");
          setName("");
          setOpen(true);
        }}
        title="New pipeline"
        className={
          collapsed
            ? "flex h-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
            : "flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        }
      >
        <Plus className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {collapsed ? (
          <span className="sr-only">New pipeline</span>
        ) : (
          "New pipeline"
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <button
            className="animate-overlay absolute inset-0 bg-zinc-900/30"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New pipeline"
            className="animate-panel relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-zinc-900">
                New pipeline
              </p>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <form action={createPipeline} className="mt-4 space-y-4">
              <div>
                <label htmlFor="pipeline-name" className="label">
                  Name
                </label>
                <input
                  ref={inputRef}
                  id="pipeline-name"
                  name="name"
                  required
                  maxLength={40}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Partners"
                  className="input"
                />
              </div>

              <div>
                <span className="label">Icon</span>
                <input type="hidden" name="icon" value={icon} />
                <div className="mt-1 grid grid-cols-6 gap-1.5">
                  {PIPELINE_ICONS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIcon(name)}
                      aria-label={name}
                      aria-pressed={icon === name}
                      className={`flex h-9 items-center justify-center rounded-md border transition-colors ${
                        icon === name
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                      }`}
                    >
                      <PipelineIcon name={name} className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>

              <PipelinePitchFields idSuffix="new" pipelineName={name} />

              <p className="text-[11px] leading-relaxed text-zinc-500">
                Creates a section in the sidebar with the standard stages (New →
                Contacted → Proposal → Won/Lost). The pitch above tells the
                email composer what we&apos;re offering to companies in this
                pipeline. Only the owner can create pipelines.
              </p>

              <SubmitButton />
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
