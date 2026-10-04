# Multi-Tenant Workspaces — Plan 2: Signup, Onboarding, Trial, Super-Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can sign up themselves, create their workspace, invite their team, and use everything under a 14-day trial that locks writes when it ends. The owner gets a super-admin switcher with read-only cross-workspace views and logged access.

**Architecture:** Clerk sign-ups open; `ensureProfile` stops defaulting to HI Labs (null workspace → onboarding); `/onboarding` creates the workspace + starter pipeline; invites carry `workspace_id` in Clerk metadata (already read by `ensureProfile`); trial state drives a banner + `canWrite` plumbing; super-admin views use an `activeWorkspaceId()` (cookie override) with explicit `.eq("workspace_id", …)` filters in data helpers, read-only by policy.

**Tech Stack:** Clerk (config + invitations), Next.js server actions + cookies, Supabase RLS (Plan 1 already enforces isolation + trial gate on writes), Playwright verification.

**Spec:** `docs/superpowers/specs/2026-10-04-multi-tenant-design.md` · **Plan 1 (done):** `docs/superpowers/plans/2026-10-04-multi-tenant-foundation.md`

## Global Constraints

- **RLS already enforces:** workspace isolation, trial write-lock, super-admin read-only. App-level `canWrite`/UI hiding is UX, not security.
- **`canWrite` semantics:** own workspace → `trialOk`; super-admin viewing a customer workspace → `false` (read-only). Super-admin writing their OWN workspace works via normal owner policies (my_workspace() = HI Labs).
- **Trial copy:** `Trial: N days left — contact us to continue` (≤7 days) · `Trial: last day` (≤1 day) · `Trial ended — contact us to continue` (expired). Contact = `atanub707@gmail.com` (constant `CONTACT_EMAIL`).
- **Super-admin viewing:** cookie `view_workspace` (uuid); default = own workspace. `activeWorkspaceId()` = cookie if super-admin and set, else `profile.workspace_id`.
- **`superadmin.view` audit:** logged into the VIEWED workspace's `activity_log` (admin client, `workspaceId` override) on each app-layout navigation while viewing a customer workspace.
- **Invite metadata:** `{ role, workspace_id }`; 1-day expiry stays; owner-only (workspace owner — `is_owner()` semantics from Plan 1).
- No new dependencies. `npm run lint && npm run build` before every commit.

---

### Task 1: Open signup + onboarding gate

**Files:**
- Modify: `src/lib/auth.ts` (`ensureProfile`: no HI Labs fallback), `src/app/(app)/layout.tsx` (gate), `src/proxy.ts` if needed for route access
- Clerk config (CLI)

**Interfaces:**
- `ensureProfile` workspace resolution: `metadata.workspace_id` (string) → that workspace; else **null**.
- Gate in `(app)/layout.tsx`: after `getCurrentProfile()`, if `profile.workspace_id === null` → `redirect("/onboarding")`.

- [ ] **Step 1:** Clerk: `npx clerk config patch` — set `sign_up_mode` to public (open signup) on the dev instance (same CLI flow used for `restricted`). Verify via `clerk config pull`.
- [ ] **Step 2:** `ensureProfile` change (drop `HI_LABS_WORKSPACE_ID` fallback; keep metadata read). Existing HI Labs users unaffected (workspace already set).
- [ ] **Step 3:** `(app)/layout.tsx` gate — `redirect("/onboarding")` when workspace_id is null. Keep `ensureProfile` first (it creates the profile on first login).
- [ ] **Step 4:** lint+build; commit `feat: open signup + onboarding gate`.

---

### Task 2: `/onboarding` — create your workspace

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/onboarding-form.tsx`
- Modify: `src/lib/actions.ts` (`createWorkspace`), `src/lib/data.ts` (none)

**Interfaces:**
- `createWorkspace(formData)`: auth required; name required (≤60 chars); insert `workspaces` (admin client — profile may have no workspace so user-client RLS insert would fail; `workspaces` has no client insert policy) `{ name, created_by: userId, plan: "trial", trial_ends_at: now + 14 days }`; insert starter pipeline (admin or user client after profile update — do admin for both) `{ id: "leads", workspace_id, name: "Leads", icon: "layers", stages: ["new","contacted","proposal","won","lost"], sort_order: 0 }`; update `profiles` (admin) `{ workspace_id, role: "owner" }`; `logActivity({ actorId, workspaceId, action: "workspace.create", summary: \`Created workspace “<name>”\` })`; `redirect("/dashboard")`.
- Page: standalone (own minimal layout — centered card, no sidebar), sign-in required; if profile already has a workspace → redirect `/dashboard`.

- [ ] **Step 1:** `createWorkspace` action (exact behavior above; all admin-client writes because the user has no workspace yet).
- [ ] **Step 2:** `/onboarding` page + form (name input + "Create workspace" submit; existing visual language: centered card, `btn-primary`, `SubmitButton`; copy: "Name your workspace — you can rename it later. You'll get a 14-day trial and can invite your team right away.").
- [ ] **Step 3:** lint+build; commit `feat: create-your-workspace onboarding`.

---

### Task 3: Workspace-scoped invites

**Files:**
- Modify: `src/lib/actions.ts` (`inviteUser`)

- [ ] **Step 1:** `inviteUser` — resolve inviter's workspace (`requireWorkspaceId()`); invitation `publicMetadata: { role: safeRole, workspace_id: workspaceId }` (both create and resend paths). Owner-only check unchanged (now workspace-owner via Plan 1 semantics).
- [ ] **Step 2:** Verify `ensureProfile` reads it (already does, Plan 1). Acceptance lands the member in the inviter's workspace with the invited role.
- [ ] **Step 3:** lint+build; commit `feat: workspace-scoped invitations`.

---

### Task 4: Trial UI + workspace settings

**Files:**
- Create: `src/components/trial-banner.tsx`
- Modify: `src/app/(app)/layout.tsx` (render banner via Shell), `src/components/shell.tsx` (accept + render banner slot), `src/app/(app)/settings/page.tsx` (workspace card), `src/lib/actions.ts` (`renameWorkspace`)

**Interfaces:**
- `TrialBanner` props: `{ plan: string; trialEndsAt: string | null; canWrite: boolean }` — renders nothing for `active`; amber ≤7 days; rose ≤1 day; rose locked when expired (`Trial ended — contact us to continue` + mailto `CONTACT_EMAIL`). `CONTACT_EMAIL = "atanub707@gmail.com"` constant in the component file.
- Layout: `getWorkspaceContext()` (Plan 1) → pass `workspace.plan`, `workspace.trial_ends_at`, `canWrite` to Shell → banner under the sidebar header/top.
- `renameWorkspace(formData)`: owner-only (assertOwner) + name required; update `workspaces` (user client — `workspaces_update_owner` policy exists); `logActivity` `workspace.rename`; revalidate layout; redirect `/settings`.
- Settings: "Workspace" card (above "Email sending"): name (owner: inline rename form; others: read-only), plan status line (`Trial · N days left` / `Trial ended` / `Active`), member count.

- [ ] **Step 1:** `TrialBanner` component.
- [ ] **Step 2:** layout/Shell plumbing.
- [ ] **Step 3:** `renameWorkspace` + Settings workspace card.
- [ ] **Step 4:** **Write-lock UX (targeted):** pass `canWrite` to the main write surfaces and hide/disable when false: companies page `PasteUrl` + bookmark/follow-up controls + delete; company detail `addContact` form, edit-details save, delete, Deep Research card, EmailComposer triggers; settings invite/role-select/remove/pipeline dialogs/email settings save. Components accept a `disabled`/`readOnly` prop where absent (minimal edits; the DB is the real gate).
- [ ] **Step 5:** lint+build; commit `feat: trial banner, workspace settings, write-lock UX`.

---

### Task 5: Super-admin viewing — active workspace + explicit filters

**Files:**
- Modify: `src/lib/data.ts` (`activeWorkspaceId()`, filters), `src/lib/types.ts` (none)

**Interfaces:**
- `activeWorkspaceId(): Promise<string>` — profile's workspace; if `is_super_admin` and cookie `view_workspace` is a uuid → cookie value. (Read cookie via `next/headers` `cookies()`.)
- Add `.eq("workspace_id", await activeWorkspaceId())` to every data-helper query over: `organizations` (getCompanies, getCompany, getUpcomingFollowUps, getDashboardStats, getStatusCounts), `contacts` (getContacts + getCompanies stats), `company_emails` (getCompanyEmails + stats), `enrichment_runs` (getEnrichmentRuns, getRecentRuns, getDeepResearchState, getDeepResearchMonthSpend), `interactions` (getInteractions, getRecentInteractions), `sent_emails` (getCompanies sent-by), `pipelines` (getPipelines, getPipelineUsage), `activity_log` (getActivityLog). Normal users: redundant with RLS but harmless (belt).

- [ ] **Step 1:** `activeWorkspaceId()`.
- [ ] **Step 2:** apply filters across the helper list (mechanical; keep one `const workspaceId = await activeWorkspaceId()` per helper).
- [ ] **Step 3:** `getCompany`/`getContacts` id-based lookups additionally verify `.eq("workspace_id", …)` so a customer id from another workspace 404s for the viewer.
- [ ] **Step 4:** lint+build; commit `feat: active-workspace scoping for super-admin views`.

---

### Task 6: Super-admin switcher + read-only mode + view logging

**Files:**
- Create: `src/components/workspace-switcher.tsx`
- Modify: `src/lib/actions.ts` (`switchWorkspace`), `src/lib/data.ts` (`getAllWorkspaces`), `src/app/(app)/layout.tsx` (switcher props + `superadmin.view` logging), `src/components/shell.tsx` (render switcher)

**Interfaces:**
- `getAllWorkspaces()` (super-admin only; RLS select allows): `{ id, name, plan }[]`.
- `switchWorkspace(formData)`: super-admin only; `id` field; `""`/`"own"` → delete cookie; else set cookie `view_workspace=<uuid>` (httpOnly, path `/`, sameSite lax, 30-day); `logActivity({ actorId, workspaceId: target, action: "superadmin.view", summary: "HI Labs viewed this workspace", details: { via: "switch" } })`; `revalidatePath("/", "layout")`; `redirect("/dashboard")`.
- Layout: if `isSuperAdmin && viewingWorkspace != own` → render a "Viewing <name> — read-only" banner (part of the switcher component) + pass `canWrite: false`; log `superadmin.view` with `{ path }` on each render (admin client via `logActivity` override).
- `canWrite` refinement (Task 4 plumbing): own workspace → trialOk; customer view → false.

- [ ] **Step 1:** `getAllWorkspaces` + `switchWorkspace`.
- [ ] **Step 2:** `WorkspaceSwitcher` (top of sidebar): select with own workspace + all workspaces (super-admin only); read-only badge when viewing a customer; "Back to my workspace" action.
- [ ] **Step 3:** layout wiring + per-navigation `superadmin.view` logging.
- [ ] **Step 4:** lint+build; commit `feat: super-admin workspace switcher with logged read-only views`.

---

### Task 7: Full live E2E

**Files:** temp `/var/folders/.../pwtest/mt2-e2e.mjs`

- [ ] **Step 1: Signup → onboarding:** new Clerk user (public signup path via the app's /sign-up with `+clerk_test` email) → first login → redirected to `/onboarding` → create workspace "E2E Co" → lands on dashboard; DB: workspace `trial`, `trial_ends_at ≈ +14d`, starter pipeline "leads", profile owner.
- [ ] **Step 2: Invite:** owner invites a second test user (metadata carries workspace_id); invitee signs in → lands in "E2E Co" (not onboarding), role as invited; Settings People shows both; invitee sees zero HI Labs data.
- [ ] **Step 3: Trial lock:** set `trial_ends_at` to yesterday (service key) → reload: banner "Trial ended", write CTAs hidden; REST probe with the owner's token: INSERT org → 403/blocked; SELECT still works.
- [ ] **Step 4: Super-admin:** flag a test user `is_super_admin` + workspace HI Labs; switcher lists HI Labs + E2E Co; switch to E2E Co → sees its company only (not HI Labs'), read-only badge, write attempt blocked; `superadmin.view` appears in E2E Co's audit (owner-visible); email settings of E2E Co users invisible to the super-admin.
- [ ] **Step 5: HI Labs unchanged:** owner account still sees 31 companies; banner absent (plan active).
- [ ] **Step 6: Cleanup:** delete E2E workspace (cascade) + test users/profiles + audit rows; screenshots for the report.
- [ ] **Step 7:** docs (`DESIGN.md` bullet update) + final commit.

---

## Self-Review

- **Spec coverage:** open signup ✓ (T1) · onboarding + starter pipeline ✓ (T2) · workspace invites ✓ (T3) · 14-day trial banners + DB lock + UX ✓ (T4) · super-admin switcher/read-only/logged ✓ (T5+T6) · isolation re-proven ✓ (T7) · one-account-one-workspace ✓ (T1 gate) · BYO/Stripe excluded ✓.
- **Placeholder scan:** none — every task names files, interfaces, exact strings.
- **Type consistency:** `getWorkspaceContext`, `activeWorkspaceId`, `canWrite`, cookie name `view_workspace`, `CONTACT_EMAIL` used consistently.
- **Risk note:** opening signups is the point of no return for public access — test with `+clerk_test` accounts first; Clerk dev-instance bot protection stays off (production instance later).

## Owner actions needed

1. None until E2E; signups open the moment Task 1 ships.
2. After E2E: decide whether to send the signup link to the two founders (they can onboard themselves).
