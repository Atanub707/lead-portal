// Transparent, explainable lead scoring.
// fit  = ICP firmographic/geo match (industry, headcount, funding, country)
// intent = configured weighted signals, discounted by confidence and recency
// reach = how contactable the account is (verified email, decision-maker, LinkedIn)
// Every point written to lead_scores.reasons cites the rule and evidence ids.
import { createAdminClient } from "./supabase/admin";
import type { IcpCriterion } from "./intelligence";

export interface ScoreReason {
  rule: string;
  label: string;
  category: "fit" | "intent" | "reach" | "exclusion";
  points: number;
  max_points: number;
  matched: boolean;
  detail: string;
  evidence_signal_ids?: number[];
}

export interface ScoreResult {
  orgId: number;
  icpId: string;
  modelVersion: number;
  fit: number;
  intent: number;
  reach: number;
  total: number;
  grade: string;
  excluded: boolean;
  exclusionReason: string | null;
  reasons: ScoreReason[];
}

const FIT_POINTS: Record<string, number> = {
  industry: 40,
  employee_band: 30,
  funding_stage: 20,
  country: 10,
};

function matchesText(value: string | null | undefined, targets: string[]): boolean {
  if (!value) return false;
  const haystack = value.toLowerCase();
  return targets.some((target) => {
    const needle = target.trim().toLowerCase();
    return needle.length > 0 && (haystack.includes(needle) || needle.includes(haystack));
  });
}

function criteriaList(criteria: IcpCriterion[], field: string): string[] {
  const rows = criteria.filter(
    (criterion) => criterion.kind !== "signal" && criterion.field === field
  );
  const values: string[] = [];
  for (const row of rows) {
    if (Array.isArray(row.value)) {
      for (const entry of row.value) {
        if (typeof entry === "string" && entry.trim()) values.push(entry.trim());
      }
    }
  }
  return values;
}

function lastSignalReason(
  signalKey: string,
  labels: Map<string, string>,
  signals: { id: number; signal_key: string; evidence: unknown; observed_at: string; expires_at: string | null; confidence: number }[],
  weights: Map<string, number>
): ScoreReason[] {
  const reasons: ScoreReason[] = [];
  for (const signal of signals) {
    const weight = weights.get(signal.signal_key);
    if (!weight) continue;
    const confidence = Math.max(0, Math.min(1, Number(signal.confidence) || 0.5));
    const observed = new Date(signal.observed_at).getTime();
    const expires = signal.expires_at ? new Date(signal.expires_at).getTime() : null;
    const decay = expires && expires > observed
      ? Math.max(0.2, Math.min(1, (expires - Date.now()) / (expires - observed)))
      : 1;
    const points = Math.round(weight * confidence * decay);
    const evidence = (signal.evidence ?? {}) as Record<string, unknown>;
    const snippet = typeof evidence.snippet === "string" ? evidence.snippet.slice(0, 140) : "";
    reasons.push({
      rule: `signal:${signal.signal_key}`,
      label: labels.get(signal.signal_key) ?? signal.signal_key,
      category: "intent",
      points,
      max_points: weight,
      matched: true,
      detail: snippet || `Observed ${signal.observed_at.slice(0, 10)}`,
      evidence_signal_ids: [signal.id],
    });
  }
  return reasons;
}

export async function scoreOrg(
  orgId: number,
  workspaceId: string
): Promise<ScoreResult | null> {
  const admin = createAdminClient();

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, website, linkedin_url, icp_id, workspace_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || (org as { workspace_id: string }).workspace_id !== workspaceId) {
    return null;
  }

  const { data: icpDefault } = await admin
    .from("icp_profiles")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("is_default", true)
    .maybeSingle();
  const icpId =
    ((org as { icp_id: string | null }).icp_id ?? icpDefault?.id ?? null);
  if (!icpId) return null;

  const [modelRes, criteriaRes, firmRes, signalsRes, contactsRes, emailRes, defsRes] =
    await Promise.all([
      admin
        .from("scoring_models")
        .select("version, weights, threshold")
        .eq("workspace_id", workspaceId)
        .eq("icp_id", icpId)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("icp_criteria")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("icp_id", icpId),
      admin.from("company_firmographics").select("*").eq("org_id", orgId).maybeSingle(),
      admin
        .from("company_signals")
        .select("id, signal_key, evidence, observed_at, expires_at, confidence")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
      admin
        .from("contacts")
        .select("email, is_decision_maker, linkedin_url, email_status")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId),
      admin
        .from("company_emails")
        .select("email")
        .eq("workspace_id", workspaceId)
        .eq("org_id", orgId)
        .limit(1),
      admin
        .from("signal_definitions")
        .select("key, label")
        .eq("workspace_id", workspaceId),
    ]);

  const criteria = (criteriaRes.data ?? []) as IcpCriterion[];
  const firm = (firmRes.data ?? null) as Record<string, unknown> | null;
  const signals = (signalsRes.data ?? []) as {
    id: number;
    signal_key: string;
    evidence: unknown;
    observed_at: string;
    expires_at: string | null;
    confidence: number;
  }[];
  const contacts = (contactsRes.data ?? []) as {
    email: string | null;
    is_decision_maker: boolean;
    linkedin_url: string | null;
    email_status: string | null;
  }[];
  const labels = new Map<string, string>(
    (defsRes.data ?? []).map((row) => [row.key as string, row.label as string])
  );

  const weights = {
    fit: Number((modelRes.data?.weights as { fit?: number } | null)?.fit ?? 0.4),
    intent: Number((modelRes.data?.weights as { intent?: number } | null)?.intent ?? 0.45),
    reach: Number((modelRes.data?.weights as { reach?: number } | null)?.reach ?? 0.15),
  };
  const threshold = Number(modelRes.data?.threshold ?? 60);
  const modelVersion = Number(modelRes.data?.version ?? 1);

  const reasons: ScoreReason[] = [];

  // ── Exclusions ────────────────────────────────────────────────────────────
  const exclusionRows = criteria.filter((criterion) => criterion.kind === "exclusion");
  for (const row of exclusionRows) {
    const targets = Array.isArray(row.value)
      ? row.value.filter((entry): entry is string => typeof entry === "string")
      : [];
    const value =
      row.field === "industry"
        ? (firm?.industry as string | null) ?? null
        : row.field === "country"
          ? (firm?.hq_country as string | null) ?? null
          : (org as { name: string }).name;
    if (matchesText(value, targets)) {
      reasons.push({
        rule: `exclusion:${row.field}`,
        label: `Excluded: ${row.field}`,
        category: "exclusion",
        points: 0,
        max_points: 0,
        matched: true,
        detail: `${value ?? "—"} matches an excluded value`,
      });
      const result: ScoreResult = {
        orgId,
        icpId,
        modelVersion,
        fit: 0,
        intent: 0,
        reach: 0,
        total: 0,
        grade: "excluded",
        excluded: true,
        exclusionReason: `${row.field}: ${value}`,
        reasons,
      };
      await persist(admin, workspaceId, result);
      return result;
    }
  }

  // ── Fit ───────────────────────────────────────────────────────────────────
  const fitFields: { field: string; label: string }[] = [
    { field: "industry", label: "Industry" },
    { field: "employee_band", label: "Headcount" },
    { field: "funding_stage", label: "Funding stage" },
    { field: "country", label: "Country" },
  ];
  let fitEarned = 0;
  let fitPossible = 0;
  let hasFitCriteria = false;
  for (const { field, label } of fitFields) {
    const targets = criteriaList(criteria, field);
    if (targets.length === 0) continue;
    hasFitCriteria = true;
    const max = FIT_POINTS[field] ?? 10;
    fitPossible += max;
    let actual: string | null = null;
    if (field === "industry") {
      const industries = [
        typeof firm?.industry === "string" ? firm.industry : null,
        ...(Array.isArray(firm?.sub_industries) ? (firm.sub_industries as string[]) : []),
      ].filter((entry): entry is string => Boolean(entry));
      const matched = industries.find((entry) => matchesText(entry, targets));
      actual = matched ?? industries[0] ?? null;
    } else if (field === "employee_band") {
      actual = typeof firm?.employee_band === "string" ? firm.employee_band : null;
    } else if (field === "funding_stage") {
      actual = typeof firm?.funding_stage === "string" ? firm.funding_stage : null;
    } else if (field === "country") {
      actual = typeof firm?.hq_country === "string" ? firm.hq_country : null;
    }
    const matched = matchesText(actual, targets);
    if (matched) fitEarned += max;
    reasons.push({
      rule: `fit:${field}`,
      label,
      category: "fit",
      points: matched ? max : 0,
      max_points: max,
      matched,
      detail: actual
        ? matched
          ? `${actual} matches the ICP`
          : `${actual} is outside the ICP`
        : "No data yet — run research or enrich",
    });
  }
  const fit = hasFitCriteria
    ? Math.round((fitEarned / Math.max(1, fitPossible)) * 100)
    : 50;
  if (!hasFitCriteria) {
    reasons.push({
      rule: "fit:none",
      label: "Targeting",
      category: "fit",
      points: 50,
      max_points: 100,
      matched: false,
      detail: "No firmographic filters configured — neutral fit",
    });
  }

  // ── Intent ────────────────────────────────────────────────────────────────
  const signalWeights = new Map<string, number>();
  for (const criterion of criteria) {
    if (criterion.kind !== "signal") continue;
    const value = criterion.value;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as { key?: unknown; weight?: unknown };
    if (typeof record.key !== "string") continue;
    const weight = Number(record.weight ?? criterion.weight);
    if (Number.isFinite(weight) && weight > 0) signalWeights.set(record.key, weight);
  }
  const signalReasons = lastSignalReason("", labels, signals, signalWeights);
  reasons.push(...signalReasons);
  const intent = Math.min(
    100,
    Math.round(signalReasons.reduce((sum, reason) => sum + reason.points, 0))
  );
  if (signalWeights.size > 0 && signalReasons.length === 0) {
    reasons.push({
      rule: "intent:none",
      label: "Signals",
      category: "intent",
      points: 0,
      max_points: 0,
      matched: false,
      detail: "No signals observed yet — scan the website or add one",
    });
  }

  // ── Reach ─────────────────────────────────────────────────────────────────
  const decisionMakers = contacts.filter((contact) => contact.is_decision_maker);
  const contactEmails = contacts.filter((contact) => Boolean(contact.email));
  const dmEmail = decisionMakers.some((contact) => Boolean(contact.email));
  const anyEmail = contactEmails.length > 0;
  const companyEmail = (emailRes.data ?? []).length > 0;
  const linkedin = Boolean((org as { linkedin_url: string | null }).linkedin_url) ||
    contacts.some((contact) => Boolean(contact.linkedin_url));

  let reach = 0;
  if (dmEmail) {
    reach += 60;
    reasons.push({
      rule: "reach:dm_email",
      label: "Decision-maker email",
      category: "reach",
      points: 60,
      max_points: 60,
      matched: true,
      detail: "A decision-maker has an email address",
    });
  } else if (anyEmail) {
    reach += 40;
    reasons.push({
      rule: "reach:email",
      label: "Contact email",
      category: "reach",
      points: 40,
      max_points: 60,
      matched: true,
      detail: "A contact has an email (no decision-maker email yet)",
    });
  } else if (companyEmail) {
    reach += 20;
    reasons.push({
      rule: "reach:company_email",
      label: "Company email",
      category: "reach",
      points: 20,
      max_points: 60,
      matched: true,
      detail: "Only a general company email is known",
    });
  } else {
    reasons.push({
      rule: "reach:email",
      label: "Email",
      category: "reach",
      points: 0,
      max_points: 60,
      matched: false,
      detail: "No email yet — run Deep Research",
    });
  }
  if (decisionMakers.length > 0) {
    reach += 25;
    reasons.push({
      rule: "reach:dm",
      label: "Decision-maker found",
      category: "reach",
      points: 25,
      max_points: 25,
      matched: true,
      detail: `${decisionMakers.length} decision-maker${decisionMakers.length === 1 ? "" : "s"} identified`,
    });
  }
  if (linkedin) {
    reach += 15;
    reasons.push({
      rule: "reach:linkedin",
      label: "LinkedIn presence",
      category: "reach",
      points: 15,
      max_points: 15,
      matched: true,
      detail: "Company or contact LinkedIn profile known",
    });
  }
  reach = Math.min(100, reach);

  const weightSum = weights.fit + weights.intent + weights.reach || 1;
  const total = Math.round(
    (fit * weights.fit + intent * weights.intent + reach * weights.reach) / weightSum
  );
  const grade =
    total >= threshold + 20
      ? "A"
      : total >= threshold + 10
        ? "B"
        : total >= threshold
          ? "C"
          : "D";

  const result: ScoreResult = {
    orgId,
    icpId,
    modelVersion,
    fit,
    intent,
    reach,
    total,
    grade,
    excluded: false,
    exclusionReason: null,
    reasons,
  };
  await persist(admin, workspaceId, result);
  return result;
}

async function persist(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  result: ScoreResult
) {
  const { error } = await admin.from("lead_scores").insert({
    workspace_id: workspaceId,
    org_id: result.orgId,
    icp_id: result.icpId,
    model_version: result.modelVersion,
    fit: result.fit,
    intent: result.intent,
    reach: result.reach,
    total: result.total,
    grade: result.grade,
    excluded: result.excluded,
    exclusion_reason: result.exclusionReason,
    reasons: result.reasons,
  });
  if (error) {
    console.error("[scoring] insert failed:", error.message);
    return;
  }

  await admin
    .from("organizations")
    .update({
      score: result.total,
      grade: result.grade,
      icp_id: result.icpId,
    })
    .eq("id", result.orgId)
    .eq("workspace_id", workspaceId);

  // Keep the last 10 snapshots per org/ICP.
  const { data: old } = await admin
    .from("lead_scores")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("org_id", result.orgId)
    .eq("icp_id", result.icpId)
    .order("computed_at", { ascending: false })
    .order("id", { ascending: false })
    .range(10, 1000);
  if (old && old.length > 0) {
    await admin
      .from("lead_scores")
      .delete()
      .in("id", old.map((row) => row.id as number));
  }
}

export async function recomputeWorkspaceScores(
  workspaceId: string,
  limit = 500
): Promise<{ scored: number; failed: number }> {
  const admin = createAdminClient();
  const { data: orgs } = await admin
    .from("organizations")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("id")
    .limit(limit);

  let scored = 0;
  let failed = 0;
  const ids = (orgs ?? []).map((row) => row.id as number);
  const concurrency = 8;
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const score = await scoreOrg(id, workspaceId);
          return Boolean(score);
        } catch (err) {
          console.error("[scoring] org failed:", id, err instanceof Error ? err.message : err);
          return false;
        }
      })
    );
    for (const ok of results) {
      if (ok) scored += 1;
      else failed += 1;
    }
  }
  return { scored, failed };
}
