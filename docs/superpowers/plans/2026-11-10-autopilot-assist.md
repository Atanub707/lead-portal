# Autopilot Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe Autopilot layer for Lead Portal: an always-on supervisor that selects qualified companies, writes grounded email drafts, and places them in a human-reviewed Outbox with a deterministic send gate.

**Architecture:** Add an autopilot settings/run/outbox data layer in Postgres. A deterministic supervisor selects eligible companies, calls the existing email drafter, and inserts drafts into an Outbox. Approval reuses the existing send-coin/scheduled-send pipeline. A worker endpoint runs enabled workspaces on a schedule; no email is sent without approval in this phase.

**Tech Stack:** Next.js 16, TypeScript, Supabase Postgres, existing `generateEmailDraft`, `preflightSend`, `approveAndSchedule`, existing send coins/queue, Vercel worker + Supabase pg_cron.

## Global Constraints

- Phase 1 is **Assist only**: no auto-send and no automatic send-coin minting.
- Every outbox item is human-approved before it enters the send queue.
- Approval must pass the existing `preflightSend` gate.
- Drafting must use stored evidence, the existing recipient classifier and the existing quality checks.
- One pending outbox item per company.
- No company contacted in the last 30 days.
- Respect suppression, prior replies, invalid email status and existing daily send policy at approval time.
- No schema changes to existing email/send tables; only additive autopilot tables.
- Workspace isolation on every query and mutation.

---

### Task 1: Autopilot schema

**Files:**
- Create: `supabase/migrations/20261110120000_autopilot_assist.sql`

- [ ] Create `autopilot_settings`, `autopilot_runs`, `autopilot_outbox`.
- [ ] Add indexes and a partial unique index for one pending item per company.
- [ ] Enable RLS and grant read access to workspace members; writes stay service-role only.
- [ ] Apply the migration in Supabase SQL Editor and verify all three tables exist.

### Task 2: Data layer

**Files:**
- Create: `src/lib/autopilot.ts`
- Test: `scripts/autopilot-cases.mts` (eligibility and gate helpers)

- [ ] Add settings defaults, read/save, recent runs, outbox list, update/reject.
- [ ] Add `runAutopilot(workspaceId, userId, maxDrafts?)`.
- [ ] Select only eligible companies: pipeline/score threshold, website, usable email, no pending outbox, no contact in 30 days.
- [ ] Draft via `generateEmailDraft`; run `preflightSend`; skip blocked companies with reason.
- [ ] Insert pending outbox rows; enforce one pending per company.
- [ ] Add `approveOutbox` using `approveAndSchedule`; update queue/coin/status.
- [ ] Add `tickAutopilot()` using settings `last_run_at` and `run_interval_minutes`.

### Task 3: APIs

**Files:**
- Create: `src/app/api/autopilot/route.ts`
- Create: `src/app/api/autopilot/run/route.ts`
- Create: `src/app/api/autopilot/outbox/route.ts`
- Create: `src/app/api/autopilot/tick/route.ts`

- [ ] `GET/POST /api/autopilot`: settings, recent runs, outbox.
- [ ] `POST /api/autopilot/run`: run now, authenticated, workspace-scoped.
- [ ] `POST /api/autopilot/outbox`: approve/reject/edit, authenticated.
- [ ] `POST /api/autopilot/tick`: bearer `CRON_SECRET`, runs enabled workspaces with small batch.
- [ ] Return clear errors; never leak another workspace.

### Task 4: Autopilot UI

**Files:**
- Create: `src/app/(app)/autopilot/page.tsx`
- Create: `src/components/autopilot-panel.tsx`
- Modify: `src/components/sidebar-nav.tsx`
- Modify: `src/components/shell.tsx` if needed

- [ ] Add Autopilot page: status, settings, Run now, Outbox review, recent runs.
- [ ] Outbox cards: editable subject/body, approve, reject, quality/recipient/gate warnings.
- [ ] Settings: enabled, pipeline, minimum score, daily draft limit, interval, review required.
- [ ] Sidebar entry with Bot icon.
- [ ] Empty/loading/error states; mobile responsive.

### Task 5: Worker scheduling

**Files:**
- Modify: `src/app/api/worker/tick/route.ts`
- Create: `supabase/migrations/20261110130000_autopilot_cron.sql`

- [ ] Add one autopilot tick to the worker for enabled workspaces.
- [ ] Add pg_cron schedule calling `/api/autopilot/tick` every 15 minutes with Vault secret.
- [ ] Document the one-time Vault secret setup.

### Task 6: Verification

- [ ] `npx tsc --noEmit`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] Apply migrations.
- [ ] Create a test workspace/company with a known website/email.
- [ ] Enable Autopilot Assist, run now, verify outbox draft, edit, approve, verify coin + scheduled queue, cancel test send.
- [ ] Verify blocked companies are skipped with reasons.
- [ ] Verify worker tick does not send without approval.
- [ ] Remove test data and test Clerk user.
