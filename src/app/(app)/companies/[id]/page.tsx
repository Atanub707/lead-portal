import Link from "next/link";
import { notFound } from "next/navigation";
import { KindBadge, StatusPill } from "@/components/badges";
import { ConfirmSubmit } from "@/components/confirm-submit";
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
} from "@/lib/data";
import {
  CHANNELS,
  KIND_LABEL,
  KIND_OPTIONS,
  LIST_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  STATUS_STAGES,
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

  const [company, contacts, interactions, profile] = await Promise.all([
    getCompany(companyId),
    getContacts(companyId),
    getInteractions(companyId),
    getCurrentProfile(),
  ]);

  if (!company) notFound();

  const isOwner = profile?.role === "owner";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        href={`/companies?list=${company.list}`}
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← {LIST_LABEL[company.list]}
      </Link>

      <header className="mt-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          {company.name}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <KindBadge kind={company.kind} />
          <StatusPill status={company.status} />
          {company.priority ? (
            <span className="text-xs capitalize text-slate-500">
              Priority: {company.priority}
            </span>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {company.website ? (
            <a
              className="text-emerald-600 hover:text-emerald-700"
              href={company.website}
              target="_blank"
              rel="noreferrer"
            >
              Website ↗
            </a>
          ) : null}
          {company.linkedin_url ? (
            <a
              className="text-emerald-600 hover:text-emerald-700"
              href={company.linkedin_url}
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn ↗
            </a>
          ) : null}
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Left column: details + danger zone */}
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Details</h2>
            <form action={updateOrganization} className="mt-4 space-y-4">
              <input type="hidden" name="id" value={company.id} />

              <div>
                <label className="label" htmlFor="name">
                  Company name
                </label>
                <input
                  id="name"
                  name="name"
                  defaultValue={company.name}
                  required
                  className="input"
                />
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
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
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
                  <label className="label" htmlFor="status">
                    Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    defaultValue={company.status}
                    className="input"
                  >
                    {STATUS_STAGES[company.list].map((stage) => (
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
                  <select
                    id="priority"
                    name="priority"
                    defaultValue={company.priority ?? ""}
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

              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="flex justify-end">
                <button type="submit" className="btn-primary">
                  Save changes
                </button>
              </div>
            </form>
          </section>

          {isOwner ? (
            <section className="card border-rose-200 p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Danger zone
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Deleting a company also deletes its contacts and interaction
                log. Owner only.
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

        {/* Right column: contacts + interactions */}
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Contacts ({contacts.length})
            </h2>

            <div className="mt-3 divide-y divide-slate-100">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {contact.name}
                    </p>
                    {contact.title ? (
                      <p className="text-xs text-slate-500">{contact.title}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      {contact.linkedin_url ? (
                        <a
                          className="text-emerald-600 hover:text-emerald-700"
                          href={contact.linkedin_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          LinkedIn ↗
                        </a>
                      ) : null}
                      {contact.email ? (
                        <a
                          className="text-slate-500 hover:text-slate-700"
                          href={`mailto:${contact.email}`}
                        >
                          {contact.email}
                        </a>
                      ) : null}
                      {contact.phone ? (
                        <span className="text-slate-500">{contact.phone}</span>
                      ) : null}
                    </div>
                  </div>
                  {isOwner ? (
                    <form action={deleteContact}>
                      <input type="hidden" name="id" value={contact.id} />
                      <input type="hidden" name="org_id" value={company.id} />
                      <ConfirmSubmit
                        message={`Delete ${contact.name}?`}
                        className="text-xs text-rose-400 transition-colors hover:text-rose-600"
                      >
                        Delete
                      </ConfirmSubmit>
                    </form>
                  ) : null}
                </div>
              ))}
              {contacts.length === 0 ? (
                <p className="py-3 text-sm text-slate-400">
                  No contacts yet.
                </p>
              ) : null}
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-emerald-600 hover:text-emerald-700">
                + Add contact
              </summary>
              <form action={addContact} className="mt-3 space-y-3">
                <input type="hidden" name="org_id" value={company.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    name="name"
                    required
                    placeholder="Full name *"
                    className="input"
                  />
                  <input name="title" placeholder="Title" className="input" />
                </div>
                <input
                  name="linkedin_url"
                  type="url"
                  placeholder="LinkedIn URL"
                  className="input"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    name="email"
                    type="email"
                    placeholder="Email"
                    className="input"
                  />
                  <input name="phone" placeholder="Phone" className="input" />
                </div>
                <button type="submit" className="btn-primary">
                  Add contact
                </button>
              </form>
            </details>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Interaction log ({interactions.length})
            </h2>

            <ul className="mt-3 space-y-3">
              {interactions.map((item) => (
                <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      {item.occurred_on}
                      {item.channel ? ` · ${item.channel}` : ""}
                    </span>
                    {isOwner ? (
                      <form action={deleteInteraction}>
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="org_id" value={company.id} />
                        <ConfirmSubmit
                          message="Delete this interaction?"
                          className="text-rose-400 transition-colors hover:text-rose-600"
                        >
                          Delete
                        </ConfirmSubmit>
                      </form>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{item.summary}</p>
                  {item.outcome ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Outcome: {item.outcome}
                    </p>
                  ) : null}
                </li>
              ))}
              {interactions.length === 0 ? (
                <li className="text-sm text-slate-400">
                  No interactions logged yet.
                </li>
              ) : null}
            </ul>

            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-emerald-600 hover:text-emerald-700">
                + Log interaction
              </summary>
              <form action={addInteraction} className="mt-3 space-y-3">
                <input type="hidden" name="org_id" value={company.id} />
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
                <div>
                  <label className="label" htmlFor="summary">
                    Summary *
                  </label>
                  <textarea
                    id="summary"
                    name="summary"
                    required
                    rows={2}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="outcome">
                    Outcome
                  </label>
                  <input id="outcome" name="outcome" className="input" />
                </div>
                <div>
                  <label className="label" htmlFor="contact_id">
                    Contact (optional)
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
                <button type="submit" className="btn-primary">
                  Log interaction
                </button>
              </form>
            </details>
          </section>
        </div>
      </div>
    </div>
  );
}
