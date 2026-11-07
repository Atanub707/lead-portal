import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, Plus, Star } from "lucide-react";
import { KindBadge, StatusDot, UserAvatar } from "@/components/badges";
import { CompanyMark } from "@/components/company-mark";
import { EmailComposer } from "@/components/email-composer";
import { LinkedInBadge } from "@/components/icons";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { FindLinkedInButton } from "@/components/find-linkedin-button";
import { FollowUpControl } from "@/components/follow-up-control";
import { SubmitButton } from "@/components/submit-button";
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
  getCompanyEmails,
  getContacts,
  getCurrentProfile,
  getDeepResearchState,
  getEnrichmentRuns,
  getInteractions,
  getMyEmailSettings,
  getPipelines,
  getProfiles,
  getWorkspaceContext,
} from "@/lib/data";
import { reconcileIfStale } from "@/lib/deep-research";
import { CompanyIntelligence } from "@/components/company-intelligence";
import { CompanyBrief } from "@/components/company-brief";
import { CompanyActions } from "@/components/company-actions";
import { ScoreBadge } from "@/components/score-badge";
import { latestBrief } from "@/lib/briefs";
import {
  getCompanySignals,
  getFirmographics,
  getLatestScore,
  getSignalDefinitions,
} from "@/lib/intelligence-data";
import { createClient } from "@/lib/supabase/server";
import {
  CHANNELS,
  KIND_LABEL,
  KIND_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  pipelineName,
  pipelineStages,
  sourceLabel,
  type EmailThread,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type OrgThread = Pick<
  EmailThread,
  "id" | "subject_norm" | "counterparty_email" | "last_message_at" | "unread"
>;

const RUN_KIND_LABEL: Record<string, string> = {
  website_research: "Website research",
  linkedin_roster: "LinkedIn team roster",
  linkedin_profile: "LinkedIn profile details",
  email_search: "Email search",
  deep_research: "Deep research",
  manual: "Manual entry",
};

const EMAIL_KIND_LABEL: Record<string, string> = {
  general: "General",
  personal: "Personal",
  other: "Other",
};

function host(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

interface DeepResearchCompanyFacts {
  phone: string | null;
  address: string | null;
  founded: number | null;
  employees: number | null;
}

function deepResearchCompanyFacts(
  details: Record<string, unknown> | null
): DeepResearchCompanyFacts | null {
  const company = details?.company;
  if (
    typeof company !== "object" ||
    company === null ||
    Array.isArray(company)
  ) {
    return null;
  }
  const record = company as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" && value.trim() !== "" ? value : null;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const facts: DeepResearchCompanyFacts = {
    phone: text(record.phone),
    address: text(record.address),
    founded: count(record.founded),
    employees: count(record.employees),
  };
  if (
    facts.phone === null &&
    facts.address === null &&
    facts.founded === null &&
    facts.employees === null
  ) {
    return null;
  }
  return facts;
}

function Section({
  title,
  count,
  className = "",
  children,
}: {
  title: string;
  count?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="text-[14px] font-semibold text-zinc-900">
        {title}
        {typeof count === "number" ? (
          <span className="ml-2 font-normal text-zinc-400">{count}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export default async function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const companyId = Number(id);
  if (!Number.isFinite(companyId)) notFound();

  // Phase 1: finish a deep-research run whose tab was closed, before the rest
  // of the page data loads — so its merged results appear in this render.
  const supabase = await createClient();
  const deepResearchState = await getDeepResearchState(companyId);
  await reconcileIfStale(supabase, deepResearchState.activeRunId);

  // Phase 2: everything else.
  const [
    company,
    contacts,
    interactions,
    profile,
    pipelines,
    companyEmails,
    enrichmentRuns,
    profiles,
    emailSettings,
    workspaceCtx,
    firmographics,
    companySignals,
    signalDefinitions,
    scoreSnapshot,
    companyBrief,
  ] = await Promise.all([
    getCompany(companyId),
    getContacts(companyId),
    getInteractions(companyId),
    getCurrentProfile(),
    getPipelines(),
    getCompanyEmails(companyId),
    getEnrichmentRuns(companyId),
    getProfiles(),
    getMyEmailSettings(),
    getWorkspaceContext(),
    getFirmographics(companyId),
    getCompanySignals(companyId),
    getSignalDefinitions(),
    getLatestScore(companyId),
    latestBrief(companyId),
  ]);

  if (!company) notFound();

  const orgThreads = profile
    ? ((
        (
          await supabase
            .from("email_threads")
            .select(
              "id, subject_norm, counterparty_email, last_message_at, unread"
            )
            .eq("user_id", profile.id)
            .eq("org_id", company.id)
            .order("last_message_at", { ascending: false })
        ).data ?? []
      ) as OrgThread[])
    : [];

  const labelFor = (id: string | null) => {
    if (!id) return null;
    const person = profiles.find((entry) => entry.id === id);
    if (!person) return null;
    const firstWord = (person.full_name ?? "").trim().split(/\s+/)[0];
    return firstWord || (person.email ? person.email.split("@")[0] : null);
  };
  const addedBy = labelFor(company.created_by);
  const addedByAvatar = company.created_by
    ? (profiles.find((entry) => entry.id === company.created_by)?.avatar ?? null)
    : null;

  const isOwner = profile?.role === "owner";
  const canWrite = workspaceCtx?.canWrite ?? true;
  const pipelineLabel = pipelineName(pipelines, company.list);
  const stages = pipelineStages(pipelines, company.list);
  const defaultFlavor =
    pipelines.find((entry) => entry.id === company.list)?.default_flavor ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const decisionMakers = contacts.filter(
    (contact) => contact.is_decision_maker
  ).length;
  const companyFacts =
    deepResearchState.latest?.status === "ok"
      ? deepResearchCompanyFacts(deepResearchState.latest.details)
      : null;
  const dateOnly = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  const bestContact =
    contacts.find((contact) => contact.is_decision_maker && contact.email) ??
    contacts.find((contact) => Boolean(contact.email)) ??
    null;
  const bestEmail = bestContact?.email ?? companyEmails[0]?.email ?? null;

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <Link
        href={`/companies?list=${company.list}`}
        className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
      >
        ← {pipelineLabel}
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <CompanyMark
            name={company.name}
            website={company.website}
            size={32}
          />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {company.name}
          </h1>
          <ScoreBadge
            score={scoreSnapshot?.total ?? null}
            grade={scoreSnapshot?.grade ?? null}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <KindBadge kind={company.kind} />
          <StatusDot status={company.status} />
          {company.priority ? (
            <span className="text-[12px] capitalize text-zinc-500">
              Priority: {company.priority}
            </span>
          ) : null}
          {company.website ? (
            <a
              className="inline-flex items-center gap-1 text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
              href={company.website}
              target="_blank"
              rel="noreferrer"
            >
              {host(company.website)}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
          {company.linkedin_url ? (
            <a
              className="inline-flex items-center gap-1.5 text-[13px] text-zinc-600 transition-colors hover:text-zinc-900"
              href={company.linkedin_url}
              target="_blank"
              rel="noreferrer"
              title={
                company.linkedin_source === "site"
                  ? "Found on their website"
                  : "Found via verified search — double-check it"
              }
            >
              <LinkedInBadge className="h-4 w-4" />
              LinkedIn
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <div className="mt-4">
          <CompanyActions
            orgId={company.id}
            email={bestEmail}
            contactId={bestContact?.id ?? null}
            contactLabel={bestContact?.name ?? null}
            smtpConfigured={emailSettings.configured}
            canWrite={canWrite}
          />
        </div>
      </header>

      <div className="mt-6">
        {/* ── Main column ──────────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Identity */}
          <Section
            title="Identity"
            className="animate-rise animate-rise-1"
          >
            {company.notes ? (
              <p className="mt-2 max-w-[80ch] whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-700">
                {company.notes}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-zinc-500">
                No description yet — run Paste URL with AI, or add notes in
                Edit details.
              </p>
            )}
            {companyFacts ? (
              <div className="mt-3 rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2.5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  {(
                    [
                      ["Phone", companyFacts.phone],
                      ["Address", companyFacts.address],
                      ["Founded", companyFacts.founded],
                      ["Employees", companyFacts.employees],
                    ] as const
                  )
                    .filter(([, value]) => value !== null)
                    .map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                          {label}
                        </dt>
                        <dd className="mt-1 text-[13px] text-zinc-800 tabular-nums">
                          {label === "Phone" && value ? (
                            <a
                              href={`tel:${String(value).replace(/[^+0-9]/g, "")}`}
                              className="hover:underline"
                            >
                              {value}
                            </a>
                          ) : (
                            value
                          )}
                        </dd>
                      </div>
                    ))}
                </dl>
                <p className="mt-2 text-[11px] text-zinc-400">via deep research</p>
              </div>
            ) : null}
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
              {(
                [
                  ["Type", KIND_LABEL[company.kind]],
                  ["Status", STATUS_LABEL[company.status]],
                  ["Priority", company.priority ?? "—"],
                  ["Added", dateOnly(company.created_at)],
                  ["Added by", addedBy ?? "—"],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[13px] capitalize text-zinc-800 tabular-nums">
                    {label === "Added by" && company.created_by ? (
                      <span className="inline-flex items-center gap-1.5">
                        <UserAvatar
                          seed={company.created_by}
                          name={addedBy}
                          avatar={addedByAvatar}
                          size={18}
                        />
                        {value}
                      </span>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>

          {/* Intelligence */}
          <Section
            title="Intelligence"
            count={companySignals.length}
            className="animate-rise animate-rise-1"
          >
            <CompanyIntelligence
              orgId={company.id}
              firmographics={firmographics}
              signals={companySignals as never}
              definitions={signalDefinitions}
              score={scoreSnapshot}
              canWrite={canWrite}
              hideScan
            />
          </Section>

          {/* AI brief */}
          <Section title="AI brief" className="animate-rise animate-rise-1">
            <CompanyBrief
              orgId={company.id}
              initialBrief={companyBrief}
              canWrite={canWrite}
              showAction={false}
            />
          </Section>

          {/* Reach */}
          <Section
            title="Company emails"
            count={companyEmails.length}
            className="animate-rise animate-rise-1"
          >
            {companyEmails.length === 0 ? (
              <p className="mt-2 text-[13px] text-zinc-500">
                No company emails yet — run Paste URL with AI.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-zinc-100">
                {companyEmails.map((email) => (
                  <li
                    key={email.id}
                    className="flex flex-wrap items-center gap-2 py-2.5"
                  >
                    <Mail
                      className="h-3.5 w-3.5 shrink-0 text-zinc-300"
                      aria-hidden="true"
                    />
                    <a
                      href={`mailto:${email.email}`}
                      className="text-[13px] text-zinc-800 transition-colors hover:text-zinc-950"
                    >
                      {email.email}
                    </a>
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500">
                      {EMAIL_KIND_LABEL[email.kind] ?? email.kind}
                    </span>
                    {email.verified ? (
                      <span className="text-[10px] font-medium text-emerald-600">
                        verified
                      </span>
                    ) : null}
                    <span className="text-[11px] text-zinc-400">
                      via {sourceLabel(email.source)}
                    </span>
                    {canWrite ? (
                      <EmailComposer
                        trigger="button"
                        triggerLabel="Draft"
                        orgId={company.id}
                        defaultTo={email.email}
                        defaultFlavor={defaultFlavor}
                        smtpConfigured={emailSettings.configured}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Emails */}
          {orgThreads.length > 0 ? (
            <Section
              title="Conversations"
              count={orgThreads.length}
              className="animate-rise animate-rise-2"
            >
              <ul className="mt-1 divide-y divide-zinc-100">
                {orgThreads.map((thread) => (
                  <li key={thread.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex w-1.5 shrink-0 justify-center">
                      {thread.unread > 0 ? (
                        <span
                          role="img"
                          aria-label="Unread"
                          className="h-1.5 w-1.5 rounded-full bg-zinc-900"
                        />
                      ) : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/emails/${thread.id}`}
                        className="block truncate text-[13px] text-zinc-800 transition-colors hover:text-zinc-950"
                      >
                        {thread.subject_norm}
                      </Link>
                      <p className="truncate text-[12px] text-zinc-500">
                        {thread.counterparty_email}
                      </p>
                    </div>
                    <time
                      dateTime={thread.last_message_at}
                      className="shrink-0 text-[12px] text-zinc-400 tabular-nums"
                    >
                      {dateOnly(thread.last_message_at)}
                    </time>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* People */}
          <Section
            title="People"
            count={contacts.length}
            className="animate-rise animate-rise-2"
          >
            {decisionMakers > 0 ? (
              <p className="mt-0.5 text-[11px] text-zinc-400">
                {decisionMakers}{" "}
                {decisionMakers === 1 ? "decision maker" : "decision makers"}
              </p>
            ) : null}

            <div className="mt-2 divide-y divide-zinc-100">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-start justify-between gap-3 py-3"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <UserAvatar
                      seed={contact.created_by ?? contact.name}
                      name={contact.name}
                      size={26}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-medium text-zinc-900">
                          {contact.name}
                        </p>
                        {contact.is_decision_maker ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <Star
                              className="h-2.5 w-2.5 fill-amber-500 text-amber-500"
                              aria-hidden="true"
                            />
                            Decision maker
                          </span>
                        ) : null}
                      </div>
                      {contact.title || contact.seniority ? (
                        <p className="truncate text-[12px] text-zinc-500">
                          {[contact.title, contact.seniority]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[12px]">
                        {contact.linkedin_url ? (
                          <a
                            className="inline-flex items-center gap-1.5 text-zinc-500 transition-colors hover:text-zinc-900"
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <LinkedInBadge className="h-3.5 w-3.5" />
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
                        {contact.email_status ? (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] ${
                              contact.email_status === "verified"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-zinc-200 bg-zinc-50 text-zinc-500"
                            }`}
                          >
                            {contact.email_status === "verified"
                              ? "email verified"
                              : contact.email_status === "found"
                                ? "email found"
                                : contact.email_status}
                          </span>
                        ) : null}
                        {contact.phone ? (
                          <span className="text-zinc-500">
                            {contact.phone}
                          </span>
                        ) : null}
                        {canWrite ? (
                          <EmailComposer
                            trigger="button"
                            triggerLabel="Draft email"
                            orgId={company.id}
                            contactId={contact.id}
                            contactLabel={`${contact.name}${
                              contact.title ? ` · ${contact.title}` : ""
                            }`}
                            defaultTo={contact.email ?? null}
                            defaultFlavor={defaultFlavor}
                            smtpConfigured={emailSettings.configured}
                          />
                        ) : null}
                      </div>
                      {canWrite && !contact.linkedin_url ? (
                        <div className="mt-1">
                          <FindLinkedInButton
                            contactId={contact.id}
                            orgId={company.id}
                          />
                        </div>
                      ) : null}
                      {labelFor(contact.created_by) ? (
                        <p className="mt-1 text-[11px] text-zinc-400">
                          Added by {labelFor(contact.created_by)}
                        </p>
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
                  No people yet — run Paste URL with AI, or add one below.
                </p>
              ) : null}
            </div>

            {canWrite ? (
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add person
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
                <SubmitButton pendingText="Adding…">Add person</SubmitButton>
              </form>
              </details>
            ) : null}
          </Section>

          {/* Outreach */}
          <Section
            title="Outreach"
            className="animate-rise animate-rise-2"
          >
            <dl className="mt-3 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Follow-up
                </dt>
                <dd className="mt-1.5">
                  {canWrite ? (
                    <FollowUpControl
                      orgId={company.id}
                      date={company.follow_up_on}
                      note={company.follow_up_note}
                    />
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Next action
                </dt>
                <dd className="mt-1.5 text-[13px] text-zinc-800">
                  {company.next_action ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Last contact
                </dt>
                <dd className="mt-1.5 text-[13px] text-zinc-800 tabular-nums">
                  {company.last_contact ?? "—"}
                </dd>
              </div>
            </dl>
            {company.follow_up_note ? (
              <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-[12px] text-zinc-600">
                Follow-up note: {company.follow_up_note}
              </p>
            ) : null}
          </Section>

          {/* Research log */}
          <Section
            title="Research log"
            count={enrichmentRuns.length}
            className="animate-rise animate-rise-3"
          >
            {enrichmentRuns.length === 0 ? (
              <p className="mt-2 text-[13px] text-zinc-500">
                No research runs logged yet.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-zinc-100">
                {enrichmentRuns.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] text-zinc-800">
                        {RUN_KIND_LABEL[run.kind] ?? run.kind}
                        <span className="ml-2 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500">
                          {sourceLabel(run.source)}
                        </span>
                        {run.kind === "deep_research" &&
                        run.status === "running" ? (
                          <span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                            running
                          </span>
                        ) : null}
                        {run.kind === "deep_research" &&
                        run.status === "failed" ? (
                          <span className="ml-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                            failed
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-[12px] text-zinc-500">
                        {run.people_found}{" "}
                        {run.people_found === 1 ? "person" : "people"}
                        {run.emails_found > 0
                          ? ` · ${run.emails_found} ${
                              run.emails_found === 1 ? "email" : "emails"
                            }`
                          : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-[12px] text-zinc-400 tabular-nums">
                      <p>{dateOnly(run.created_at)}</p>
                      <p>
                        {Number(run.cost_usd) > 0
                          ? `$${Number(run.cost_usd).toFixed(2)}`
                          : "free"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Timeline */}
          <Section
            title="Timeline"
            count={interactions.length}
            className="animate-rise animate-rise-3"
          >
            {canWrite ? (
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
                      Person
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
                  <SubmitButton pendingText="Logging…">
                    Log interaction
                  </SubmitButton>
                </div>
              </form>
              </details>
            ) : null}

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
                      {isOwner && canWrite ? (
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
          </Section>
        </div>

      </div>
    </div>
  );
}
