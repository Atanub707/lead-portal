"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { updatePipeline } from "@/lib/actions";
import { PIPELINE_ICONS } from "@/lib/types";
import { PipelineIcon } from "@/components/pipeline-icon";
import { PipelinePitchFields } from "@/components/pipeline-pitch-fields";
import { SubmitButton } from "@/components/submit-button";

export function EditPipelineDialog({
  id,
  name,
  icon,
  pitch,
  value_props,
  proof_points,
  cta,
  default_flavor,
}: {
  id: string;
  name: string;
  icon: string;
  pitch: string | null;
  value_props: string[];
  proof_points: string[];
  cta: string | null;
  default_flavor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState({ name, icon });
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    nameRef.current?.select();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openDialog() {
    setFields({ name, icon });
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title="Edit pipeline"
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">Edit {name}</span>
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
            aria-label="Edit pipeline"
            className="animate-panel relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-zinc-900">
                Edit pipeline
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

            <form action={updatePipeline} className="mt-4 space-y-4">
              <input type="hidden" name="id" value={id} />

              <div>
                <label htmlFor={`pipeline-name-${id}`} className="label">
                  Name
                </label>
                <input
                  ref={nameRef}
                  id={`pipeline-name-${id}`}
                  name="name"
                  required
                  maxLength={40}
                  value={fields.name}
                  onChange={(event) =>
                    setFields((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="input"
                />
              </div>

              <div>
                <span className="label">Icon</span>
                <input type="hidden" name="icon" value={fields.icon} />
                <div className="mt-1 grid grid-cols-6 gap-1.5">
                  {PIPELINE_ICONS.map((iconName) => (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() =>
                        setFields((prev) => ({ ...prev, icon: iconName }))
                      }
                      aria-label={iconName}
                      aria-pressed={fields.icon === iconName}
                      className={`flex h-9 items-center justify-center rounded-md border transition-colors ${
                        fields.icon === iconName
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                      }`}
                    >
                      <PipelineIcon name={iconName} className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>

              <PipelinePitchFields
                idSuffix={id}
                pipelineName={fields.name}
                initial={{
                  pitch,
                  value_props,
                  proof_points,
                  cta,
                  default_flavor,
                }}
              />

              <SubmitButton className="btn-primary w-full justify-center">
                Save pipeline
              </SubmitButton>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
