"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { FLAVORS } from "@/lib/flavors";
import { generatePipelinePitch } from "@/lib/actions";

// Shared pitch editor used by both the New pipeline and Edit pipeline dialogs.
// Fields submit natively via their name attributes; state lives here.
export function PipelinePitchFields({
  idSuffix,
  pipelineName,
  initial,
}: {
  idSuffix: string;
  pipelineName: string;
  initial?: {
    pitch?: string | null;
    value_props?: string[] | null;
    proof_points?: string[] | null;
    cta?: string | null;
    default_flavor?: string | null;
  };
}) {
  const [pitch, setPitch] = useState(initial?.pitch ?? "");
  const [valueProps, setValueProps] = useState(
    (initial?.value_props ?? []).join("\n")
  );
  const [proofPoints, setProofPoints] = useState(
    (initial?.proof_points ?? []).join("\n")
  );
  const [cta, setCta] = useState(initial?.cta ?? "");
  const [flavor, setFlavor] = useState(initial?.default_flavor ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notesEmpty = pitch.trim() === "";

  async function autoGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generatePipelinePitch(pitch, pipelineName);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPitch(result.pitch);
      setValueProps(result.value_props.join("\n"));
      setProofPoints(result.proof_points.join("\n"));
      setCta(result.cta);
    } catch {
      setError("Couldn't generate a pitch — try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={`pipeline-pitch-${idSuffix}`} className="label mb-0">
            Pitch
          </label>
          <button
            type="button"
            onClick={autoGenerate}
            disabled={generating || notesEmpty}
            title="Type rough notes, then let AI sharpen them into a structured pitch"
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
          id={`pipeline-pitch-${idSuffix}`}
          name="pitch"
          rows={3}
          value={pitch}
          onChange={(event) => setPitch(event.target.value)}
          placeholder="Rough notes — what are we offering? (e.g. DevSecOps-based ISO 27001 / SOC 2 readiness for startups)"
          className="input resize-none"
        />
        <p className="mt-1 text-[11px] text-zinc-400">
          Type rough notes, hit Auto-generate, and AI will structure the pitch.
          Emails for companies in this pipeline are written from it.
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-[12px] text-rose-600">
            {error}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor={`pipeline-value-props-${idSuffix}`} className="label">
          Value props
        </label>
        <textarea
          id={`pipeline-value-props-${idSuffix}`}
          name="value_props"
          rows={3}
          value={valueProps}
          onChange={(event) => setValueProps(event.target.value)}
          placeholder="One per line"
          className="input resize-none"
        />
      </div>

      <div>
        <label
          htmlFor={`pipeline-proof-points-${idSuffix}`}
          className="label"
        >
          Proof points
        </label>
        <textarea
          id={`pipeline-proof-points-${idSuffix}`}
          name="proof_points"
          rows={2}
          value={proofPoints}
          onChange={(event) => setProofPoints(event.target.value)}
          placeholder="Certifications, case studies, numbers — one per line"
          className="input resize-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`pipeline-cta-${idSuffix}`} className="label">
            CTA
          </label>
          <input
            id={`pipeline-cta-${idSuffix}`}
            name="cta"
            value={cta}
            onChange={(event) => setCta(event.target.value)}
            placeholder="e.g. a 15-minute call"
            className="input"
          />
        </div>
        <div>
          <label htmlFor={`pipeline-flavor-${idSuffix}`} className="label">
            Default flavor
          </label>
          <select
            id={`pipeline-flavor-${idSuffix}`}
            name="default_flavor"
            value={flavor}
            onChange={(event) => setFlavor(event.target.value)}
            className="input"
          >
            <option value="">No default</option>
            {FLAVORS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
