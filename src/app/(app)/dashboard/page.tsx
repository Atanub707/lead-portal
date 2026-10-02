import Link from "next/link";
import { getRecentInteractions, getStatusCounts } from "@/lib/data";
import {
  LIST_LABEL,
  STATUS_LABEL,
  STATUS_STAGES,
  type InteractionWithOrg,
  type OrgList,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [posCounts, compCounts, posRecent, compRecent] = await Promise.all([
    getStatusCounts("pos"),
    getStatusCounts("compliance"),
    getRecentInteractions("pos", 5),
    getRecentInteractions("compliance", 5),
  ]);

  const pipelines: {
    list: OrgList;
    counts: Record<string, number>;
    recent: InteractionWithOrg[];
  }[] = [
    { list: "pos", counts: posCounts, recent: posRecent },
    { list: "compliance", counts: compCounts, recent: compRecent },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Two pipelines, one shared database.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {pipelines.map(({ list, counts, recent }) => {
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          return (
            <section key={list} className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  {LIST_LABEL[list]}
                </h2>
                <Link
                  href={`/companies?list=${list}`}
                  className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
                >
                  Open →
                </Link>
              </div>

              <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                {total}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  companies
                </span>
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {STATUS_STAGES[list].map((stage) => (
                  <span
                    key={stage}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600"
                  >
                    {STATUS_LABEL[stage]}
                    <span className="font-semibold text-slate-800">
                      {counts[stage] ?? 0}
                    </span>
                  </span>
                ))}
              </div>

              <div className="mt-5 border-t border-slate-100 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Recent activity
                </p>
                {recent.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">
                    No activity yet.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {recent.map((item) => (
                      <li key={item.id} className="flex items-start gap-2">
                        <span className="mt-0.5 w-20 shrink-0 text-xs text-slate-400">
                          {item.occurred_on}
                        </span>
                        <span className="text-sm text-slate-600">
                          <Link
                            href={`/companies/${item.org_id}`}
                            className="font-medium text-slate-800 hover:text-emerald-700"
                          >
                            {item.organizations?.name ?? "Company"}
                          </Link>{" "}
                          — {item.summary}
                        </span>
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
