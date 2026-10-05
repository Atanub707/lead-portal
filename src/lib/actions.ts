"use server";

import { generateObject, generateText } from "ai";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { logActivity } from "./activity";
import { NO_AI_KEY_MESSAGE, pickModel } from "./ai";
import { getCurrentProfile, requireWorkspaceId } from "./data";
import { encryptSecret } from "./crypto";
import { createAdminClient } from "./supabase/admin";
import { clearClerkDirectoryCache } from "./clerk-directory";
import { createClient } from "./supabase/server";
import { findLinkedInProfile, tinyfishEnabled } from "./research";
import type { OrgKind, OrgList, PipelineStage, UserRole } from "./types";
import {
  AVATAR_PRESETS,
  KIND_OPTIONS,
  PIPELINE_ICONS,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
} from "./types";

function field(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// Textarea value → trimmed, non-empty lines (one bullet per line).
function splitLines(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
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
  const workspaceId = await requireWorkspaceId();

  const { data, error } = await supabase
    .from("organizations")
    .insert({
      list,
      workspace_id: workspaceId,
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
  const workspaceId = await requireWorkspaceId();

  const { error } = await supabase
    .from("pipelines")
    .insert({
      id,
      workspace_id: workspaceId,
      name,
      icon,
      sort_order,
      pitch: field(formData, "pitch"),
      value_props: splitLines(field(formData, "value_props")),
      proof_points: splitLines(field(formData, "proof_points")),
      cta: field(formData, "cta"),
      default_flavor: field(formData, "default_flavor"),
    });
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
  redirect("/settings/pipelines");
}

export async function updatePipeline(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();

  const id = field(formData, "id");
  const name = field(formData, "name");
  if (!id) throw new Error("Missing pipeline id");
  if (!name) throw new Error("Pipeline name is required");

  const iconRaw = field(formData, "icon") ?? "layers";
  const icon = (PIPELINE_ICONS as readonly string[]).includes(iconRaw)
    ? iconRaw
    : "layers";

  const { error } = await supabase
    .from("pipelines")
    .update({
      name,
      icon,
      pitch: field(formData, "pitch"),
      value_props: splitLines(field(formData, "value_props")),
      proof_points: splitLines(field(formData, "proof_points")),
      cta: field(formData, "cta"),
      default_flavor: field(formData, "default_flavor"),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "pipeline.update",
    targetType: "pipeline",
    targetId: id,
    summary: `Updated pipeline “${name}”`,
  });

  revalidatePath("/", "layout");
  redirect("/settings/pipelines");
}

// ─── Pipeline pitch (AI) ─────────────────────────────────────────────────────

const PitchSchema = z.object({
  pitch: z.string(),
  value_props: z.array(z.string()),
  proof_points: z.array(z.string()),
  cta: z.string(),
});

const PITCH_SYSTEM =
  "You sharpen the user's rough notes into a concise B2B service pitch. NEVER invent certifications, client names, numbers, or claims that are not present in the notes. Return JSON only: { pitch: string (2-3 sentences), value_props: string[] (3-5 short bullets), proof_points: string[] (0-3, only when grounded in the notes), cta: string (one short ask) }";

const PITCH_JSON_SHAPE = `Return a single JSON object with exactly these keys:
{
  "pitch": string (2-3 sentences),
  "value_props": string[] (3-5 short bullets),
  "proof_points": string[] (0-3, [] when nothing in the notes grounds them),
  "cta": string (one short ask)
}
Return ONLY the JSON object — no markdown fences, no commentary.`;

function parseJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to brace slicing
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

interface GeneratedPitch {
  pitch: string;
  value_props: string[];
  proof_points: string[];
  cta: string;
}

function cleanPitch(value: z.infer<typeof PitchSchema>): GeneratedPitch | null {
  const pitch = value.pitch.trim();
  if (!pitch) return null;
  return {
    pitch,
    value_props: value.value_props
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 5),
    proof_points: value.proof_points
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 3),
    cta: value.cta.trim(),
  };
}

export async function generatePipelinePitch(
  notes: string,
  pipelineName: string
): Promise<
  | {
      ok: true;
      pitch: string;
      value_props: string[];
      proof_points: string[];
      cta: string;
    }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const roughNotes = notes.trim();
  if (!roughNotes) return { ok: false, error: "Add a few rough notes first" };

  const model = pickModel(userId);
  if (!model) return { ok: false, error: NO_AI_KEY_MESSAGE };

  const prompt = `Pipeline: ${
    pipelineName.trim() || "Untitled pipeline"
  }\n\nRough notes:\n${roughNotes}`;

  // Plain-text generation first (same reliability pattern as /api/paste):
  // no JSON mode, with generateObject as the second chance.
  let generated: GeneratedPitch | null = null;
  const failures: string[] = [];

  try {
    const { text } = await generateText({
      model,
      system: `${PITCH_SYSTEM}\n\n${PITCH_JSON_SHAPE}`,
      prompt,
    });
    const parsed = parseJsonObject(text);
    if (parsed) {
      const result = PitchSchema.safeParse(parsed);
      if (result.success) {
        generated = cleanPitch(result.data);
        if (!generated) failures.push("text: empty pitch");
      } else {
        failures.push(
          `text: ${result.error.issues[0]?.message ?? "schema mismatch"}`
        );
      }
    } else {
      failures.push("text: no JSON object in the model output");
    }
  } catch (err) {
    failures.push(`text: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!generated) {
    try {
      const { object } = await generateObject({
        model,
        schema: PitchSchema,
        system: PITCH_SYSTEM,
        prompt,
      });
      generated = cleanPitch(object);
    } catch (err) {
      failures.push(
        `object: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!generated) {
    console.error("[pipeline.pitch] generation failed:", failures.join(" | "));
    return {
      ok: false,
      error: "The AI couldn't sharpen those notes. Please try again.",
    };
  }

  return { ok: true, ...generated };
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export async function switchWorkspace(formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile?.is_super_admin) {
    throw new Error("Only the operator can switch workspaces");
  }

  const target = field(formData, "workspace_id");
  const store = await cookies();

  if (!target || target === profile.workspace_id) {
    store.delete("view_workspace");
    revalidatePath("/", "layout");
    redirect("/dashboard");
  }

  store.set("view_workspace", target, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  await logActivity({
    actorId: profile.id,
    workspaceId: target,
    action: "superadmin.view",
    targetType: "workspace",
    targetId: target,
    summary: "HI Labs viewed this workspace",
    details: { via: "switch" },
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function renameWorkspace(formData: FormData) {
  const supabase = await assertOwner();
  const { userId } = await auth();

  const name = field(formData, "name");
  if (!name) throw new Error("Workspace name is required");
  const workspaceId = await requireWorkspaceId();

  const { error } = await supabase
    .from("workspaces")
    .update({ name: name.slice(0, 60) })
    .eq("id", workspaceId);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    workspaceId,
    action: "workspace.rename",
    targetType: "workspace",
    targetId: workspaceId,
    summary: `Renamed workspace to “${name}”`,
  });

  revalidatePath("/", "layout");
  redirect("/settings");
}

export async function createWorkspace(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");

  const name = field(formData, "name");
  if (!name) throw new Error("Workspace name is required");

  // The user has no workspace yet, so every write here uses the admin client.
  const admin = createAdminClient();
  const trialEndsAt = new Date(Date.now() + 86_400_000).toISOString();

  const { data: workspace, error } = await admin
    .from("workspaces")
    .insert({
      name: name.slice(0, 60),
      created_by: userId,
      plan: "trial",
      trial_ends_at: trialEndsAt,
    })
    .select("id")
    .single();
  if (error || !workspace) {
    throw new Error(error?.message ?? "Could not create the workspace");
  }

  await admin.from("pipelines").insert({
    id: "leads",
    workspace_id: workspace.id,
    name: "Leads",
    icon: "layers",
    stages: ["new", "contacted", "proposal", "won", "lost"],
    sort_order: 0,
  });

  await admin
    .from("profiles")
    .update({ workspace_id: workspace.id, role: "owner" })
    .eq("id", userId);

  await logActivity({
    actorId: userId,
    workspaceId: workspace.id,
    action: "workspace.create",
    targetType: "workspace",
    targetId: workspace.id,
    summary: `Created workspace “${name}”`,
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
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
      `/settings/pipelines?pipeline_error=${encodeURIComponent(
        `${used} compan${used === 1 ? "y is" : "ies are"} still in this pipeline — move or delete ${
          used === 1 ? "it" : "them"
        } first.`
      )}`
    );
  }
  if ((total ?? 0) <= 1) {
    redirect(
      `/settings/pipelines?pipeline_error=${encodeURIComponent(
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
  redirect("/settings/pipelines?pipeline_removed=1");
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
    workspace_id: await requireWorkspaceId(),
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
      message: "LinkedIn lookup isn't available right now — try again later.",
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
  const workspaceId = await requireWorkspaceId();

  const { error } = await supabase.from("interactions").insert({
    org_id: orgId,
    workspace_id: workspaceId,
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
  code?: "seat_required";
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
  const workspaceId = await requireWorkspaceId();

  const [{ count: memberCount }, { data: seatRow }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    supabase.from("workspaces").select("seats").eq("id", workspaceId).maybeSingle(),
  ]);
  const seats = (seatRow as { seats: number } | null)?.seats ?? 1;

  // Pending invitations already hold a seat: without counting them, repeated
  // invites would bypass the seat gate until each invitee accepts.
  const client = await clerkClient();
  const pendingInvites = await client.invitations.getInvitationList({
    status: "pending",
    limit: 100,
  });
  const pendingForWorkspace = (pendingInvites.data ?? []).filter(
    (invitation) =>
      (invitation.publicMetadata as { workspace_id?: string } | null)
        ?.workspace_id === workspaceId
  ).length;
  if ((memberCount ?? 0) + pendingForWorkspace >= seats) {
    return {
      ok: false,
      error: "Seats are full — add a seat to invite more people.",
      code: "seat_required",
    };
  }

  // Clerk sends the invitation email itself (notify defaults to true).
  // expiresInDays: 1 — short-lived invites (Clerk's minimum unit is days).
  const createInvite = async (): Promise<string | null> => {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      publicMetadata: { role: safeRole, workspace_id: workspaceId },
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
  revalidatePath("/settings/members");
  redirect("/settings/members");
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
  revalidatePath("/settings/members");
  redirect("/settings/members");
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
  if (!targetId) redirect(`/settings/members?remove_error=${encodeURIComponent("Missing user")}`);

  const { userId } = await auth();
  if (userId === targetId) {
    redirect(
      `/settings/members?remove_error=${encodeURIComponent("You cannot remove your own account")}`
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
    redirect(`/settings/members?remove_error=${encodeURIComponent(errorMessage)}`);
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
  redirect("/settings/members?removed=1");
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

  // Avatar: a preset id from the picker, a stored uploaded image URL, or
  // null for auto-generated.
  const avatarRaw = field(formData, "avatar");
  const isPreset =
    avatarRaw && AVATAR_PRESETS.some((preset) => preset.id === avatarRaw);
  const isStoredImage =
    avatarRaw &&
    avatarRaw.length <= 600 &&
    avatarRaw.includes("/storage/v1/object/public/avatars/");
  const avatar = isPreset ? avatarRaw : isStoredImage ? avatarRaw : null;

  // Admin client so a user can always set their OWN name even before the
  // row-level "update self" policy migration lands. Ownership is enforced here:
  // the update is hard-scoped to the signed-in user's id.
  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ full_name: cleanName, avatar })
    .eq("id", userId);
  if (error) throw new Error(error.message);

  await logActivity({
    actorId: userId,
    action: "profile.name",
    targetType: "profile",
    targetId: userId,
    summary: `Updated profile — name “${cleanName}”`,
  });

  revalidatePath("/settings");
  revalidateAll();
  revalidatePath("/", "layout");
}

// Custom display picture: the client crops to a 256×256 JPEG data URL, this
// stores it in the public `avatars` bucket (one file per user) and points the
// profile at it.
const AVATAR_DATA_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

export async function uploadAvatar(
  dataUrl: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const match = AVATAR_DATA_RE.exec(dataUrl);
  if (!match) return { ok: false, error: "Use a PNG, JPEG, or WebP image." };

  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const contentType = `image/${match[1]}`;
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > 400_000) {
    return { ok: false, error: "That image is too large — try a smaller one." };
  }

  const admin = createAdminClient();
  const path = `${userId}/avatar.${ext}`;
  let { error } = await admin.storage
    .from("avatars")
    .upload(path, buffer, { contentType, upsert: true });
  if (error && /bucket/i.test(error.message)) {
    await admin.storage.createBucket("avatars", { public: true });
    ({ error } = await admin.storage
      .from("avatars")
      .upload(path, buffer, { contentType, upsert: true }));
  }
  if (error) {
    console.error("[avatar] upload failed:", error.message);
    return { ok: false, error: "Couldn't upload the picture. Try again." };
  }

  const { data } = admin.storage.from("avatars").getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error: dbError } = await admin
    .from("profiles")
    .update({ avatar: url })
    .eq("id", userId);
  if (dbError) {
    console.error("[avatar] profile update failed:", dbError.message);
    return { ok: false, error: "Couldn't save the picture." };
  }

  await logActivity({
    actorId: userId,
    action: "profile.name",
    targetType: "profile",
    targetId: userId,
    summary: "Updated profile picture",
  });
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true, url };
}

export async function signOut() {
  const { sessionId } = await auth();
  if (sessionId) {
    const client = await clerkClient();
    await client.sessions.revokeSession(sessionId);
  }
  redirect("/sign-in");
}
