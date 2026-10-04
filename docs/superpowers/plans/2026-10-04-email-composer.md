# Email Composer & Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate personalized outreach emails in the admin portal from pipeline pitch + company profile + a required flavor; copy or send from the member's own SMTP; audit every send and show "Sent by <name>" in the companies table.

**Architecture:** One migration adds pitch columns to `pipelines` plus `user_email_settings` (SMTP + signature, password encrypted with AES-256-GCM) and `sent_emails` (history + table display + follow-up context). Server routes generate drafts (AI via the existing `pickModel` pipeline), test SMTP (nodemailer with SSL↔STARTTLS auto-correct), and send (decrypt → nodemailer → records + audit). UI: composer dialog from the table and company page, a `/settings/email` sub-page per member, and an extended pipeline edit dialog with AI pitch generation.

**Tech Stack:** Next.js 16 route handlers, Supabase (RLS: own-row settings, authenticated read of sent history), nodemailer (new dep), node:crypto (AES-256-GCM), existing AI helpers (`src/lib/ai.ts` → `pickModel`, `generateText` primary + `generateObject` fallback), Tailwind/React client components.

**Spec:** `docs/superpowers/specs/2026-10-04-email-composer-design.md` (source of truth).

## Global Constraints

- **Encryption:** AES-256-GCM, random 12-byte nonce, envelope `v1:<nonce>:<tag>:<ciphertext>` (base64 parts), fail-closed on tamper. Key: `SMTP_ENCRYPTION_KEY` (64 hex chars = 32 bytes). The SMTP password is **write-only** — never returned by any API; UI shows "Saved ✓" state only.
- **Generation rules (verbatim from spec):** 60–90 words (Follow-up 30–50); max two short paragraphs; first person; real facts only (pitch + company data — never invent numbers, clients, certifications); banned phrases: "I hope this email finds you well", "I'm writing to", "leverage", "passionate", "excited", "thrilled", exclamation marks, bullets; **no em/en dashes**; subject ≤ 8 words; the model never writes a signature.
- **Six flavors (exact ids):** `short-direct`, `pain-first`, `insight-authority`, `warm-intro`, `founder-founder`, `follow-up`. Flavor is REQUIRED for generation.
- **Signature** = `from_name`, `signature_phone`, `signature_link` from `user_email_settings`, appended server-side (each line only when set).
- **Audit actions:** `email.sent` (actor = sender), `email.settings_update`, `pipeline.update`. Sends also insert an `interactions` row (channel `email`) for the timeline.
- **Sends are server-side only**; `sent_emails` writes never happen from the client. Settings RLS: own row only.
- **Migrations:** this project's migration pipeline was unblocked 2026-10-04 (applied via Supabase Management API). Task 1 applies this migration the same way (or via the SQL Editor block if the token was revoked). Record the version in `supabase_migrations.schema_migrations`.
- New dependency: `nodemailer` + `@types/nodemailer` (only new dependency).
- Run `npm run lint && npm run build` before every commit. No new test framework; live verification via controller Playwright/scripts. Commit messages: plain imperative.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261004100000_email_composer.sql` (new) | pitch columns; `user_email_settings`; `sent_emails`; RLS/grants |
| `src/lib/crypto.ts` (new) | `encryptSecret` / `decryptSecret` (AES-256-GCM envelope) |
| `src/lib/email.ts` (new) | `FLAVORS`, prompt builder, `generateEmailDraft`, post-processing, `sendEmailViaSmtp`, `testSmtp` |
| `src/app/api/email/draft/route.ts` (new) | POST → draft JSON |
| `src/app/api/email/send/route.ts` (new) | POST → send + records + audit |
| `src/app/api/email/test/route.ts` (new) | POST → verify (+ optional test send) |
| `src/components/email-composer.tsx` (new) | composer dialog (flavor required, generate/edit/copy/send) |
| `src/components/email-settings-form.tsx` (new) | `/settings/email` form (SMTP + signature + test) |
| `src/app/(app)/settings/email/page.tsx` (new) | per-member email settings page |
| `src/components/edit-pipeline-dialog.tsx` (new; supersedes `rename-pipeline-dialog.tsx` usage) | name/icon/pitch + ✨ Auto-generate |
| `src/lib/actions.ts` (modify) | `saveEmailSettings`, `updatePipeline`, `generatePipelinePitch`, audit calls |
| `src/lib/data.ts` (modify) | `getMyEmailSettings`, `getPipelinePitch`, sent-by data in `getCompanies` |
| `src/app/(app)/companies/page.tsx` (modify) | Email cell: composer button + "Sent by <name>" |
| `src/app/(app)/companies/[id]/page.tsx` (modify) | "Draft email" entry points (Reach + People) |
| `src/app/(app)/settings/page.tsx` (modify) | "Email sending" status card; Pipelines rows → Edit dialog |
| `.env.example` (modify) | `SMTP_ENCRYPTION_KEY=` |

---

### Task 1: Migration + crypto + dependency

**Files:**
- Create: `supabase/migrations/20261004100000_email_composer.sql`
- Create: `src/lib/crypto.ts`
- Modify: `.env.example`
- Temp test: `/var/folders/.../pwtest/crypto-check.mjs`

**Interfaces:**
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(envelope: string): string` (throws `Error("Invalid or tampered secret")` on bad envelope/tag).

- [ ] **Step 1: Migration file** — exact content:

```sql
-- Email composer: pipeline pitch, per-member SMTP settings (encrypted), sent history.

alter table public.pipelines
  add column if not exists pitch text,
  add column if not exists value_props text[] not null default '{}',
  add column if not exists proof_points text[] not null default '{}',
  add column if not exists cta text,
  add column if not exists default_flavor text;

create table public.user_email_settings (
  user_id text primary key references public.profiles (id) on delete cascade,
  from_name text,
  from_email text,
  smtp_host text,
  smtp_port integer,
  smtp_secure boolean not null default true,
  smtp_user text,
  smtp_password_enc text,
  signature_phone text,
  signature_link text,
  updated_at timestamptz not null default now()
);

alter table public.user_email_settings enable row level security;

create policy "user_email_settings_select_own" on public.user_email_settings
  for select to authenticated using (user_id = public.clerk_user_id());
create policy "user_email_settings_insert_own" on public.user_email_settings
  for insert to authenticated with check (user_id = public.clerk_user_id());
create policy "user_email_settings_update_own" on public.user_email_settings
  for update to authenticated using (user_id = public.clerk_user_id())
  with check (user_id = public.clerk_user_id());

grant select, insert, update on public.user_email_settings to authenticated;
grant all privileges on public.user_email_settings to service_role;

create table public.sent_emails (
  id bigint generated always as identity primary key,
  org_id bigint not null references public.organizations (id) on delete cascade,
  contact_id bigint references public.contacts (id) on delete set null,
  sent_by text references public.profiles (id) on delete set null,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index sent_emails_org_idx on public.sent_emails (org_id, created_at desc);

alter table public.sent_emails enable row level security;

create policy "sent_emails_select" on public.sent_emails
  for select to authenticated using (true);

grant select on public.sent_emails to authenticated;
grant all privileges on public.sent_emails to service_role;
```

- [ ] **Step 2: Apply the migration** — via Management API (`POST https://api.supabase.com/v1/projects/goxbvyrmzrhiegpqjere/database/query`, Bearer `sbp_…`), then `insert into supabase_migrations.schema_migrations (version, name) values ('20261004100000','email_composer') on conflict do nothing`. If the token was revoked, hand the SQL block to the user for the SQL Editor. Verify via REST probes: `pipelines?select=pitch&limit=1` → 200; `user_email_settings?limit=1` → 200; `sent_emails?limit=1` → 200.

- [ ] **Step 3: Env key + dependency**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Add the output as `SMTP_ENCRYPTION_KEY=` to `.env.local` and Vercel (Production, project `lead-portal-9siz`), plus the empty key to `.env.example`. Then `npm install nodemailer && npm install -D @types/nodemailer`.

- [ ] **Step 4: `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.SMTP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("Missing SMTP_ENCRYPTION_KEY (64 hex chars)");
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${nonce.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(envelope: string): string {
  const [version, nonceB64, tagB64, ctB64] = envelope.split(":");
  if (version !== "v1" || !nonceB64 || !tagB64 || !ctB64) {
    throw new Error("Invalid or tampered secret");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonceB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Invalid or tampered secret");
  }
}
```

- [ ] **Step 5: Temp round-trip test** — script imports the compiled behavior via `node --experimental-strip-types` (relative import, no path aliases in the file — it has none) and asserts: round-trip equality; two encryptions of the same plaintext differ (random nonce); tampered ciphertext throws; malformed envelope throws.

- [ ] **Step 6:** `npm run lint && npm run build` → PASS. Commit: `feat: email composer schema, crypto, nodemailer dep`.

---

### Task 2: Email settings — data, save action, sub-page, test route

**Files:**
- Modify: `src/lib/data.ts` (`getMyEmailSettings`)
- Modify: `src/lib/actions.ts` (`saveEmailSettings`)
- Create: `src/app/api/email/test/route.ts`
- Create: `src/app/(app)/settings/email/page.tsx`
- Create: `src/components/email-settings-form.tsx`

**Interfaces:**
- Produces: `getMyEmailSettings(): Promise<{ configured: boolean; from_name: string | null; from_email: string | null; smtp_host: string | null; smtp_port: number | null; smtp_secure: boolean; smtp_user: string | null; signature_phone: string | null; signature_link: string | null }>` (never the password)
- Produces: `saveEmailSettings(formData)` server action (empty `password` keeps the stored one)
- Produces: `POST /api/email/test` body `{ host, port, secure, user, password?, to? }` → `{ ok: true, note? }` | `{ ok: false, error }` (blank password → use saved decrypted; `to` → also send a test message)

- [ ] **Step 1: `getMyEmailSettings`** — `auth()` → `createClient()` select all columns except `smtp_password_enc` (explicit column list), `configured = !!(row?.smtp_host && row?.smtp_user && row?.smtp_password_enc)`.
- [ ] **Step 2: `saveEmailSettings`** — `auth()`; upsert own row (`onConflict: "user_id"`); if `password` field non-empty → `encryptSecret`; else omit the column from the update payload (preserve). Also derive `smtp_secure` from port when not provided (`port === 465` → true; `587` → false). `logActivity({ action: "email.settings_update", summary: "Updated email sending settings" })`. `revalidatePath("/settings/email")` + `/settings`.
- [ ] **Step 3: test route** — nodemailer `createTransport` + `verify()`, try `secure` first, on TLS-mismatch errors retry flipped (report `note: "Connected with SSL/STARTTLS — the toggle was adjusted automatically"`); auth errors → `"Authentication failed — check username and password (Gmail needs an App Password)."`; TLS errors → port hint. If `to` present, `transport.sendMail({ from, to, subject: "Lead Portal SMTP test", text: "Your email sending is configured correctly." })`. Follow the Taylor-AI `/api/emails/test` logic verbatim in spirit.
- [ ] **Step 4: `/settings/email` page** — server component: `getMyEmailSettings()` → render `<EmailSettingsForm initial={...} />`; container `mx-auto w-full max-w-[880px] px-4 py-8 sm:px-8`; header `<h1 className="text-lg font-semibold tracking-tight text-zinc-900">Email sending</h1>` + subtitle "Send outreach from your own mailbox. Only you can see these settings."
- [ ] **Step 5: form component** — fields per spec; **port input auto-sets the secure toggle** (465 → SSL on, 587 → off) with helper text "465 = SSL · 587 = STARTTLS — the toggle sets itself."; password input `type="password"` with placeholder `"••••••••"` when configured and label note "Leave blank to keep the saved password"; **[Send test email]** button (calls `/api/email/test` with current form values + `to: from_email`, shows testing/ok/error inline); Save via `saveEmailSettings` form action with `SubmitButton` pending state; signature phone + link fields. Style: existing `label`/`input`/`btn-primary`/`btn-ghost` classes, zinc palette.
- [ ] **Step 6:** `npm run lint && npm run build` → PASS. Commit: `feat: per-member email settings (SMTP + signature) with encrypted password`.

---

### Task 3: Pipeline pitch — actions + AI generate + edit dialog

**Files:**
- Modify: `src/lib/actions.ts` (`updatePipeline`, `generatePipelinePitch`)
- Create: `src/components/edit-pipeline-dialog.tsx`
- Modify: `src/app/(app)/settings/page.tsx` (Pipelines rows use the new dialog)

**Interfaces:**
- Produces: `updatePipeline(formData)` — fields `id`, `name`, `icon`, `pitch`, `value_props` (newline-separated text), `proof_points` (newline-separated), `cta`, `default_flavor`; splits on newlines, trims, drops empties; `logActivity({ action: "pipeline.update", summary: "Updated pipeline “<name>”" })`; `redirect("/settings")`.
- Produces: `generatePipelinePitch(notes: string, pipelineName: string): Promise<{ ok: true; pitch: string; value_props: string[]; proof_points: string[]; cta: string } | { ok: false; error: string }>` — `pickModel(userId)`, `generateText` with plain-JSON instructions (primary) then `generateObject` fallback (same pattern as `src/app/api/paste/route.ts:190-230`); system rules: "You sharpen the user's notes into a concise B2B service pitch. NEVER invent certifications, client names, or numbers not present in the notes. Return JSON: { pitch (2–3 sentences), value_props (3–5 bullets), proof_points (0–3, only if grounded in notes), cta (one short ask) }."
- Consumes: `getPipelines()` (already selects `*`, so pitch columns flow through after Task 1).

- [ ] **Step 1:** `updatePipeline` action (exact behavior above). Keep `renamePipeline` untouched (still used by tests) or replace its usage — the Settings page switches to the new dialog in Step 3.
- [ ] **Step 2:** `generatePipelinePitch` action.
- [ ] **Step 3: `edit-pipeline-dialog.tsx`** — extends the existing `rename-pipeline-dialog.tsx` shell (same portal-free fixed dialog, Escape/backdrop close, `animate-panel`): fields Name (maxLength 40), Icon grid (reuse `PIPELINE_ICONS` + `PipelineIcon` from the new-pipeline dialog), Pitch textarea, Value props textarea (one per line), Proof points textarea (one per line), CTA input, Default flavor select (the six + "No default"), and a **✨ Auto-generate** button (disabled when notes empty; pending state; fills the four fields from the response; shows errors inline). Trigger: pencil icon button (same as rename today). Form `action={updatePipeline}` with a `SubmitButton` "Save pipeline".
- [ ] **Step 4:** Settings → Pipelines rows: swap `RenamePipelineDialog` for `EditPipelineDialog` passing `{ id, name, icon, pitch, value_props, proof_points, cta, default_flavor }` (extend `getPipelineUsage` select to include the new columns).
- [ ] **Step 5:** `npm run lint && npm run build` → PASS. Commit: `feat: pipeline pitch fields with AI auto-generate`.

---

### Task 4: Draft generation — `src/lib/email.ts` + `/api/email/draft`

**Files:**
- Create: `src/lib/email.ts` (flavors, prompt, generation, post-processing)
- Create: `src/app/api/email/draft/route.ts`

**Interfaces:**
- Produces: `FLAVORS: readonly { id: string; label: string; brief: string }[]` — ids exactly `short-direct`, `pain-first`, `insight-authority`, `warm-intro`, `founder-founder`, `follow-up`.
- Produces: `generateEmailDraft(opts: { userId: string; orgId: number; contactId?: number | null; flavor: string }): Promise<{ ok: true; to: string; subject: string; body: string } | { ok: false; error: string }>`
- Produces: `POST /api/email/draft` body `{ orgId, contactId?, flavor }` → the same shape (auth required).

- [ ] **Step 1: flavor style blocks** — in `src/lib/email.ts`, exact six with these briefs:

```ts
export const FLAVORS = [
  { id: "short-direct", label: "Short & direct", brief: "One value prop, straight to the point. 60-80 words." },
  { id: "pain-first", label: "Pain-first", brief: "Open with a problem they likely have, tie it to the pitch. 70-90 words." },
  { id: "insight-authority", label: "Insight & authority", brief: "Lead with an insight or deadline relevant to their space, position expertise. 70-90 words." },
  { id: "warm-intro", label: "Warm intro", brief: "Reference something specific from their website or profile. Friendly. 70-90 words." },
  { id: "founder-founder", label: "Founder-to-founder", brief: "Peer tone, casual, low-pressure. 50-70 words." },
  { id: "follow-up", label: "Follow-up", brief: "Gentle bump. If a prior sent email is provided, reference it; otherwise a short intro. 30-50 words." },
] as const;
```

- [ ] **Step 2: data gathering** — org (`name`, `notes`, `website`), pipeline pitch (via `org.list` → `pipelines` row: `pitch`, `value_props`, `proof_points`, `cta`), person (contact by `contactId`: `name`, `title`; else greeting fallback), prior send (`sent_emails` latest for org/contact → subject + created_at), sender signature (`user_email_settings`).
- [ ] **Step 3: prompt** — persona "senior consultant writing cold outreach that reads like a real human wrote it"; inputs; flavor brief; **all Global Constraints rules verbatim**; greeting rule (never greet generic inboxes — reuse `isGenericEmail` from `src/lib/people.ts` on the email local part; fallback "Hi there,"); return JSON `{ subject, body }` only, no signature.
- [ ] **Step 4: generation + post-processing** — `pickModel(userId)`; `generateText` plain-JSON primary → `generateObject` fallback (paste-route pattern); deterministic cleanup: strip `\u2014`/`\u2013` → ", ", collapse whitespace, cap subject at 160 chars and 8 words, then append signature server-side from settings (`from_name`, `signature_phone`, `signature_link`, newline-joined, only set lines). Return `{ ok: true, to, subject, body }` where `to` = contact email ?? company's first email (else `{ ok: false, error: "No email address on this company — add one first." }`).
- [ ] **Step 5: route** — auth, validate `flavor` against `FLAVORS` ids (else 400 "Pick a flavor"), call `generateEmailDraft`, map errors to 500 with message. No audit entry for drafts (ephemeral).
- [ ] **Step 6:** `npm run lint && npm run build` → PASS. Commit: `feat: email draft generation (flavors, humanized rules, signature)`.

---

### Task 5: Send + records + audit — `/api/email/send`

**Files:**
- Create: `src/app/api/email/send/route.ts`
- Modify: `src/lib/email.ts` (`sendEmailViaSmtp`)

**Interfaces:**
- Produces: `sendEmailViaSmtp(settings: { host; port; secure; user; password; fromName; fromEmail }, msg: { to; subject; body }): Promise<void>` (throws with friendly message on failure).
- Produces: `POST /api/email/send` body `{ orgId, contactId?, to, subject, body }` → `{ ok: true }` | `{ ok: false, error }`.

- [ ] **Step 1:** `sendEmailViaSmtp` — `nodemailer.createTransport({ host, port, secure, auth: { user, pass }, tls: { rejectUnauthorized: false } })`; `sendMail({ from: "Name <email>", to, subject, text: body })`; friendly error mapping identical to the test route.
- [ ] **Step 2: route** — auth → load `user_email_settings` (must be configured, else 409 "Set up email sending first") → `decryptSecret` → send → insert `sent_emails` (`org_id`, `contact_id`, `sent_by: userId`, `to_email`, `subject`, `body`) → `logActivity({ actorId: userId, action: "email.sent", orgId, targetType: "company", summary: \`Sent “${subject}” to ${companyName} (${to})\` })` → insert `interactions` row (`org_id`, `contact_id`, `channel: "email"`, `summary: \`Email sent: ${subject}\``, `logged_by: userId`). Errors → 502 with the friendly message; nothing recorded on failure.
- [ ] **Step 3:** `npm run lint && npm run build` → PASS. Commit: `feat: send outreach via member SMTP with sent history + audit`.

---

### Task 6: Composer UI + entry points + "Sent by" in the table

**Files:**
- Create: `src/components/email-composer.tsx`
- Modify: `src/lib/data.ts` (`getCompanies` sent-by fields)
- Modify: `src/app/(app)/companies/page.tsx` (Email cell)
- Modify: `src/app/(app)/companies/[id]/page.tsx` (Draft email buttons)

**Interfaces:**
- Produces: `EmailComposer` props `{ orgId: number; contactId?: number | null; defaultTo?: string | null; defaultFlavor?: string | null; smtpConfigured: boolean; trigger: "icon" | "button"; triggerLabel?: string }` — renders its own trigger and the dialog.
- Produces (data): `CompanyRow` gains `last_sent_by_name: string | null`, `last_sent_at: string | null`, `last_sent_subject: string | null` (latest `sent_emails` per org + `userLabels()` resolution).

- [ ] **Step 1: `getCompanies`** — after the existing stats queries, one more query: `sent_emails` for the org ids ordered `created_at desc`, reduce to first per org; resolve sender label via the existing `labels` map; attach the three fields.
- [ ] **Step 2: table Email cell** — replace the mailto anchor: `<EmailComposer trigger="icon" orgId contactId={null} defaultTo={company.first_email} smtpConfigured={smtpConfigured} />` (icon button, same dimensions as today). Below it, when `last_sent_by_name`: `<span className="inline-flex items-center gap-1"><UserAvatar seed={...} size={16} /><span className="text-[11px] text-zinc-500">Sent by {last_sent_by_name}</span></span>` with `title={date + subject}`. Page fetches `smtpConfigured` once (`getMyEmailSettings`).
- [ ] **Step 3: company page** — Reach email rows and People rows get a small "Draft email" ghost button rendering `<EmailComposer trigger="button" contactId={contact.id} defaultTo={email} />`; pass `defaultFlavor` from the company's pipeline (`getPipelines` row by `company.list`).
- [ ] **Step 4: composer component** — dialog per spec §UI-3: To (editable), recipient chip (person name/title when known), **flavor selector (required; six chips)**, Generate (✨; disabled without flavor; pending state), Subject + Body (editable textareas), Regenerate, Copy (clipboard, "Copied ✓"), Send (disabled + "Set up email sending →" link to `/settings/email` when `!smtpConfigured`; pending "Sending…"; success "Sent ✓"), error line (`role="alert"`). Fetch `/api/email/draft` then `/api/email/send`; `router.refresh()` after send. Escape/backdrop close; `animate-panel`; `motion-reduce` spinners; no layout shift.
- [ ] **Step 5:** `npm run lint && npm run build` → PASS. Commit: `feat: email composer + sent-by in the companies table`.

---

### Task 7: Settings status card + wiring

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1:** Add an "Email sending" card (owner AND members see it — it's per-member) in the left column above "Your profile": status line `Configured ✓ · <from_email>` (emerald) or `Not set up yet` (amber), subtext "Send outreach from your own mailbox — only you can see these settings.", link button "Open email settings" → `/settings/email`. Fetch `getMyEmailSettings()` in the page's `Promise.all`.
- [ ] **Step 2:** `npm run lint && npm run build` → PASS. Commit: `feat: email sending status card in settings`.

---

### Task 8: Live E2E + docs

**Files:**
- Modify: `DESIGN.md` (one bullet: email composer + per-member SMTP + audit)
- Temp: `/var/folders/.../pwtest/email-e2e.mjs`

- [ ] **Step 1:** Update `DESIGN.md` "Enrichment cost order" area with a short "Outreach" bullet (drafts ≈ one AI call; sends via member SMTP; every send audited). Commit with the E2E fixes if any.
- [ ] **Step 2: E2E (Playwright, owner test user + Ethereal SMTP — no real credentials):**
  1. Create Ethereal creds via `POST https://api.nodemailer.com/user` (returns `user`, `pass`, `smtp.host/port/secure`).
  2. Login → `/settings/email` → fill SMTP + signature → **Send test email** → expect ok state.
  3. Settings → Pipelines → open Edit on a temp pipeline → type rough notes → ✨ Auto-generate → assert structured fields filled → save → verify DB columns.
  4. Open a company row → composer → **Generate without flavor** → blocked; pick `short-direct` → generate → assert: subject present, body ≤ ~120 words, no banned phrases, no em-dashes, signature appended.
  5. **Copy** → clipboard contains subject + body.
  6. **Send** → success; verify: `sent_emails` row (sent_by = test user), `activity_log` `email.sent` with actor, `interactions` row, companies table shows **"Sent by <name>"**, `/audit` shows the send under the actor, company timeline shows "Email sent: …".
  7. Follow-up flavor on the same company → body references the prior send.
  8. Screenshots: composer, settings page, table cell, audit entry.
  9. Cleanup: delete test user/profile/sent_emails/activity rows/temp pipeline; leave nothing behind.
- [ ] **Step 3:** `npm run lint && npm run build`; final commit if any fixes.

---

## Self-Review

- **Spec coverage:** pitch columns + AI generate (T3) ✓; six flavors required (T4/T6) ✓; per-member SMTP sub-page + encryption + write-only + test with auto-correct (T1/T2) ✓; generation rules incl. no-invent/banned/no-dashes/signature-server-side (T4) ✓; copy + send (T5/T6) ✓; audit `email.sent` + timeline + table "Sent by" (T5/T6) ✓; settings status card (T7) ✓; follow-up prior-send reference (T4 step 2/T8) ✓; non-goals excluded ✓.
- **Placeholder scan:** none — every step names files, fields, exact strings, or the existing pattern to copy (paste-route AI fallback, Taylor-AI test logic, ConfirmSubmit dialog shell).
- **Type consistency:** `FLAVORS` ids, `generateEmailDraft` return shape, `sendEmailViaSmtp` signature, `getMyEmailSettings` fields, and the three `CompanyRow` sent-by fields are identical across tasks.
- **Migration path:** applied in Task 1 via the same Management API flow used for the audit migration; version recorded; REST probes verify.

## Open items for the owner (non-blocking)

1. Your real SMTP credentials are yours to add later on `/settings/email` (Gmail needs an App Password). The E2E uses Ethereal, so no real creds are needed to build/verify.
2. The `SMTP_ENCRYPTION_KEY` is generated and stored in Vercel + `.env.local`; losing it means re-entering SMTP passwords (acceptable, note for the future).
