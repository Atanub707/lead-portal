import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "./supabase/admin";
import { HI_LABS_WORKSPACE_ID, type Profile, type UserRole } from "./types";

// Returns the signed-in user's profile, creating it on first login.
// The first profile ever becomes the owner; everyone else defaults to editor.
// Invited users can carry a role via Clerk invitation public metadata
// ({ role: "owner" | "editor" }), which Clerk copies onto the user.
// Workspace: invitation metadata may carry workspace_id; otherwise the
// account joins HI Labs (Plan 1 fallback — Plan 2 replaces this with the
// create-your-workspace onboarding flow).
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
      : HI_LABS_WORKSPACE_ID;

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
