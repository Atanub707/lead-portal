"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, Sparkles, X } from "lucide-react";
import { generatePipelinePitch, updatePipeline } from "@/lib/actions";
import { PIPELINE_ICONS } from "@/lib/types";
import { FLAVORS } from "@/lib/flavors";
import { PipelineIcon } from "@/components/pipeline-icon";
import { SubmitButton } from "@/components/submit-button";

const FLAVOR_OPTIONS = FLAVORS;

function flavorOrDefault(value: string | null): string {
  return FLAVOR_OPTIONS.some((flavor) => flavor.id === value) ? (value ?? "") : "";
}

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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState({
    name,
    icon,
    pitch: pitch ?? "",
    value_props: value_props.join("\n"),
    proof_points: proof_points.join("\n"),
    cta: cta ?? "",
    default_flavor: flavorOrDefault(default_flavor),
  });
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
    setFields({
      name,
      icon,
      pitch: pitch ?? "",
      value_props: value_props.join("\n"),
      proof_points: proof_points.join("\n"),
      cta: cta ?? "",
      default_flavor: flavorOrDefault(default_flavor),
    });
    setError(null);
    setOpen(true);
  }

  function set(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function autoGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generatePipelinePitch(fields.pitch, fields.name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFields((prev) => ({
        ...prev,
        pitch: result.pitch,
        value_props: result.value_props.join("\n"),
        proof_points: result.proof_points.join("\n"),
        cta: result.cta,
      }));
    } catch {
      setError("Couldn't generate a pitch — try again.");
    } finally {
      setGenerating(false);
    }
  }

  const notesEmpty = fields.pitch.trim() === "";

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
                  onChange={(event) => set("name", event.target.value)}
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
                      onClick={() => set("icon", iconName)}
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

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`pipeline-pitch-${id}`}
                    className="label mb-0"
                  >
                    Pitch
                  </label>
                  <button
                    type="button"
                    onClick={autoGenerate}
                    disabled={generating || notesEmpty}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {generating ? (
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {generating ? "Generating…" : "Auto-generate"}
                  </button>
                </div>
                <textarea
                  id={`pipeline-pitch-${id}`}
                  name="pitch"
                  rows={3}
                  value={fields.pitch}
                  onChange={(event) => set("pitch", event.target.value)}
                  placeholder="Rough notes — what are you offering?"
                  className="input resize-none"
                />
                {error ? (
                  <p role="alert" className="mt-1 text-[12px] text-rose-600">
                    {error}
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`pipeline-value-props-${id}`}
                  className="label"
                >
                  Value props
                </label>
                <textarea
                  id={`pipeline-value-props-${id}`}
                  name="value_props"
                  rows={3}
                  value={fields.value_props}
                  onChange={(event) => set("value_props", event.target.value)}
                  placeholder="One per line"
                  className="input resize-none"
                />
              </div>

              <div>
                <label
                  htmlFor={`pipeline-proof-points-${id}`}
                  className="label"
                >
                  Proof points
                </label>
                <textarea
                  id={`pipeline-proof-points-${id}`}
                  name="proof_points"
                  rows={3}
                  value={fields.proof_points}
                  onChange={(event) => set("proof_points", event.target.value)}
                  placeholder="One per line"
                  className="input resize-none"
                />
              </div>

              <div>
                <label htmlFor={`pipeline-cta-${id}`} className="label">
                  CTA
                </label>
                <input
                  id={`pipeline-cta-${id}`}
                  name="cta"
                  value={fields.cta}
                  onChange={(event) => set("cta", event.target.value)}
                  className="input"
                />
              </div>

              <div>
                <label htmlFor={`pipeline-flavor-${id}`} className="label">
                  Default flavor
                </label>
                <select
                  id={`pipeline-flavor-${id}`}
                  name="default_flavor"
                  value={fields.default_flavor}
                  onChange={(event) => set("default_flavor", event.target.value)}
                  className="input"
                >
                  <option value="">No default</option>
                  {FLAVOR_OPTIONS.map((flavor) => (
                    <option key={flavor.id} value={flavor.id}>
                      {flavor.label}
                    </option>
                  ))}
                </select>
              </div>

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
