import { Download } from "lucide-react";
import { getAnalytics } from "@/lib/analytics";

export const dynamic = "force-dynamic";

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export default async function AnalyticsPage() {
  const data = await getAnalytics();
  const total = data.totals.companies || 1;

  const kpis = [
    ["Companies", data.totals.companies],
    ["Qualified", data.totals.qualified],
    ["Contacted", data.totals.contacted],
    ["Replies", data.totals.replied],
    ["Positive", data.totals.positive],
    ["Won", data.totals.won],
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Analytics</h1>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
            Funnel, source and signal attribution across the workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/export?kind=companies" className="btn-ghost">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Companies CSV
          </a>
          <a href="/api/export?kind=contacts" className="btn-ghost">
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Contacts CSV
          </a>
        </div>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map(([label, value]) => (
          <div key={label} className="card p-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-zinc-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Funnel</h2>
          <ul className="mt-3 space-y-2.5">
            {data.funnel.map((step) => (
              <li key={step.key}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-zinc-700">{step.label}</span>
                  <span className="tabular-nums text-zinc-500">
                    {step.value} <span className="text-zinc-400">· {pct(step.value, total)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-zinc-900"
                    style={{ width: `${Math.max(1, pct(step.value, total))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-zinc-400">
            Qualified = scored A/B/C · Replies captured from IMAP threads · Positive replies classified from reply text.
          </p>
        </section>

        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Pipelines</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="py-1.5 pr-3 font-medium">Pipeline</th>
                  <th className="py-1.5 pr-3 font-medium">Companies</th>
                  <th className="py-1.5 pr-3 font-medium">Qualified</th>
                  <th className="py-1.5 pr-3 font-medium">Contacted</th>
                  <th className="py-1.5 pr-3 font-medium">Replied</th>
                  <th className="py-1.5 font-medium">Won</th>
                </tr>
              </thead>
              <tbody>
                {data.pipelines.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 pr-3 text-zinc-800">{row.name}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.companies}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.qualified}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.contacted}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.replied}</td>
                    <td className="py-1.5 tabular-nums text-zinc-600">{row.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Signal attribution</h2>
          {data.signals.length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-500">No signals observed yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400">
                    <th className="py-1.5 pr-3 font-medium">Signal</th>
                    <th className="py-1.5 pr-3 font-medium">Companies</th>
                    <th className="py-1.5 pr-3 font-medium">Contacted</th>
                    <th className="py-1.5 font-medium">Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signals.slice(0, 12).map((row) => (
                    <tr key={row.key} className="border-b border-zinc-100 last:border-0">
                      <td className="py-1.5 pr-3 text-zinc-800">{row.label}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.companies}</td>
                      <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{row.contacted}</td>
                      <td className="py-1.5 tabular-nums text-zinc-600">{row.replied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Sources</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Discovery runs</p>
              {data.discoverySources.length === 0 ? (
                <p className="mt-1 text-[12px] text-zinc-500">None yet.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-zinc-600">
                  {data.discoverySources.map((row) => (
                    <li key={row.key} className="flex justify-between">
                      <span>{row.key}</span>
                      <span className="tabular-nums">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">Contacts</p>
              {data.contactSources.length === 0 ? (
                <p className="mt-1 text-[12px] text-zinc-500">None yet.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-[12px] text-zinc-600">
                  {data.contactSources.map((row) => (
                    <li key={row.key} className="flex justify-between">
                      <span>{row.key}</span>
                      <span className="tabular-nums">{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">Campaigns</h2>
        {data.campaigns.length === 0 ? (
          <p className="mt-2 text-[12px] text-zinc-500">No campaigns yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="py-1.5 pr-3 font-medium">Campaign</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Enrolled</th>
                  <th className="py-1.5 pr-3 font-medium">Active</th>
                  <th className="py-1.5 pr-3 font-medium">Sent</th>
                  <th className="py-1.5 font-medium">Replies</th>
                </tr>
              </thead>
              <tbody>
                {data.campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-zinc-100 last:border-0">
                    <td className="py-1.5 pr-3 text-zinc-800">{campaign.name}</td>
                    <td className="py-1.5 pr-3 capitalize text-zinc-600">{campaign.status}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{campaign.enrolled}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{campaign.active}</td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600">{campaign.sent}</td>
                    <td className="py-1.5 tabular-nums text-zinc-600">{campaign.replies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
