# Lead Portal — Admin UI

Web admin portal for the two lead databases (POS sales + compliance services).
Next.js + Supabase. Deployable to Vercel for free.

## What's inside

- Magic-link sign-in (no passwords) via Supabase Auth
- Two pipelines — **POS** and **Compliance** — one shared database, kept separate
- Companies, contacts (members), and append-only interaction logs
- Roles: first user becomes **Owner** (delete + manage users); everyone else is an **Editor** (add/edit only) — enforced by database Row-Level Security
- CSV importer for the existing workspace lists

## One-time setup

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**
   (this uses your second free slot — it does not affect your PoS project)
2. Pick a strong database password and the region closest to you, then wait ~2 minutes

### 2. Create the schema

1. In the project: **SQL Editor → New query**
2. Paste everything from `supabase/migrations/20261002000000_init.sql` → **Run**
   (run it once — migrations are single-apply)

### 3. Collect your keys

**Settings → API Keys** — copy:
- Project URL
- **Publishable** key (new projects) — legacy projects: the `anon` public key
- **Secret** key (new projects: `sb_secret_…`) — legacy projects: `service_role` key

### 4. Local environment

```bash
cp .env.example .env.local
# edit .env.local and paste the URL + keys
```

### 5. Redirect URLs (Auth)

**Authentication → URL Configuration**:
- Site URL: `http://localhost:3005`
- Redirect URLs: add `http://localhost:3005/auth/callback`

(Add the production URLs here again after deploying.)

### 6. Run it

```bash
npm install
npm run dev
```

Create your admin account in Supabase → **Authentication → Users → Add user →
Create new user** (your email + a strong password, enable **Auto Confirm User**).
You become the **owner** automatically (first account). Then sign in at
<http://localhost:3005> with that email and password.

### 7. Import your existing lists

```bash
node --env-file=.env.local scripts/import-csv.mjs
```

Reads `../companies.csv` and `../service-companies.csv` plus the detail Markdown
files (members + interaction logs). Safe to re-run — existing companies are skipped.

### 8. Go invite-only (RBAC)

1. Supabase → **Authentication → Sign In / Providers** → turn **OFF**
   "Allow new users to sign up" → Save. From now on nobody can self-create an
   account — partners join only by invitation.
2. In the portal: **Settings → Invite a partner** → enter their email → Send.
   They receive an email with a link, set their password on the Welcome screen,
   and land in the app as an **editor**.
3. Manage roles or remove users anytime in **Settings** — owner only. Editors can
   add/edit pipeline data; the database (RLS) blocks deletes and role changes.

> Invite emails use Supabase's built-in sender, which is rate-limited
> (a few per hour). For reliable delivery connect custom SMTP
> (free tiers: Resend, Brevo) in **Authentication → SMTP**.

## AI assistant ("Add with AI")

Each pipeline page has an **Add with AI** button next to "Add company". It opens a
chat panel where you paste research — links, notes, member lists — and the assistant
documents the company into that pipeline (it defaults to the pipeline you opened it
from) with duplicate-checking, using your own permissions. Manual entry stays on
every screen.

### Website & LinkedIn research

Paste just a website URL and the assistant will:

1. **Fetch the site** (plus /about, /team, /contact) — extracting the company name,
   description, LinkedIn company URL, emails, and any team members published on the site
2. **Discover LinkedIn employees via Apify** (optional) — creates contacts with names,
   titles, and profile URLs; prefers founders and senior people

To enable LinkedIn research, connect a free Apify account:

1. [apify.com](https://apify.com) → sign up (free plan includes $5/month credit)
2. Apify Console → **Settings → Integrations** → copy the **API token**
3. Add `APIFY_API_TOKEN=...` to `.env.local` and Vercel
4. Optional: swap the actor with `APIFY_LINKEDIN_ACTOR_ID` (default:
   `harvestapi/linkedin-company-employees`) and its input via `APIFY_LINKEDIN_ACTOR_INPUT`

Without Apify, website research still works and LinkedIn profiles stay manual.
Direct LinkedIn scraping is intentionally not implemented — LinkedIn blocks automation;
Apify actors are the supported route.

Enable it with an OpenCode subscription key (one model, fixed: **DeepSeek V4.1 Flash**):

1. Sign in at [opencode.ai/auth](https://opencode.ai/auth) → subscribe to **OpenCode Go** →
   **Create API key**
2. Add it to `.env.local` (and to Vercel → Environment Variables for production):
   `OPENCODE_API_KEY=...` — the assistant calls the Go endpoint
   (`https://opencode.ai/zen/go/v1`) with this single model
3. Restart the dev server

Fallbacks (used only when `OPENCODE_API_KEY` is empty): `OPENAI_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, or `GROQ_API_KEY` — `AI_MODEL` overrides those
fallback models.

## Deploy to Vercel (free)

1. Push this `admin-portal` folder to a GitHub repository (or use the Vercel CLI)
2. [vercel.com](https://vercel.com) → **Add New → Project** → import the repo
3. Add the two `NEXT_PUBLIC_*` environment variables
4. Deploy, then add `https://<your-app>.vercel.app/auth/callback` to
   Supabase → Authentication → URL Configuration → Redirect URLs
   (and update the Site URL)

## Keeping the database in sync with GitHub

This repository is built for Supabase's **native GitHub integration** — available on the
free plan. Once connected, every push to `main` that changes `supabase/migrations/`
is deployed to your project automatically (migrations are tracked as applied, so
re-pushing the same commit is safe).

**Connect it (after the Supabase project exists):**

1. Supabase dashboard → your project → **Settings → Integrations → GitHub**
2. Authorize and select the `lead-portal` repository
3. Working directory: `/` (the repo root — where `supabase/` lives)
4. Trigger the first deploy (a small commit push is enough)

> ⚠️ **Pick one path — do not double-apply.** The SQL Editor does not record applied
> migrations in Supabase's history table. If you let the GitHub integration deploy the
> migration, do **not** also paste it manually. If a migration has been applied by hand,
> run `supabase migration repair --status applied <timestamp>` (CLI) before switching
> to GitHub deploys.

**Prefer the CLI?** Same result from your machine:

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

> The CSV import (`scripts/import-csv.mjs`) is **seed data, not a migration** —
> it is never run automatically; run it once from your machine.

## Notes

- **Free tier pausing** — a free Supabase project pauses after ~1 week of inactivity.
  Your data is safe; restore takes one click in the dashboard.
- **Email limits** — Supabase's built-in email sender is rate-limited (a few per hour).
  Use the **Password** tab on the login page to avoid email entirely; for magic links,
  connect custom SMTP (free tiers: Resend, Brevo) in Supabase → Authentication → SMTP.
  For password sign-up, turn **off** "Confirm email" in
  Authentication → Sign In / Providers → Email (re-enable it once both accounts exist).
- **Keep `.env.local` secret** — it is git-ignored. Never commit keys. The full
  policy and incident checklist: [`SECURITY.md`](./SECURITY.md); a pre-commit hook
  and a CI scan block credential leaks automatically.
- Architecture details: see [`DESIGN.md`](./DESIGN.md).
