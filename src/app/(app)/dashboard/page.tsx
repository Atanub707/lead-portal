import Link from "next/link";
import {
  getDashboardStats,
  getPipelines,
  getRecentInteractions,
  getRecentRuns,
  getStatusCounts,
  getUpcomingFollowUps,
} from "@/lib/data";
import { STATUS_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

const RUN_KIND_LABEL: Record<string, string> = {
  website_research: "Website research",
  linkedin_roster: "LinkedIn team roster",
  linkedin_profile: "LinkedIn profile details",
  email_search: "Email search",
  manual: "Manual entry",
};

export default async function DashboardPage() {
  const [pipelines, stats, followUps, recentRuns] = await Promise.all([
    getPipelines(),
    getDashboardStats(),
    getUpcomingFollowUps(6),
    getRecentRuns(5),
  ]);

  const data = await Promise.all(
    pipelines.map(async (pipeline) => ({
      pipeline,
      counts: await getStatusCounts(pipeline.id),
      recent: await getRecentInteractions(pipeline.id, 2),
    }))
  );

  const today = new Date().toISOString().slice(0, 10);
  const followUpsDue =
    stats.followUps.overdue + stats.followUps.today + stats.followUps.soon;
  const followUpParts = [
    stats.followUps.overdue > 0 ? `${stats.followUps.overdue} overdue` : null,
    stats.followUps.today > 0 ? `${stats.followUps.today} today` : null,
    stats.followUps.soon > 0 ? `${stats.followUps.soon} this week` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const listBreakdown = pipelines
    .map(
      (pipeline) =>
        `${stats.perList[pipeline.id] ?? 0} ${pipeline.name.replace(
          /\s+Pipeline$/i,
          ""
        )}`
    )
    .join(" · ");

  const kpis: { label: string; value: number; detail: string; tone?: string }[] =
    [
      {
        label: "Companies",
        value: stats.totalCompanies,
        detail: listBreakdown,
      },
      {
        label: "People",
        value: stats.people,
        detail:
          stats.decisionMakers > 0
            ? `${stats.decisionMakers} decision makers`
            : "no decision makers yet",
        tone: stats.decisionMakers > 0 ? "text-amber-700" : undefined,
      },
      {
        label: "Emails found",
        value: stats.emails,
        detail: "company + personal",
      },
      {
        label: "Follow-ups due",
        value: followUpsDue,
        detail: followUpParts || "nothing due",
        tone: stats.followUps.overdue > 0 ? "text-rose-600" : undefined,
      },
    ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex items-end justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Dashboard
        </h1>
      </header>

      {/* KPI row */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi, index) => (
          <div
            key={kpi.label}
            className={`card animate-rise animate-rise-${index + 1} p-5`}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              {kpi.label}
            </p>
            <p className="mt-2 text-[26px] font-semibold tracking-tight text-zinc-900 tabular-nums">
              {kpi.value}
            </p>
            <p className={`mt-1 text-[12px] ${kpi.tone ?? "text-zinc-500"}`}>
              {kpi.detail}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Pipeline cards */}
        <div className="space-y-5">
          {data.map(({ pipeline, counts, recent }, index) => {
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const activeStages = pipeline.stages.filter(
              (stage) => stage !== "new" && stage !== "won" && stage !== "lost"
            );
            const active = activeStages.reduce(
              (sum, stage) => sum + (counts[stage] ?? 0),
              0
            );
            const won = counts.won ?? 0;

            const cardStats: [string, number][] = [
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
                    className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-900"
                  >
                    Open →
                  </Link>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-4 border-b border-zinc-100 pb-4">
                  {cardStats.map(([label, value]) => (
                    <div key={label}>
                      <p className="text-[24px] font-semibold tracking-tight text-zinc-900 tabular-nums">
                        {value}
                      </p>
                      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        {label}
                      </p>
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
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100">
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

        {/* Side panels */}
        <div className="space-y-5">
          <section className="card animate-rise animate-rise-3 p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Follow-ups
              <span className="ml-2 font-normal text-zinc-400">
                {followUps.length}
              </span>
            </h2>
            {followUps.length === 0 ? (
              <p className="mt-2 text-[13px] text-zinc-500">
                Nothing scheduled — set follow-ups from the pipeline table.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100">
                {followUps.map((item) => {
                  const state =
                    item.follow_up_on < today
                      ? "overdue"
                      : item.follow_up_on === today
                        ? "today"
                        : "upcoming";
                  const chip =
                    state === "overdue"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : state === "today"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-zinc-200 bg-white text-zinc-600";
                  const label =
                    state === "today"
                      ? "Today"
                      : new Date(`${item.follow_up_on}T00:00:00`).toLocaleDateString(
                          undefined,
                          { month: "short", day: "numeric" }
                        );
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/companies/${item.id}`}
                          className="text-[13px] font-medium text-zinc-800 transition-colors hover:text-zinc-950"
                        >
                          {item.name}
                        </Link>
                        {item.follow_up_note ? (
                          <p className="truncate text-[12px] text-zinc-500">
                            {item.follow_up_note}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums ${chip}`}
                      >
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card animate-rise animate-rise-4 p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Recent research runs
            </h2>
            {recentRuns.length === 0 ? (
              <p className="mt-2 text-[13px] text-zinc-500">
                No research runs yet — paste a company URL.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-zinc-100">
                {recentRuns.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] text-zinc-800">
                        {RUN_KIND_LABEL[run.kind] ?? run.kind}
                        <span className="ml-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500">
                          {run.source}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-zinc-500">
                        <Link
                          href={`/companies/${run.org_id}`}
                          className="transition-colors hover:text-zinc-900"
                        >
                          {run.organizations?.name ?? "Company"}
                        </Link>{" "}
                        · {run.people_found}{" "}
                        {run.people_found === 1 ? "person" : "people"}
                        {run.emails_found > 0
                          ? ` · ${run.emails_found} ${
                              run.emails_found === 1 ? "email" : "emails"
                            }`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[12px] text-zinc-400 tabular-nums">
                      <p>
                        {new Date(run.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </p>
                      <p>
                        {Number(run.cost_usd) > 0
                          ? `$${Number(run.cost_usd).toFixed(2)}`
                          : "free"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
