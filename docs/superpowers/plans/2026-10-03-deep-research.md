# Deep Research (Apify) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When website research finds no decision maker and no reachable contact info, the company page shows a **Deep Research** button that runs a paid Apify pipeline (Apollo-style B2B database + LinkedIn) to find founders'/owners' emails, LinkedIn profiles, and phone numbers, then merges the results with source labels and a cost trail.

**Architecture:** Two Apify actors started asynchronously from a Next.js route handler; run ids stored in the existing `enrichment_runs` row (`status: "running"`); a status endpoint polls Apify, fetches datasets, normalizes, dedupes against existing contacts (reusing `matchEmailToContact`), merges, and finalizes the run with real `cost_usd`. The client polls while the page is open; a lazy reconcile on page load completes runs whose tab was closed. **No new database migration is required** — `contacts`, `company_emails`, `enrichment_runs` already have every column needed.

**Tech Stack:** Next.js 16 route handlers, Supabase (token-bound + admin clients), Apify REST API v2 (plain `fetch`, no SDK dependency), Tailwind/React client components. Verification via node probe scripts + Playwright against the live deploy (this repo has no unit-test framework; follow the established probe/Playwright pattern).

## Global Constraints

- **Website data is always the source of truth.** Never overwrite `contacts.linkedin_url`/`email`/`phone` sourced from the website; only fill gaps. Company LinkedIn from Apify may only fill an EMPTY `organizations.linkedin_url`, with `linkedin_source: "apollo"`.
- **Every paid run is capped:** Apollo-style actor `totalResults: 10`; LinkedIn employees actor `maxItems: 25`. Hard per-run cost ceiling ≈ **$0.15**.
- **Source labels are mandatory:** contacts get `source: "apollo"` or `source: "linkedin"`; company emails get `source: "apollo"`. Never `"website"`.
- **One active run per company**, plus a 7-day cooldown after a successful run (rule enforced server-side, not just hidden in UI).
- **Monthly hard stop:** no new run starts when this month's `deep_research` spend ≥ **$5.00** (`DEEP_RESEARCH_MONTHLY_CAP_USD`). Any member may trigger; pastes never auto-trigger.
- **The button is only for thin companies** (exact rule in Task 5). It must not appear when a decision maker exists.
- **Secrets:** `APIFY_API_TOKEN` already exists in the Vercel project (`lead-portal-9siz`) — confirmed. Add it to `.env.local` and `.env.example`; never commit a value.
- Actor ids (verified on Apify store, Oct 2026):
  - Apollo-style leads: `pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe` ($2/1k on Free plan, $1/1k paid; verified emails + LinkedIn + phones; `countOnly: true` is a **free** pre-flight count).
  - LinkedIn employees: `harvestapi/linkedin-company-employees` (Short mode ≈ $4/1k, `maxItems` cap, start fee $0.02).
- Apify REST endpoints used (token as query param):
  - Start: `POST https://api.apify.com/v2/acts/{actorId}/runs?token=…` → `data.id`, `data.defaultDatasetId`
  - Status: `GET https://api.apify.com/v2/actor-runs/{runId}?token=…` → `data.status`, `data.defaultDatasetId`, `data.usageTotalUsd`
  - Items: `GET https://api.apify.com/v2/datasets/{datasetId}/items?limit=100&token=…`
- Run `npm run lint && npm run build` before every commit. Commit messages: plain imperative, no AI attribution.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/apify.ts` (new) | Thin Apify REST client: start run, get run, get dataset items. No SDK. |
| `src/lib/people.ts` (new) | Shared person helpers: `isDecisionTitle`, `isGenericEmail`, `splitName`. Moves logic out of the paste route so deep research reuses it. |
| `src/lib/deep-research.ts` (new) | Actor ids + input builders, raw-item normalizers, `needsDeepResearch` rule, start/reconcile orchestration, merge engine. |
| `src/app/api/deep-research/route.ts` (new) | `POST` = start run (guards + create run row + start actors); `GET` = status/poll + reconcile when finished. |
| `src/components/deep-research.tsx` (new) | Client card + confirm dialog + polling + running/done states. |
| `src/app/api/paste/route.ts` (modify) | Import `isDecisionTitle` from `people.ts` (delete local regex). |
| `src/app/(app)/companies/[id]/page.tsx` (modify) | Render the card when the rule matches; show deep-research company facts (phone, address, founded, size) in Identity; add log labels + running chip. |
| `src/app/(app)/dashboard/page.tsx` (modify) | Add `deep_research` to `RUN_KIND_LABEL`. |
| `src/lib/data.ts` (modify) | `getDeepResearchState(orgId)` — latest run + active flag (small, focused query). |
| `.env.example` (modify) | `APIFY_API_TOKEN=` line. |
| `DESIGN.md` (modify) | Replace the "paid Apify actor was removed" note with the deep-research tier description. |
| `docs/superpowers/plans/2026-10-03-deep-research.md` | This plan. |

---

### Task 1: Apify client + live probe (discover real field names)

**Files:**
- Create: `src/lib/apify.ts`
- Modify: `.env.example` (add `APIFY_API_TOKEN=` under the other keys)
- Create (temp, not committed): `/var/folders/.../pwtest/apify-probe.mjs`

**Interfaces:**
- Produces: `startActorRun(actorId, input) → { runId, datasetId }`, `getActorRun(runId) → { status, datasetId, usageTotalUsd }`, `getDatasetItems(datasetId, limit?) → unknown[]`

- [ ] **Step 1: Add the token locally.** User adds `APIFY_API_TOKEN=apify_api_…` to `admin-portal/.env.local` (value already in Vercel). Add the empty key to `.env.example`.

- [ ] **Step 2: Write `src/lib/apify.ts`**

```ts
const APIFY_BASE = "https://api.apify.com/v2";

function token(): string {
  const value = process.env.APIFY_API_TOKEN;
  if (!value) throw new Error("Missing APIFY_API_TOKEN");
  return value;
}

export interface ActorRunInfo {
  runId: string;
  datasetId: string;
  status: string;
  usageTotalUsd: number;
}

export async function startActorRun(
  actorId: string,
  input: unknown
): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Apify start failed (${res.status}): ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId };
}

export async function getActorRun(runId: string): Promise<ActorRunInfo> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token()}`);
  if (!res.ok) throw new Error(`Apify run lookup failed (${res.status})`);
  const json = (await res.json()) as {
    data: {
      id: string;
      status: string;
      defaultDatasetId: string;
      usageTotalUsd?: number;
    };
  };
  return {
    runId: json.data.id,
    status: json.data.status,
    datasetId: json.data.defaultDatasetId,
    usageTotalUsd: json.data.usageTotalUsd ?? 0,
  };
}

export async function getDatasetItems(
  datasetId: string,
  limit = 100
): Promise<unknown[]> {
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?limit=${limit}&token=${token()}`
  );
  if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
  return (await res.json()) as unknown[];
}
```

- [ ] **Step 3: Probe both actors with real inputs** (temp script, one small run each — ≈ $0.05 total). Use a company with a known domain, e.g. `qwan.app`:

```js
// /var/folders/.../pwtest/apify-probe.mjs
const token = process.env.APIFY_API_TOKEN;
const start = async (actor, input) => {
  const r = await (await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${token}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  })).json();
  console.log(actor, "→", r.data.id);
  return r.data;
};
const apollo = await start("pipelinelabs/lead-scraper-apollo-zoominfo-lusha-ppe", {
  totalResults: 5, personTitleIncludes: ["Founder", "CEO", "Owner"], includeTitleVariants: true,
  seniorityIncludes: ["c_suite", "owner"], hasEmail: true,
  companyDomainIncludes: ["qwan.app"], companyDomainMatchMode: "strict",
  dontSaveProgress: true, countOnly: false,
});
// wait for terminal state, then dump first 2 raw items with ALL keys:
// GET /v2/actor-runs/{id} → defaultDatasetId → GET /v2/datasets/{id}/items
```

- [ ] **Step 4: Record findings.** Paste the raw JSON key list of one item from each actor into this plan's Task 2 mapping as the fallback chain (do not commit raw personal data — field names only).

- [ ] **Step 5: Verify + commit**

Run: `npm run lint && npm run build` → PASS. Commit `feat: apify client for deep research`.

---

### Task 2: Shared people helpers + normalizers (pure logic, node-verified)

**Files:**
- Create: `src/lib/people.ts`
- Create: `src/lib/deep-research.ts` (normalizers only in this task)
- Modify: `src/app/api/paste/route.ts` (use shared `isDecisionTitle`)
- Test (temp script): `pwtest/normalize-test.mjs` asserting against Task 1 fixtures

**Interfaces:**
- Produces:
  - `isDecisionTitle(title: string | null): boolean`
  - `isGenericEmail(local: string): boolean`
  - `needsDeepResearch(input): boolean` (Task 5 consumes)
  - `normalizeApolloLead(raw): NormalizedLead | null`
  - `normalizeLinkedInEmployee(raw): NormalizedLead | null`
  - `type NormalizedLead = { name; title; email; phone; linkedinUrl; companyLinkedinUrl; companyPhone; companyAddress; companyFounded; employeeCount }`

- [ ] **Step 1: Create `src/lib/people.ts`** — move `DECISION_TITLE` regex from `src/app/api/paste/route.ts` (exact current regex) and export:

```ts
const DECISION_TITLE =
  /\b(ceo|cto|coo|cfo|cmo|cro|cio|founder|co-?founder|owner|president|partner|managing director|general manager|head of|chief|vp|vice president)\b/i;

export function isDecisionTitle(title: string | null): boolean {
  return !!title && DECISION_TITLE.test(title);
}

const GENERIC_LOCALS = new Set([
  "info", "sales", "support", "contact", "admin", "hello", "team", "press",
  "media", "office", "help", "billing", "hr", "jobs", "careers", "marketing",
]);

export function isGenericEmail(local: string): boolean {
  return GENERIC_LOCALS.has(local.toLowerCase());
}
```

Update the paste route: delete its local `DECISION_TITLE`, import `isDecisionTitle` from `@/lib/people`, replace `DECISION_TITLE.test(contact.title)` with `isDecisionTitle(contact.title)`.

- [ ] **Step 2: Create normalizers in `src/lib/deep-research.ts`** — defensive mapping with fallbacks (actor field names vary; Task 1 fixtures pin them). Example for the Apollo actor (adjust keys per probe):

```ts
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

export function normalizeApolloLead(raw: unknown): NormalizedLead | null {
  const r = raw as Record<string, unknown>;
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
    companyLinkedinUrl: str(r.companyLinkedinUrl) ?? str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded: typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}
```

(Implement `normalizeLinkedInEmployee` the same way from its probe keys: `fullName`/`profileUrl`/`currentPositions[0].title` etc. — exact keys recorded in Task 1.)

- [ ] **Step 3: Node-verify with fixtures.** Temp script imports the normalizers via `tsx`-less approach (build once, or test through a tiny API route? — simplest: `npx tsx` is not installed; use `node --experimental-strip-types` if Node ≥ 22 (project runs Node 24) → `node --experimental-strip-types normalize-test.mjs` importing the TS file directly is not supported for path aliases; instead inline-copy the fixture check: run `npx tsc --noEmit` for types + assert behavior in a temp `.mjs` that re-implements nothing — verify through the live endpoint in Task 4 instead). **Concrete check:** fixture with missing fields returns `null` for junk, maps email lowercase, prefers `fullName`.

- [ ] **Step 4: Verify + commit.** `npm run lint && npm run build` → PASS. Commit `feat: shared person helpers + deep research normalizers`.

---

### Task 3: Start endpoint (guards, run row, actor starts)

**Files:**
- Create: `src/app/api/deep-research/route.ts` (POST half)
- Modify: `src/lib/deep-research.ts` (add `startDeepResearch`)
- Modify: `src/lib/data.ts` (add `getDeepResearchState`)

**Interfaces:**
- Produces: `POST /api/deep-research` body `{ orgId: number }` → `{ ok: true, runId: number } | { ok: false, error: string }`
- Produces: `startDeepResearch(supabase, opts: { orgId: number; userId: string; company: { id: number; name: string; website: string | null; linkedin_url: string | null } })` — performs its own guard queries (active run, 7-day cooldown, $5/month cap) internally

- [ ] **Step 1: `getDeepResearchState` in `src/lib/data.ts`**

```ts
export interface DeepResearchState {
  activeRunId: number | null;
  lastSuccessAt: string | null;
  latest: EnrichmentRun | null;
}

export async function getDeepResearchState(orgId: number): Promise<DeepResearchState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrichment_runs")
    .select("*")
    .eq("org_id", orgId)
    .eq("kind", "deep_research")
    .order("created_at", { ascending: false })
    .limit(5);
  const runs = (data ?? []) as EnrichmentRun[];
  return {
    activeRunId: runs.find((r) => r.status === "running")?.id ?? null,
    lastSuccessAt: runs.find((r) => r.status === "ok")?.created_at ?? null,
    latest: runs[0] ?? null,
  };
}
```

- [ ] **Step 2: POST handler with all guards** (auth → org fetch → active-run lock → 7-day cooldown → create row → start actors → save run ids):

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDeepResearch } from "@/lib/deep-research";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const { orgId } = (await request.json()) as { orgId?: number };
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("organizations")
    .select("id, name, website, linkedin_url")
    .eq("id", orgId)
    .maybeSingle();
  if (!company) return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });

  const result = await startDeepResearch(supabase, { orgId, userId, company });
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
```

- [ ] **Step 3: `startDeepResearch` in `src/lib/deep-research.ts`** — performs the guard queries (active run, last success < 7 days), inserts the run row first (`status: "running"`, `details: { actors: [] }`), then starts actors (Apollo always; LinkedIn employees only when `company.linkedin_url` is present), stores `{ slug, runId, datasetId }[]` into `details.actors` via update. If actor start throws: mark run `failed` with the error and return `{ ok: false, error }`. Cost estimate guard: inputs are hard-capped (`totalResults: 10`, `maxItems: 25`).

- [ ] **Step 4: Manual verify** (after deploy in Task 4's harness): POST returns 409 for a company with a fresh successful run; 200 + row with `status:"running"` otherwise.

- [ ] **Step 5: Verify + commit.** `npm run lint && npm run build`. Commit `feat: deep research start endpoint with guards`.

---

### Task 4: Status endpoint + merge engine

**Files:**
- Modify: `src/app/api/deep-research/route.ts` (GET half)
- Modify: `src/lib/deep-research.ts` (add `reconcileDeepResearch` + `mergeLeads`)

**Interfaces:**
- Produces: `GET /api/deep-research?orgId=N` → `{ ok, status: "running" | "ok" | "failed", summary?: { people: number; emails: number; cost: number }, error? }`
- Produces: `reconcileDeepResearch(supabase, runId) → summary`

- [ ] **Step 1: GET handler** — auth; find active run for org via `getDeepResearchState`; if none → `{ ok: true, status: "idle" }`; if run older than 15 min and still running → mark `failed` ("timed out"); else call `reconcileDeepResearch`.

- [ ] **Step 2: `reconcileDeepResearch`** — for each actor in `details.actors`: `getActorRun`; collect statuses. If any terminal (`SUCCEEDED`/`FAILED`/`ABORTED`/`TIMED-OUT`) and none running → fetch dataset items for succeeded runs (limit 100), normalize, merge, compute `cost_usd = Σ usageTotalUsd`, update run: `status: "ok"` (or `"failed"` if zero succeeded), `people_found`, `emails_found`, `details = { actors, company: {...}, found: { people, emails } }`. Return summary. If still running → `{ status: "running" }`.

- [ ] **Step 3: `mergeLeads`** — the rules engine (all reuse existing helpers):

```ts
// 1. Load existing contacts + company_emails for the org.
// 2. Dedupe: skip lead when (a) linkedinUrl matches an existing contact,
//    (b) email matches via matchEmailToContact, (c) lowercased name matches.
// 3. Insert contacts: source "apollo" | "linkedin", is_decision_maker: isDecisionTitle(title),
//    email_status: email ? "found" : null, created_by: userId.
// 4. Emails with a generic local (isGenericEmail) OR unmatched → company_emails
//    (kind: isGenericEmail(local) ? "general" : "personal", source: "apollo"),
//    skip duplicates by email.
// 5. Company fills (only when empty on the org row): linkedin_url → set + linkedin_source "apollo".
//    companyPhone/companyAddress/companyFounded/employeeCount → run details only (display in Identity).
// 6. NEVER touch website-sourced contact fields.
```

- [ ] **Step 4: Live verify** with the Task 3 harness: start a run for a thin test company (e.g. `ReinoLab`, which had 0 people/1 email) → poll GET until `ok` → assert: contacts inserted with `source: "apollo"`, run `cost_usd > 0`, research log shows the run. Cleanup: delete the inserted test rows if the company is not a real target (keep if genuinely useful).

- [ ] **Step 5: Verify + commit.** `npm run lint && npm run build`. Commit `feat: deep research reconcile + merge with source labels`.

---

### Task 5: UI — card, confirm dialog, polling, states

**Files:**
- Create: `src/components/deep-research.tsx` (client)
- Modify: `src/app/(app)/companies/[id]/page.tsx` (render + pass props)

**Interfaces:**
- Consumes: `needsDeepResearch` rule from `src/lib/deep-research.ts` (pure — same rule must be importable in a server component):

```ts
export function needsDeepResearch(input: {
  contacts: { is_decision_maker: boolean; email: string | null; phone: string | null; linkedin_url: string | null }[];
  companyEmailCount: number;
  activeRunId: number | null;
  lastSuccessAt: string | null;
}): boolean {
  if (input.activeRunId) return true; // show the running card instead of the button
  const decisionMaker = input.contacts.some((c) => c.is_decision_maker);
  if (decisionMaker) return false;
  const reachable = input.contacts.filter((c) => c.email || c.phone || c.linkedin_url).length;
  const thin = input.contacts.length === 0 || reachable === 0 || input.companyEmailCount === 0;
  if (!thin) return false;
  if (input.lastSuccessAt && Date.now() - new Date(input.lastSuccessAt).getTime() < 7 * 86_400_000) return false;
  return true;
}
```

- [ ] **Step 1: Component states**
  - **Idle (button):** a bordered card placed directly under the Identity card: title "No founder or contact info found on their website." + subtext "Deep research searches paid B2B sources (Apollo-style database + LinkedIn) for decision makers, emails and phones." + `Deep Research` primary button. Small print: "Runs on paid Apify actors — capped at ~$0.15 per run."
  - **Confirm dialog** (portal, `animate-panel`, same pattern as `ConfirmSubmit`): what it will do, capped estimate, then on confirm → `POST /api/deep-research`; show pending state.
  - **Running:** spinner + "Searching B2B databases… usually 1–3 minutes. You can leave this page — results are saved." Polls `GET /api/deep-research?orgId=` every 5 s. On `ok` → `router.refresh()` + success line "Found N people · M emails · $X.XX".
  - **Failed:** rose banner + "Try again" (re-POST; cooldown only applies after success).
- [ ] **Step 2: Wire into `page.tsx`:** fetch `getDeepResearchState(companyId)` alongside existing data; compute the rule with `contacts`, `companyEmailCount`, state; render `<DeepResearch orgId={company.id} initialActiveRun={...} />` when `needsDeepResearch(...)` is true.
- [ ] **Step 3: Accessibility/motion:** dialog focus + Escape + backdrop close; `motion-reduce` respected; button pending spinner (`Loader2`), no layout shift.
- [ ] **Step 4: Live verify (Playwright):** login as owner test user → open `ReinoLab` → button visible → dialog → confirm → running state → results appear (People/Reach populated) → screenshot.
- [ ] **Step 5: Verify + commit.** `npm run lint && npm run build`. Commit `feat: deep research button + dialog + live status`.

---

### Task 6: Company page facts + log labels

**Files:**
- Modify: `src/app/(app)/companies/[id]/page.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` (`RUN_KIND_LABEL.deep_research = "Deep research (Apify)"`)

- [ ] **Step 1:** Add `deep_research: "Deep research (Apify)"` to the company page's `RUN_KIND_LABEL` map; render a `running` chip (amber, pulsing dot) when `run.status === "running"`, and `failed` (rose) when failed.
- [ ] **Step 2:** Identity card: when the latest successful deep-research run has `details.company`, show extra facts as small rows under the description: Phone / Address / Founded / Employees — each labeled "via Apify". Never overwrite `notes`.
- [ ] **Step 3:** Reach card: nothing new (emails already render from `company_emails`); People card: nothing new (contacts render with existing badges).
- [ ] **Step 4: Verify + commit.** `npm run lint && npm run build`; screenshot company page with results. Commit `feat: deep research facts + log labels`.

---

### Task 7: Lazy reconcile + failure hygiene

**Files:**
- Modify: `src/app/(app)/companies/[id]/page.tsx` (server-side reconcile on load)
- Modify: `src/lib/deep-research.ts` (timeout guard helper)

- [ ] **Step 1:** On page load, if `getDeepResearchState` returns an `activeRunId` and the run's `created_at` is older than 30 s, call `reconcileDeepResearch` before rendering (so a closed tab still finishes; the 30 s floor avoids polling on the same request that just started it).
- [ ] **Step 2:** Wrap reconcile in try/catch — a failing Apify call must never break the page render; leave the run `running` and retry next visit. Timeout: runs older than 15 min → `failed` with `details.error = "timed out"`.
- [ ] **Step 3: Verify:** start a run, close the tab immediately, re-open the company page after 2 min → results merged.
- [ ] **Step 4: Verify + commit.** Commit `feat: lazy deep research reconcile`.

---

### Task 8: Cost guardrails + docs + final E2E

**Files:**
- Modify: `src/components/deep-research.tsx` (month spend line)
- Modify: `DESIGN.md`, `.env.example`, `README.md` (env table)
- Modify: `src/lib/data.ts` (`getDeepResearchMonthSpend`)

- [ ] **Step 1:** `getDeepResearchMonthSpend()` — sum `cost_usd` of `kind = "deep_research"` runs since the 1st of the month; show in the confirm dialog: "This month's deep research spend: $X.XX". (Advisory only — hard caps are the input limits.)
- [ ] **Step 2:** DESIGN.md: replace the "paid Apify actor was removed (2026-10)" bullet with: website-first stays free; **Deep Research is the only paid tier**, manual, capped, source-labeled, logged with real cost.
- [ ] **Step 3: Full live E2E (Playwright, owner test user):** thin company → button → dialog → run → results → log entry with cost → button gone (decision maker found) → run again on a company with a fresh success → blocked by cooldown (server-side 409). Screenshot the results.
- [ ] **Step 4:** Cleanup: delete test users; leave merged real data.
- [ ] **Step 5:** `npm run lint && npm run build`; commit `feat: deep research cost guardrails + docs`.

---

## Self-Review

- **Spec coverage:** button only when thin (Task 5 rule + Task 3 server-side re-check) ✓; Apollo/Apify pipeline (Tasks 1–4) ✓; founder email/LinkedIn/phone (normalizers + merge) ✓; "properly shown" results in People/Reach/Identity/Research log (Tasks 4–6) ✓; plan-first (this document) ✓.
- **Placeholder scan:** actor field names are the one genuine unknown — Task 1 probes them and Task 2 has explicit fallback chains, so no step depends on an unnamed field.
- **Type consistency:** `NormalizedLead`, `ActorRunInfo`, `DeepResearchState`, `needsDeepResearch`, `reconcileDeepResearch` names are identical across tasks.
- **No migration needed** — verified against `20261002060000_leadgen_schema.sql` (runs table has `status`, `details`, `cost_usd`; contacts have `source`, `email_status`, `phone`).

## Confirmed decisions (locked 2026-10-03)

1. **Budget cap:** hard stop at **$5.00/month** — `startDeepResearch` refuses when the month's `deep_research` `cost_usd` sum ≥ 5; the dialog shows current month spend. Constant `DEEP_RESEARCH_MONTHLY_CAP_USD = 5` in `src/lib/deep-research.ts` (single place to raise later).
2. **Who can trigger:** **any member** (editor or owner) — only the auth check applies; no role gate.
3. **Trigger mode:** **manual only** — the button is the sole trigger; pastes never auto-spend.
