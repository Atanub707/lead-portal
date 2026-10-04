"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { logActivity } from "./activity";
import { encryptSecret } from "./crypto";
import { createAdminClient } from "./supabase/admin";
import { clearClerkDirectoryCache } from "./clerk-directory";
import { createClient } from "./supabase/server";
import { findLinkedInProfile, tinyfishEnabled } from "./research";
import type { OrgKind, OrgList, PipelineStage, UserRole } from "./types";
import { KIND_OPTIONS, PIPELINE_ICONS, PRIORITY_OPTIONS, STATUS_LABEL } from "./types";

function field(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function clerkErrorInfo(err: unknown): { code?: string; message?: string } {
  const candidate = err as {
    errors?: { code?: string; message?: string; longMessage?: string }[];
    message?: string;
  };
  const first = candidate?.errors?.[0];
  return {
    code: first?.code,
    message: first?.longMessage ?? first?.message ?? candidate?.message,
  };
}

function revalidateAll(orgId?: number) {
  revalidatePath("/dashboard");
  revalidatePath("/companies");
  if (orgId) revalidatePath(`/companies/${orgId}`);
}

async function assertOwner() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (data?.role !== "owner") {
    throw new Error("Only the owner can do this");
  }
  return supabase;
}

// ─── Organizations ───────────────────────────────────────────────────────────

export async function createOrganization(formData: FormData) {
  const { userId } = await auth();
  const supabase = await createClient();

  const name = field(formData, "name");
  if (!name) throw new Error("Company name is required");

  const list = (field(formData, "list") ?? "pos") as OrgList;
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("id", list)
    .maybeSingle();
  if (!pipeline) throw new Error("Unknown pipeline");

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
      created_by: userId ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  await logActivity({
    actorId: userId,
    action: "company.create",
    orgId: data.id,
    targetType: "company",
    targetId: data.id,
    summary: `Added company “${name}”`,
  });
  revalidateAll(data.id);
  redirect(`/companies/${data.id}`);
}

export async function updateOrganization(formData: FormData) {
  const { userId } = await auth();
  const supabase = await createClient();
  const id = Number(field(formData, "id"));
  if (!id) throw new Error("Missing company id");

  const name = field(formData, "name") ?? "Unnamed";
  const status = field(formData, "status");
  const kind = field(formData, "kind");
  const priority = field(formData, "priority");

  const { error } = await supabase
    .from("organizations")
    .update({
      name,
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
  await logActivity({
    actorId: userId,
    action: "company.update",
    orgId: id,
    targetType: "company",
    targetId: id,
    summary: `Updated company “${name}”`,
  });
  revalidateAll(id);
}

export async function toggleBookmark(
  orgId: number,
  bookmarked: boolean
): Promise<{ ok: boolean }> {
  const { userId } = await auth();
  if (!userId) return { ok: false };
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  const { error } = await supabase
    .from("organizations")
    .update({ bookmarked })
    .eq("id", orgId);
  if (error) return { ok: false };

  await logActivity({
    actorId: userId,
    action: "company.bookmark",
    orgId,
    targetType: "company",
    targetId: orgId,
    summary: `${bookmarked ? "Starred" : "Unstarred"} “${org?.name ?? "Unknown"}”`,
  });

  revalidateAll(orgId);
  return { ok: true };
}

export async function setFollowUp(
  orgId: number,
  date: string | null,
  note: string | null
): Promise<{ ok: boolean; message?: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, message: "Not signed in" };
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

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

  await logActivity({
    actorId: userId,
    action: "company.follow_up",
    orgId,
    targetType: "company",
    targetId: orgId,
    summary: cleanDate
      ? `Set follow-up for “${org?.name ?? "Unknown"}” to ${cleanDate}`
      : `Cleared follow-up for “${org?.name ?? "Unknown"}”`,
  });

  revalidateAll(orgId);
  return { ok: true };
}

export async function deleteOrganization(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();
  const id = Number(field(formData, "id"));
  if (!id) throw new Error("Missing company id");

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("organizations").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "company.delete",
    targetType: "company",
    targetId: id,
    summary: `Deleted company “${org?.name ?? "Unknown"}”`,
  });

  revalidateAll();

  const next = field(formData, "next");
  redirect(next && next.startsWith("/") ? next : "/companies");
}

// ─── Pipelines ───────────────────────────────────────────────────────────────

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "pipeline"
  );
}

export async function createPipeline(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();

  const name = field(formData, "name");
  if (!name) throw new Error("Pipeline name is required");

  const iconRaw = field(formData, "icon") ?? "layers";
  const icon = (PIPELINE_ICONS as readonly string[]).includes(iconRaw)
    ? iconRaw
    : "layers";

  const base = slugify(name);
  let id = base;
  let suffix = 1;
  for (;;) {
    const { data: clash } = await supabase
      .from("pipelines")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!clash) break;
    suffix += 1;
    id = `${base}-${suffix}`;
  }

  const { data: last } = await supabase
    .from("pipelines")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sort_order = ((last?.sort_order as number | undefined) ?? -1) + 1;

  const { error } = await supabase
    .from("pipelines")
    .insert({ id, name, icon, sort_order });
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "pipeline.create",
    targetType: "pipeline",
    targetId: id,
    summary: `Created pipeline “${name}”`,
  });

  revalidatePath("/", "layout");
  redirect(`/companies?list=${id}`);
}

export async function renamePipeline(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();

  const id = field(formData, "id");
  const name = field(formData, "name");
  if (!id) throw new Error("Missing pipeline id");
  if (!name) throw new Error("Pipeline name is required");

  const { data: existing } = await supabase
    .from("pipelines")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("pipelines")
    .update({ name: name.slice(0, 60) })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "pipeline.rename",
    targetType: "pipeline",
    targetId: id,
    summary: `Renamed pipeline “${existing?.name ?? "Unknown"}” → “${name.slice(0, 60)}”`,
  });

  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function deletePipeline(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();

  const id = field(formData, "id");
  if (!id) throw new Error("Missing pipeline id");

  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const [{ count: companies }, { count: total }] = await Promise.all([
    supabase
      .from("organizations")
      .select("id", { count: "exact", head: true })
      .eq("list", id),
    supabase.from("pipelines").select("id", { count: "exact", head: true }),
  ]);

  const used = companies ?? 0;
  if (used > 0) {
    redirect(
      `/settings?pipeline_error=${encodeURIComponent(
        `${used} compan${used === 1 ? "y is" : "ies are"} still in this pipeline — move or delete ${
          used === 1 ? "it" : "them"
        } first.`
      )}`
    );
  }
  if ((total ?? 0) <= 1) {
    redirect(
      `/settings?pipeline_error=${encodeURIComponent(
        "You need at least one pipeline."
      )}`
    );
  }

  const { error } = await supabase.from("pipelines").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "pipeline.delete",
    targetType: "pipeline",
    targetId: id,
    summary: `Deleted pipeline “${pipeline?.name ?? "Unknown"}”`,
  });

  revalidatePath("/", "layout");
  redirect("/settings?pipeline_removed=1");
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export async function addContact(formData: FormData) {
  const { userId } = await auth();
  const supabase = await createClient();
  const orgId = Number(field(formData, "org_id"));
  const name = field(formData, "name");
  if (!orgId || !name) throw new Error("Contact name is required");

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  const row = {
    org_id: orgId,
    name,
    title: field(formData, "title"),
    linkedin_url: field(formData, "linkedin_url"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    notes: field(formData, "notes"),
    created_by: userId ?? null,
  };

  let { error } = await supabase.from("contacts").insert(row);
  if (error && /created_by/.test(error.message)) {
    // Attribution column not migrated yet — retry without it.
    const { created_by, ...rest } = row;
    ({ error } = await supabase.from("contacts").insert(rest));
  }
  if (error) throw new Error(error.message);
  await logActivity({
    actorId: userId,
    action: "contact.add",
    orgId,
    targetType: "contact",
    summary: `Added person “${name}” to “${org?.name ?? "Unknown"}”`,
  });
  revalidateAll(orgId);
}

export async function deleteContact(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();
  const id = Number(field(formData, "id"));
  const orgId = Number(field(formData, "org_id"));

  const [{ data: contact }, { data: org }] = await Promise.all([
    supabase.from("contacts").select("name").eq("id", id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);

  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "contact.delete",
    orgId,
    targetType: "contact",
    targetId: id,
    summary: `Removed person “${contact?.name ?? "Unknown"}” from “${org?.name ?? "Unknown"}”`,
  });

  revalidateAll(orgId);
}

export async function findContactLinkedIn(
  contactId: number,
  orgId: number
): Promise<{ ok: boolean; message?: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, message: "Not signed in" };
  const supabase = await createClient();

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

  await logActivity({
    actorId: userId,
    action: "contact.linkedin",
    orgId,
    targetType: "contact",
    targetId: contactId,
    summary: `Found LinkedIn for “${contact.name}”`,
  });

  revalidateAll(orgId);
  return { ok: true };
}

// ─── Interactions ────────────────────────────────────────────────────────────

export async function addInteraction(formData: FormData) {
  const { userId } = await auth();
  const supabase = await createClient();

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
    logged_by: userId ?? null,
  });
  if (error) throw new Error(error.message);

  // Keep last_contact current when this interaction is newer.
  const { data: org } = await supabase
    .from("organizations")
    .select("name, last_contact")
    .eq("id", orgId)
    .maybeSingle();

  const current = (org as { last_contact: string | null } | null)?.last_contact;
  if (!current || occurredOn > current) {
    await supabase
      .from("organizations")
      .update({ last_contact: occurredOn })
      .eq("id", orgId);
  }

  await logActivity({
    actorId: userId,
    action: "company.interaction",
    orgId,
    targetType: "company",
    targetId: orgId,
    summary: `Logged an interaction with “${
      (org as { name?: string | null } | null)?.name ?? "Unknown"
    }”`,
  });

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
  emailed?: boolean;
  link?: string;
  error?: string;
}

export async function inviteUser(
  emailInput: string,
  role: UserRole = "editor"
): Promise<InviteResult> {
  const email = emailInput.trim().toLowerCase();
  const safeRole: UserRole = role === "owner" ? "owner" : "editor";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address" };
  }

  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const supabase = await createClient();
  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (me?.role !== "owner") {
    return { ok: false, error: "Only the owner can invite people" };
  }

  const base = await currentSiteUrl();

  // Clerk sends the invitation email itself (notify defaults to true).
  // expiresInDays: 1 — short-lived invites (Clerk's minimum unit is days).
  const createInvite = async (): Promise<string | null> => {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { role: safeRole },
      redirectUrl: `${base}/dashboard`,
      expiresInDays: 1,
    });
    return (invitation as { url?: string }).url ?? null;
  };

  let invitationUrl: string | null = null;
  try {
    invitationUrl = await createInvite();
  } catch (err) {
    const info = clerkErrorInfo(err);
    if (info.code === "duplicate_record") {
      // Resend: replace any pending invitation for this email with a fresh one.
      try {
        const client = await clerkClient();
        const list = await client.invitations.getInvitationList({
          status: "pending",
          limit: 100,
          query: email,
        });
        for (const invitation of list.data ?? []) {
          if (invitation.emailAddress?.toLowerCase() === email) {
            await client.invitations.revokeInvitation(invitation.id);
          }
        }
        invitationUrl = await createInvite();
      } catch (retryErr) {
        const retryInfo = clerkErrorInfo(retryErr);
        return { ok: false, error: retryInfo.message ?? "Invite failed" };
      }
    } else if (info.code === "form_identifier_exists") {
      return {
        ok: false,
        error:
          "This email already has an account — they can sign in directly (or use “Forgot password?”).",
      };
    } else {
      return { ok: false, error: info.message ?? "Invite failed" };
    }
  }

  await logActivity({
    actorId: userId,
    action: "user.invite",
    targetType: "user",
    targetId: email,
    summary: `Invited ${email} as ${safeRole}`,
  });

  clearClerkDirectoryCache();
  revalidatePath("/settings");
  return { ok: true, emailed: true, link: invitationUrl ?? undefined };
}

export async function revokeInvitation(formData: FormData) {
  await assertOwner();
  const id = field(formData, "invitation_id");
  if (!id) throw new Error("Missing invitation id");

  const client = await clerkClient();
  await client.invitations.revokeInvitation(id);
  clearClerkDirectoryCache();
  revalidatePath("/settings");
  redirect("/settings");
}

export async function deleteInvitation(formData: FormData) {
  await assertOwner();
  const id = field(formData, "invitation_id");
  if (!id) throw new Error("Missing invitation id");

  // The SDK has no delete for invitations; the REST API does.
  const res = await fetch(
    `https://api.clerk.com/v1/invitations/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
    }
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Could not delete invitation (${res.status})`);
  }
  clearClerkDirectoryCache();
  revalidatePath("/settings");
  redirect("/settings");
}

export async function removeUser(formData: FormData) {
  try {
    return await removeUserInner(formData);
  } catch (err) {
    const digest =
      err && typeof err === "object" && "digest" in err
        ? String((err as { digest?: unknown }).digest ?? "")
        : "";
    if (!digest.startsWith("NEXT_")) {
      console.error("[removeUser] failed:", err);
    }
    throw err;
  }
}

async function removeUserInner(formData: FormData) {
  const supabase = await assertOwner();
  const targetId = field(formData, "user_id");
  if (!targetId) redirect(`/settings?remove_error=${encodeURIComponent("Missing user")}`);

  const { userId } = await auth();
  if (userId === targetId) {
    redirect(
      `/settings?remove_error=${encodeURIComponent("You cannot remove your own account")}`
    );
  }

  const { data: target } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", targetId)
    .maybeSingle();

  let errorMessage: string | null = null;
  try {
    const client = await clerkClient();
    await client.users.deleteUser(targetId);
    const admin = createAdminClient();
    await admin.from("profiles").delete().eq("id", targetId);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "User could not be removed";
  }

  clearClerkDirectoryCache();
  revalidatePath("/settings");

  if (errorMessage) {
    redirect(`/settings?remove_error=${encodeURIComponent(errorMessage)}`);
  }

  await logActivity({
    actorId: userId,
    action: "user.remove",
    targetType: "user",
    targetId,
    summary: `Removed ${
      (target as { email?: string | null } | null)?.email ?? targetId
    }`,
  });
  redirect("/settings?removed=1");
}

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ ok: boolean; message?: string }> {
  const supabase = await assertOwner();
  if (!userId || (role !== "owner" && role !== "editor")) {
    return { ok: false, message: "Invalid role update" };
  }

  const { userId: actorId } = await auth();
  const { data: target } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const { error } = await supabase
    .from("profiles")
    .update({ role: role as UserRole })
    .eq("id", userId);
  if (error) return { ok: false, message: error.message };

  await logActivity({
    actorId,
    action: "user.role",
    targetType: "user",
    targetId: userId,
    summary: `Changed ${
      (target as { email?: string | null } | null)?.email ?? userId
    } to ${role}`,
  });
  revalidatePath("/settings");
  return { ok: true };
}

// ─── Email settings ──────────────────────────────────────────────────────────

export async function saveEmailSettings(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const portRaw = field(formData, "smtp_port");
  const port = portRaw ? Number.parseInt(portRaw, 10) : null;
  const secureField = field(formData, "smtp_secure");
  const smtpSecure =
    secureField === null
      ? port === 465
      : secureField === "true" || secureField === "on" || secureField === "1";

  const payload: Record<string, unknown> = {
    user_id: userId,
    from_name: field(formData, "from_name"),
    from_email: field(formData, "from_email"),
    smtp_host: field(formData, "smtp_host"),
    smtp_port: port !== null && Number.isFinite(port) ? port : null,
    smtp_secure: smtpSecure,
    smtp_user: field(formData, "smtp_user"),
    signature_phone: field(formData, "signature_phone"),
    signature_link: field(formData, "signature_link"),
    updated_at: new Date().toISOString(),
  };

  const password = field(formData, "password");
  if (password) payload.smtp_password_enc = encryptSecret(password);

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_email_settings")
    .upsert(payload, { onConflict: "user_id" });
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "email.settings_update",
    summary: "Updated email sending settings",
  });

  revalidatePath("/settings/email");
  revalidatePath("/settings");
  redirect("/settings/email");
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function updateMyName(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const name = field(formData, "full_name");
  if (!name) throw new Error("Name is required");

  const cleanName = name.slice(0, 80);

  // Admin client so a user can always set their OWN name even before the
  // row-level "update self" policy migration lands. Ownership is enforced here:
  // the update is hard-scoped to the signed-in user's id.
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: cleanName })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "profile.name",
    targetType: "profile",
    targetId: userId,
    summary: `Set display name to “${cleanName}”`,
  });

  revalidatePath("/settings");
  revalidateAll();
  revalidatePath("/", "layout");
}

export async function signOut() {
  const { sessionId } = await auth();
  if (sessionId) {
    const client = await clerkClient();
    await client.sessions.revokeSession(sessionId);
  }
  redirect("/sign-in");
}
