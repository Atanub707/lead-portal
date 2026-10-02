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

**Settings → API** — copy:
- Project URL
- `anon` public key
- `service_role` key (secret)

### 4. Local environment

```bash
cp .env.example .env.local
# edit .env.local and paste the URL + keys
```

### 5. Redirect URLs (Auth)

**Authentication → URL Configuration**:
- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/auth/callback`

(Add the production URLs here again after deploying.)

### 6. Run it

```bash
npm install
npm run dev
```

Open <http://localhost:3000> → sign in with your email → **you become the owner**
(the first account is auto-assigned the owner role).

### 7. Import your existing lists

```bash
node --env-file=.env.local scripts/import-csv.mjs
```

Reads `../companies.csv` and `../service-companies.csv` plus the detail Markdown
files (members + interaction logs). Safe to re-run — existing companies are skipped.

### 8. Invite your friend

They open the deployed URL, sign in with their email, and automatically become an
**editor**. You can review roles anytime in **Settings**.

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
- **Magic-link email limits** — Supabase's built-in email sender is rate-limited.
  Fine for a 2-person team; connect custom SMTP later if needed.
- **Keep `.env.local` secret** — it is git-ignored. Never commit keys. The full
  policy and incident checklist: [`SECURITY.md`](./SECURITY.md); a pre-commit hook
  and a CI scan block credential leaks automatically.
- Architecture details: see [`DESIGN.md`](./DESIGN.md).
