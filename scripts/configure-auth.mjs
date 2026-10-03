// Configures Supabase Auth for production via the Management API:
//   1. Site URL + redirect allowlist (magic links, password resets)
//   2. Brevo SMTP (reliable delivery for magic links and reset emails)
//
// Requires in .env.local:
//   SUPABASE_ACCESS_TOKEN  — supabase.com/dashboard/account/tokens
//   BREVO_SMTP_KEY         — brevo.com → SMTP & API → SMTP tab (xsmtpsib-…)
//
// Run: node --env-file=.env.local scripts/configure-auth.mjs

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const smtpKey = process.env.BREVO_SMTP_KEY?.trim();
const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ??
  "https://lead-portal-9siz.vercel.app";

if (!supabaseUrl) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
  process.exit(1);
}
if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN in .env.local — create one at https://supabase.com/dashboard/account/tokens"
  );
  process.exit(1);
}

const ref = new URL(supabaseUrl).hostname.split(".")[0];
const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const current = await (await fetch(api, { headers })).json();
console.log("current site_url:", current.site_url ?? "-");
console.log("current redirect allowlist:", current.uri_allow_list ?? "-");
console.log("current smtp_host:", current.smtp_host ?? "(built-in Supabase mailer)");

const redirects = [
  `${siteUrl}/auth/callback`,
  `${siteUrl}/welcome`,
  "http://localhost:3005/auth/callback",
  "http://localhost:3005/welcome",
];

const body = {
  site_url: siteUrl,
  uri_allow_list: redirects.join(","),
};

if (smtpKey && senderEmail) {
  body.smtp_host = "smtp-relay.brevo.com";
  body.smtp_port = 587;
  body.smtp_user = senderEmail;
  body.smtp_pass = smtpKey;
  body.smtp_admin_email = senderEmail;
  body.smtp_sender_name = "Lead Portal";
} else {
  console.log(
    "\n(no BREVO_SMTP_KEY — skipping SMTP; magic-link and reset emails will use Supabase's rate-limited sender)"
  );
}

const res = await fetch(api, {
  method: "PATCH",
  headers,
  body: JSON.stringify(body),
});
const updated = await res.json();
if (!res.ok) {
  console.error("PATCH failed:", res.status, JSON.stringify(updated).slice(0, 300));
  process.exit(1);
}

console.log("\nupdated site_url:", updated.site_url);
console.log("updated redirect allowlist:", updated.uri_allow_list);
console.log("smtp_host:", updated.smtp_host ?? "(unchanged / not set)");
console.log("smtp_user:", updated.smtp_user ?? "-");
console.log("smtp_pass set:", Boolean(updated.smtp_pass));
console.log("\nDone. Test: sign in with a magic link from the login page.");
