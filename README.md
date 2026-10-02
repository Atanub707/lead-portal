# Lead Portal — Admin UI

Web admin portal for the two lead databases (POS sales + compliance services).
Next.js + Supabase. Deployable to Vercel for free.

## What's inside

- Magic-link sign-in (no passwords) via Supabase Auth
- Two pipelines — **POS** and **Compliance** — one shared database, kept separate
- **Pipelines are data:** the owner can add new sections from the sidebar (**+ New
  pipeline**) with a name and an icon; they get the standard stages and work exactly
  like the built-in two (paste flow, filters, dashboard)
- Companies, contacts (members), and append-only interaction logs
- Action-first pipeline table: ★ bookmarks, **follow-ups** (overdue/today/upcoming),
  reach counts (people + emails found), one-click **Email** — with overdue/starred filters
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
2. In the portal: **Settings → Invite a partner** → enter their email →
   **Create invite link** → **Copy**. Send the link to them however you like
   (WhatsApp, Slack, email). Opening it signs them in and asks them to set a
   password, then lands them in the app as an **editor**. No email is sent and
   nothing is rate-limited; links are single-use and expire in 24 hours by default.
3. Manage roles or remove users anytime in **Settings** — owner only. Editors can
   add/edit pipeline data; the database (RLS) blocks deletes and role changes.

> Prefer automatic invite emails? That needs custom SMTP (free tiers: Resend,
> Brevo) in **Authentication → SMTP** — but the copyable link works without it
> and never hits Supabase's built-in email rate limits.

## AI assistant ("Paste URL with AI")

Each pipeline page has a **Paste URL with AI** button next to "Add company". Paste a
company website, pick the pipeline (POS or Compliance — it defaults to the page you
opened), and press **Go**. There is no chat: one URL in, a full pipeline record out.

The assistant does the whole job in one shot:

1. **Fetches the site** (plus /about, /team, /contact) — using TinyFish when
   `TINYFISH_API_KEY` is set (free; renders JavaScript-heavy sites) and falling back
   to a built-in fetcher otherwise
2. **Extracts the company** — name, description, LinkedIn company URL, emails, and the
   people published on the site (team/about pages)
3. **Finds personal LinkedIn profiles** — free TinyFish Search per person when the site
   doesn't link them; only confident name + company matches are saved
4. **Saves everything** — creates the company in the selected pipeline (or updates it
   when it already exists) and adds the contacts it found; duplicates are skipped

It finishes with a short summary: record link, contacts added, whether the LinkedIn
company URL was found, and what's still missing so you can fill it by hand.

### LinkedIn employee rosters are manual

Employee scraping is intentionally not automated (LinkedIn blocks bots, and paid actors
aren't worth it for this use case). The pipeline record keeps the company's LinkedIn
URL — the research step finds it — and people are added manually on the company page.
Each contact without a LinkedIn URL also has a **Find LinkedIn** button: one free search
on demand, matched against their name + company. No confident match = nothing is saved.

**Costs:** all research is free — TinyFish Fetch/Search are free on every plan
(limits around 1,000 fetched URLs/day and 500 searches/hour) and the built-in fallback
costs nothing. Only the AI extraction call is metered, covered by your OpenCode Go
subscription.

**Guardrails:** only the exact domain you pasted (plus up to 3 subpages of it) is ever
fetched, private/local addresses are blocked, and the TinyFish search fallback only ever
looks up the company's own LinkedIn page — never people.

**Optional TinyFish upgrade:** create a key at
[agent.tinyfish.ai](https://agent.tinyfish.ai) → **API Keys**, then add
`TINYFISH_API_KEY=...` to `.env.local` and Vercel. Without it the portal falls back to a
built-in fetcher and skips the search fallback — everything still works.

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
3. Add the environment variables (Supabase publishable/secret keys, `OPENCODE_API_KEY`,
   and optionally `TINYFISH_API_KEY`) — see `.env.example`
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
