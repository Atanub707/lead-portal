import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "./supabase/admin";
import type { Profile, UserRole } from "./types";

// Returns the signed-in user's profile, creating it on first login.
// The first profile ever becomes the owner; everyone else defaults to editor.
// Invited users can carry a role via Clerk invitation public metadata
// ({ role: "owner" | "editor" }), which Clerk copies onto the user.
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

  const invitedRole = (user.publicMetadata as { role?: string } | null)?.role;
  const role: UserRole =
    invitedRole === "owner" || invitedRole === "editor"
      ? invitedRole
      : (count ?? 0) === 0
        ? "owner"
        : "editor";

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;
  const fullName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || null;

  const { data: created } = await admin
    .from("profiles")
    .insert({ id: user.id, email, full_name: fullName, role })
    .select("*")
    .single();

  return (created as Profile) ?? null;
}
