"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
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
      notes: field(formData, "notes"),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidateAll(id);
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

export async function inviteUser(formData: FormData) {
  await assertOwner();

  const email = field(formData, "email");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect(`/settings?invite_error=${encodeURIComponent("Enter a valid email address")}`);
  }

  let errorMessage: string | null = null;
  try {
    const admin = createAdminClient();
    const base = await currentSiteUrl();
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${base}/auth/callback?next=/welcome`,
    });
    if (error) errorMessage = error.message;
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : "Invitation could not be sent";
  }

  revalidatePath("/settings");

  if (errorMessage) {
    redirect(`/settings?invite_error=${encodeURIComponent(errorMessage)}`);
  }
  redirect(`/settings?invited=${encodeURIComponent(email)}`);
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
