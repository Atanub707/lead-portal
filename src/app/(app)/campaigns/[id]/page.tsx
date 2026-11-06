import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import {
  enrollCampaign,
  saveCampaignSteps,
  setCampaignStatus,
  updateCampaign,
} from "@/lib/campaign-actions";
import { getCampaignDetail } from "@/lib/campaign-data";
import { getPipelines } from "@/lib/data";
import { FLAVORS } from "@/lib/flavors";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  archived: "border-zinc-200 bg-zinc-50 text-zinc-500",
  draft: "border-sky-200 bg-sky-50 text-sky-700",
};

function day(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, pipelines] = await Promise.all([
    getCampaignDetail(id),
    getPipelines(),
  ]);
  if (!detail.campaign) notFound();
  const campaign = detail.campaign;
  const pipeline = pipelines.find((entry) => entry.id === campaign.pipeline_id);

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-8">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Campaigns
      </Link>

      <header className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          {campaign.name}
        </h1>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
            STATUS_STYLE[campaign.status] ?? STATUS_STYLE.draft
          }`}
        >
          {campaign.status}
        </span>
        <span className="text-[12px] text-zinc-500">
          {pipeline ? pipeline.name : "No pipeline linked"}
        </span>
        <form action={setCampaignStatus} className="ml-auto">
          <input type="hidden" name="id" value={campaign.id} />
          <input
            type="hidden"
            name="status"
            value={campaign.status === "active" ? "paused" : "active"}
          />
          <SubmitButton
            pendingText="Updating…"
            className={campaign.status === "active" ? "btn-ghost" : "btn-primary"}
          >
            {campaign.status === "active" ? "Pause" : "Activate"}
          </SubmitButton>
        </form>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Settings</h2>
          <form action={updateCampaign} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={campaign.id} />
            <div>
              <label htmlFor="campaign-name" className="label">Name</label>
              <input id="campaign-name" name="name" className="input" defaultValue={campaign.name} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="campaign-pipeline" className="label">Pipeline</label>
                <select id="campaign-pipeline" name="pipeline_id" className="input" defaultValue={campaign.pipeline_id ?? ""}>
                  <option value="">None</option>
                  {pipelines.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="campaign-status" className="label">Status</label>
                <select id="campaign-status" name="status" className="input" defaultValue={campaign.status}>
                  {["draft", "active", "paused", "archived"].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="campaign-score" className="label">Min score</label>
                <input id="campaign-score" name="min_score" type="number" min={0} max={100} className="input tabular-nums" defaultValue={campaign.min_score} />
              </div>
              <div>
                <label htmlFor="campaign-cap" className="label">Daily cap</label>
                <input id="campaign-cap" name="daily_cap" type="number" min={1} max={30} className="input tabular-nums" defaultValue={campaign.daily_cap} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px] text-zinc-700">
              <input type="checkbox" name="stop_on_reply" defaultChecked={campaign.stop_on_reply} className="h-3.5 w-3.5 rounded border-zinc-300" />
              Stop the sequence when the recipient replies
            </label>
            <div className="flex justify-end">
              <SubmitButton>Save settings</SubmitButton>
            </div>
          </form>
        </section>

        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Steps</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            One step per line: <code>delay_days | flavor</code>. The delay is
            days after the previous step. Flavors:{" "}
            {FLAVORS.map((flavor) => flavor.id).join(", ")}.
          </p>
          <form action={saveCampaignSteps} className="mt-3 space-y-3">
            <input type="hidden" name="id" value={campaign.id} />
            <textarea
              name="steps"
              rows={5}
              className="input font-mono text-[11px]"
              defaultValue={
                detail.steps.length > 0
                  ? detail.steps
                      .map((step) => `${step.delay_days} | ${step.flavor ?? "short-direct"}`)
                      .join("\n")
                  : "0 | short-direct\n3 | pain-first\n5 | follow-up"
              }
            />
            <div className="flex justify-end">
              <SubmitButton>Save steps</SubmitButton>
            </div>
          </form>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-[11px] leading-relaxed text-amber-800">
              Active campaigns auto-send AI drafts — no review step. Keep the
              cap low, verify emails and rely on stop-on-reply.
            </p>
          </div>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">Enroll companies</h2>
        <p className="mt-1 text-[11px] text-zinc-500">
          Enrolls companies from the campaign pipeline that have a contact email,
          at or above the score threshold.
        </p>
        <form action={enrollCampaign} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={campaign.id} />
          <div>
            <label htmlFor="enroll-score" className="label">Min score</label>
            <input id="enroll-score" name="min_score" type="number" min={0} max={100} className="input w-24 tabular-nums" defaultValue={campaign.min_score} />
          </div>
          <div>
            <label htmlFor="enroll-limit" className="label">Max companies</label>
            <input id="enroll-limit" name="limit" type="number" min={1} max={50} className="input w-28 tabular-nums" defaultValue={25} />
          </div>
          <SubmitButton pendingText="Enrolling…">Enroll</SubmitButton>
        </form>
      </section>

      <section className="card mt-5 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">
          Enrollments
          <span className="ml-2 font-normal text-zinc-400">{detail.enrollments.length}</span>
        </h2>
        {detail.enrollments.length === 0 ? (
          <p className="mt-2 text-[12px] text-zinc-500">No enrollments yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="py-1.5 pr-3 font-medium">Company</th>
                  <th className="py-1.5 pr-3 font-medium">Contact</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Step</th>
                  <th className="py-1.5 pr-3 font-medium">Next run</th>
                  <th className="py-1.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {detail.enrollments.map((enrollment) => (
                  <tr key={enrollment.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 pr-3">
                      <Link href={`/companies/${enrollment.org_id}`} className="text-zinc-800 hover:underline">
                        {enrollment.org_name}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-600">
                      {enrollment.contact_name ?? "—"}
                      {enrollment.to_email ? (
                        <span className="block text-[10px] text-zinc-400">{enrollment.to_email}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3 capitalize text-zinc-600">{enrollment.status}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{enrollment.current_step}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{day(enrollment.next_run_at)}</td>
                    <td className="py-1.5 text-zinc-500">{enrollment.stop_reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card mt-5 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">Recent events</h2>
        {detail.events.length === 0 ? (
          <p className="mt-2 text-[12px] text-zinc-500">No campaign activity yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {detail.events.map((event) => (
              <li key={event.id} className="flex items-center gap-2 text-[12px] text-zinc-600">
                <span className="rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {event.kind}
                </span>
                <span>{event.org_name ?? "—"}</span>
                <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">
                  {day(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
