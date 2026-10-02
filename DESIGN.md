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

- Every authenticated user can **read** all records, **insert**, and **update**.
- **Delete** (organizations, contacts, interactions) and **role changes** are owner-only.
- Enforcement is two-layered:
  1. **RLS policies** in Postgres — `is_owner()` checks the caller's profile role. Even a crafted API call cannot delete as an editor.
  2. Server Actions double-check owner status before destructive operations.
- The first account to sign up becomes `owner` automatically (trigger `handle_new_user`). Everyone after is `editor`.
- Service role key is used only by the local import script and never shipped to the browser.

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

## Future upgrades

1. AI enrichment on add (paste URL → industry, size, description, contact suggestions)
2. Kanban board per pipeline + saved views
3. Reminders/digest emails ("follow-ups due this week")
4. CSV export, duplicate detection
5. Trust-center watcher for compliance leads (new SOC 2 / ISO badges)
