# Security & Secret-Handling Policy

This repository holds the **code** for the Lead Portal. It must never contain
credentials or customer data. Everyone with access (owner + editor) follows these rules.

## What counts as a credential — never commit

- Supabase keys: `anon` and especially `service_role`, database password, access tokens
- Vercel tokens · GitHub tokens (PATs) · email/SMTP passwords · any API key
- Private keys (`*.pem`, `*.key`), `*.p12`, service-account JSON files
- Real `.env` files of any kind

Safe in code: the Supabase project URL and the **placeholder** values in `.env.example`.

## Where credentials are allowed to live

| Secret | Allowed location |
| ------ | ---------------- |
| Local development keys | `.env.local` on your machine (git-ignored — never committed) |
| Production keys | Vercel → Project → Settings → Environment Variables |
| `service_role` key | Only for local scripts (`scripts/import-csv.mjs`) — never in browser code, never in a `NEXT_PUBLIC_*` variable |
| Database password | Your password manager |

## Automatic protections (active in this repo)

1. **`.gitignore`** — `.env*` (with `!.env.example`), `*.pem`, `*.key`, `*.p12`, service-account files.
2. **Pre-commit hook** (`.githooks/pre-commit`) — refuses to commit real env files or
   credential patterns (for example Supabase JWTs, Stripe/AWS/GitHub token shapes, private keys).
   It is installed automatically by `npm install` (via the `prepare` script).
   **Never bypass it with `git commit --no-verify`.**
3. **CI secret scan** (`.github/workflows/secret-scan.yml`) — TruffleHog runs on every
   push and pull request; a verified credential fails the workflow.
4. **GitHub secret scanning + push protection** — enable once in
   **Repo → Settings → Code security** (free on public repos; GitHub may require the paid
   Secret Protection add-on on private repos — layers 2–3 cover you either way).

## If a secret is ever committed (incident checklist)

A pushed secret is compromised immediately — even in a private repo, even if a later
commit deletes it.

1. **Rotate first, clean up second.**
   - Supabase: **Settings → API → Reset** the affected key · **Settings → Database** → reset password
   - Vercel: update the variable and redeploy · GitHub: revoke the token
2. Fix the code: move the value to an environment variable, merge the fix.
3. History cleanup (only after rotating): `git filter-repo` / BFG + force-push — or simply
   re-create the repo while it is still young.
4. Note what happened in an issue so it does not repeat.

## Data rules

- Customer/lead data lives in the database and in the local workspace CSVs — **not in this repo**.
- `scripts/import-csv.mjs` runs only locally with the service role key; it is never wired into CI.
