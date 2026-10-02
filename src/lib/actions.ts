"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";
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

  revalidatePath("/", "layout");
  redirect(`/companies?list=${id}`);
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
  emailed?: boolean;
  emailError?: string;
  error?: string;
}

async function sendInviteEmail(
  to: string,
  link: string
): Promise<{ sent: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY?.trim();
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim();
  if (!apiKey || !senderEmail) return { sent: false };

  const senderName = process.env.BREVO_SENDER_NAME?.trim() || "Lead Portal";
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        to: [{ email: to }],
        subject: "You've been invited to Lead Portal",
        htmlContent: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#27272a;line-height:1.6">
<p>Hi,</p>
<p>You've been invited to <strong>Lead Portal</strong> — the team's pipeline for company research and outreach.</p>
<p><a href="${link}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px">Set your password &amp; join</a></p>
<p style="color:#71717a;font-size:12px">This link works once and expires in 24 hours. If you weren't expecting this, you can ignore this email.</p>
</div>`,
        textContent: `You've been invited to Lead Portal.\n\nSet your password (link works once, expires in 24 hours):\n${link}\n`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        sent: false,
        error: `Email service ${res.status}: ${text.slice(0, 160)}`,
      };
    }
    return { sent: true };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : "Email could not be sent",
    };
  }
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
    const failures: string[] = [];
    // New email → invite (creates the account). Existing account → magic link (re-invite).
    for (const type of ["invite", "magiclink"] as const) {
      const { data, error } = await admin.auth.admin.generateLink({
        type,
        email,
        options: { redirectTo: `${base}/auth/callback?next=/welcome` },
      });
      const properties = data?.properties;
      if (!error && properties?.hashed_token) {
        // Invite with the chosen role from the start.
        const invitedUserId = data?.user?.id;
        if (invitedUserId) {
          await admin
            .from("profiles")
            .update({ role: safeRole })
            .eq("id", invitedUserId);
        }
        const link = `${base}/auth/callback?token_hash=${encodeURIComponent(
          properties.hashed_token
        )}&type=${properties.verification_type ?? type}&next=/welcome`;
        const emailResult = await sendInviteEmail(email, link);
        revalidatePath("/settings");
        return {
          ok: true,
          link,
          emailed: emailResult.sent,
          emailError: emailResult.error,
          note:
            properties.verification_type === "magiclink"
              ? "This email already has an account — the link signs them straight in."
              : "New account created (pending). The link is single-use and expires in 24 hours by default.",
        };
      }
      failures.push(`${type}: ${error?.message ?? "no token returned"}`);
    }
    return {
      ok: false,
      error: `Supabase could not create a link for this email (${failures
        .join(" | ")
        .slice(0, 220)})`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invite failed",
    };
  }
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

  const { error } = await supabase
    .from("profiles")
    .update({ role: role as UserRole })
    .eq("id", userId);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
