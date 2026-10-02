import Link from "next/link";
import { Search } from "lucide-react";
import { CompanyAvatar, KindBadge, StatusDot } from "@/components/badges";
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
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {LIST_LABEL[list]}
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            {companies.length}{" "}
            {companies.length === 1 ? "company" : "companies"}
          </p>
        </div>
        <Link href={`/companies/new?list=${list}`} className="btn-primary">
          + Add company
        </Link>
      </header>

      <form
        method="get"
        className="mt-6 flex flex-wrap items-center gap-2"
        aria-label="Filters"
      >
        <input type="hidden" name="list" value={list} />
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Search companies…"
            aria-label="Search companies"
            className="input pl-8"
          />
        </div>
        <select
          name="status"
          defaultValue={status}
          aria-label="Status"
          className="input w-[130px]"
        >
          <option value="">Any status</option>
          {STATUS_STAGES[list].map((stage) => (
            <option key={stage} value={stage}>
              {STATUS_LABEL[stage]}
            </option>
          ))}
        </select>
        <select
          name="kind"
          defaultValue={kind}
          aria-label="Type"
          className="input w-[130px]"
        >
          <option value="">Any type</option>
          {KIND_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority}
          aria-label="Priority"
          className="input w-[120px]"
        >
          <option value="">Any priority</option>
          {PRIORITY_OPTIONS.map((option) => (
            <option key={option} value={option} className="capitalize">
              {option}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-ghost">
          Apply
        </button>
        {q || status || kind || priority ? (
          <Link href={`/companies?list=${list}`} className="btn-ghost">
            Reset
          </Link>
        ) : null}
      </form>

      <div className="card mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-zinc-200/80">
                <th className="th pl-4">Company</th>
                <th className="th">Type</th>
                <th className="th">Status</th>
                <th className="th">Priority</th>
                <th className="th text-right">Contacts</th>
                <th className="th">Last contact</th>
                <th className="th pr-4">Next action</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50/70"
                >
                  <td className="td pl-4">
                    <div className="flex items-center gap-2.5">
                      <CompanyAvatar name={company.name} />
                      <div className="min-w-0">
                        <Link
                          href={`/companies/${company.id}`}
                          className="block truncate font-medium text-zinc-900 transition-colors hover:text-zinc-600"
                        >
                          {company.name}
                        </Link>
                        {company.website ? (
                          <p className="truncate text-[12px] text-zinc-500">
                            {host(company.website)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <KindBadge kind={company.kind} />
                  </td>
                  <td className="td">
                    <StatusDot status={company.status} />
                  </td>
                  <td className="td capitalize">{company.priority ?? "—"}</td>
                  <td className="td text-right tabular-nums">
                    {company.contacts?.[0]?.count ?? 0}
                  </td>
                  <td className="td tabular-nums">
                    {company.last_contact ?? "—"}
                  </td>
                  <td className="td max-w-[240px] truncate pr-4">
                    {company.next_action ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {companies.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-[13px] font-medium text-zinc-700">
              No companies found
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Adjust the filters, or add the first one.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
