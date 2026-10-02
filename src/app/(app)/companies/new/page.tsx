import Link from "next/link";
import { createOrganization } from "@/lib/actions";
import {
  KIND_LABEL,
  KIND_OPTIONS,
  LIST_LABEL,
  PRIORITY_OPTIONS,
  parseList,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const list = parseList(sp.list);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="max-w-xl">
        <Link
          href={`/companies?list=${list}`}
          className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
        >
          ← {LIST_LABEL[list]}
        </Link>

        <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900">
          Add company
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Goes into the {LIST_LABEL[list]}. Contacts and interactions come
          next.
        </p>

        <form action={createOrganization} className="card mt-6 space-y-4 p-5">
        <input type="hidden" name="list" value={list} />

        <div>
          <label className="label" htmlFor="name">
            Company name
          </label>
          <input id="name" name="name" required className="input" />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="website">
              Website
            </label>
            <input
              id="website"
              name="website"
              type="url"
              placeholder="https://…"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="linkedin_url">
              LinkedIn
            </label>
            <input
              id="linkedin_url"
              name="linkedin_url"
              type="url"
              placeholder="https://linkedin.com/company/…"
              className="input"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="kind">
              Type
            </label>
            <select id="kind" name="kind" defaultValue="lead" className="input">
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
              defaultValue=""
              className="input"
            >
              <option value="">—</option>
              {PRIORITY_OPTIONS.map((option) => (
                <option key={option} value={option} className="capitalize">
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="next_action">
            Next action
          </label>
          <input id="next_action" name="next_action" className="input" />
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={4} className="input" />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Link href={`/companies?list=${list}`} className="btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn-primary">
            Create company
          </button>
        </div>
        </form>
      </div>
    </div>
  );
}
