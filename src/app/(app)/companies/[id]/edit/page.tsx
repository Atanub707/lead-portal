import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SubmitButton } from "@/components/submit-button";
import { deleteOrganization, updateOrganization } from "@/lib/actions";
import {
  getCompany,
  getCurrentProfile,
  getPipelines,
  getWorkspaceContext,
} from "@/lib/data";
import {
  KIND_LABEL,
  KIND_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  pipelineStages,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditCompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = Number(id);
  if (!Number.isFinite(companyId)) notFound();

  const [company, pipelines, profile, workspaceCtx] = await Promise.all([
    getCompany(companyId),
    getPipelines(),
    getCurrentProfile(),
    getWorkspaceContext(),
  ]);
  if (!company) notFound();
  if (workspaceCtx?.canWrite === false) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-8">
        <div className="card p-6">
          <p className="text-[14px] text-zinc-600">
            Read-only account — ask the workspace owner to unlock changes.
          </p>
          <Link href={`/companies/${company.id}`} className="btn-ghost mt-3 inline-flex">
            Back to company
          </Link>
        </div>
      </div>
    );
  }

  const stages = pipelineStages(pipelines, company.list);
  const isOwner = profile?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:px-8">
      <Link
        href={`/companies/${company.id}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {company.name}
      </Link>

      <header className="mt-3">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Edit company
        </h1>
        <p className="mt-1 text-[14px] text-zinc-500">
          Details are usually accurate already — edit only when something is wrong.
        </p>
      </header>

      <section className="card mt-6 p-6">
        <form action={updateOrganization} className="space-y-5">
          <input type="hidden" name="id" value={company.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">
                Name
              </label>
              <input id="name" name="name" defaultValue={company.name} required className="input" />
            </div>
            <div>
              <label className="label" htmlFor="website">
                Website
              </label>
              <input id="website" name="website" type="url" defaultValue={company.website ?? ""} className="input" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="linkedin_url">
                LinkedIn
              </label>
              <input id="linkedin_url" name="linkedin_url" type="url" defaultValue={company.linkedin_url ?? ""} className="input" />
              {company.linkedin_source ? (
                <p className="mt-1 text-[11px] text-zinc-400">
                  {company.linkedin_source === "site"
                    ? "Found on their website"
                    : "Found via verified search — double-check it"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="kind">
                Type
              </label>
              <select id="kind" name="kind" defaultValue={company.kind} className="input">
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {KIND_LABEL[option]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="status">
                Status
              </label>
              <select id="status" name="status" defaultValue={company.status} className="input">
                {stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {STATUS_LABEL[stage]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="priority">
                Priority
              </label>
              <select id="priority" name="priority" defaultValue={company.priority ?? ""} className="input">
                <option value="">—</option>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option} value={option} className="capitalize">
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="next_action">
                Next action
              </label>
              <input id="next_action" name="next_action" defaultValue={company.next_action ?? ""} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="follow_up_on">
                Follow-up date
              </label>
              <input id="follow_up_on" name="follow_up_on" type="date" defaultValue={company.follow_up_on ?? ""} className="input" />
            </div>
            <div>
              <label className="label" htmlFor="last_contact">
                Last contact
              </label>
              <input id="last_contact" name="last_contact" type="date" defaultValue={company.last_contact ?? ""} className="input" />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="follow_up_note">
              Follow-up note
            </label>
            <input id="follow_up_note" name="follow_up_note" defaultValue={company.follow_up_note ?? ""} className="input" />
          </div>

          <div>
            <label className="label" htmlFor="notes">
              Notes / description
            </label>
            <textarea id="notes" name="notes" rows={6} defaultValue={company.notes ?? ""} className="input" />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 pt-4">
            <Link href={`/companies/${company.id}`} className="btn-ghost">
              Cancel
            </Link>
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </form>
      </section>

      {isOwner ? (
        <section className="card mt-5 p-6">
          <h2 className="text-[14px] font-semibold text-zinc-900">Delete company</h2>
          <p className="mt-1 text-[13px] text-zinc-500">
            Removes this company with its people and history. Owner only.
          </p>
          <form action={deleteOrganization} className="mt-3">
            <input type="hidden" name="id" value={company.id} />
            <ConfirmSubmit
              message={`Delete ${company.name} and all its data?`}
              className="btn-danger"
            >
              Delete company
            </ConfirmSubmit>
          </form>
        </section>
      ) : null}
    </div>
  );
}
