# Multi-Tenant Workspaces — Design

**Status:** DRAFT for owner review · **Date:** 2026-10-04

## Goal

Turn the Lead Portal into a multi-tenant product: other teams (starting with two founder leads) sign up, get an **isolated workspace**, invite their members, and use every feature (paste research, deep research, email composer, audit). **14-day grace period**, then writes lock until they pay (manual for now). Existing HI Labs data migrates untouched.

## Locked decisions

1. **Shared database + row-level isolation** (not DB-per-tenant): one Postgres, every row tagged with `workspace_id`, isolation enforced by Postgres RLS.
2. **One account = one workspace** (v1). A person needing a second workspace uses a different email.
3. **Existing data → "HI Labs" workspace**; atanub707 becomes **super-admin**; Bakir stays a normal HI Labs owner.
4. **Super-admin (atanub707):** workspace switcher, full visibility, **read-only by default**, every visit **logged into that workspace's audit**, SMTP passwords **never visible** (encrypted, owner-only decryption).
5. **Open self-serve signup** (Clerk) with email verification → **"Create your workspace"** onboarding.
6. **14-day trial** from workspace creation; banners at ≤7 days and ≤1 day; after expiry **writes lock at the database level**, reads/copy stay; manual payment; Stripe later.
7. **Pipelines become per-workspace.**
8. **BYO-Supabase** (tenant brings their own database) and **Stripe billing** are phase 3 — out of scope here, but the design keeps them possible (a `data_mode` slot on workspaces is reserved conceptually; no column yet, YAGNI).

## Architecture

```
Your team / Founder A / Founder B  →  Clerk (own logins, invites)
                                        ↓
                    Next.js app on Vercel (one deployment)
                                        ↓
        Supabase Postgres (one DB): RLS  workspace_id = my_workspace()
              ├── Workspace: HI Labs     (existing data)
              ├── Workspace: Founder A   (isolated rows)
              └── Workspace: Founder B   (isolated rows)
        Super-admin (you): switcher → read-only views, logged
```

## Data model (one migration)

### New table: `workspaces`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `name` | `text not null` | |
| `created_by` | `text` | Clerk id (no FK — avoids circularity with profiles) |
| `trial_ends_at` | `timestamptz` | null for HI Labs (internal) |
| `plan` | `text not null default 'trial'` | `trial` \| `active` (HI Labs = `active`) |
| `created_at` | `timestamptz default now()` | |

### `profiles` changes

- `workspace_id uuid references workspaces(id) on delete cascade` (null until onboarding/invite acceptance)
- `is_super_admin boolean not null default false`
- Role stays `owner`/`editor` — now interpreted **per workspace**

### `workspace_id` added to every data table

`organizations`, `contacts`, `company_emails`, `enrichment_runs`, `interactions`, `sent_emails`, `activity_log`, `pipelines` — all `uuid not null references workspaces(id) on delete cascade`, indexed.

Backfill order in the migration: create **HI Labs** workspace → add columns nullable → backfill all existing rows with its id → set NOT NULL → add indexes/FKs.

### `pipelines` — per-workspace

- Adds `workspace_id`; uniqueness moves to `unique (workspace_id, id)`
- `organizations.list` FK changes from `references pipelines(id)` to composite `(workspace_id, list) references pipelines(workspace_id, id)`
- HI Labs keeps its current pipelines (`pos`, `compliance`, `expenzee`, …) unchanged
- New workspaces get one starter pipeline ("Leads") created at onboarding

### Helper functions (SQL, `security definer`)

- `my_workspace() returns uuid` — the caller's `profiles.workspace_id`
- `is_workspace_owner() returns boolean` — caller's role in their own workspace
- `is_super_admin() returns boolean`
- `trial_active(workspace uuid) returns boolean` — `trial_ends_at is null or trial_ends_at > now()`

### RLS policy shape (every data table)

- **SELECT:** `workspace_id = my_workspace() or is_super_admin()`
- **INSERT / UPDATE / DELETE:** `workspace_id = my_workspace() and trial_active(workspace_id)` — plus existing owner-gates where they exist (e.g. pipelines delete → `is_workspace_owner() and trial_active(...)`)
- Super-admin is **excluded from write policies** (read-only by default)
- `activity_log`: SELECT stays owner-of-that-workspace (or super-admin); writes via the server admin client (service role), as today
- `user_email_settings`: own-row only (unchanged); update additionally requires `trial_active(my_workspace())`
- Trial enforcement lives **in the database** — an expired workspace cannot write even through a crafted API call

## Auth & onboarding

- Clerk: sign-ups **open** (email verification on). Bot protection: enable when moving to a production Clerk instance (noted; dev instance acceptable for the two pilots).
- `ensureProfile` (first login):
  - Invitation metadata present (`workspace_id`, `role`) → profile joins that workspace with that role
  - Otherwise → profile created **without workspace** → app redirects to **`/onboarding`**
- `/onboarding` — "Create your workspace": name input → server action creates the workspace (`plan: 'trial'`, `trial_ends_at = now() + 14 days`), the starter "Leads" pipeline, sets the profile (`workspace_id`, `role: 'owner'`) → lands on the dashboard
- Invitations: `inviteUser` requires **workspace owner**; Clerk invitation metadata carries `workspace_id` + role; 1-day expiry, revoke/delete UI unchanged
- First login of a workspace owner shows a small "Invite your team" prompt in Settings

## Trial

- `trial_ends_at` set at creation; `plan` flips to `active` manually when they pay (you do it from the super-admin switcher or SQL; a small owner-only toggle comes with Plan 2)
- UI: banner appears ≤7 days ("Trial: N days left — contact us to continue"), ≤1 day ("last day"), expired ("Trial ended — contact us to continue")
- Expired: writes locked (RLS + UI), reads/copy/export still work
- HI Labs: `plan='active'`, `trial_ends_at=null` — never locks

## Super-admin

- Switcher (top of the sidebar): lists all workspaces; selecting one sets a cookie `view_workspace`
- When viewing a customer workspace: all pages render read-only (write controls hidden; server actions reject via `canWrite` check; RLS blocks regardless)
- **Every visit logged** into that workspace's `activity_log` (`superadmin.view`, actor = you, details: path) — visible to the customer's owner
- SMTP settings and passwords remain invisible (own-row RLS; decryption only for the owning user's sends)
- Your own home workspace is HI Labs (switcher defaults there)

## Audit additions

- `workspace.create` (onboarding), `workspace.rename` (owner), `superadmin.view` (per customer-workspace page load), `trial.expired` (system, once)

## What customers are told

*"Your workspace is private to your team. Platform access is limited to support and is logged."*

## Out of scope (v1)

Stripe/automatic billing · BYO-Supabase · one user in multiple workspaces · per-tenant custom domains · plan tiers · super-admin write access to customer workspaces.

## Phasing (each plan ships working software)

- **Plan 1 — Workspace foundation:** schema, RLS, HI Labs migration, workspace-scoped queries, per-workspace pipelines. Existing team experience unchanged.
- **Plan 2 — Signup, onboarding, invites, trial, super-admin UI:** open signup, `/onboarding`, workspace-scoped invites, trial banners/lock, switcher + read-only views + access logging.
- **Phase 3 (later):** Stripe billing, BYO-Supabase tier.

## Success criteria (live verification)

1. **HI Labs unchanged:** every page works, data intact after migration (spot-check companies, pipelines, audit, email settings).
2. **Signup → workspace:** a new account creates a workspace, becomes its owner, gets the starter pipeline.
3. **Invite → correct workspace:** invited member lands in the inviter's workspace with the assigned role.
4. **Isolation is real:** user A's session cannot read or write user B's rows — verified with direct REST calls using A's own token (empty results / denied writes, not just hidden UI).
5. **Trial lock is real:** a workspace with an expired `trial_ends_at` cannot write (REST insert denied) while reads/copy still work; UI shows the locked banner.
6. **Super-admin:** switcher lists all workspaces; customer view is read-only (write denied); `superadmin.view` appears in that workspace's audit; no SMTP password exposure.
7. **No regression:** deep research, email composer, paste flow, audit all work per workspace.
