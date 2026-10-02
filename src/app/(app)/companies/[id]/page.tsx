import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Plus } from "lucide-react";
import { CompanyAvatar, KindBadge, StatusDot } from "@/components/badges";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { FindLinkedInButton } from "@/components/find-linkedin-button";
import {
  addContact,
  addInteraction,
  deleteContact,
  deleteInteraction,
  deleteOrganization,
  updateOrganization,
} from "@/lib/actions";
import {
  getCompany,
  getContacts,
  getCurrentProfile,
  getInteractions,
  getPipelines,
} from "@/lib/data";
import {
  CHANNELS,
  KIND_LABEL,
  KIND_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  pipelineName,
  pipelineStages,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = Number(id);
  if (!Number.isFinite(companyId)) notFound();

  const [company, contacts, interactions, profile, pipelines] =
    await Promise.all([
      getCompany(companyId),
      getContacts(companyId),
      getInteractions(companyId),
      getCurrentProfile(),
      getPipelines(),
    ]);

  if (!company) notFound();

  const isOwner = profile?.role === "owner";
  const pipelineLabel = pipelineName(pipelines, company.list);
  const stages = pipelineStages(pipelines, company.list);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <Link
        href={`/companies?list=${company.list}`}
        className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
      >
        ← {pipelineLabel}
      </Link>

      <header className="mt-3">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          {company.name}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <KindBadge kind={company.kind} />
          <StatusDot status={company.status} />
          {company.priority ? (
            <span className="text-[12px] capitalize text-zinc-500">
              Priority: {company.priority}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
          {company.website ? (
            <a
              className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-900"
              href={company.website}
              target="_blank"
              rel="noreferrer"
            >
              Website
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
          {company.linkedin_url ? (
            <a
              className="inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-900"
              href={company.linkedin_url}
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: activity + contacts */}
        <div className="space-y-6">
          <section className="card animate-rise animate-rise-1 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-zinc-900">
                Activity
                <span className="ml-2 font-normal text-zinc-400">
                  {interactions.length}
                </span>
              </h2>
            </div>

            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-dashed border-zinc-200 px-3 py-2 text-[13px] text-zinc-500 transition-colors hover:border-zinc-300 hover:text-zinc-800 [&::-webkit-details-marker]:hidden">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Log interaction
              </summary>
              <form
                action={addInteraction}
                className="mt-3 space-y-3 rounded-md bg-zinc-50/70 p-3"
              >
                <input type="hidden" name="org_id" value={company.id} />
                <div>
                  <label className="label" htmlFor="summary">
                    What happened?
                  </label>
                  <textarea
                    id="summary"
                    name="summary"
                    required
                    rows={2}
                    className="input"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="occurred_on">
                      Date
                    </label>
                    <input
                      id="occurred_on"
                      type="date"
                      name="occurred_on"
                      defaultValue={today}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="channel">
                      Channel
                    </label>
                    <select
                      id="channel"
                      name="channel"
                      defaultValue="Email"
                      className="input"
                    >
                      {CHANNELS.map((channel) => (
                        <option key={channel}>{channel}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="outcome">
                      Outcome
                    </label>
                    <input id="outcome" name="outcome" className="input" />
                  </div>
                  <div>
                    <label className="label" htmlFor="contact_id">
                      Contact
                    </label>
                    <select
                      id="contact_id"
                      name="contact_id"
                      defaultValue=""
                      className="input"
                    >
                      <option value="">—</option>
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="btn-primary">
                    Log interaction
                  </button>
                </div>
              </form>
            </details>

            {interactions.length === 0 ? (
              <p className="mt-4 text-[13px] text-zinc-500">
                No interactions logged yet.
              </p>
            ) : (
              <ul className="relative ml-1 mt-4 space-y-4 border-l border-zinc-100 pl-4">
                {interactions.map((item) => (
                  <li key={item.id} className="relative">
                    <span
                      className="absolute -left-[21px] top-1.5 h-1.5 w-1.5 rounded-full bg-zinc-300 ring-2 ring-white"
                      aria-hidden="true"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[12px] text-zinc-500 tabular-nums">
                        {item.occurred_on}
                        {item.channel ? ` · ${item.channel}` : ""}
                      </p>
                      {isOwner ? (
                        <form action={deleteInteraction}>
                          <input type="hidden" name="id" value={item.id} />
                          <input
                            type="hidden"
                            name="org_id"
                            value={company.id}
                          />
                          <ConfirmSubmit
                            message="Delete this interaction?"
                            className="text-[11px] text-zinc-400 transition-colors hover:text-rose-600"
                          >
                            Delete
                          </ConfirmSubmit>
                        </form>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[13px] text-zinc-800">
                      {item.summary}
                    </p>
                    {item.outcome ? (
                      <p className="mt-0.5 text-[12px] text-zinc-500">
                        Outcome: {item.outcome}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card animate-rise animate-rise-2 p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Contacts
              <span className="ml-2 font-normal text-zinc-400">
                {contacts.length}
              </span>
            </h2>

            <div className="mt-2 divide-y divide-zinc-100">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <CompanyAvatar name={contact.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium text-zinc-900">
                        {contact.name}
                      </p>
                      {contact.title ? (
                        <p className="truncate text-[12px] text-zinc-500">
                          {contact.title}
                        </p>
                      ) : null}
                      <div className="mt-0.5 flex flex-wrap gap-3 text-[12px]">
                        {contact.linkedin_url ? (
                          <a
                            className="text-zinc-500 transition-colors hover:text-zinc-900"
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            LinkedIn
                          </a>
                        ) : null}
                        {contact.email ? (
                          <a
                            className="text-zinc-500 transition-colors hover:text-zinc-900"
                            href={`mailto:${contact.email}`}
                          >
                            {contact.email}
                          </a>
                        ) : null}
                        {contact.phone ? (
                          <span className="text-zinc-500">
                            {contact.phone}
                          </span>
                        ) : null}
                      </div>
                      {!contact.linkedin_url ? (
                        <div className="mt-1">
                          <FindLinkedInButton
                            contactId={contact.id}
                            orgId={company.id}
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {isOwner ? (
                    <form action={deleteContact}>
                      <input type="hidden" name="id" value={contact.id} />
                      <input type="hidden" name="org_id" value={company.id} />
                      <ConfirmSubmit
                        message={`Delete ${contact.name}?`}
                        className="text-[11px] text-zinc-400 transition-colors hover:text-rose-600"
                      >
                        Delete
                      </ConfirmSubmit>
                    </form>
                  ) : null}
                </div>
              ))}
              {contacts.length === 0 ? (
                <p className="py-3 text-[13px] text-zinc-500">
                  No contacts yet.
                </p>
              ) : null}
            </div>

            <details className="group mt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add contact
              </summary>
              <form action={addContact} className="mt-3 space-y-3">
                <input type="hidden" name="org_id" value={company.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    name="name"
                    required
                    placeholder="Full name *"
                    aria-label="Full name"
                    className="input"
                  />
                  <input
                    name="title"
                    placeholder="Title"
                    aria-label="Title"
                    className="input"
                  />
                </div>
                <input
                  name="linkedin_url"
                  type="url"
                  placeholder="LinkedIn URL"
                  aria-label="LinkedIn URL"
                  className="input"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    name="email"
                    type="email"
                    placeholder="Email"
                    aria-label="Email"
                    className="input"
                  />
                  <input
                    name="phone"
                    placeholder="Phone"
                    aria-label="Phone"
                    className="input"
                  />
                </div>
                <button type="submit" className="btn-primary">
                  Add contact
                </button>
              </form>
            </details>
          </section>
        </div>

        {/* Right: details + danger */}
        <div className="space-y-6">
          <section className="card animate-rise animate-rise-2 p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Details
            </h2>
            <form action={updateOrganization} className="mt-4 space-y-3.5">
              <input type="hidden" name="id" value={company.id} />

              <div>
                <label className="label" htmlFor="name">
                  Name
                </label>
                <input
                  id="name"
                  name="name"
                  defaultValue={company.name}
                  required
                  className="input"
                />
              </div>

              <div>
                <label className="label" htmlFor="website">
                  Website
                </label>
                <input
                  id="website"
                  name="website"
                  type="url"
                  defaultValue={company.website ?? ""}
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
                  defaultValue={company.linkedin_url ?? ""}
                  className="input"
                />
                {company.linkedin_source ? (
                  <p className="mt-1 text-[11px] text-zinc-400">
                    {company.linkedin_source === "site"
                      ? "Found on their website"
                      : "Found via verified search — double-check it"}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="kind">
                    Type
                  </label>
                  <select
                    id="kind"
                    name="kind"
                    defaultValue={company.kind}
                    className="input"
                  >
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
                    defaultValue={company.priority ?? ""}
                    className="input"
                  >
                    <option value="">—</option>
                    {PRIORITY_OPTIONS.map((option) => (
                      <option
                        key={option}
                        value={option}
                        className="capitalize"
                      >
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="status">
                  Status
                </label>
                <select
                  id="status"
                  name="status"
                  defaultValue={company.status}
                  className="input"
                >
                  {stages.map((stage) => (
                    <option key={stage} value={stage}>
                      {STATUS_LABEL[stage]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="next_action">
                  Next action
                </label>
                <input
                  id="next_action"
                  name="next_action"
                  defaultValue={company.next_action ?? ""}
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="follow_up_on">
                    Follow-up date
                  </label>
                  <input
                    id="follow_up_on"
                    name="follow_up_on"
                    type="date"
                    defaultValue={company.follow_up_on ?? ""}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="follow_up_note">
                    Follow-up note
                  </label>
                  <input
                    id="follow_up_note"
                    name="follow_up_note"
                    defaultValue={company.follow_up_note ?? ""}
                    placeholder="What to do"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="last_contact">
                  Last contact
                </label>
                <input
                  id="last_contact"
                  name="last_contact"
                  type="date"
                  defaultValue={company.last_contact ?? ""}
                  className="input"
                />
              </div>

              <div>
                <label className="label" htmlFor="notes">
                  Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={5}
                  defaultValue={company.notes ?? ""}
                  className="input"
                />
              </div>

              <div className="flex justify-end pt-1">
                <button type="submit" className="btn-primary">
                  Save changes
                </button>
              </div>
            </form>
          </section>

          {isOwner ? (
            <section className="card animate-rise animate-rise-3 p-5">
              <h2 className="text-[13px] font-semibold text-zinc-900">
                Danger zone
              </h2>
              <p className="mt-1 text-[12px] text-zinc-500">
                Deleting removes this company with its contacts and history.
                Owner only.
              </p>
              <form action={deleteOrganization} className="mt-3">
                <input type="hidden" name="id" value={company.id} />
                <ConfirmSubmit
                  message={`Delete ${company.name} and all its data?`}
                  className="btn-danger w-full"
                >
                  Delete company
                </ConfirmSubmit>
              </form>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
