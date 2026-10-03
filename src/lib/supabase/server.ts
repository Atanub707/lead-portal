import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Supabase client bound to the signed-in Clerk user (Supabase third-party auth),
// so Row-Level Security evaluates as that user. The "supabase" JWT template adds
// the `role: authenticated` claim that PostgREST requires.
export async function createClient() {
  const { getToken } = await auth();
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => (await getToken({ template: "supabase" })) ?? null,
    }
  );
}
