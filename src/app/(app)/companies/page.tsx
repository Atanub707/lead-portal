import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Mail,
  Search,
  Trash2,
} from "lucide-react";
import { BookmarkToggle } from "@/components/bookmark-toggle";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { FollowUpControl } from "@/components/follow-up-control";
import { PasteUrl } from "@/components/paste-url";
import { CompanyAvatar, KindBadge } from "@/components/badges";
import { deleteOrganization } from "@/lib/actions";
import { getCompanies, getCurrentProfile, getPipelines } from "@/lib/data";
import {
  KIND_LABEL,
  KIND_OPTIONS,
  parseList,
  pipelineName,
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
  const kind = str(sp.kind);
  const follow = str(sp.follow);
  const starred = str(sp.starred) === "1";

  const perRaw = Number(str(sp.per));
  const per = PAGE_SIZES.includes(perRaw) ? perRaw : DEFAULT_PER;
  const pageRaw = Number(str(sp.page));
  const requestedPage =
    Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const profile = await getCurrentProfile();
  const isOwner = profile?.role === "owner";
  const pipelines = await getPipelines();
  if (!pipelines.some((pipeline) => pipeline.id === list)) notFound();

  let result = await getCompanies({
    list,
    q,
    kind,
    follow,
    starred,
    page: requestedPage,
    per,
  });

  const totalPages = Math.max(1, Math.ceil(result.count / per));
  if (requestedPage > totalPages && result.count > 0) {
    result = await getCompanies({
      list,
      q,
      kind,
      follow,
      starred,
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
    if (kind) params.set("kind", kind);
    if (follow) params.set("follow", follow);
    if (starred) params.set("starred", "1");
    params.set("per", String(next.per ?? per));
    params.set("page", String(next.page ?? current));
    return `/companies?${params.toString()}`;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {pipelineName(pipelines, list)}
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 tabular-nums">
            {count} {count === 1 ? "company" : "companies"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PasteUrl list={list} pipelines={pipelines} />
          <Link href={`/companies/new?list=${list}`} className="btn-primary">
            + Add company
          </Link>
        </div>
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
          name="follow"
          defaultValue={follow}
          aria-label="Follow-up"
          className="input w-[140px]"
        >
          <option value="">Any follow-up</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due this week</option>
          <option value="none">No follow-up</option>
        </select>
        <select
          name="starred"
          defaultValue={starred ? "1" : ""}
          aria-label="Bookmarks"
          className="input w-[130px]"
        >
          <option value="">All companies</option>
          <option value="1">Starred only</option>
        </select>
        <button type="submit" className="btn-ghost">
          Apply
        </button>
        {q || kind || follow || starred ? (
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
                <th className="th w-10 pl-2">
                  <span className="sr-only">Bookmark</span>
                </th>
                <th className="th pl-2">Company</th>
                <th className="th">Type</th>
                <th className="th">Reach</th>
                <th className="th">Follow-up</th>
                <th className="th pr-4 text-right">Email</th>
                <th className="th w-10 pr-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50/70"
                >
                  <td className="td pl-2">
                    <BookmarkToggle
                      orgId={company.id}
                      bookmarked={company.bookmarked}
                    />
                  </td>
                  <td className="td pl-2">
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
                          <a
                            href={company.website}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[240px] items-center gap-1 text-[12px] text-zinc-500 transition-colors hover:text-zinc-900"
                          >
                            <span className="truncate">
                              {host(company.website)}
                            </span>
                            <ExternalLink
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="td">
                    <KindBadge kind={company.kind} />
                  </td>
                  <td className="td">
                    <span className="text-[12px] text-zinc-600 tabular-nums">
                      {company.people_count === 0 &&
                      company.email_count === 0 ? (
                        <span className="text-zinc-300">—</span>
                      ) : (
                        [
                          company.people_count > 0
                            ? `${company.people_count} ${
                                company.people_count === 1
                                  ? "person"
                                  : "people"
                              }`
                            : null,
                          company.email_count > 0
                            ? `${company.email_count} ${
                                company.email_count === 1 ? "email" : "emails"
                              }`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      )}
                    </span>
                  </td>
                  <td className="td">
                    <FollowUpControl
                      orgId={company.id}
                      date={company.follow_up_on}
                      note={company.follow_up_note}
                    />
                  </td>
                  <td className="td pr-4 text-right">
                    {company.first_email ? (
                      <a
                        href={`mailto:${company.first_email}`}
                        title={company.first_email}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">
                          Email {company.first_email}
                        </span>
                      </a>
                    ) : (
                      <span
                        className="text-[12px] text-zinc-300"
                        aria-hidden="true"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td className="td pr-4">
                    {isOwner ? (
                      <form action={deleteOrganization}>
                        <input type="hidden" name="id" value={company.id} />
                        <input type="hidden" name="next" value={href({})} />
                        <ConfirmSubmit
                          message={`Delete ${company.name}? Its contacts and interactions are deleted too. This cannot be undone.`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">
                            Delete {company.name}
                          </span>
                        </ConfirmSubmit>
                      </form>
                    ) : null}
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
                    scroll={false}
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
                      scroll={false}
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
                        scroll={false}
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
                      scroll={false}
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
