// Backfill company_emails from the normalized "Email:" lines in notes.
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)[1].trim();
const key = env.match(/SUPABASE_SECRET_KEY=(.+)/)[1].trim();
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function rest(path, init = {}) {
  const res = await fetch(url + path, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text.slice(0, 200)}`);
  if (res.status === 204 || text.length === 0) return null;
  return JSON.parse(text);
}

async function main() {
  const orgs = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(
      `/rest/v1/organizations?select=id,workspace_id,notes&order=id&offset=${from}&limit=1000`
    );
    orgs.push(...page);
    if (page.length < 1000) break;
  }

  const rows = [];
  for (const org of orgs) {
    if (!org.notes || !org.workspace_id) continue;
    for (const line of org.notes.split(/\r?\n/)) {
      const match = line.match(/^\s*Email:\s*(.+)$/i);
      if (!match) continue;
      const email = match[1].trim().toLowerCase();
      if (!EMAIL_RE.test(email)) continue;
      rows.push({
        org_id: org.id,
        workspace_id: org.workspace_id,
        email,
        kind: "general",
        source: "notes",
      });
    }
  }

  if (rows.length > 0) {
    await rest("/rest/v1/company_emails?on_conflict=org_id,email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }
  console.log(`backfilled ${rows.length} company emails from notes`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
