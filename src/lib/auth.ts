import { auth, currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "./supabase/admin";
import type { Profile, UserRole } from "./types";

// Returns the signed-in user's profile, creating it on first login.
//
// The session id comes from auth() — verified by the middleware from the
// session JWT, no Clerk API call — so profile resolution never fails when
// Clerk's API is slow, rate-limited, or briefly unreachable. currentUser()
// is only used when a profile is being created (for name/email/metadata).
//
// Role: invitation metadata ({ role }) or editor by default.
// Workspace: invitation metadata ({ workspace_id }) when invited; otherwise
// NULL — the app gate redirects to /onboarding to create a workspace.
export async function ensureProfile(): Promise<Profile | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return existing as Profile;

  // First login: create the profile. currentUser() may be unavailable —
  // degrade to a minimal profile (name/email fill in later on settings save).
  const user = await currentUser().catch(() => null);

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const metadata = (user?.publicMetadata ?? null) as {
    role?: string;
    workspace_id?: string;
  } | null;
  const invitedRole = metadata?.role;
  const role: UserRole =
    invitedRole === "owner" || invitedRole === "editor"
      ? invitedRole
      : (count ?? 0) === 0
        ? "owner"
        : "editor";

  const workspaceId =
    typeof metadata?.workspace_id === "string"
      ? metadata.workspace_id
      : null;

  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    null;
  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

  const { data: created } = await admin
    .from("profiles")
    .insert({
      id: userId,
      email,
      full_name: fullName,
      role,
      workspace_id: workspaceId,
    })
    .select("*")
    .single();

  return (created as Profile) ?? null;
}
