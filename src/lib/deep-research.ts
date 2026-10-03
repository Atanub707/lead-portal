import type { SupabaseClient } from "@supabase/supabase-js";
import { getActorRun, getDatasetItems, startActorRun } from "./apify";
import { matchEmailToContact } from "./match";
import { isDecisionTitle, isGenericEmail } from "./people";
import { createAdminClient } from "./supabase/admin";

export interface NormalizedLead {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  companyFounded: number | null;
  employeeCount: number | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fromRecord(value: unknown, keys: string[]): string | null {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    for (const key of keys) {
      const found = str(record[key]);
      if (found) return found;
    }
  }
  return null;
}

export function normalizeApolloLead(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  return {
    name,
    title: str(r.title) ?? str(r.jobTitle) ?? str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.linkedin) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      str(r.companyLinkedinUrl) ?? str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}

export function needsDeepResearch(input: {
  contacts: {
    is_decision_maker: boolean;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
  }[];
  companyEmailCount: number;
  activeRunId: number | null;
  lastSuccessAt: string | null;
}): boolean {
  if (input.activeRunId) return true; // show the running card instead of the button
  const decisionMaker = input.contacts.some((c) => c.is_decision_maker);
  if (decisionMaker) return false;
  const reachable = input.contacts.filter(
    (c) => c.email || c.phone || c.linkedin_url
  ).length;
  const thin =
    input.contacts.length === 0 || reachable === 0 || input.companyEmailCount === 0;
  if (!thin) return false;
  if (
    input.lastSuccessAt &&
    Date.now() - new Date(input.lastSuccessAt).getTime() < 7 * 86_400_000
  ) {
    return false;
  }
  return true;
}

export function normalizeLinkedInEmployee(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  const positions = r.currentPosition ?? r.currentPositions;
  return {
    name,
    title:
      str(r.title) ??
      str(r.jobTitle) ??
      fromRecord(positions, ["title"]) ??
      fromRecord(r.experience, ["position", "title"]) ??
      str(r.position) ??
      str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.profileUrl) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      fromRecord(positions, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      fromRecord(r.experience, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      str(r.companyLinkedinUrl) ??
      str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}

export const APOLLO_ACTOR = "pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe";
export const LINKEDIN_EMPLOYEES_ACTOR = "harvestapi/linkedin-company-employees";
export const DEEP_RESEARCH_MONTHLY_CAP_USD = 5;
const DEEP_RESEARCH_ESTIMATED_RUN_USD = 0.15;
// A reconcile claim older than this is treated as abandoned and reset.
export const RECONCILE_CLAIM_STALE_MS = 5 * 60_000;
// A run older than this is always failed, never reset or re-claimed.
const RUN_TIMEOUT_MS = 15 * 60_000;

// Claim timestamp lives in details.claim_at (jsonb) — no schema change needed.
// Only a parsable timestamp inside the stale window counts as a live owner.
export function isFreshReconcileClaim(details: unknown): boolean {
  const claimAt = asRecord(details)?.claim_at;
  if (typeof claimAt !== "string") return false;
  const claimedAtMs = Date.parse(claimAt);
  if (!Number.isFinite(claimedAtMs)) return false;
  // Future-dated claims are clock skew, not liveness: treat them as stale so
  // they can't block recovery until the clock catches up.
  const claimAgeMs = Date.now() - claimedAtMs;
  return claimAgeMs >= 0 && claimAgeMs <= RECONCILE_CLAIM_STALE_MS;
}

export function apolloInput(company: { name: string; website: string | null }) {
  let domain: string | null = null;
  if (company.website) {
    try {
      domain = new URL(company.website).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }
  return {
    totalResults: 10,
    personTitleIncludes: [
      "Founder",
      "Co-Founder",
      "CEO",
      "Owner",
      "Managing Director",
    ],
    includeTitleVariants: true,
    seniorityIncludes: ["c_suite", "owner"],
    hasEmail: true,
    companyDomainIncludes: domain ? [domain] : undefined,
    companyDomainMatchMode: "strict",
    companyNameIncludes: domain ? undefined : [company.name],
    companyNameMatchMode: "phrase",
    dontSaveProgress: true,
    countOnly: false,
  };
}

export function linkedinEmployeesInput(companyLinkedinUrl: string) {
  return {
    companies: [companyLinkedinUrl],
    maxItems: 25,
    profileScraperMode: "Short ($4 per 1k)",
  };
}

export type StartDeepResearchResult =
  | { ok: true; runId: number }
  | { ok: false; error: string };

interface DeepResearchCompany {
  id: number;
  name: string;
  website: string | null;
  linkedin_url: string | null;
}

const DAY_MS = 86_400_000;

export async function startDeepResearch(
  supabase: SupabaseClient,
  opts: { orgId: number; userId: string; company: DeepResearchCompany }
): Promise<StartDeepResearchResult> {
  const { orgId, userId, company } = opts;

  // Guard 1: one active run per company ("reconciling" is an active claim too).
  const { data: activeRuns } = await supabase
    .from("enrichment_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .in("status", ["running", "reconciling"])
    .limit(1);
  if (activeRuns && activeRuns.length > 0) {
    return {
      ok: false,
      error: "Deep research is already running for this company.",
    };
  }

  // Guard 2: 7-day cooldown after the last successful run.
  const { data: successRuns } = await supabase
    .from("enrichment_runs")
    .select("created_at")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .eq("status", "ok")
    .order("created_at", { ascending: false })
    .limit(1);
  const lastSuccessAt = successRuns?.[0]?.created_at as string | undefined;
  if (lastSuccessAt) {
    const remaining =
      7 * DAY_MS - (Date.now() - new Date(lastSuccessAt).getTime());
    if (remaining > 0) {
      const days = Math.ceil(remaining / DAY_MS);
      return {
        ok: false,
        error: `Deep research ran recently — try again in ${days} day${
          days === 1 ? "" : "s"
        }.`,
      };
    }
  }

  // Guard 3: hard monthly budget across all companies.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: monthRuns } = await supabase
    .from("enrichment_runs")
    .select("cost_usd, status")
    .eq("kind", "deep_research")
    .gte("created_at", monthStart.toISOString());
  const finalizedSpend = (monthRuns ?? []).reduce(
    (sum, run) => sum + Number(run.cost_usd ?? 0),
    0
  );
  const inFlightRuns = (monthRuns ?? []).filter(
    (run) => run.status === "running" || run.status === "reconciling"
  ).length;
  const monthSpend =
    finalizedSpend + inFlightRuns * DEEP_RESEARCH_ESTIMATED_RUN_USD;
  if (monthSpend >= DEEP_RESEARCH_MONTHLY_CAP_USD) {
    return {
      ok: false,
      error: `Monthly deep research budget ($${DEEP_RESEARCH_MONTHLY_CAP_USD}) reached.`,
    };
  }

  // Run-row writes use the admin client: enrichment_runs has no RLS UPDATE
  // policy, so user-scoped updates would silently affect 0 rows. Guards above
  // stay on the user client (select policy allows them).
  const admin = createAdminClient();

  // Lock the company before spending: insert the running row first.
  const { data: run, error: insertError } = await admin
    .from("enrichment_runs")
    .insert({
      org_id: orgId,
      kind: "deep_research",
      source: "apify",
      status: "running",
      details: { actors: [] },
      created_by: userId,
    })
    .select("id")
    .single();
  if (insertError || !run) {
    console.error("[deep-research] run insert failed:", insertError?.message);
    return {
      ok: false,
      error: "Couldn't start deep research. Please try again.",
    };
  }

  // Double-submit TOCTOU: the guards above are read-then-act, so two tabs can
  // both pass them. Let the oldest active run win (id breaks created_at ties);
  // the younger row is marked failed before any actor is started. A read error
  // fails closed — without proof we won the race, never start actors.
  const { data: activeAfterInsert, error: activeReadError } = await supabase
    .from("enrichment_runs")
    .select("id")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .in("status", ["running", "reconciling"])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (activeReadError) {
    console.error(
      "[deep-research] active-run recheck failed:",
      activeReadError.message
    );
  }
  const lostRace =
    Boolean(activeReadError) ||
    Boolean(
      activeAfterInsert &&
        activeAfterInsert.length > 0 &&
        activeAfterInsert[0].id !== run.id
    );
  if (lostRace) {
    await admin
      .from("enrichment_runs")
      .update({
        status: "failed",
        details: { actors: [], error: "duplicate start" },
      })
      .eq("id", run.id);
    return {
      ok: false,
      error: "Deep research is already running for this company.",
    };
  }

  const actors: { slug: string; runId: string; datasetId: string }[] = [];
  try {
    const apollo = await startActorRun(APOLLO_ACTOR, apolloInput(company));
    actors.push({ slug: APOLLO_ACTOR, ...apollo });
    if (company.linkedin_url) {
      const linkedin = await startActorRun(
        LINKEDIN_EMPLOYEES_ACTOR,
        linkedinEmployeesInput(company.linkedin_url)
      );
      actors.push({ slug: LINKEDIN_EMPLOYEES_ACTOR, ...linkedin });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[deep-research] actor start failed:", message);
    await admin
      .from("enrichment_runs")
      .update({ status: "failed", details: { actors, error: message } })
      .eq("id", run.id);
    return {
      ok: false,
      error: "Couldn't start deep research. Please try again.",
    };
  }

  await admin
    .from("enrichment_runs")
    .update({ details: { actors } })
    .eq("id", run.id);

  return { ok: true, runId: run.id as number };
}

// ─── Reconcile (poll Apify, fetch, normalize, merge, finalize) ───────────────

export interface DeepResearchSummary {
  people: number;
  emails: number;
  cost: number;
}

export type ReconcileDeepResearchResult =
  | { ok: true; status: "running" }
  | { ok: true; status: "ok" | "failed"; summary: DeepResearchSummary };

interface DeepResearchActorRef {
  slug: string;
  runId: string;
  datasetId: string;
}

const TERMINAL_RUN_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

function actorNormalizer(slug: string): ((raw: unknown) => NormalizedLead | null) | null {
  if (slug === APOLLO_ACTOR) return normalizeApolloLead;
  if (slug === LINKEDIN_EMPLOYEES_ACTOR) return normalizeLinkedInEmployee;
  return null;
}

export async function reconcileDeepResearch(
  supabase: SupabaseClient,
  runId: number
): Promise<ReconcileDeepResearchResult> {
  const { data: run } = await supabase
    .from("enrichment_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) throw new Error("Deep research run not found");

  // Another tab may own the reconcile ("reconciling"), or may have finalized
  // this run since `getDeepResearchState` was read.
  if (run.status === "reconciling") return { ok: true, status: "running" };
  if (run.status !== "running") {
    return {
      ok: true,
      status: run.status === "ok" ? "ok" : "failed",
      summary: {
        people: Number(run.people_found ?? 0),
        emails: Number(run.emails_found ?? 0),
        cost: Number(run.cost_usd ?? 0),
      },
    };
  }

  // Defense in depth: a run past the 15-min wall is failed even if a caller
  // skipped the GET/lazy stale guards — never reset and re-claimed.
  if (Date.now() - new Date(run.created_at).getTime() > RUN_TIMEOUT_MS) {
    const cost = await failTimedOutRun(run);
    return {
      ok: true,
      status: "failed",
      summary: {
        people: Number(run.people_found ?? 0),
        emails: Number(run.emails_found ?? 0),
        cost,
      },
    };
  }

  // Atomic claim: only the caller that flips running → reconciling owns this
  // reconcile (and therefore the merge). Losers get 0 rows and return a
  // running-style result without merging. The claim timestamp rides in
  // details.claim_at so staleness needs no schema change.
  const admin = createAdminClient();
  const { data: claimed } = await admin
    .from("enrichment_runs")
    .update({
      status: "reconciling",
      details: {
        ...((run.details as Record<string, unknown> | null) ?? {}),
        claim_at: new Date().toISOString(),
      },
    })
    .eq("id", run.id)
    .eq("status", "running")
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true, status: "running" };

  const actorRefs = ((run.details?.actors ?? []) as DeepResearchActorRef[]).filter(
    (actor) => actor?.runId
  );
  // The POST inserts the row before actors are persisted; the claim is held
  // until the run ids land (or the timeout/stale-reset paths recover it).
  if (actorRefs.length === 0) return { ok: true, status: "running" };

  const infos = await Promise.all(actorRefs.map((actor) => getActorRun(actor.runId)));
  if (infos.some((info) => !TERMINAL_RUN_STATUSES.has(info.status))) {
    return { ok: true, status: "running" };
  }

  const leads: DeepResearchLead[] = [];
  for (let i = 0; i < actorRefs.length; i += 1) {
    const info = infos[i];
    if (info.status !== "SUCCEEDED") continue;
    const normalize = actorNormalizer(actorRefs[i].slug);
    if (!normalize) continue;
    const items = await getDatasetItems(info.datasetId || actorRefs[i].datasetId, 100);
    for (const item of items) {
      const lead = normalize(item);
      if (lead) {
        leads.push({
          lead,
          source: actorRefs[i].slug === APOLLO_ACTOR ? "apollo" : "linkedin",
        });
      }
    }
  }

  const succeeded = infos.filter((info) => info.status === "SUCCEEDED").length;
  const cost = infos.reduce((sum, info) => sum + info.usageTotalUsd, 0);
  const { people, emails, company } = await mergeLeads(supabase, {
    orgId: run.org_id as number,
    userId: (run.created_by as string | null) ?? null,
    leads,
  });

  const status = succeeded > 0 ? "ok" : "failed";
  const { error } = await admin
    .from("enrichment_runs")
    .update({
      status,
      people_found: people,
      emails_found: emails,
      cost_usd: cost,
      details: { actors: actorRefs, company, found: { people, emails } },
    })
    .eq("id", run.id);
  if (error) throw new Error(error.message);

  return { ok: true, status, summary: { people, emails, cost } };
}

// Lazy finalization for runs whose tab was closed. A run younger than this is
// left alone so a page load moments after starting doesn't poll Apify twice.
const RECONCILE_MIN_AGE_MS = 30_000;

// Best-effort Apify usage for a run that never finalized, so a timed-out run
// still records what it spent. Each actor lookup fails independently.
export async function sumActorUsageUsd(details: unknown): Promise<number> {
  const raw = (details as { actors?: unknown } | null)?.actors;
  const actors = Array.isArray(raw) ? (raw as { runId?: string }[]) : [];
  let total = 0;
  for (const actor of actors) {
    if (!actor?.runId) continue;
    try {
      const info = await getActorRun(actor.runId);
      total += info.usageTotalUsd;
    } catch (err) {
      console.error(
        "[deep-research] timeout cost lookup failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return total;
}

// Shared timeout exit: record whatever in-flight Apify cost is fetchable, then
// fail the run with the "timed out" details the route has always written.
// Returns the fetched cost so callers can include it in their summary.
export async function failTimedOutRun(run: {
  id: number;
  details: unknown;
}): Promise<number> {
  const cost = await sumActorUsageUsd(run.details);
  const admin = createAdminClient();
  await admin
    .from("enrichment_runs")
    .update({
      status: "failed",
      cost_usd: cost,
      details: {
        ...((run.details as Record<string, unknown> | null) ?? {}),
        error: "timed out",
      },
    })
    .eq("id", run.id);
  return cost;
}

type ObservedClaimAt =
  | { kind: "iso"; value: string }
  | { kind: "missing" }
  | { kind: "malformed" };

function observedClaimAt(details: unknown): ObservedClaimAt {
  const claimAt = asRecord(details)?.claim_at;
  if (claimAt === null || claimAt === undefined) return { kind: "missing" };
  if (typeof claimAt === "string" && Number.isFinite(Date.parse(claimAt))) {
    return { kind: "iso", value: claimAt };
  }
  return { kind: "malformed" };
}

// Claim-value CAS: release a stale reconcile claim only when details.claim_at
// still equals the value observed by the caller. A malformed or mismatched
// claim is never reset — returning false means "someone else acted first".
export async function resetStaleReconcileClaim(run: {
  id: number;
  details: unknown;
}): Promise<boolean> {
  const claim = observedClaimAt(run.details);
  if (claim.kind === "malformed") return false;
  const admin = createAdminClient();
  const reset = admin
    .from("enrichment_runs")
    .update({
      status: "running",
      details: {
        ...((run.details as Record<string, unknown> | null) ?? {}),
        claim_at: null,
      },
    })
    .eq("id", run.id)
    .eq("status", "reconciling");
  const { data } = await (claim.kind === "iso"
    ? reset.eq("details->>claim_at", claim.value)
    : reset.is("details->>claim_at", null)
  ).select("id");
  return data?.length === 1;
}

export async function reconcileIfStale(
  supabase: SupabaseClient,
  activeRunId: number | null
): Promise<void> {
  if (activeRunId === null) return;

  const { data: run } = await supabase
    .from("enrichment_runs")
    .select("id, status, created_at, details")
    .eq("id", activeRunId)
    .maybeSingle();
  if (!run) return;

  const ageMs = Date.now() - new Date(run.created_at).getTime();

  // Mirror the GET route: read with the user client, fail the run with admin
  // (no RLS UPDATE policy). Never let a lazy failure break the page render.
  const failLazily = async () => {
    try {
      await failTimedOutRun(run);
    } catch (err) {
      console.error(
        "[deep-research] lazy timeout failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  if (run.status === "reconciling") {
    // A fresh claim belongs to another tab; a missing/malformed/old one means
    // the holder died. A run past the 15-min wall takes the timeout path
    // instead of a reset — resetting would let a zombie cycle reset→claim
    // forever and never be observed as timed out.
    if (isFreshReconcileClaim(run.details)) return;
    if (ageMs > RUN_TIMEOUT_MS) {
      await failLazily();
      return;
    }
    // Claim-value CAS: only release the exact claim observed above. 0 rows
    // means another request reset (or re-claimed) first — leave it alone.
    const released = await resetStaleReconcileClaim(run);
    if (!released) return;
  } else if (run.status === "running" && ageMs > RUN_TIMEOUT_MS) {
    await failLazily();
    return;
  }

  if (ageMs > RECONCILE_MIN_AGE_MS) {
    try {
      await reconcileDeepResearch(supabase, activeRunId);
    } catch (err) {
      console.error(
        "[deep-research] lazy reconcile failed:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// ─── Merge (dedupe + insert contacts/emails + fill empty org fields) ─────────

export interface DeepResearchLead {
  lead: NormalizedLead;
  source: "apollo" | "linkedin";
}

export interface MergedCompanyFacts {
  phone: string | null;
  address: string | null;
  founded: number | null;
  employees: number | null;
  linkedin_url: string | null;
}

export interface MergeLeadsResult {
  people: number;
  emails: number;
  company: MergedCompanyFacts;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function linkKey(url: string | null): string {
  return (url ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function emailKey(email: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export async function mergeLeads(
  supabase: SupabaseClient,
  opts: { orgId: number; userId: string | null; leads: DeepResearchLead[] }
): Promise<MergeLeadsResult> {
  const { orgId, userId, leads } = opts;

  const [contactsRes, companyEmailsRes, orgRes] = await Promise.all([
    supabase.from("contacts").select("name, linkedin_url, email").eq("org_id", orgId),
    supabase.from("company_emails").select("email").eq("org_id", orgId),
    supabase.from("organizations").select("linkedin_url").eq("id", orgId).maybeSingle(),
  ]);

  const failedRead = [
    { label: "contacts", error: contactsRes.error },
    { label: "company_emails", error: companyEmailsRes.error },
    { label: "organizations", error: orgRes.error },
  ].find((read) => read.error);
  if (failedRead) {
    console.error(
      `[deep-research] ${failedRead.label} read failed:`,
      failedRead.error?.message
    );
    throw new Error(`Couldn't load existing ${failedRead.label} for merge.`);
  }

  const existingContacts = (contactsRes.data ?? []) as {
    name: string;
    linkedin_url: string | null;
    email: string | null;
  }[];
  const existingCompanyEmails = (companyEmailsRes.data ?? []) as { email: string }[];

  const seenNames = new Set(existingContacts.map((contact) => nameKey(contact.name)));
  const seenLinks = new Set(
    existingContacts.map((contact) => linkKey(contact.linkedin_url)).filter(Boolean)
  );
  const contactEmails = new Set(
    existingContacts
      .map((contact) => emailKey(contact.email))
      .filter((email): email is string => Boolean(email))
  );
  const knownEmails = new Set([
    ...contactEmails,
    ...existingCompanyEmails.map((row) => row.email.toLowerCase()),
  ]);

  // Firmographic extras ride on the run details only; first non-null wins.
  const company: MergedCompanyFacts = {
    phone: null,
    address: null,
    founded: null,
    employees: null,
    linkedin_url: null,
  };
  for (const { lead } of leads) {
    if (!company.phone) company.phone = lead.companyPhone;
    if (!company.address) company.address = lead.companyAddress;
    if (company.founded === null) company.founded = lead.companyFounded;
    if (company.employees === null) company.employees = lead.employeeCount;
    if (!company.linkedin_url) company.linkedin_url = lead.companyLinkedinUrl;
  }

  const newContacts: Record<string, unknown>[] = [];
  const newCompanyEmails = new Map<string, "general" | "personal">();
  let contactEmailCount = 0;

  for (const { lead, source } of leads) {
    const byName = nameKey(lead.name);
    const byLink = linkKey(lead.linkedinUrl);
    const email = emailKey(lead.email);
    const local = email?.split("@")[0] ?? null;
    const generic = local ? isGenericEmail(local) : false;

    const duplicate =
      (byLink !== "" && seenLinks.has(byLink)) ||
      seenNames.has(byName) ||
      (email !== null &&
        (contactEmails.has(email) ||
          matchEmailToContact(lead.name, [...contactEmails]) !== null));

    if (!duplicate) {
      // Generic inboxes are company reach, never a person's email.
      const contactEmail = email && !generic ? email : null;
      newContacts.push({
        org_id: orgId,
        name: lead.name,
        title: lead.title,
        linkedin_url: lead.linkedinUrl,
        email: contactEmail,
        phone: lead.phone,
        source,
        is_decision_maker: isDecisionTitle(lead.title),
        email_status: contactEmail ? "found" : null,
        created_by: userId,
      });
      seenNames.add(byName);
      if (byLink) seenLinks.add(byLink);
      if (contactEmail) {
        contactEmails.add(contactEmail);
        knownEmails.add(contactEmail);
        contactEmailCount += 1;
      }
      if (email && generic && !knownEmails.has(email)) {
        newCompanyEmails.set(email, "general");
        knownEmails.add(email);
      }
      continue;
    }

    // Duplicate person: a new email is still reachable company data.
    if (email && !knownEmails.has(email)) {
      newCompanyEmails.set(email, generic ? "general" : "personal");
      knownEmails.add(email);
    }
  }

  if (newContacts.length > 0) {
    let { error } = await supabase.from("contacts").insert(newContacts);
    if (error && /created_by/.test(error.message)) {
      // Attribution column not migrated yet — insert without it so people still land.
      const stripped = newContacts.map((row) => {
        const copy = { ...row };
        delete copy.created_by;
        return copy;
      });
      ({ error } = await supabase.from("contacts").insert(stripped));
    }
    if (error) {
      console.error("[deep-research] contact insert failed:", error.message);
      throw new Error("Couldn't save researched contacts.");
    }
  }

  let companyEmailCount = 0;
  if (newCompanyEmails.size > 0) {
    const rows = [...newCompanyEmails].map(([email, kind]) => ({
      org_id: orgId,
      email,
      kind,
      source: "apollo",
    }));
    const { error } = await supabase
      .from("company_emails")
      .upsert(rows, { onConflict: "org_id,email", ignoreDuplicates: true });
    if (error) {
      console.error("[deep-research] company email insert failed:", error.message);
      throw new Error("Couldn't save researched emails.");
    }
    companyEmailCount = rows.length;
  }

  const orgLinkedin =
    ((orgRes.data as { linkedin_url: string | null } | null)?.linkedin_url) ?? null;
  if (!orgLinkedin && company.linkedin_url) {
    const { error } = await supabase
      .from("organizations")
      .update({ linkedin_url: company.linkedin_url, linkedin_source: "apollo" })
      .eq("id", orgId)
      .is("linkedin_url", null);
    if (error) {
      console.error("[deep-research] org linkedin fill failed:", error.message);
    }
  }

  return {
    people: newContacts.length,
    emails: contactEmailCount + companyEmailCount,
    company,
  };
}
