import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "./supabase/admin";
import type { Profile, UserRole } from "./types";

// Returns the signed-in user's profile, creating it on first login.
// Role: invitation metadata ({ role }) or editor by default.
// Workspace: invitation metadata ({ workspace_id }) when invited; otherwise
// NULL — the app gate redirects to /onboarding to create a workspace.
export async function ensureProfile(): Promise<Profile | null> {
  const user = await currentUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (existing) return existing as Profile;

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const metadata = user.publicMetadata as {
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
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

  const { data: created } = await admin
    .from("profiles")
    .insert({
      id: user.id,
      email,
      full_name: fullName,
      role,
      workspace_id: workspaceId,
    })
    .select("*")
    .single();

  return (created as Profile) ?? null;
}
