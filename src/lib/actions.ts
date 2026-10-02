"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { findLinkedInProfile, tinyfishEnabled } from "./research";
import type { OrgKind, OrgList, PipelineStage, UserRole } from "./types";
import { KIND_OPTIONS, PRIORITY_OPTIONS, STATUS_LABEL } from "./types";

function field(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function revalidateAll(orgId?: number) {
  revalidatePath("/dashboard");
  revalidatePath("/companies");
  if (orgId) revalidatePath(`/companies/${orgId}`);
}

async function assertOwner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (data?.role !== "owner") {
    throw new Error("Only the owner can do this");
  }
  return supabase;
}

// ─── Organizations ───────────────────────────────────────────────────────────

export async function createOrganization(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const name = field(formData, "name");
  if (!name) throw new Error("Company name is required");

  const list = (field(formData, "list") === "compliance"
    ? "compliance"
    : "pos") as OrgList;
  const kind = field(formData, "kind");
  const priority = field(formData, "priority");

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      list,
      name,
      website: field(formData, "website"),
      linkedin_url: field(formData, "linkedin_url"),
      kind: (kind && KIND_OPTIONS.includes(kind as OrgKind)
        ? kind
        : "lead") as OrgKind,
      status: "new",
      priority:
        priority && PRIORITY_OPTIONS.includes(priority as never)
          ? priority
          : null,
      next_action: field(formData, "next_action"),
      notes: field(formData, "notes"),
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidateAll(data.id);
  redirect(`/companies/${data.id}`);
}

export async function updateOrganization(formData: FormData) {
  const supabase = await createClient();
  const id = Number(field(formData, "id"));
  if (!id) throw new Error("Missing company id");

  const status = field(formData, "status");
  const kind = field(formData, "kind");
  const priority = field(formData, "priority");

  const { error } = await supabase
    .from("organizations")
    .update({
      name: field(formData, "name") ?? "Unnamed",
      website: field(formData, "website"),
      linkedin_url: field(formData, "linkedin_url"),
      kind: (kind && KIND_OPTIONS.includes(kind as OrgKind)
        ? kind
        : "lead") as OrgKind,
      status: (status && STATUS_LABEL[status as PipelineStage]
        ? status
        : "new") as PipelineStage,
      priority:
        priority && PRIORITY_OPTIONS.includes(priority as never)
          ? priority
          : null,
      next_action: field(formData, "next_action"),
      last_contact: field(formData, "last_contact"),
      follow_up_on: field(formData, "follow_up_on"),
      follow_up_note: field(formData, "follow_up_note"),
      notes: field(formData, "notes"),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidateAll(id);
}

export async function toggleBookmark(
  orgId: number,
  bookmarked: boolean
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("organizations")
    .update({ bookmarked })
    .eq("id", orgId);
  if (error) return { ok: false };

  revalidateAll(orgId);
  return { ok: true };
}

export async function setFollowUp(
  orgId: number,
  date: string | null,
  note: string | null
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  const cleanDate =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const { error } = await supabase
    .from("organizations")
    .update({
      follow_up_on: cleanDate,
      follow_up_note: cleanDate ? note?.trim() || null : null,
    })
    .eq("id", orgId);
  if (error) return { ok: false, message: error.message };

  revalidateAll(orgId);
  return { ok: true };
}

export async function deleteOrganization(formData: FormData) {
  const supabase = await assertOwner();
  const id = Number(field(formData, "id"));
  if (!id) throw new Error("Missing company id");

  const { error } = await supabase.from("organizations").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateAll();
  redirect("/companies");
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function addContact(formData: FormData) {
  const supabase = await createClient();
  const orgId = Number(field(formData, "org_id"));
  const name = field(formData, "name");
  if (!orgId || !name) throw new Error("Contact name is required");

  const { error } = await supabase.from("contacts").insert({
    org_id: orgId,
    name,
    title: field(formData, "title"),
    linkedin_url: field(formData, "linkedin_url"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    notes: field(formData, "notes"),
  });

  if (error) throw new Error(error.message);
  revalidateAll(orgId);
}

export async function deleteContact(formData: FormData) {
  const supabase = await assertOwner();
  const id = Number(field(formData, "id"));
  const orgId = Number(field(formData, "org_id"));

  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateAll(orgId);
}

export async function findContactLinkedIn(
  contactId: number,
  orgId: number
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Not signed in" };

  if (!tinyfishEnabled()) {
    return {
      ok: false,
      message: "Add a free TINYFISH_API_KEY to enable this",
    };
  }

  const [{ data: contact }, { data: org }] = await Promise.all([
    supabase
      .from("contacts")
      .select("name")
      .eq("id", contactId)
      .maybeSingle(),
    supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle(),
  ]);
  if (!contact || !org) return { ok: false, message: "Contact not found" };

  const found = await findLinkedInProfile(contact.name, org.name);
  if (!found) {
    return {
      ok: false,
      message: "No confident match found — add it manually",
    };
  }

  const { error } = await supabase
    .from("contacts")
    .update({ linkedin_url: found })
    .eq("id", contactId);
  if (error) return { ok: false, message: error.message };

  revalidateAll(orgId);
  return { ok: true };
}

// ─── Interactions ────────────────────────────────────────────────────────────

export async function addInteraction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = Number(field(formData, "org_id"));
  const summary = field(formData, "summary");
  const occurredOn = field(formData, "occurred_on") ?? new Date().toISOString().slice(0, 10);
  if (!orgId || !summary) throw new Error("Summary is required");

  const contactIdRaw = field(formData, "contact_id");

  const { error } = await supabase.from("interactions").insert({
    org_id: orgId,
    contact_id: contactIdRaw ? Number(contactIdRaw) : null,
    occurred_on: occurredOn,
    channel: field(formData, "channel"),
    summary,
    outcome: field(formData, "outcome"),
    logged_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  // Keep last_contact current when this interaction is newer.
  const { data: org } = await supabase
    .from("organizations")
    .select("last_contact")
    .eq("id", orgId)
    .maybeSingle();

  const current = (org as { last_contact: string | null } | null)?.last_contact;
  if (!current || occurredOn > current) {
    await supabase
      .from("organizations")
      .update({ last_contact: occurredOn })
      .eq("id", orgId);
  }

  revalidateAll(orgId);
}

export async function deleteInteraction(formData: FormData) {
  const supabase = await assertOwner();
  const id = Number(field(formData, "id"));
  const orgId = Number(field(formData, "org_id"));

  const { error } = await supabase.from("interactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidateAll(orgId);
}

async function currentSiteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3005";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface InviteResult {
  ok: boolean;
  link?: string;
  note?: string;
  error?: string;
}

export async function inviteUser(emailInput: string): Promise<InviteResult> {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "owner") {
    return { ok: false, error: "Only the owner can invite people" };
  }

  const base = await currentSiteUrl();

  try {
    const admin = createAdminClient();
    // New email → invite (creates the account). Existing account → magic link (re-invite).
    for (const type of ["invite", "magiclink"] as const) {
      const { data, error } = await admin.auth.admin.generateLink({
        type,
        email,
        options: { redirectTo: `${base}/auth/callback?next=/welcome` },
      });
      const properties = data?.properties;
      if (!error && properties?.hashed_token) {
        const link = `${base}/auth/callback?token_hash=${encodeURIComponent(
          properties.hashed_token
        )}&type=${properties.verification_type ?? type}&next=/welcome`;
        revalidatePath("/settings");
        return {
          ok: true,
          link,
          note:
            properties.verification_type === "magiclink"
              ? "This email already has an account — the link signs them straight in."
              : "New account created (pending). The link is single-use and expires in 24 hours by default.",
        };
      }
    }
    return {
      ok: false,
      error: "Supabase could not create a link for this email",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invite failed",
    };
  }
}

export async function removeUser(formData: FormData) {
  const supabase = await assertOwner();
  const userId = field(formData, "user_id");
  if (!userId) redirect(`/settings?remove_error=${encodeURIComponent("Missing user")}`);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === userId) {
    redirect(
      `/settings?remove_error=${encodeURIComponent("You cannot remove your own account")}`
    );
  }

  let errorMessage: string | null = null;
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) errorMessage = error.message;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "User could not be removed";
  }

  revalidatePath("/settings");

  if (errorMessage) {
    redirect(`/settings?remove_error=${encodeURIComponent(errorMessage)}`);
  }
}

export async function updateUserRole(formData: FormData) {
  const supabase = await assertOwner();
  const userId = field(formData, "user_id");
  const role = field(formData, "role");
  if (!userId || (role !== "owner" && role !== "editor")) {
    throw new Error("Invalid role update");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ role: role as UserRole })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
