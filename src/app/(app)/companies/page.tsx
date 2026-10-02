import Link from "next/link";
import { KindBadge, StatusPill } from "@/components/badges";
import { getCompanies } from "@/lib/data";
import {
  KIND_LABEL,
  KIND_OPTIONS,
  LIST_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  STATUS_STAGES,
  parseList,
  str,
} from "@/lib/types";

export const dynamic = "force-dynamic";

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const list = parseList(sp.list);
  const q = str(sp.q);
  const status = str(sp.status);
  const kind = str(sp.kind);
  const priority = str(sp.priority);

  const companies = await getCompanies({ list, q, status, kind, priority });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            {LIST_LABEL[list]}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {companies.length} {companies.length === 1 ? "company" : "companies"}
          </p>
        </div>
        <Link href={`/companies/new?list=${list}`} className="btn-primary">
          Add company
        </Link>
      </header>

      <form
        method="get"
        className="card mt-6 flex flex-wrap items-end gap-3 p-4"
      >
        <input type="hidden" name="list" value={list} />
        <div className="min-w-[180px] flex-1">
          <label className="label" htmlFor="q">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Company name…"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={status} className="input">
            <option value="">All</option>
            {STATUS_STAGES[list].map((stage) => (
              <option key={stage} value={stage}>
                {STATUS_LABEL[stage]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="kind">
            Type
          </label>
          <select id="kind" name="kind" defaultValue={kind} className="input">
            <option value="">All</option>
            {KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={priority}
            className="input"
          >
            <option value="">All</option>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option} className="capitalize">
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary">
            Apply
          </button>
          <Link href={`/companies?list=${list}`} className="btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <div className="card mt-6 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Company</th>
                <th className="th">Type</th>
                <th className="th">Status</th>
                <th className="th">Priority</th>
                <th className="th">Contacts</th>
                <th className="th">Last contact</th>
                <th className="th">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((company) => (
                <tr key={company.id} className="hover:bg-slate-50/70">
                  <td className="td">
                    <Link
                      href={`/companies/${company.id}`}
                      className="font-medium text-slate-900 hover:text-emerald-700"
                    >
                      {company.name}
                    </Link>
                    {company.website ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {host(company.website)}
                      </p>
                    ) : null}
                  </td>
                  <td className="td">
                    <KindBadge kind={company.kind} />
                  </td>
                  <td className="td">
                    <StatusPill status={company.status} />
                  </td>
                  <td className="td capitalize">{company.priority ?? "—"}</td>
                  <td className="td">{company.contacts?.[0]?.count ?? 0}</td>
                  <td className="td">{company.last_contact ?? "—"}</td>
                  <td className="td max-w-[220px] truncate">
                    {company.next_action ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {companies.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            No companies match. Adjust the filters or add one.
          </p>
        ) : null}
      </div>
    </div>
  );
}
