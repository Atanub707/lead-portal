import Link from "next/link";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/submit-button";
import { createCampaign } from "@/lib/campaign-actions";
import { getCampaigns } from "@/lib/campaign-data";
import { getPipelines } from "@/lib/data";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  archived: "border-zinc-200 bg-zinc-50 text-zinc-500",
  draft: "border-sky-200 bg-sky-50 text-sky-700",
};

export default async function CampaignsPage() {
  const [campaigns, pipelines] = await Promise.all([
    getCampaigns(),
    getPipelines(),
  ]);

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Campaigns
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Multi-step email sequences. Active campaigns send due steps once a day
          within the 30/day cap, stop on reply, and respect the suppression
          list.
        </p>
      </header>

      <section className="card mt-6 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">New campaign</h2>
        <form action={createCampaign} className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="campaign-name" className="label">
              Name
            </label>
            <input
              id="campaign-name"
              name="name"
              required
              className="input"
              placeholder="Compliance — 3-touch outbound"
            />
          </div>
          <div>
            <label htmlFor="campaign-pipeline" className="label">
              Pipeline
            </label>
            <select id="campaign-pipeline" name="pipeline_id" className="input">
              <option value="">None</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="campaign-score" className="label">
                Min score
              </label>
              <input
                id="campaign-score"
                name="min_score"
                type="number"
                min={0}
                max={100}
                defaultValue={50}
                className="input tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="campaign-cap" className="label">
                Daily cap
              </label>
              <input
                id="campaign-cap"
                name="daily_cap"
                type="number"
                min={1}
                max={30}
                defaultValue={30}
                className="input tabular-nums"
              />
            </div>
          </div>
          <div className="sm:col-span-4 flex justify-end">
            <SubmitButton pendingText="Creating…">Create campaign</SubmitButton>
          </div>
        </form>
      </section>

      {campaigns.length === 0 ? (
        <div className="card mt-5 p-8 text-center">
          <Send className="mx-auto h-5 w-5 text-zinc-300" aria-hidden="true" />
          <p className="mt-2 text-[13px] text-zinc-500">
            No campaigns yet. Create one above, add steps, then enroll qualified
            companies.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="card flex flex-wrap items-center gap-4 p-4 transition-colors hover:border-zinc-300"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-zinc-900">
                      {campaign.name}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
                        STATUS_STYLE[campaign.status] ?? STATUS_STYLE.draft
                      }`}
                    >
                      {campaign.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {campaign.steps} step{campaign.steps === 1 ? "" : "s"} ·{" "}
                    {campaign.active} active · {campaign.enrolled} enrolled
                  </p>
                </div>
                <dl className="flex gap-5 text-right">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-zinc-400">Sent</dt>
                    <dd className="text-[13px] font-medium tabular-nums text-zinc-800">{campaign.sent}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-zinc-400">Replies</dt>
                    <dd className="text-[13px] font-medium tabular-nums text-zinc-800">{campaign.replies}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
