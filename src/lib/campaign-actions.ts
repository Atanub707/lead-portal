"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspaceId } from "./data";
import { createClient } from "./supabase/server";
import { FLAVORS } from "./flavors";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function createCampaign(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const name = field(formData, "name");
  if (!name) throw new Error("Campaign name is required");

  const { data: icp } = await supabase
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspaceId,
      name,
      pipeline_id: field(formData, "pipeline_id") || null,
      icp_id: icp?.id ?? null,
      status: "draft",
      daily_cap: Math.min(30, Math.max(1, Number(field(formData, "daily_cap")) || 30)),
      min_score: Math.min(100, Math.max(0, Number(field(formData, "min_score")) || 0)),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Could not create the campaign");

  revalidatePath("/campaigns");
  redirect(`/campaigns/${created.id}`);
}

export async function updateCampaign(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const id = field(formData, "id");
  const status = field(formData, "status");
  const { error } = await supabase
    .from("campaigns")
    .update({
      name: field(formData, "name") || undefined,
      pipeline_id: field(formData, "pipeline_id") || null,
      status: ["draft", "active", "paused", "archived"].includes(status)
        ? status
        : undefined,
      daily_cap: Math.min(30, Math.max(1, Number(field(formData, "daily_cap")) || 30)),
      min_score: Math.min(100, Math.max(0, Number(field(formData, "min_score")) || 0)),
      stop_on_reply: formData.get("stop_on_reply") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  revalidatePath(`/campaigns/${id}`);
}

export async function saveCampaignSteps(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const id = field(formData, "id");
  const raw = field(formData, "steps");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const flavors = new Set<string>(FLAVORS.map((flavor) => flavor.id));
  const steps = lines.map((line, index) => {
    const [delayRaw, flavorRaw] = line.split("|").map((part) => part.trim());
    const delay = Number(delayRaw);
    const flavor = flavorRaw && flavors.has(flavorRaw) ? flavorRaw : "short-direct";
    return {
      workspace_id: workspaceId,
      campaign_id: id,
      step_no: index + 1,
      channel: "email",
      delay_days: Number.isFinite(delay) ? Math.max(0, Math.round(delay)) : 0,
      flavor,
    };
  });
  if (steps.length === 0) throw new Error("Add at least one step");

  await supabase.from("campaign_steps").delete().eq("campaign_id", id);
  const { error } = await supabase.from("campaign_steps").insert(steps);
  if (error) throw new Error(error.message);

  revalidatePath(`/campaigns/${id}`);
}

export async function enrollCampaign(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const id = field(formData, "id");
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, pipeline_id, min_score")
    .eq("id", id)
    .maybeSingle();
  if (!campaign?.pipeline_id) {
    throw new Error("Link the campaign to a pipeline first");
  }

  const minScore = Math.min(
    100,
    Math.max(0, Number(field(formData, "min_score")) || Number(campaign.min_score ?? 0))
  );
  const limit = Math.min(50, Math.max(1, Number(field(formData, "limit")) || 25));

  const { data: firstStep } = await supabase
    .from("campaign_steps")
    .select("delay_days")
    .eq("campaign_id", id)
    .order("step_no")
    .limit(1)
    .maybeSingle();
  if (!firstStep) throw new Error("Add at least one step first");

  let query = supabase
    .from("organizations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("list", campaign.pipeline_id)
    .limit(200);
  if (minScore > 0) query = query.gte("score", minScore);
  const { data: orgs } = await query;
  if (!orgs || orgs.length === 0) throw new Error("No companies match that filter");

  const orgIds = orgs.map((row) => row.id as number);
  const { data: contacts } = await supabase
    .from("contacts")
    .select("id, org_id, email, is_decision_maker")
    .eq("workspace_id", workspaceId)
    .in("org_id", orgIds)
    .not("email", "is", null)
    .order("is_decision_maker", { ascending: false });

  const byOrg = new Map<number, { id: number; email: string }>();
  for (const contact of contacts ?? []) {
    const orgId = contact.org_id as number;
    if (!byOrg.has(orgId) && contact.email) {
      byOrg.set(orgId, { id: contact.id as number, email: contact.email as string });
    }
  }

  const nextRunAt = new Date(
    Date.now() + Math.max(0, Number(firstStep.delay_days ?? 0)) * 86_400_000
  ).toISOString();
  const rows = [...byOrg.entries()].slice(0, limit).map(([orgId, contact]) => ({
    workspace_id: workspaceId,
    campaign_id: id,
    org_id: orgId,
    contact_id: contact.id,
    status: "active",
    current_step: 0,
    next_run_at: nextRunAt,
  }));
  if (rows.length === 0) {
    throw new Error("No companies with contact emails match — run Deep Research first");
  }

  const { error } = await supabase
    .from("campaign_enrollments")
    .upsert(rows, {
      onConflict: "campaign_id,org_id,contact_id",
      ignoreDuplicates: true,
    });
  if (error) throw new Error(error.message);

  revalidatePath(`/campaigns/${id}`);
}

export async function setCampaignStatus(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();
  const id = field(formData, "id");
  const status = field(formData, "status");
  if (!["draft", "active", "paused", "archived"].includes(status)) {
    throw new Error("Unknown status");
  }
  const { error } = await supabase
    .from("campaigns")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}
