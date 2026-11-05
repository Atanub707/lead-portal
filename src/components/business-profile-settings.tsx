"use client";

import { SubmitButton } from "@/components/submit-button";
import {
  applyBusinessTemplate,
  createDefaultIcp,
  saveBusinessProfile,
  saveIcp,
} from "@/lib/intelligence-actions";
import {
  EMPLOYEE_BAND_OPTIONS,
  FUNDING_STAGE_OPTIONS,
  type BusinessProfile,
  type IcpCriterion,
  type IcpPersona,
  type IcpProfile,
  type ScoringModel,
  type SignalDefinition,
} from "@/lib/intelligence";
import type { Pipeline } from "@/lib/types";

interface TemplateSummary {
  key: string;
  name: string;
  description: string | null;
}

function criterionValues(
  criteria: IcpCriterion[],
  kind: string,
  fieldName: string
): string[] {
  const row = criteria.find(
    (criterion) => criterion.kind === kind && criterion.field === fieldName
  );
  return Array.isArray(row?.value)
    ? (row.value as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
}

function signalWeights(criteria: IcpCriterion[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const criterion of criteria) {
    if (criterion.kind !== "signal") continue;
    const value = criterion.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as { key?: unknown; weight?: unknown };
    if (typeof record.key !== "string") continue;
    const weight = Number(record.weight);
    if (Number.isFinite(weight) && weight > 0) map.set(record.key, weight);
  }
  return map;
}

function personasText(personas: IcpPersona[]): string {
  return personas
    .map((persona) =>
      [
        persona.name,
        persona.titles.join(", "),
        persona.seniorities.join(", "),
      ]
        .filter((part) => part.length > 0)
        .join(" | ")
    )
    .join("\n");
}

export function BusinessProfileSettings({
  profile,
  icp,
  personas,
  criteria,
  model,
  signals,
  pipelines,
  templates,
  canWrite,
}: {
  profile: BusinessProfile | null;
  icp: IcpProfile | null;
  personas: IcpPersona[];
  criteria: IcpCriterion[];
  model: ScoringModel | null;
  signals: SignalDefinition[];
  pipelines: Pipeline[];
  templates: TemplateSummary[];
  canWrite: boolean;
}) {
  const industries = criterionValues(criteria, "firmographic", "industry");
  const employeeBands = criterionValues(criteria, "firmographic", "employee_band");
  const fundingStages = criterionValues(criteria, "firmographic", "funding_stage");
  const geo = criterionValues(criteria, "geo", "country");
  const weights = signalWeights(criteria);
  const linkedPipeline = pipelines.find((pipeline) => pipeline.icp_id === icp?.id);
  const scoring = model?.weights ?? {};
  const readOnly = !canWrite;

  return (
    <div className="space-y-5">
      <p className="text-[13px] leading-relaxed text-zinc-500">
        Define what this workspace sells and who it targets. Discovery,
        qualification and outreach read from this configuration — nothing here
        is industry-specific by default.
      </p>

      <section className="card p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">
          Start from a template
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
          Applying a template creates (or updates) a business profile and its
          ICP. Everything stays editable afterwards.
        </p>
        <form action={applyBusinessTemplate} className="mt-3 flex flex-wrap items-center gap-2">
          <select
            name="template_key"
            aria-label="Business profile template"
            className="input max-w-xs"
            defaultValue={profile?.template_key ?? "custom"}
            disabled={readOnly}
          >
            {templates.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </select>
          <SubmitButton pendingText="Applying…">Apply template</SubmitButton>
        </form>
      </section>

      <section className="card p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">
          What we sell
        </h2>
        <form
          key={`bp-${profile?.id ?? "new"}-${profile?.updated_at ?? ""}`}
          action={saveBusinessProfile}
          className="mt-3 space-y-4"
        >
          <input type="hidden" name="id" value={profile?.id ?? ""} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bp-name" className="label">
                Business profile name
              </label>
              <input
                id="bp-name"
                name="name"
                required
                maxLength={80}
                className="input"
                defaultValue={profile?.name ?? ""}
                placeholder="e.g. Compliance & Security Readiness"
                disabled={readOnly}
              />
            </div>
            <div>
              <label htmlFor="bp-categories" className="label">
                Service categories
              </label>
              <input
                id="bp-categories"
                name="service_categories"
                className="input"
                defaultValue={(profile?.service_categories ?? []).join(", ")}
                placeholder="SOC 2 readiness, ISO 27001, Cloud security"
                disabled={readOnly}
              />
            </div>
          </div>
          <div>
            <label htmlFor="bp-description" className="label">
              Description
            </label>
            <textarea
              id="bp-description"
              name="description"
              rows={2}
              className="input"
              defaultValue={profile?.description ?? ""}
              placeholder="One or two sentences on what the business delivers."
              disabled={readOnly}
            />
          </div>
          <div>
            <label htmlFor="bp-positioning" className="label">
              Positioning
            </label>
            <input
              id="bp-positioning"
              name="positioning"
              className="input"
              defaultValue={profile?.positioning ?? ""}
              placeholder="How you differ from alternatives"
              disabled={readOnly}
            />
          </div>
          <div>
            <label htmlFor="bp-differentiators" className="label">
              Differentiators (one per line)
            </label>
            <textarea
              id="bp-differentiators"
              name="differentiators"
              rows={3}
              className="input"
              defaultValue={(profile?.differentiators ?? []).join("\n")}
              placeholder={"Audit-ready in 6 weeks\nFixed-fee scoping"}
              disabled={readOnly}
            />
          </div>
          {readOnly ? null : (
            <div className="flex justify-end">
              <SubmitButton>Save business profile</SubmitButton>
            </div>
          )}
        </form>
      </section>

      {icp ? (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[13px] font-semibold text-zinc-900">
                Ideal Customer Profile
              </h2>
              <p className="mt-1 text-[12px] text-zinc-500">
                Targeting rules, personas, signals and scoring. Empty values
                mean &ldquo;any&rdquo;.
              </p>
            </div>
            {icp.is_default ? (
              <span className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                Default
              </span>
            ) : null}
          </div>

          <form
            key={`icp-${icp.id}-${icp.updated_at}`}
            action={saveIcp}
            className="mt-4 space-y-5"
          >
            <input type="hidden" name="icp_id" value={icp.id} />
            <input
              type="hidden"
              name="business_profile_id"
              value={profile?.id ?? ""}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="icp-name" className="label">
                  ICP name
                </label>
                <input
                  id="icp-name"
                  name="name"
                  required
                  className="input"
                  defaultValue={icp.name}
                  disabled={readOnly}
                />
              </div>
              <div>
                <label htmlFor="icp-pipeline" className="label">
                  Pipeline
                </label>
                <select
                  id="icp-pipeline"
                  name="pipeline_id"
                  className="input"
                  defaultValue={linkedPipeline?.id ?? "none"}
                  disabled={readOnly}
                >
                  <option value="none">None</option>
                  {pipelines.map((pipeline) => (
                    <option key={pipeline.id} value={pipeline.id}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="icp-industries" className="label">
                  Industries (comma separated)
                </label>
                <input
                  id="icp-industries"
                  name="industries"
                  className="input"
                  defaultValue={industries.join(", ")}
                  placeholder="SaaS, FinTech, Health Care"
                  disabled={readOnly}
                />
              </div>
              <div>
                <label htmlFor="icp-geo" className="label">
                  Countries / regions (comma separated)
                </label>
                <input
                  id="icp-geo"
                  name="geo"
                  className="input"
                  defaultValue={geo.join(", ")}
                  placeholder="India, United States, EU"
                  disabled={readOnly}
                />
              </div>
            </div>

            <div>
              <p className="label">Employee bands</p>
              <div className="flex flex-wrap gap-1.5">
                {EMPLOYEE_BAND_OPTIONS.map((band) => (
                  <label
                    key={band}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white"
                  >
                    <input
                      type="checkbox"
                      name="employee_bands"
                      value={band}
                      defaultChecked={employeeBands.includes(band)}
                      className="sr-only"
                      disabled={readOnly}
                    />
                    {band}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="label">Funding stages</p>
              <div className="flex flex-wrap gap-1.5">
                {FUNDING_STAGE_OPTIONS.map((stage) => (
                  <label
                    key={stage.value}
                    className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-[11px] text-zinc-600 has-checked:border-zinc-900 has-checked:bg-zinc-900 has-checked:text-white"
                  >
                    <input
                      type="checkbox"
                      name="funding_stages"
                      value={stage.value}
                      defaultChecked={fundingStages.includes(stage.value)}
                      className="sr-only"
                      disabled={readOnly}
                    />
                    {stage.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="icp-personas" className="label">
                Personas (one per line: Name | Titles | Seniorities)
              </label>
              <textarea
                id="icp-personas"
                name="personas"
                rows={4}
                className="input font-mono text-[11px]"
                defaultValue={personasText(personas)}
                placeholder={"Founder | Founder, Co-Founder, CEO | c_suite, owner\nCTO | CTO, VP Engineering | c_suite, vp"}
                disabled={readOnly}
              />
            </div>

            <div>
              <p className="label">Buying signals (weight 0–50, 0 = off)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {signals.map((signal) => (
                  <label
                    key={signal.key}
                    className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-zinc-800">
                        {signal.label}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-zinc-400">
                        {signal.category}
                      </span>
                    </span>
                    <input
                      type="number"
                      name={`signal_${signal.key}`}
                      min={0}
                      max={50}
                      step={1}
                      defaultValue={weights.get(signal.key) ?? 0}
                      className="input w-16 tabular-nums"
                      aria-label={`${signal.label} weight`}
                      disabled={readOnly}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="label">Scoring</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label htmlFor="weight-fit" className="mb-1 block text-[11px] text-zinc-500">
                    Fit weight
                  </label>
                  <input
                    id="weight-fit"
                    name="weight_fit"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="input tabular-nums"
                    defaultValue={scoring.fit ?? 0.4}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <label htmlFor="weight-intent" className="mb-1 block text-[11px] text-zinc-500">
                    Intent weight
                  </label>
                  <input
                    id="weight-intent"
                    name="weight_intent"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="input tabular-nums"
                    defaultValue={scoring.intent ?? 0.45}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <label htmlFor="weight-reach" className="mb-1 block text-[11px] text-zinc-500">
                    Reach weight
                  </label>
                  <input
                    id="weight-reach"
                    name="weight_reach"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="input tabular-nums"
                    defaultValue={scoring.reach ?? 0.15}
                    disabled={readOnly}
                  />
                </div>
                <div>
                  <label htmlFor="threshold" className="mb-1 block text-[11px] text-zinc-500">
                    Qualified at
                  </label>
                  <input
                    id="threshold"
                    name="threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input tabular-nums"
                    defaultValue={model?.threshold ?? 60}
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>

            {readOnly ? null : (
              <div className="flex justify-end">
                <SubmitButton>Save ICP</SubmitButton>
              </div>
            )}
          </form>
        </section>
      ) : (
        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">
            Ideal Customer Profile
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
            No ICP yet. Create a default one, or apply a template above.
          </p>
          <form action={createDefaultIcp} className="mt-3">
            <SubmitButton pendingText="Creating…">Create default ICP</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
