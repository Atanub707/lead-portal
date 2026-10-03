import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Clerk session tokens live ~60s. Without caching, every Supabase query on
// every render (and every prefetch) fetches a fresh token from Clerk — which
// multiplies traffic, adds latency, and can trip Clerk's rate limits (429).
// A short in-memory cache per warm server instance fixes all three.
const TOKEN_TTL_MS = 45_000;
const MAX_ENTRIES = 200;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function cachedToken(
  sessionId: string | null,
  getToken: (options: { template: string }) => Promise<string | null>
): Promise<string | null> {
  if (!sessionId) return (await getToken({ template: "supabase" })) ?? null;

  const now = Date.now();
  const hit = tokenCache.get(sessionId);
  if (hit && hit.expiresAt > now) return hit.token;

  const token = (await getToken({ template: "supabase" })) ?? null;
  if (token) {
    if (tokenCache.size >= MAX_ENTRIES) {
      const oldest = tokenCache.keys().next().value;
      if (oldest) tokenCache.delete(oldest);
    }
    tokenCache.set(sessionId, { token, expiresAt: now + TOKEN_TTL_MS });
  }
  return token;
}

// Supabase client bound to the signed-in Clerk user (Supabase third-party auth),
// so Row-Level Security evaluates as that user. The "supabase" JWT template adds
// the `role: authenticated` claim that PostgREST requires.
export async function createClient() {
  const { sessionId, getToken } = await auth();
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () =>
        cachedToken(sessionId, (options) => getToken(options)),
    }
  );
}
