// AI account briefs: one structured call per company, cached for a week and
// grounded in stored evidence (firmographics, signals, contacts, ICP).
import { generateText } from "ai";
import { pickModel, NO_AI_KEY_MESSAGE } from "./ai";
import { createAdminClient } from "./supabase/admin";

export interface CompanyBrief {
  summary: string;
  priorities: string[];
  likely_objections: string[];
  suggested_angle: string;
  stakeholder_notes: { name: string; title: string; note: string }[];
  created_at: string;
}

const PROMPT_VERSION = "brief-v1";
const MAX_AGE_MS = 7 * 86_400_000;

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
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
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

export async function latestBrief(orgId: number): Promise<CompanyBrief | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("company_briefs")
    .select("summary, priorities, likely_objections, suggested_angle, stakeholder_notes, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    summary: (data.summary as string) ?? "",
    priorities: (data.priorities as string[]) ?? [],
    likely_objections: (data.likely_objections as string[]) ?? [],
    suggested_angle: (data.suggested_angle as string) ?? "",
    stakeholder_notes: (data.stakeholder_notes as CompanyBrief["stakeholder_notes"]) ?? [],
    created_at: data.created_at as string,
  };
}

export async function generateCompanyBrief(
  orgId: number,
  workspaceId: string,
  userId: string,
  force = false
): Promise<{ ok: true; brief: CompanyBrief } | { ok: false; error: string }> {
  const admin = createAdminClient();
  if (!force) {
    const existing = await latestBrief(orgId);
    if (existing && Date.now() - new Date(existing.created_at).getTime() < MAX_AGE_MS) {
      return { ok: true, brief: existing };
    }
  }

  const model = pickModel(userId);
  if (!model) return { ok: false, error: NO_AI_KEY_MESSAGE };

  const [orgRes, firmRes, signalsRes, contactsRes, icpRes, profileRes] =
    await Promise.all([
      admin.from("organizations").select("id, name, website, notes").eq("id", orgId).maybeSingle(),
      admin.from("company_firmographics").select("*").eq("org_id", orgId).maybeSingle(),
      admin
        .from("company_signals")
        .select("id, signal_key, evidence, confidence, observed_at")
        .eq("org_id", orgId)
        .order("observed_at", { ascending: false })
        .limit(12),
      admin
        .from("contacts")
        .select("name, title, email, is_decision_maker")
        .eq("org_id", orgId)
        .limit(8),
      admin
        .from("icp_profiles")
        .select("id, name, description")
        .eq("workspace_id", workspaceId)
        .eq("is_default", true)
        .maybeSingle(),
      admin
        .from("business_profiles")
        .select("name, service_categories, positioning")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const org = orgRes.data;
  if (!org) return { ok: false, error: "Company not found" };

  const signals = (signalsRes.data ?? []).map((signal) => ({
    key: signal.signal_key,
    confidence: signal.confidence,
    observed_at: signal.observed_at,
    snippet:
      (signal.evidence as { snippet?: string } | null)?.snippet?.slice(0, 180) ?? null,
  }));
  const firm = firmRes.data ?? null;
  const contacts = contactsRes.data ?? [];
  const offering = (profileRes.data?.service_categories as string[] | null) ?? [];

  const evidence = {
    company: {
      name: org.name,
      website: org.website,
      description: org.notes?.slice(0, 600) ?? null,
    },
    firmographics: firm
      ? {
          industry: firm.industry,
          employees: firm.employee_band,
          hq: [firm.hq_city, firm.hq_region, firm.hq_country].filter(Boolean).join(", "),
          funding: firm.funding_stage,
          founded: firm.founded_year,
          tech: firm.tech_stack,
        }
      : null,
    signals,
    contacts,
    icp: icpRes.data,
    offering,
  };

  const prompt = `Write a concise B2B account brief from this evidence. Do not invent facts.
Return ONLY JSON:
{"summary":string(3-4 sentences),"priorities":string[2-4],"likely_objections":string[2-4],"suggested_angle":string(1-2 sentences),"stakeholder_notes":[{"name":string,"title":string,"note":string}]}

Evidence JSON:
${JSON.stringify(evidence).slice(0, 6000)}`;

  try {
    const { text } = await generateText({
      model,
      system:
        "You are a senior B2B sales strategist. Be specific and evidence-led; never invent people, emails or metrics.",
      prompt,
    });
    const parsed = parseJson(text) as Record<string, unknown> | null;
    if (!parsed || typeof parsed.summary !== "string") {
      return { ok: false, error: "The AI couldn't build a brief. Try again." };
    }
    const stakeholderNotes = Array.isArray(parsed.stakeholder_notes)
      ? parsed.stakeholder_notes
          .map((entry) => entry as Record<string, unknown>)
          .filter((entry) => typeof entry.name === "string")
          .slice(0, 6)
          .map((entry) => ({
            name: String(entry.name),
            title: typeof entry.title === "string" ? entry.title : "",
            note: typeof entry.note === "string" ? entry.note : "",
          }))
      : [];

    const signalIds = (signalsRes.data ?? []).map((signal) => signal.id as number);
    const { data: inserted, error } = await admin
      .from("company_briefs")
      .insert({
        workspace_id: workspaceId,
        org_id: orgId,
        summary: parsed.summary.slice(0, 1200),
        priorities: strings(parsed.priorities).slice(0, 6),
        likely_objections: strings(parsed.likely_objections).slice(0, 6),
        suggested_angle:
          typeof parsed.suggested_angle === "string"
            ? parsed.suggested_angle.slice(0, 600)
            : null,
        stakeholder_notes: stakeholderNotes,
        evidence_signal_ids: signalIds,
        model: process.env.AI_MODEL ?? "opencode-go",
        prompt_version: PROMPT_VERSION,
      })
      .select("created_at")
      .single();
    if (error || !inserted) {
      return { ok: false, error: error?.message ?? "Could not save the brief." };
    }

    return {
      ok: true,
      brief: {
        summary: parsed.summary,
        priorities: strings(parsed.priorities),
        likely_objections: strings(parsed.likely_objections),
        suggested_angle:
          typeof parsed.suggested_angle === "string" ? parsed.suggested_angle : "",
        stakeholder_notes: stakeholderNotes,
        created_at: inserted.created_at as string,
      },
    };
  } catch (err) {
    console.error("[briefs] generation failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "The AI couldn't build a brief. Try again." };
  }
}
