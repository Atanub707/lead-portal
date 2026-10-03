import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UserAvatar } from "@/components/badges";
import { getActivityLog, getCurrentProfile, getProfiles } from "@/lib/data";
import { str } from "@/lib/types";

export const dynamic = "force-dynamic";

const PER = 20;

const GROUPS: { value: string; label: string }[] = [
  { value: "company", label: "Companies" },
  { value: "contact", label: "People" },
  { value: "research", label: "Research" },
  { value: "pipeline", label: "Pipelines" },
  { value: "user", label: "Access" },
  { value: "profile", label: "Profile" },
];

const GROUP_VALUES = new Set(GROUPS.map((group) => group.value));

function timestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "owner") redirect("/dashboard");

  const sp = await searchParams;
  const actorRaw = str(sp.actor);
  const groupRaw = str(sp.group);
  const group = GROUP_VALUES.has(groupRaw) ? groupRaw : "";
  const pageRaw = Number(str(sp.page));
  const requestedPage =
    Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  const profiles = await getProfiles();
  const actor = profiles.some((p) => p.id === actorRaw) ? actorRaw : "";

  let result = await getActivityLog({
    page: requestedPage,
    per: PER,
    actorId: actor || undefined,
    group: group || undefined,
  });

  const totalPages = Math.max(1, Math.ceil(result.count / PER));
  if (requestedPage > totalPages && result.count > 0) {
    result = await getActivityLog({
      page: totalPages,
      per: PER,
      actorId: actor || undefined,
      group: group || undefined,
    });
  }

  const rows = result.rows;
  const count = result.count;
  const current = Math.min(requestedPage, totalPages);
  const fromRow = count === 0 ? 0 : (current - 1) * PER + 1;
  const toRow = Math.min(current * PER, count);

  const emails = new Map(profiles.map((p) => [p.id, p.email]));

  function href(next: { page?: number }) {
    const params = new URLSearchParams();
    if (actor) params.set("actor", actor);
    if (group) params.set("group", group);
    params.set("page", String(next.page ?? current));
    return `/audit?${params.toString()}`;
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Audit log
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500 tabular-nums">
            {count} {count === 1 ? "entry" : "entries"}
          </p>
        </div>
      </header>

      <form
        method="get"
        className="mt-6 flex flex-wrap items-center gap-2"
        aria-label="Filters"
      >
        <select
          name="actor"
          defaultValue={actor}
          aria-label="Actor"
          className="input w-[220px]"
        >
          <option value="">All</option>
          {profiles.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email ?? user.full_name ?? user.id}
            </option>
          ))}
        </select>
        <select
          name="group"
          defaultValue={group}
          aria-label="Type"
          className="input w-[150px]"
        >
          <option value="">All</option>
          {GROUPS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-ghost">
          Apply
        </button>
        {actor || group ? (
          <Link href="/audit" className="btn-ghost">
            Reset
          </Link>
        ) : null}
      </form>

      <div className="card mt-5 divide-y divide-zinc-100 overflow-hidden">
        {rows.map((row) => {
          const label = row.actor_id
            ? (emails.get(row.actor_id) ?? "System")
            : "System";
          return (
            <div key={row.id} className="flex items-start gap-3 px-4 py-3">
              <span className="pt-0.5">
                <UserAvatar seed={row.actor_id} name={label} size={26} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-zinc-900">
                    {label}
                  </span>
                  <span className="inline-flex items-center rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                    {row.action}
                  </span>
                  {row.org_id ? (
                    <Link
                      href={`/companies/${row.org_id}`}
                      className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-900"
                    >
                      View company
                    </Link>
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] text-zinc-600">{row.summary}</p>
              </div>
              <time
                dateTime={row.created_at}
                className="shrink-0 pt-0.5 text-[12px] text-zinc-400 tabular-nums"
              >
                {timestamp(row.created_at)}
              </time>
            </div>
          );
        })}

        {count === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-[13px] text-zinc-500">
              {actor || group
                ? "No matching activity."
                : "No activity recorded yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 px-4 py-2.5">
            <p className="text-[12px] text-zinc-500 tabular-nums">
              Showing {fromRow}–{toRow} of {count}
            </p>

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
          </div>
        )}
      </div>
    </div>
  );
}
