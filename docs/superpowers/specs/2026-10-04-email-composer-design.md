# Email Composer & Outreach — Design

**Status:** DRAFT for owner review · **Date:** 2026-10-04 · **Author:** build session

## Goal

Generate personalized, human-sounding outreach emails inside the admin portal — per company and per person — grounded in (a) the **pipeline's pitch** (what we're offering), (b) the **company's researched profile**, and (c) a required **flavor**. Members then copy or send from **their own mailbox**, with a full audit of who sent what.

## Non-goals (v1)

Sequences/automation, open/click tracking, reply detection (IMAP), attachments, scheduling, non-English output, user-authored custom templates, multiple mailboxes per user.

## Locked decisions

1. **The pipeline is the offering.** Each pipeline carries a structured pitch (positioning statement, value bullets, proof points, CTA) with a **✨ Auto-generate** button: rough notes in → sharpened, structured pitch out (never invents claims).
2. **Six flavors, required at generation:** Short & direct · Pain-first · Insight & authority · Warm intro · Founder-to-founder · Follow-up.
3. **Per-member email identity** on a dedicated sub-page (Settings → Email sending), not in the main settings cards.
4. **SMTP passwords encrypted at rest** (AES-256-GCM, versioned envelope), write-only, decrypted server-side only for test/send.
5. **Copy always available; Send** only when the member's SMTP is configured.
6. **Every send is audited** (actor = sender) and shown on the company timeline; the companies table shows the latest **"Sent by <name>"**.
7. **Generation quality follows the Taylor-AI reference** (`/Users/atanubiswas/Desktop/Projects/Taylor-AI/Taylor-AI-App`): short, human, banned phrases, no em/en dashes, deterministic signature, real facts only.

## Data model (one migration)

### `pipelines` — new columns

| Column | Type | Notes |
|---|---|---|
| `pitch` | `text` | positioning statement, 2–3 sentences |
| `value_props` | `text[]` | 3–5 bullets |
| `proof_points` | `text[]` | certifications / case studies / numbers |
| `cta` | `text` | preferred ask ("15-min call", "free readiness check") |
| `default_flavor` | `text` | optional preselect in the composer |

### `user_email_settings` — new table

`user_id text primary key references profiles(id) on delete cascade`, `from_name text`, `from_email text`, `smtp_host text`, `smtp_port integer`, `smtp_secure boolean`, `smtp_user text`, `smtp_password_enc text` (envelope), `signature_phone text`, `signature_link text`, `updated_at timestamptz default now()`.

- RLS: select/insert/update **own row only** (`user_id = public.clerk_user_id()`).
- The password is never returned to any client; the UI shows a "Saved ✓" state only.

### `sent_emails` — new table

`id`, `org_id bigint references organizations(id) on delete cascade`, `contact_id bigint references contacts(id) on delete set null`, `sent_by text references profiles(id) on delete set null`, `to_email text`, `subject text`, `body text`, `created_at timestamptz default now()`; index `(org_id, created_at desc)`.

- RLS: select for authenticated (team-visible history — internal tool); writes are server-side only.
- Serves three consumers: the table's "Sent by" cell, the Follow-up flavor's prior-email reference, and per-company history.

## Encryption

- `SMTP_ENCRYPTION_KEY` env (32 random bytes, 64 hex chars) in Vercel + `.env.local`.
- AES-256-GCM, random 12-byte nonce, envelope `v1:<nonce>:<tag>:<ciphertext>` (base64 parts), tamper-detecting and fail-closed.
- Decrypt only inside test/send server paths; never logged, never returned.

## Generation pipeline (`src/lib/email.ts`)

**Inputs:** pipeline pitch fields · company (name, description/notes, website, latest research facts) · recipient (name/title/email, or a safe generic greeting) · flavor · sender signature (from `user_email_settings`) · prior sent email to that company/contact (for Follow-up).

**Prompt rules (Taylor-AI derived):**
- Persona: senior consultant writing cold outreach that reads like a real human wrote it.
- Greeting: exact first line; **never greet generic inboxes** (`info`, `contact`, `sales`, `careers`, …); fall back to "Hi there,".
- Length: **60–90 words** (Follow-up 30–50), max two short paragraphs.
- First person; confident opener + one fit line + soft ask.
- **Real facts only** — pitch + company data; never invent numbers, clients, certifications.
- Banned phrases: "I hope this email finds you well", "I'm writing to", "leverage", "passionate", "excited", "thrilled", exclamation marks, bullets/listicles.
- **No em/en dashes** anywhere.
- Return JSON only: `{ subject ≤ 8 words, body }`; the model never writes a signature.

**Flavors (style blocks):**

| Flavor | Angle | Length | Ask |
|---|---|---|---|
| Short & direct | one value prop, straight to the point | 60–80w | soft call |
| Pain-first | opens with a problem they likely have, ties to pitch | 70–90w | soft call |
| Insight & authority | leads with an insight/deadline relevant to their space | 70–90w | invite to compare notes |
| Warm intro | references something specific from their site/profile | 70–90w | friendly chat |
| Founder-to-founder | peer, casual, low-pressure | 50–70w | quick exchange |
| Follow-up | gentle bump; references the prior send when one exists, else short intro | 30–50w | single-line ask |

**Deterministic post-processing:** strip em/en dashes, collapse whitespace, trim subject, append signature server-side (`from_name`, `signature_phone`, `signature_link` — each line only when set).

## Send pipeline

- `POST /api/email/draft` → `{ subject, body }` (one AI call, ~$0.005).
- `POST /api/email/send` → load + decrypt sender settings → nodemailer send → on success: insert `sent_emails`, `logActivity("email.sent", "Sent “<subject>” to <company> (<to>)")`, insert an interaction (channel `email`) for the timeline → return ok. Friendly errors: auth → "check username/password (Gmail needs an App Password)"; TLS → "port 465 uses SSL, 587 uses STARTTLS".
- `POST /api/email/test` → nodemailer `verify()` with **auto SSL↔STARTTLS correction** (Taylor-AI pattern) + test email to self.

## UI

1. **Companies table — Email cell:** compose icon (replaces bare mailto); when an email has been sent, show **avatar + "Sent by <name>"** (tooltip: date + subject). Data from latest `sent_emails` per org (extend `getCompanies`).
2. **Company page:** "Draft email" on Reach email rows and People rows (recipient prefilled; person name/title used for personalization). Timeline shows sent emails via interactions.
3. **Composer dialog:** To (editable) · recipient chip · **flavor selector (required)** · Generate ✨ → editable subject/body · Regenerate · Copy · Send. Send disabled with "Set up email sending →" when unconfigured. Pending + error states.
4. **Settings:** "Email sending" status card (Configured ✓ `from_email` / Not set up) → link.
5. **`/settings/email`:** sender name/email, SMTP host/port/secure (auto-set from port), username, password (write-only), signature phone/link, **[Send test email]**, Save. Per-member only.
6. **Pipeline edit dialog:** extends the existing rename dialog with the pitch fields + ✨ Auto-generate; reachable from Settings → Pipelines ("Edit").

## Audit

- `email.sent` — actor = sender, org, recipient, subject (shows under the sender's name in the audit screen, filterable by user).
- `email.settings_update`, `pipeline.pitch_update` — logged like other mutations.

## Security & privacy

- Own-row-only settings; the owner cannot read members' SMTP secrets.
- Sent bodies stored and team-visible (internal tool) — called out here for explicit approval.
- No secrets in logs; encryption fail-closed.

## Success criteria (live verification)

1. Member configures SMTP → test email arrives → status shows Configured.
2. Pipeline pitch saved via Auto-generate (rough notes → structured).
3. From a company row: flavor required → draft generated (≤90 words, no banned phrases, signature appended) → editable → Copy works.
4. Send → arrives from the member's address → companies table shows "Sent by <member>" → audit shows `email.sent` under that member → timeline shows it.
5. Follow-up flavor references the prior send when one exists.
6. Unconfigured member: Send disabled with setup link.
