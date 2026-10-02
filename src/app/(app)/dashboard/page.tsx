import Link from "next/link";
import {
  getPipelines,
  getRecentInteractions,
  getStatusCounts,
} from "@/lib/data";
import { STATUS_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const pipelines = await getPipelines();
  const data = await Promise.all(
    pipelines.map(async (pipeline) => ({
      pipeline,
      counts: await getStatusCounts(pipeline.id),
      recent: await getRecentInteractions(pipeline.id, 5),
    }))
  );

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Dashboard
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          {pipelines.length}{" "}
          {pipelines.length === 1 ? "pipeline" : "pipelines"}, one shared
          database.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {data.map(({ pipeline, counts, recent }, index) => {
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          const activeStages = pipeline.stages.filter(
            (s) => s !== "new" && s !== "won" && s !== "lost"
          );
          const active = activeStages.reduce(
            (sum, stage) => sum + (counts[stage] ?? 0),
            0
          );
          const won = counts.won ?? 0;

          const stats: [string, number][] = [
            ["Total", total],
            ["Active", active],
            ["Won", won],
          ];

          return (
            <section
              key={pipeline.id}
              className={`card animate-rise animate-rise-${index + 1} p-5`}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-semibold text-zinc-900">
                  {pipeline.name}
                </h2>
                <Link
                  href={`/companies?list=${pipeline.id}`}
                  className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
                >
                  Open →
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4 border-b border-zinc-100 pb-4">
                {stats.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-[22px] font-semibold tracking-tight text-zinc-900 tabular-nums">
                      {value}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">{label}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2.5">
                {pipeline.stages.map((stage) => {
                  const count = counts[stage] ?? 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={stage} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-[12px] text-zinc-500">
                        {STATUS_LABEL[stage]}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                        <div
                          className="h-full rounded-full bg-zinc-900"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-zinc-700">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-5 border-t border-zinc-100 pt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Recent activity
                </p>
                {recent.length === 0 ? (
                  <p className="mt-2 text-[13px] text-zinc-500">
                    No activity yet.
                  </p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {recent.map((item) => (
                      <li key={item.id} className="flex gap-3">
                        <span
                          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300"
                          aria-hidden="true"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/companies/${item.org_id}`}
                            className="text-[13px] font-medium text-zinc-800 transition-colors hover:text-zinc-950"
                          >
                            {item.organizations?.name ?? "Company"}
                          </Link>
                          <p className="truncate text-[12px] text-zinc-500">
                            {item.summary}
                            {item.channel ? ` · ${item.channel}` : ""}
                          </p>
                          <p className="text-[11px] text-zinc-400">
                            {item.occurred_on}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
