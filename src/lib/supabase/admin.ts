import { createClient } from "@supabase/supabase-js";

// Server-only. Never import this from a Client Component — it uses the secret key.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secret) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY in .env.local — required for invitations and user management."
    );
  }

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
