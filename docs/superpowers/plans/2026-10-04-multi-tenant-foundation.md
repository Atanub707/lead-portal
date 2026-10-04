# Multi-Tenant Workspaces — Plan 1: Workspace Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every record belong to a workspace, with isolation enforced by Postgres RLS, migrating all existing HI Labs data untouched. No visible change for the current team; this is the foundation for signup/trial (Plan 2).

**Architecture:** One `workspaces` table; `workspace_id` on every data table; helper SQL functions (`my_workspace()`, `is_owner()` redefined, `is_super_admin()`, `trial_active()`); all RLS policies rewritten to workspace scope; all app insert paths set `workspace_id`; admin-client (service-role) paths explicitly scoped.

**Tech Stack:** Postgres/Supabase (RLS, security-definer functions), Next.js server actions + route handlers, Clerk auth. Verification via SQL probes + REST calls with real user tokens + Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-multi-tenant-design.md` (source of truth).

## Global Constraints

- **Sequencing is critical:** the migration rewrites RLS to require `workspace_id`. Code that sets `workspace_id` must deploy in the SAME window as the migration (apply migration → deploy within ~1 minute; brief write failures in that window are acceptable and retryable).
- **HI Labs id (fixed, used everywhere):** `00000000-0000-4000-8000-000000000001` · name `HI Labs` · `plan='active'` · `trial_ends_at=null`.
- **Super-admin:** `atanub707@gmail.com` → `profiles.is_super_admin = true` (migration).
- **RLS policy shape (every data table):** SELECT = `workspace_id = my_workspace() or is_super_admin()`; INSERT/UPDATE/DELETE = `workspace_id = my_workspace() and trial_active(workspace_id)` plus existing owner gates. Super-admin is NOT in write policies.
- **`is_owner()` is redefined** to mean "owner of the caller's own workspace" — existing policies that use it keep working and become workspace-scoped.
- **One account = one workspace.** `profiles.workspace_id` may be NULL only between signup and onboarding (Plan 2); in Plan 1 every existing profile gets HI Labs.
- **Admin-client writes (service role, bypasses RLS) must be explicitly scoped:** `logActivity`, deep-research run-row writes, `sent_emails` insert, `removeUser`/`updateMyName` profile writes.
- **Pipelines become per-workspace:** PK `(workspace_id, id)`; `organizations` FK becomes `(workspace_id, list) references pipelines(workspace_id, id)`.
- No new dependencies. `npm run lint && npm run build` before every commit.
- The migration is applied via the Supabase Management API (fresh `sbp_` token from the owner; revoked after) — or the SQL Editor block if no token.

---

## File Structure

| File | Change |
|---|---|
| `supabase/migrations/20261004120000_workspaces.sql` (new) | workspaces table, columns, backfill, NOT NULL, pipelines composite PK/FK, helper functions, full RLS rewrite |
| `src/lib/types.ts` | `Workspace` type; `Profile` gains `workspace_id`, `is_super_admin` |
| `src/lib/data.ts` | `getCurrentProfile` returns new fields; new `getWorkspaceContext()`; every query naturally scoped by RLS (no filters needed), but admin paths below get explicit scoping |
| `src/lib/auth.ts` | `ensureProfile`: assign HI Labs when no workspace (Plan 1: the only workspace); pass through invite metadata later (Plan 2) |
| `src/lib/activity.ts` | `logActivity` resolves the actor's `workspace_id` and stores it |
| `src/lib/actions.ts` | `createOrganization`, `addContact`, `addInteraction`, `createPipeline` set `workspace_id`; `removeUser`/`updateMyName` admin writes unchanged (profiles carry workspace) |
| `src/app/api/paste/route.ts` | org/contact/company_email/enrichment_run inserts set `workspace_id` |
| `src/lib/deep-research.ts` | run-row inserts set `workspace_id` (admin client); merge inserts set it |
| `src/app/api/email/send/route.ts` | `sent_emails` insert sets `workspace_id` |
| `DESIGN.md` | one "Multi-tenancy" bullet |

---

### Task 1: Migration file (schema + backfill + helpers + RLS rewrite)

**Files:**
- Create: `supabase/migrations/20261004120000_workspaces.sql`

**Interfaces:**
- Produces (SQL): `public.my_workspace() → uuid`, `public.is_owner() → boolean` (redefined), `public.is_super_admin() → boolean`, `public.trial_active(uuid) → boolean`, fixed HI Labs id `00000000-0000-4000-8000-000000000001`.

- [ ] **Step 1: Inventory the current policies** — run against the live DB (Management API or REST is not enough; use SQL):

```sql
select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by tablename, policyname;
```

Record the list in the migration file header as a comment (so the rewrite is auditable).

- [ ] **Step 2: Write the migration** — exact structure:

```sql
-- Multi-tenant workspaces: foundation.
-- Sequencing: apply together with the workspace-scoped app deploy.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text,
  trial_ends_at timestamptz,
  plan text not null default 'trial',
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade,
  add column if not exists is_super_admin boolean not null default false;

alter table public.organizations   add column if not exists workspace_id uuid;
alter table public.contacts        add column if not exists workspace_id uuid;
alter table public.company_emails  add column if not exists workspace_id uuid;
alter table public.enrichment_runs add column if not exists workspace_id uuid;
alter table public.interactions    add column if not exists workspace_id uuid;
alter table public.sent_emails     add column if not exists workspace_id uuid;
alter table public.activity_log    add column if not exists workspace_id uuid;
alter table public.pipelines       add column if not exists workspace_id uuid;

-- HI Labs (fixed id)
insert into public.workspaces (id, name, plan)
values ('00000000-0000-4000-8000-000000000001', 'HI Labs', 'active')
on conflict (id) do nothing;

update public.organizations   set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.contacts        set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.company_emails  set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.enrichment_runs set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.interactions    set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.sent_emails     set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.activity_log    set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.pipelines       set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;
update public.profiles        set workspace_id = '00000000-0000-4000-8000-000000000001' where workspace_id is null;

update public.profiles set is_super_admin = true where email = 'atanub707@gmail.com';

-- NOT NULL + FKs + indexes
alter table public.organizations   alter column workspace_id set not null;
alter table public.contacts        alter column workspace_id set not null;
alter table public.company_emails  alter column workspace_id set not null;
alter table public.enrichment_runs alter column workspace_id set not null;
alter table public.interactions    alter column workspace_id set not null;
alter table public.sent_emails     alter column workspace_id set not null;
alter table public.activity_log    alter column workspace_id set not null;
alter table public.pipelines       alter column workspace_id set not null;

alter table public.organizations   add constraint organizations_workspace_fkey   foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.contacts        add constraint contacts_workspace_fkey        foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.company_emails  add constraint company_emails_workspace_fkey  foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.enrichment_runs add constraint enrichment_runs_workspace_fkey foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.interactions    add constraint interactions_workspace_fkey    foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.sent_emails     add constraint sent_emails_workspace_fkey     foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.activity_log    add constraint activity_log_workspace_fkey    foreign key (workspace_id) references public.workspaces (id) on delete cascade;
alter table public.pipelines       add constraint pipelines_workspace_fkey       foreign key (workspace_id) references public.workspaces (id) on delete cascade;

create index organizations_workspace_idx   on public.organizations (workspace_id);
create index contacts_workspace_idx        on public.contacts (workspace_id);
create index company_emails_workspace_idx  on public.company_emails (workspace_id);
create index enrichment_runs_workspace_idx on public.enrichment_runs (workspace_id);
create index interactions_workspace_idx    on public.interactions (workspace_id);
create index sent_emails_workspace_idx     on public.sent_emails (workspace_id);
create index activity_log_workspace_idx    on public.activity_log (workspace_id);
create index pipelines_workspace_idx       on public.pipelines (workspace_id);

-- Pipelines: composite key + scoped FK from organizations
alter table public.organizations drop constraint if exists organizations_list_fkey;
alter table public.pipelines drop constraint if exists pipelines_pkey;
alter table public.pipelines add constraint pipelines_pkey primary key (workspace_id, id);
alter table public.organizations
  add constraint organizations_list_fkey
  foreign key (workspace_id, list) references public.pipelines (workspace_id, id);

-- Helper functions
create or replace function public.my_workspace()
returns uuid language sql security definer stable set search_path = public as $$
  select workspace_id from public.profiles where id = public.clerk_user_id();
$$;

-- is_owner() now means "owner of the caller's own workspace" — existing
-- policies that reference it become workspace-scoped automatically.
create or replace function public.is_owner()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = public.clerk_user_id() and role = 'owner'
  );
$$;

create or replace function public.is_super_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(
    (select is_super_admin from public.profiles where id = public.clerk_user_id()),
    false
  );
$$;

create or replace function public.trial_active(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspaces
    where id = ws and (trial_ends_at is null or trial_ends_at > now())
  );
$$;

grant execute on function public.my_workspace, public.is_owner, public.is_super_admin, public.trial_active to authenticated;
```

- [ ] **Step 3: Rewrite every policy** — for each table, `drop policy if exists` + recreate per the mapping (names from the Step 1 inventory; the target set):

```sql
-- organizations
drop policy if exists "organizations_select" on public.organizations;
create policy "organizations_select" on public.organizations
  for select to authenticated using (workspace_id = public.my_workspace() or public.is_super_admin());
drop policy if exists "organizations_insert" on public.organizations;
create policy "organizations_insert" on public.organizations
  for insert to authenticated with check (workspace_id = public.my_workspace() and public.trial_active(workspace_id));
drop policy if exists "organizations_update" on public.organizations;
create policy "organizations_update" on public.organizations
  for update to authenticated using (workspace_id = public.my_workspace() and public.trial_active(workspace_id))
  with check (workspace_id = public.my_workspace() and public.trial_active(workspace_id));
drop policy if exists "organizations_delete_owner" on public.organizations;
create policy "organizations_delete_owner" on public.organizations
  for delete to authenticated using (workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id));

-- Repeat the same four-policy shape for: contacts, company_emails,
-- enrichment_runs, interactions, sent_emails — with the owner gate on
-- deletes where it exists today (contacts/company_emails deletes are owner-gated).

-- activity_log: SELECT stays owner-of-workspace (or super-admin); writes stay admin-client only
drop policy if exists "activity_log_select_owner" on public.activity_log;
create policy "activity_log_select_owner" on public.activity_log
  for select to authenticated using (
    (workspace_id = public.my_workspace() and public.is_owner()) or public.is_super_admin()
  );

-- pipelines: select workspace-wide; writes owner + trial
drop policy if exists "pipelines_select" on public.pipelines;
create policy "pipelines_select" on public.pipelines
  for select to authenticated using (workspace_id = public.my_workspace() or public.is_super_admin());
drop policy if exists "pipelines_insert_owner" on public.pipelines;
create policy "pipelines_insert_owner" on public.pipelines
  for insert to authenticated with check (workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id));
drop policy if exists "pipelines_update_owner" on public.pipelines;
create policy "pipelines_update_owner" on public.pipelines
  for update to authenticated using (workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id))
  with check (workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id));
drop policy if exists "pipelines_delete_owner" on public.pipelines;
create policy "pipelines_delete_owner" on public.pipelines
  for delete to authenticated using (workspace_id = public.my_workspace() and public.is_owner() and public.trial_active(workspace_id));

-- profiles: same-workspace visibility (+ self + super-admin); self-name update stays; owner role updates stay (is_owner() redefined)
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (
    workspace_id = public.my_workspace() or id = public.clerk_user_id() or public.is_super_admin()
  );
-- (keep "profiles_update_self_name" and the owner role-update policy as-is; they
-- now inherit workspace semantics via is_owner() / clerk_user_id())

-- user_email_settings: own-row only + trial gate on writes
drop policy if exists "user_email_settings_insert_own" on public.user_email_settings;
create policy "user_email_settings_insert_own" on public.user_email_settings
  for insert to authenticated with check (user_id = public.clerk_user_id() and public.trial_active(public.my_workspace()));
drop policy if exists "user_email_settings_update_own" on public.user_email_settings;
create policy "user_email_settings_update_own" on public.user_email_settings
  for update to authenticated using (user_id = public.clerk_user_id())
  with check (user_id = public.clerk_user_id() and public.trial_active(public.my_workspace()));
```

(The implementer must reconcile against the Step 1 inventory: any policy not named above gets dropped and folded into this shape; record the mapping in the report.)

- [ ] **Step 4:** `npm run lint && npm run build` unaffected (no app code yet). Commit: `feat: multi-tenant foundation migration (workspaces + RLS)`.

---

### Task 2: Workspace context in the app

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/data.ts`, `src/lib/auth.ts`

**Interfaces:**
- Produces: `Profile` gains `workspace_id: string | null`, `is_super_admin: boolean`; `Workspace` type `{ id, name, plan, trial_ends_at }`; `getWorkspaceContext(): Promise<{ profile; workspace: Workspace | null; isSuperAdmin: boolean; canWrite: boolean } | null>` where `canWrite = isSuperAdmin ? false : (workspace ? workspace.plan === "active" || (workspace.trial_ends_at && new Date(workspace.trial_ends_at) > new Date()) : false)` — Plan 1: used by nothing yet except future-proofing; Plan 2 consumes it.
- `ensureProfile`: if the created profile has no `workspace_id`, assign HI Labs (`00000000-0000-4000-8000-000000000001`) — Plan 1 fallback (Plan 2 replaces with invite-metadata/onboarding).

- [ ] **Step 1:** types + `getCurrentProfile` select `*` already; extend the `Profile` interface.
- [ ] **Step 2:** `getWorkspaceContext()` in data.ts (profile → workspace row via `workspaces` select, RLS allows own-workspace; super-admin select allowed by policy).
- [ ] **Step 3:** `ensureProfile` fallback assignment (direct update after insert).
- [ ] **Step 4:** lint+build; commit `feat: workspace context in app data layer`.

---

### Task 3: Every insert path sets `workspace_id`; admin paths scoped

**Files:**
- Modify: `src/lib/actions.ts`, `src/lib/activity.ts`, `src/app/api/paste/route.ts`, `src/lib/deep-research.ts`, `src/app/api/email/send/route.ts`

**Interfaces:**
- Every data insert gains `workspace_id` = the acting user's `my_workspace()` (resolve once per action via `getCurrentProfile()` or a small `myWorkspaceId()` helper in data.ts).

- [ ] **Step 1: `myWorkspaceId()` helper** (data.ts) — returns `profile.workspace_id`, throws if null (Plan 1: never null).
- [ ] **Step 2: `logActivity`** — resolve actor workspace (admin client query on profiles) and include `workspace_id` in the insert; when the actor has no workspace (super-admin system events), fall back to the org's workspace if `orgId` provided.
- [ ] **Step 3: paste route** — org insert (or update), contacts, company_emails, enrichment_runs inserts all get `workspace_id` (one resolution at the top).
- [ ] **Step 4: deep-research.ts** — `startDeepResearch` run insert + `mergeLeads` contact/company_email inserts + finalize/update writes: include `workspace_id` on inserts (admin writes are updates-by-id — no change needed there); `sent_emails`/`interactions` in the send route: add `workspace_id`.
- [ ] **Step 5: actions.ts** — `createOrganization`, `addContact`, `addInteraction`, `createPipeline` add `workspace_id`; the `created_by` strip-and-retry fallback stays untouched.
- [ ] **Step 6:** lint+build; commit `feat: workspace-scoped writes across the app`.

---

### Task 4: Per-workspace pipelines in code

**Files:**
- Modify: `src/lib/actions.ts` (`createPipeline`), `src/lib/types.ts` (`FALLBACK_PIPELINES` comment), `src/lib/data.ts` (fallback note)

- [ ] **Step 1:** `createPipeline` clash check adds `.eq("workspace_id", workspaceId)` (ids only need to be unique per workspace now); insert includes `workspace_id`.
- [ ] **Step 2:** `FALLBACK_PIPELINES` stays as a last-resort render aid; add a comment that ids are per-workspace and the fallback is only for DB-unreachable states.
- [ ] **Step 3:** `updatePipeline`/`deletePipeline`/`getPipelineUsage` unchanged (RLS scopes them).
- [ ] **Step 4:** lint+build; commit `feat: per-workspace pipelines`.

---

### Task 5: Isolation verification harness

**Files:**
- Temp: `/var/folders/.../pwtest/mt-isolation.mjs`

- [ ] **Step 1: Script setup** — create (via service key) a second workspace `MT Test` + two test users: user A in HI Labs, user B in `MT Test` (profiles with workspace_id set), one company + one contact in each workspace. Clerk users via API; get session tokens via the frontend API? Simpler: sign each test user in through the app (Playwright) and capture the Supabase-bound access via the app's own server paths — but for direct REST isolation probes we need a Clerk JWT for the `supabase` template: obtain via Clerk Backend API `POST /v1/sessions/{session_id}/tokens/{template}`? The Backend API can create sign-in tokens; simplest reliable route: use Playwright to log in, then read the token from the app? Overkill.
  Pragmatic approach: verify isolation **through the deployed app UI + server paths** (the app's user-scoped client): log in as user B, assert the HI Labs company is NOT visible anywhere (search, dashboard counts, direct `/companies/{id}` → 404/empty), and POST attempts (e.g., direct fetch to the app's own data via a debug? no) — plus **direct PostgREST probes using the service key are not valid** (bypass RLS).
  **Correct method:** get a real Clerk→Supabase token: log in as the test user in Playwright, then `page.evaluate(() => window.Clerk.session.getToken({ template: "supabase" }))` — Clerk JS exposes the session token client-side. Then use that token against PostgREST directly (`apikey: publishable`, `Authorization: Bearer <token>`) to prove: user B reading HI Labs rows returns `[]`; user B inserting a row into HI Labs' workspace id is rejected (401/403/RLS violation).
- [ ] **Step 2:** the script asserts: (a) B sees own company; (b) B cannot read A's company by id; (c) B cannot insert with A's workspace_id; (d) B cannot update A's company; (e) super-admin (atanub707 — cannot log in as them; skip in Plan 1, verified in Plan 2 UI) — instead assert RLS shape via `pg_policies` dump.
- [ ] **Step 3:** run only AFTER Task 6 applies the migration. Commit the script? No — temp only; results go in the report.

---

### Task 6: Apply + deploy together + full verification

- [ ] **Step 1:** Owner provides a fresh `sbp_…` token (or the SQL Editor block is handed over). Apply `20261004120000_workspaces.sql` via Management API; record in `supabase_migrations.schema_migrations` (`('20261004120000','workspaces')`).
- [ ] **Step 2: IMMEDIATELY deploy** the code (`git push`; wait for the Vercel deployment of the current HEAD).
- [ ] **Step 3: HI Labs unchanged (Playwright, owner test user):** dashboard counts match pre-migration (31 companies, 20 emails, pipelines POS Clients/Compliance Services/Expenzee with correct counts); company page loads; research log intact; audit intact; email settings intact.
- [ ] **Step 4: Smoke all write paths:** paste a URL into a temp pipeline (org+contacts+emails+runs written with workspace_id — verify via REST), toggle bookmark, add a contact, rename a pipeline, send-test email settings (SMTP test route unaffected), deep research start guard (no spend — just confirm the guard reads workspace data).
- [ ] **Step 5: Isolation harness (Task 5)** — all assertions pass.
- [ ] **Step 6: SQL shape check:** `select count(*) from pg_policies where schemaname='public'` and spot-check that every data table has the four-policy shape (dump + eyeball; paste in report).
- [ ] **Step 7: Cleanup:** delete MT Test workspace (cascades its rows), test users + profiles, temp pipeline. Update `DESIGN.md` with a "Multi-tenancy" bullet. Commit + push.
- [ ] **Step 8:** Revoke the `sbp_` token (owner action, remind).

---

## Self-Review

- **Spec coverage:** workspaces table ✓; workspace_id on all 8 tables + profiles ✓; HI Labs backfill ✓; super-admin flag ✓; helper functions + is_owner() redefinition ✓; RLS four-policy shape + trial gate + super-admin read-only ✓; per-workspace pipelines ✓; admin paths scoped ✓; sequencing (apply+deploy together) ✓; isolation verification with real tokens ✓. Plan 2 items (signup, onboarding, invites metadata, trial UI, switcher) deliberately NOT here ✓.
- **Placeholder scan:** policy rewrite says "reconcile against inventory" with the exact target shape given — actionable, not vague.
- **Type consistency:** `getWorkspaceContext`, `myWorkspaceId`, HI Labs id, helper names used identically across tasks.
- **Risk note:** the migration touches live data; all statements are `if not exists`/idempotent where possible; the only destructive change is the pipelines PK swap (guarded by the backfill making every row non-null first).

## Owner actions needed

1. A fresh `sbp_…` Supabase token at apply time (Task 6) — or paste the SQL block yourself.
2. Pick a quiet moment: apply + deploy happen within the same minute; the app may reject writes for ~60 seconds mid-switch.
