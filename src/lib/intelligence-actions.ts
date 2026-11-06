"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireWorkspaceId } from "./data";
import {
  applyTemplateToWorkspace,
  ensureDefaultIcp,
  seedWorkspaceSignals,
} from "./intelligence-write";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { splitLines, splitList } from "./intelligence";
import { signalDedupeHash } from "./signals";
import { scoreOrg } from "./scoring";

function field(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function list(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function personaLines(value: string): {
  name: string;
  titles: string[];
  seniorities: string[];
}[] {
  return splitLines(value)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const name = parts[0] ?? "";
      if (!name) return null;
      return {
        name,
        titles: splitList(parts[1] ?? ""),
        seniorities: splitList(parts[2] ?? ""),
      };
    })
    .filter(
      (entry): entry is { name: string; titles: string[]; seniorities: string[] } =>
        entry !== null
    );
}

export async function saveBusinessProfile(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const id = field(formData, "id");
  const name = field(formData, "name");
  if (!name) throw new Error("Business profile name is required");

  const row = {
    name,
    description: field(formData, "description") || null,
    service_categories: splitList(field(formData, "service_categories")),
    positioning: field(formData, "positioning") || null,
    differentiators: splitLines(field(formData, "differentiators")),
    updated_at: new Date().toISOString(),
  };

  if (id) {
    const { error } = await supabase
      .from("business_profiles")
      .update(row)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("business_profiles").insert({
      workspace_id: workspaceId,
      created_by: userId,
      ...row,
    });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/settings/business");
}

export async function applyBusinessTemplate(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const templateKey = field(formData, "template_key");
  if (!templateKey) throw new Error("Pick a template first");

  const result = await applyTemplateToWorkspace(workspaceId, userId, templateKey);
  if (!result.ok) throw new Error(result.error ?? "Could not apply the template");

  revalidatePath("/settings/business");
}

export async function createDefaultIcp() {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  await seedWorkspaceSignals(workspaceId);
  await ensureDefaultIcp(workspaceId, userId);
  revalidatePath("/settings/business");
}

export async function addManualSignal(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const orgId = Number(field(formData, "org_id"));
  const signalKey = field(formData, "signal_key");
  const note = field(formData, "note");
  const url = field(formData, "evidence_url");
  if (!orgId || !signalKey || !note) {
    throw new Error("Pick a signal and add a short note");
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) throw new Error("Company not found");

  const admin = createAdminClient();
  const { error } = await admin.from("company_signals").upsert(
    [
      {
        workspace_id: workspaceId,
        org_id: orgId,
        signal_key: signalKey,
        value: { note },
        evidence: { source: "manual", url: url || null, snippet: note.slice(0, 240) },
        source_key: "manual",
        confidence: 1,
        observed_at: new Date().toISOString(),
        expires_at: null,
        dedupe_hash: signalDedupeHash([orgId, signalKey, note, url]),
      },
    ],
    { onConflict: "org_id,signal_key,dedupe_hash", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);

  const { count } = await admin
    .from("company_signals")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("workspace_id", workspaceId);
  await admin
    .from("organizations")
    .update({
      signal_count: count ?? 0,
      last_signal_at: new Date().toISOString(),
    })
    .eq("id", orgId)
    .eq("workspace_id", workspaceId);

  await scoreOrg(orgId, workspaceId).catch((err) => {
    console.error("[intelligence] score failed:", err instanceof Error ? err.message : err);
  });

  revalidatePath(`/companies/${orgId}`);
}

export async function saveIcp(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not signed in");
  const workspaceId = await requireWorkspaceId();
  const supabase = await createClient();

  const id = field(formData, "icp_id");
  const name = field(formData, "name") || "Default ICP";
  const description = field(formData, "description") || null;
  const businessProfileId = field(formData, "business_profile_id") || null;
  const pipelineId = field(formData, "pipeline_id");

  let icpId = id;
  if (icpId) {
    const { error } = await supabase
      .from("icp_profiles")
      .update({
        name,
        description,
        business_profile_id: businessProfileId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", icpId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
  } else {
    const { data: created, error } = await supabase
      .from("icp_profiles")
      .insert({
        workspace_id: workspaceId,
        business_profile_id: businessProfileId,
        name,
        description,
        status: "active",
        is_default: true,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not save the ICP");
    icpId = created.id as string;
  }

  // Personas
  await supabase
    .from("icp_personas")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);
  const personas = personaLines(field(formData, "personas"));
  if (personas.length > 0) {
    const { error } = await supabase.from("icp_personas").insert(
      personas.map((persona, index) => ({
        workspace_id: workspaceId,
        icp_id: icpId,
        name: persona.name,
        titles: persona.titles,
        seniorities: persona.seniorities,
        functions: [],
        weight: 1,
        is_primary: index === 0,
      }))
    );
    if (error) throw new Error(error.message);
  }

  // Criteria (targeting). Preserve existing signal rules when the form did
  // not render weight fields (e.g. definitions unavailable at render time).
  const hasSignalFields = [...formData.keys()].some((key) =>
    key.startsWith("signal_")
  );
  const { data: existingSignalRows } = await supabase
    .from("icp_criteria")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId)
    .eq("kind", "signal");

  await supabase
    .from("icp_criteria")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);

  const criteria: Record<string, unknown>[] = [];
  const pushList = (kind: string, fieldName: string, values: string[]) => {
    if (values.length === 0) return;
    criteria.push({
      workspace_id: workspaceId,
      icp_id: icpId,
      kind,
      field: fieldName,
      operator: "in",
      value: values,
      is_required: true,
      weight: 1,
      label: fieldName,
      sort_order: criteria.length,
    });
  };

  pushList(
    "firmographic",
    "industry",
    splitList(field(formData, "industries"))
  );
  pushList(
    "firmographic",
    "employee_band",
    list(formData, "employee_bands")
  );
  pushList("geo", "country", splitList(field(formData, "geo")));
  pushList(
    "firmographic",
    "funding_stage",
    list(formData, "funding_stages")
  );

  const { data: definitions } = await supabase
    .from("signal_definitions")
    .select("key")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);
  if (!hasSignalFields && existingSignalRows) {
    for (const row of existingSignalRows) {
      criteria.push({
        workspace_id: workspaceId,
        icp_id: icpId,
        kind: "signal",
        field: row.field,
        operator: row.operator,
        value: row.value,
        is_required: row.is_required,
        weight: row.weight,
        label: row.label,
        sort_order: criteria.length,
      });
    }
  }
  for (const definition of definitions ?? []) {
    const key = (definition as { key: string }).key;
    const raw = field(formData, `signal_${key}`);
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    criteria.push({
      workspace_id: workspaceId,
      icp_id: icpId,
      kind: "signal",
      field: "signal_key",
      operator: "exists",
      value: { key, weight },
      is_required: false,
      weight,
      label: key,
      sort_order: criteria.length,
    });
  }

  if (criteria.length > 0) {
    const { error } = await supabase.from("icp_criteria").insert(criteria);
    if (error) throw new Error(error.message);
  }

  // Scoring model
  const fit = Number(field(formData, "weight_fit"));
  const intent = Number(field(formData, "weight_intent"));
  const reach = Number(field(formData, "weight_reach"));
  const threshold = Number(field(formData, "threshold"));
  const weights = {
    fit: Number.isFinite(fit) ? Math.max(0, Math.min(1, fit)) : 0.4,
    intent: Number.isFinite(intent) ? Math.max(0, Math.min(1, intent)) : 0.45,
    reach: Number.isFinite(reach) ? Math.max(0, Math.min(1, reach)) : 0.15,
  };

  const { data: existingModel } = await supabase
    .from("scoring_models")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId)
    .maybeSingle();
  if (existingModel?.id) {
    await supabase
      .from("scoring_models")
      .update({
        name: `${name} scoring`,
        weights,
        threshold: Number.isFinite(threshold) ? Math.round(threshold) : 60,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingModel.id);
  } else {
    await supabase.from("scoring_models").insert({
      workspace_id: workspaceId,
      icp_id: icpId,
      name: `${name} scoring`,
      weights,
      threshold: Number.isFinite(threshold) ? Math.round(threshold) : 60,
    });
  }

  // Link the chosen pipeline to this ICP; unlink others pointing at it when
  // the user selects "None".
  await supabase
    .from("pipelines")
    .update({ icp_id: null })
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);
  if (pipelineId && pipelineId !== "none") {
    await supabase
      .from("pipelines")
      .update({ icp_id: icpId })
      .eq("workspace_id", workspaceId)
      .eq("id", pipelineId);
  }

  // The ICP being edited becomes the workspace default (single visible ICP in
  // the settings UI; the partial unique index enforces one default).
  await supabase
    .from("icp_profiles")
    .update({ is_default: false })
    .eq("workspace_id", workspaceId)
    .neq("id", icpId);
  await supabase
    .from("icp_profiles")
    .update({ is_default: true })
    .eq("workspace_id", workspaceId)
    .eq("id", icpId);

  await seedWorkspaceSignals(workspaceId);
  revalidatePath("/settings/business");
  revalidatePath("/companies");
}
