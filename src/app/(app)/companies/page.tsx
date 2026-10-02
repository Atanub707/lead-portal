import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
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

const PAGE_SIZES = [10, 20, 50];
const DEFAULT_PER = 20;

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const items: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("…");
  for (let p = start; p <= end; p += 1) items.push(p);
  if (end < total - 1) items.push("…");
  items.push(total);
  return items;
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

  const perRaw = Number(str(sp.per));
  const per = PAGE_SIZES.includes(perRaw) ? perRaw : DEFAULT_PER;
  const pageRaw = Number(str(sp.page));
  const requestedPage =
    Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  let result = await getCompanies({
    list,
    q,
    status,
    kind,
    priority,
    page: requestedPage,
    per,
  });

  const totalPages = Math.max(1, Math.ceil(result.count / per));
  if (requestedPage > totalPages && result.count > 0) {
    result = await getCompanies({
      list,
      q,
      status,
      kind,
      priority,
      page: totalPages,
      per,
    });
  }

  const companies = result.rows;
  const count = result.count;
  const current = Math.min(requestedPage, totalPages);
  const fromRow = count === 0 ? 0 : (current - 1) * per + 1;
  const toRow = Math.min(current * per, count);

  function href(next: { page?: number; per?: number }) {
    const params = new URLSearchParams();
    params.set("list", list);
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (priority) params.set("priority", priority);
    params.set("per", String(next.per ?? per));
    params.set("page", String(next.page ?? current));
    return `/companies?${params.toString()}`;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {LIST_LABEL[list]}
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 tabular-nums">
            {count} {count === 1 ? "company" : "companies"}
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
        <input type="hidden" name="per" value={String(per)} />
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
          <Link href={`/companies?list=${list}&per=${per}`} className="btn-ghost">
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

        {count === 0 ? (
          <div className="border-t border-zinc-100 px-4 py-16 text-center">
            <p className="text-[13px] font-medium text-zinc-700">
              No companies found
            </p>
            <p className="mt-1 text-[13px] text-zinc-500">
              Adjust the filters, or add the first one.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 px-4 py-2.5">
            <p className="text-[12px] text-zinc-500 tabular-nums">
              Showing {fromRow}–{toRow} of {count}
            </p>

            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-0.5">
                <span className="mr-1 text-[12px] text-zinc-500">Rows</span>
                {PAGE_SIZES.map((size) => (
                  <Link
                    key={size}
                    href={href({ per: size, page: 1 })}
                    aria-label={`${size} rows per page`}
                    className={`flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-[12px] tabular-nums transition-colors ${
                      size === per
                        ? "bg-zinc-100 font-medium text-zinc-900"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                    }`}
                  >
                    {size}
                  </Link>
                ))}
              </div>

              {totalPages > 1 ? (
                <nav className="flex items-center gap-1" aria-label="Pagination">
                  {current > 1 ? (
                    <Link
                      href={href({ page: current - 1 })}
                      aria-label="Previous page"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-100 text-zinc-300"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </span>
                  )}

                  {pageItems(current, totalPages).map((item, index) =>
                    item === "…" ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-1 text-[12px] text-zinc-400"
                      >
                        …
                      </span>
                    ) : item === current ? (
                      <span
                        key={item}
                        aria-current="page"
                        className="flex h-8 min-w-8 items-center justify-center rounded-md bg-zinc-900 px-1.5 text-[12px] font-medium text-white tabular-nums"
                      >
                        {item}
                      </span>
                    ) : (
                      <Link
                        key={item}
                        href={href({ page: item })}
                        aria-label={`Page ${item}`}
                        className="flex h-8 min-w-8 items-center justify-center rounded-md border border-zinc-200 bg-white px-1.5 text-[12px] text-zinc-600 tabular-nums transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                      >
                        {item}
                      </Link>
                    )
                  )}

                  {current < totalPages ? (
                    <Link
                      href={href({ page: current + 1 })}
                      aria-label="Next page"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-100 text-zinc-300"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  )}
                </nav>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
