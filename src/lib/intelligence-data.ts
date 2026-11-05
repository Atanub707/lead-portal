import { activeWorkspaceId, getPipelines } from "./data";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import type {
  BusinessProfile,
  Firmographics,
  IcpCriterion,
  IcpPersona,
  IcpProfile,
  ScoringModel,
  SignalDefinition,
} from "./intelligence";
import type { Pipeline } from "./types";

export interface TemplateSummary {
  key: string;
  name: string;
  description: string | null;
}

export interface IntelligenceBundle {
  workspaceId: string;
  profiles: BusinessProfile[];
  icp: IcpProfile | null;
  icps: IcpProfile[];
  personas: IcpPersona[];
  criteria: IcpCriterion[];
  model: ScoringModel | null;
  signals: SignalDefinition[];
  pipelines: Pipeline[];
  templates: TemplateSummary[];
}

export async function getIntelligenceBundle(): Promise<IntelligenceBundle> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const workspaceId = await activeWorkspaceId();

  const [profilesRes, icpsRes, signalsRes, templatesRes, pipelines] =
    await Promise.all([
      supabase
        .from("business_profiles")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabase
        .from("icp_profiles")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true }),
      admin
        .from("signal_definitions")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("category", { ascending: true })
        .order("label", { ascending: true }),
      supabase
        .from("template_business_profiles")
        .select("key, name, description")
        .order("sort_order", { ascending: true }),
      getPipelines(),
    ]);

  if (signalsRes.error) {
    console.error("[intelligence] signal definitions read failed:", signalsRes.error.message);
  }
  const profiles = (profilesRes.data ?? []) as BusinessProfile[];
  const icps = (icpsRes.data ?? []) as IcpProfile[];
  const icp = icps[0] ?? null;

  let personas: IcpPersona[] = [];
  let criteria: IcpCriterion[] = [];
  let model: ScoringModel | null = null;

  if (icp) {
    const [personasRes, criteriaRes, modelRes] = await Promise.all([
      supabase
        .from("icp_personas")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("icp_id", icp.id)
        .order("is_primary", { ascending: false }),
      supabase
        .from("icp_criteria")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("icp_id", icp.id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("scoring_models")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("icp_id", icp.id)
        .maybeSingle(),
    ]);
    personas = (personasRes.data ?? []) as IcpPersona[];
    criteria = (criteriaRes.data ?? []) as IcpCriterion[];
    model = (modelRes.data ?? null) as ScoringModel | null;
  }

  return {
    workspaceId,
    profiles,
    icp,
    icps,
    personas,
    criteria,
    model,
    signals: (signalsRes.data ?? []) as SignalDefinition[],
    pipelines,
    templates: (templatesRes.data ?? []) as TemplateSummary[],
  };
}

export async function getFirmographics(
  orgId: number
): Promise<Firmographics | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_firmographics")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  return (data ?? null) as Firmographics | null;
}

export async function getCompanySignals(orgId: number) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_signals")
    .select("*")
    .eq("org_id", orgId)
    .order("observed_at", { ascending: false })
    .limit(50);
  return data ?? [];
}
