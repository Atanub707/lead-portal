// Server-only write helpers for the intelligence layer. Used by server
// actions, onboarding, deep research and imports. Always workspace-scoped.
import { createAdminClient } from "./supabase/admin";
import type { Firmographics } from "./intelligence";

export interface FirmographicPatch {
  industry?: string | null;
  sub_industries?: string[];
  employee_band?: string | null;
  employee_count?: number | null;
  founded_year?: number | null;
  hq_country?: string | null;
  hq_region?: string | null;
  hq_city?: string | null;
  funding_stage?: string | null;
  last_funding_at?: string | null;
  total_funding_usd?: number | null;
  revenue_band?: string | null;
  tech_stack?: string[];
  data_sources?: Record<string, unknown>;
  confidence?: number;
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function unique(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function upsertFirmographics(
  orgId: number,
  workspaceId: string,
  patch: FirmographicPatch
): Promise<void> {
  if (!orgId || !workspaceId) return;
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("company_firmographics")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  const current = (existing ?? null) as Firmographics | null;
  const sources = {
    ...(current?.data_sources ?? {}),
    ...(patch.data_sources ?? {}),
  };

  const row = {
    org_id: orgId,
    workspace_id: workspaceId,
    industry: clean(patch.industry) ?? current?.industry ?? null,
    sub_industries:
      unique(patch.sub_industries) ?? current?.sub_industries ?? [],
    employee_band: clean(patch.employee_band) ?? current?.employee_band ?? null,
    employee_count:
      patch.employee_count ?? current?.employee_count ?? null,
    founded_year: patch.founded_year ?? current?.founded_year ?? null,
    hq_country: clean(patch.hq_country) ?? current?.hq_country ?? null,
    hq_region: clean(patch.hq_region) ?? current?.hq_region ?? null,
    hq_city: clean(patch.hq_city) ?? current?.hq_city ?? null,
    funding_stage: clean(patch.funding_stage) ?? current?.funding_stage ?? null,
    last_funding_at:
      clean(patch.last_funding_at) ?? current?.last_funding_at ?? null,
    total_funding_usd:
      patch.total_funding_usd ?? current?.total_funding_usd ?? null,
    revenue_band: clean(patch.revenue_band) ?? current?.revenue_band ?? null,
    tech_stack: unique(patch.tech_stack)
      ? [...new Set([...(current?.tech_stack ?? []), ...(patch.tech_stack ?? [])])]
      : current?.tech_stack ?? [],
    data_sources: sources,
    confidence: patch.confidence ?? current?.confidence ?? 0.5,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("company_firmographics")
    .upsert(row, { onConflict: "org_id" });
  if (error) {
    console.error("[intelligence] firmographics upsert failed:", error.message);
  }
}

export async function seedWorkspaceSignals(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  const admin = createAdminClient();
  const { error } = await admin.rpc("seed_workspace_signal_definitions", {
    ws: workspaceId,
  });
  if (error) {
    console.error("[intelligence] signal seed failed:", error.message);
  }
}

export async function ensureDefaultIcp(
  workspaceId: string,
  userId: string | null
): Promise<string | null> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await admin
    .from("icp_profiles")
    .insert({
      workspace_id: workspaceId,
      name: "Default ICP",
      description: "Configure who this workspace targets.",
      status: "active",
      is_default: true,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    console.error("[intelligence] default ICP create failed:", error?.message);
    return null;
  }
  return created.id as string;
}

interface TemplatePersona {
  name: string;
  titles?: string[];
  seniorities?: string[];
  is_primary?: boolean;
}

interface TemplateSignal {
  key: string;
  weight?: number;
}

interface TemplateConfig {
  service_categories?: string[];
  icp?: {
    industries?: string[];
    employee_bands?: string[];
    geo?: string[];
    funding_stages?: string[];
    personas?: TemplatePersona[];
    signals?: TemplateSignal[];
  };
  scoring?: { fit?: number; intent?: number; reach?: number; threshold?: number };
}

export async function applyTemplateToWorkspace(
  workspaceId: string,
  userId: string | null,
  templateKey: string
): Promise<{ ok: boolean; businessProfileId?: string; icpId?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: template, error: templateError } = await admin
    .from("template_business_profiles")
    .select("key, name, description, config")
    .eq("key", templateKey)
    .maybeSingle();
  if (templateError || !template) {
    return { ok: false, error: "Unknown business profile template." };
  }

  const config = (template.config ?? {}) as TemplateConfig;
  const serviceCategories = (config.service_categories ?? []).filter(Boolean);

  // One business profile per applied template in the workspace.
  const { data: existingProfile } = await admin
    .from("business_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("template_key", templateKey)
    .maybeSingle();

  let businessProfileId = existingProfile?.id as string | undefined;
  if (businessProfileId) {
    const { error } = await admin
      .from("business_profiles")
      .update({
        name: template.name,
        description: template.description,
        service_categories: serviceCategories,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", businessProfileId)
      .eq("workspace_id", workspaceId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data: created, error } = await admin
      .from("business_profiles")
      .insert({
        workspace_id: workspaceId,
        name: template.name,
        description: template.description,
        service_categories: serviceCategories,
        template_key: templateKey,
        is_active: true,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, error: error?.message ?? "Could not save the profile." };
    }
    businessProfileId = created.id as string;
  }

  // One ICP per business profile.
  const { data: existingIcp } = await admin
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("business_profile_id", businessProfileId)
    .maybeSingle();

  let icpId = existingIcp?.id as string | undefined;
  const icpName = config.icp ? template.name : "Default ICP";
  if (icpId) {
    await admin
      .from("icp_profiles")
      .update({
        name: icpName,
        description: template.description,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", icpId)
      .eq("workspace_id", workspaceId);
  } else {
    const { data: created, error } = await admin
      .from("icp_profiles")
      .insert({
        workspace_id: workspaceId,
        business_profile_id: businessProfileId,
        name: icpName,
        description: template.description,
        status: "active",
        is_default: false,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !created) {
      return { ok: false, error: error?.message ?? "Could not save the ICP." };
    }
    icpId = created.id as string;
  }

  // Replace personas and criteria for this ICP.
  await admin
    .from("icp_personas")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);
  const personas = (config.icp?.personas ?? []).filter((p) => p?.name);
  if (personas.length > 0) {
    const { error } = await admin.from("icp_personas").insert(
      personas.map((persona, index) => ({
        workspace_id: workspaceId,
        icp_id: icpId,
        name: persona.name,
        titles: persona.titles ?? [],
        seniorities: persona.seniorities ?? [],
        functions: [],
        weight: 1,
        is_primary: persona.is_primary ?? index === 0,
      }))
    );
    if (error) console.error("[intelligence] personas insert failed:", error.message);
  }

  await admin
    .from("icp_criteria")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId);

  const criteria: Record<string, unknown>[] = [];
  const pushList = (
    kind: string,
    field: string,
    values: string[] | undefined
  ) => {
    const cleanValues = (values ?? []).map((v) => v.trim()).filter(Boolean);
    if (cleanValues.length === 0) return;
    criteria.push({
      workspace_id: workspaceId,
      icp_id: icpId,
      kind,
      field,
      operator: "in",
      value: cleanValues,
      is_required: true,
      weight: 1,
      label: field,
      sort_order: criteria.length,
    });
  };

  pushList("firmographic", "industry", config.icp?.industries);
  pushList("firmographic", "employee_band", config.icp?.employee_bands);
  pushList("geo", "country", config.icp?.geo);
  pushList("firmographic", "funding_stage", config.icp?.funding_stages);

  for (const signal of config.icp?.signals ?? []) {
    if (!signal?.key) continue;
    criteria.push({
      workspace_id: workspaceId,
      icp_id: icpId,
      kind: "signal",
      field: "signal_key",
      operator: "exists",
      value: { key: signal.key, weight: signal.weight ?? 10 },
      is_required: false,
      weight: signal.weight ?? 10,
      label: signal.key,
      sort_order: criteria.length,
    });
  }

  if (criteria.length > 0) {
    const { error } = await admin.from("icp_criteria").insert(criteria);
    if (error) console.error("[intelligence] criteria insert failed:", error.message);
  }

  const scoring = config.scoring ?? {};
  const weights = {
    fit: scoring.fit ?? 0.4,
    intent: scoring.intent ?? 0.45,
    reach: scoring.reach ?? 0.15,
  };
  const { data: existingModel } = await admin
    .from("scoring_models")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("icp_id", icpId)
    .maybeSingle();
  if (existingModel?.id) {
    await admin
      .from("scoring_models")
      .update({
        name: `${icpName} scoring`,
        weights,
        threshold: scoring.threshold ?? 60,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingModel.id);
  } else {
    await admin.from("scoring_models").insert({
      workspace_id: workspaceId,
      icp_id: icpId,
      name: `${icpName} scoring`,
      weights,
      threshold: scoring.threshold ?? 60,
      is_active: true,
    });
  }

  await seedWorkspaceSignals(workspaceId);

  return { ok: true, businessProfileId, icpId };
}
