# Lead Portal — Documentation

Architecture, security model, and data design for the admin portal.

## Purpose

Web admin UI for two segregated lead databases, shared between the owner and one editor:

1. **POS Sales** — selling the PoS system
2. **Compliance Services** — selling SOC 2 / ISO 27000 readiness & compliance

Both live in one Supabase project but are kept logically separate via the `list` field on every organization.

## Stack

| Layer | Choice | Notes |
| ----- | ------ | ----- |
| Frontend | Next.js 16 (App Router, TypeScript, Tailwind v4) | Server Components + Server Actions |
| Auth | Supabase Auth — email magic link | No passwords to manage |
| Database | Supabase Postgres (free tier, dedicated project) | Separate from the PoS product's project |
| Security | Postgres Row-Level Security | Permissions enforced in the DB, not just UI |
| Hosting | Vercel (free) | Env vars: the two `NEXT_PUBLIC_*` keys |

## Data model

```
profiles        id (auth user), email, full_name, role (owner | editor)
organizations   id, list (pos | compliance), name, website, linkedin_url,
                kind (lead | partner | competitor | other), status, priority,
                next_action, last_contact, notes, created_by
contacts        id, org_id → organizations, name, title, linkedin_url,
                email, phone, notes
interactions    id, org_id, contact_id (nullable), occurred_on, channel,
                summary, outcome, logged_by
```

Pipeline stages:
- POS: `new → contacted → demo → proposal → won / lost`
- Compliance: `new → contacted → scoping → proposal → won / lost`

## Security model

- **Invite-only access** — public sign-up is disabled in Supabase. Accounts are
  created only by an owner invitation (`inviteUserByEmail`); the invitee sets a
  password on `/welcome`, then signs in normally.
- Every authenticated user can **read** all records, **insert**, and **update**.
- **Delete** (organizations, contacts, interactions), **role changes**,
  **invitations**, and **user removal** are owner-only.
- Enforcement is three-layered:
  1. **RLS policies** in Postgres — `is_owner()` checks the caller's profile role.
     A crafted API call cannot delete as an editor.
  2. Server Actions double-check owner status before destructive/admin operations.
  3. Supabase Auth admin API (secret key) is required for invitations/removals and
     is only reachable server-side.
- The first account created becomes `owner` automatically (trigger
  `handle_new_user`); invited users join as `editor`.
- The secret/service-role key is used only server-side (CSV import script +
  invitation admin API) and is never shipped to the browser.

## Key flows

- **Sign in** — email → magic link → `/auth/callback` exchanges the code → session cookie (via `@supabase/ssr`).
- **Auth gate** — the `(app)` layout verifies the session on every request; unauthenticated users are redirected to `/login`. All portal routes are dynamic-rendered (no caching of personnel data).
- **Add company** — creates the record (status `new`) → redirects to its detail page.
- **Log interaction** — appends to the timeline and bumps `last_contact` if the interaction is newer.
- **Import** — `scripts/import-csv.mjs` parses the workspace CSVs + Markdown detail files (members + interaction logs) and seeds the database idempotently.

## Deliberate choices (v1)

- **No kanban board yet** — table + filters first; drag-and-drop is a later upgrade.
- **No AI enrichment yet** — planned next: paste a URL → server function drafts an enriched record.
- **No email reminders yet** — next action + last contact are tracked for manual review.
- **Free tier** — the Supabase project pauses after ~1 week of inactivity; data is safe and restore is one click.

## Companies table (action-first)

Columns: ★ bookmark toggle · Company (name → record, domain → external link) ·
Type (AI-assigned) · Reach ("N people · M emails" — contacts + emails found by
research) · Follow-up (dated chip: overdue / today / upcoming, set via mini-dialog
with an optional note) · Email (mailto to the first address found).

Filters: search, Type, Follow-up state (overdue / due this week / none), Starred only.
Removed from the table but kept on the detail page: status, priority, next action,
last contact. Status still powers the dashboard stage counts.

Fields added in `20261002010000_actions.sql`: `bookmarked`, `follow_up_on`,
`follow_up_note`, `emails text[]` (general emails from research, separate from
per-contact emails).

## Research pipeline ("Paste URL with AI")- **Flow** (`src/app/api/paste/route.ts`): one POST does research → AI extraction →
  duplicate-checked writes (company + contacts) and returns a summary. No chat.
- **Website research** (`src/lib/research.ts` → `researchWebsite`): fetches a public site
  plus up to 3 subpages (/about, /team, /contact). Prefers TinyFish Fetch when
  `TINYFISH_API_KEY` is set (free — JS-rendered pages, clean markdown) with a TinyFish
  Search fallback for the LinkedIn company URL when it is not linked on the site;
  otherwise falls back to a built-in SSRF-guarded fetcher (public hosts only — redirects
  re-validated; size/time caps). Extracts title/description/LinkedIn URLs/emails/socials
  plus page text excerpts. The built-in fetcher also decodes Cloudflare-obfuscated
  emails and, for JS-only (SPA) sites, mines the site's own script chunks (capped:
  80 chunks / 6 MB / 8s each) for LinkedIn/social links and mailto addresses — this
  recovers footers that only exist client-side, with no key required.
- **AI extraction** (`src/lib/ai.ts` → `pickModel`): plain-text generation with a strict
  JSON shape is primary (avoids DeepSeek/OpenCode-Go `response_format` quirks), tolerant
  parse + zod validation; `generateObject` is the fallback. The model is instructed to
  never invent URLs, emails, or people.
- **Personal LinkedIn discovery (free):** during each paste, contacts without a LinkedIn
  URL get one TinyFish Search each (`site:linkedin.com/in "Name" "Company"`); only
  confident name+company matches are saved (`findLinkedInProfile`). A per-contact
  **Find LinkedIn** button on the company page does the same on demand.
- **LinkedIn employee rosters are manual** — direct scraping is the blocked/banned
  surface, and the paid Apify actor was removed (2026-10) in favor of the free
  company/profile-URL lookups. The old integration is recoverable from git history.
- **Enrichment cost order:** website + company LinkedIn + personal profile URLs are all
  free (TinyFish, or the built-in fetcher). Paid tools (Apify deep-dive, email
  verification) come only after a person is known and worth it; personal emails are
  manual — no safe public source exists.
- **Laya ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya)) has
  no role here:** it is a ~400M-param non-autoregressive *classifier* (calibrated
  choice/score/yes-no decisions, ~33 ms/pass, Apache-2.0) — not a web or enrichment
  tool. The only place it fits is high-volume bulk-intake classification (see Future
  upgrades), and it needs its own GPU host.

## Future upgrades

1. AI enrichment on add (paste URL → industry, size, description, contact suggestions)
2. Kanban board per pipeline + saved views
3. Reminders/digest emails ("follow-ups due this week")
4. CSV export, duplicate detection
5. Trust-center watcher for compliance leads (new SOC 2 / ISO badges)
6. **Bulk intake with Laya classification** (planned — trigger: when batch lists arrive,
   e.g. hundreds of companies at once):
   - Flow: paste/upload raw list → **Laya** pre-classifies each item with typed questions
     (`list`: pos/compliance, `kind`, `priority`, `is_company`) → review grid → import to Supabase.
   - Why Laya ([convaiinnovations/laya](https://huggingface.co/convaiinnovations/laya), Apache-2.0,
     ~400M params): non-generative decision model, ~33 ms per forward pass, 100+ languages,
     calibrated probabilities, nothing to hallucinate. Cheap first pass; the LLM assistant
     (DeepSeek via OpenCode Go) handles only extraction/enrichment.
   - Infra note: Laya is Python and ~400 MB — **cannot run on Vercel serverless**. Needs its own
     always-on host running `laya-serve` (small VPS/container) behind an internal API route.
   - Not needed at current volume — the Go/DeepSeek assistant covers single-lead entry end-to-end.
