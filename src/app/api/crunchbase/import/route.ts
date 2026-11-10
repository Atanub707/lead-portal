import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getActorRun, getDatasetItems } from "@/lib/apify";
import {
  bareDomain,
  crunchbaseFiltersSummary,
  EMPLOYEE_BANDS,
  FOUNDED_AFTER_OPTIONS,
  FUNDING_STAGES,
  hasCrunchbaseFilters,
  INDUSTRY_OPTIONS,
  normalizeCompanyName,
  normalizeCrunchbaseItems,
  normalizeLinkedinUrl,
  startCrunchbaseActor,
  type CrunchbaseFilters,
} from "@/lib/crunchbase";
import { requireWorkspaceId } from "@/lib/data";
import {
  employeeBandFromCount,
  parseEmployeeBandText,
  parseFundingStage,
  parseLocationText,
} from "@/lib/intelligence";
import { upsertFirmographics } from "@/lib/intelligence-write";
import { recordFundingSignal } from "@/lib/signal-scan";
import { scoreOrg } from "@/lib/scoring";
import { enqueueJob } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const RUN_TIMEOUT_MS = 30 * 60_000;

type Admin = ReturnType<typeof createAdminClient>;

interface LeadImportRow {
  id: number;
  workspace_id: string;
  pipeline_id: string;
  requested_count: number;
  actor_run_id: string | null;
  dataset_id: string | null;
  status: string;
  imported: number;
  skipped: number;
  cost_usd: number;
  error: string | null;
  created_at: string;
}

function redactSecrets(message: string, secrets: (string | null | undefined)[]) {
  let safe = message;
  for (const secret of secrets) {
    if (secret && secret.length > 0) {
      safe = safe.split(secret).join("[redacted]");
    }
  }
  return safe
    .replace(/token=[^&\s]+/gi, "token=[redacted]")
    .slice(0, 400);
}

function sampleOf(item: unknown) {
  try {
    const json = JSON.stringify(item);
    return json ? json.slice(0, 2000) : null;
  } catch {
    return String(item).slice(0, 2000);
  }
}

async function finishImport(
  admin: Admin,
  row: LeadImportRow,
  patch: {
    status: "ok" | "failed";
    imported?: number;
    skipped?: number;
    cost?: number;
    error?: string | null;
    details?: Record<string, unknown> | null;
  }
) {
  const { error } = await admin
    .from("lead_imports")
    .update({
      status: patch.status,
      imported: patch.imported ?? 0,
      skipped: patch.skipped ?? 0,
      cost_usd: patch.cost ?? 0,
      error: patch.error ?? null,
      details: patch.details ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("workspace_id", row.workspace_id);
  if (error) {
    console.error("[crunchbase] import update failed:", error.message);
  }
}

function summary(row: LeadImportRow) {
  return {
    status: row.status,
    imported: Number(row.imported ?? 0),
    skipped: Number(row.skipped ?? 0),
    cost: Number(row.cost_usd ?? 0),
    error: row.error ?? null,
  };
}

function parseFilters(raw: unknown): CrunchbaseFilters | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const filters: CrunchbaseFilters = {};

  if (typeof body.category === "string" && body.category.trim()) {
    const category = body.category.trim();
    if (INDUSTRY_OPTIONS.some((entry) => entry.value === category)) {
      filters.category = category;
    }
  }
  if (typeof body.location === "string" && body.location.trim()) {
    filters.location = body.location.trim().slice(0, 120);
  }
  if (Array.isArray(body.employeeCount)) {
    const bands = body.employeeCount.filter(
      (band): band is string =>
        typeof band === "string" &&
        (EMPLOYEE_BANDS as readonly string[]).includes(band)
    );
    if (bands.length > 0) filters.employeeCount = [...new Set(bands)];
  }
  if (typeof body.fundingStage === "string" && body.fundingStage.trim()) {
    const stage = body.fundingStage.trim();
    if (FUNDING_STAGES.some((entry) => entry.value === stage)) {
      filters.fundingStage = stage;
    }
  }
  if (typeof body.foundedAfter === "string" && body.foundedAfter.trim()) {
    const foundedAfter = body.foundedAfter.trim();
    if (FOUNDED_AFTER_OPTIONS.some((entry) => entry.value === foundedAfter)) {
      filters.foundedAfter = foundedAfter;
    }
  }
  filters.detailed = body.detailed !== false;

  return hasCrunchbaseFilters(filters) ? filters : null;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const workspaceId = await requireWorkspaceId();
  const admin = createAdminClient();

  const body = (await request.json().catch(() => null)) as {
    filters?: unknown;
    count?: unknown;
    pipelineId?: unknown;
  } | null;

  const filters = parseFilters(body?.filters);
  if (!filters) {
    return NextResponse.json(
      { error: "Choose at least one filter: industry, location, headcount or funding stage." },
      { status: 400 }
    );
  }

  const requestedCount =
    body?.count === undefined || body?.count === null
      ? 25
      : Number(body.count);
  const count = Number.isFinite(requestedCount)
    ? Math.min(100, Math.max(1, Math.round(requestedCount)))
    : 25;

  const pipelineId =
    typeof body?.pipelineId === "string" ? body.pipelineId.trim() : "";
  if (!pipelineId) {
    return NextResponse.json(
      { error: "Choose a pipeline for these leads." },
      { status: 400 }
    );
  }
  const { data: pipeline, error: pipelineError } = await admin
    .from("pipelines")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", pipelineId)
    .maybeSingle();
  if (pipelineError) {
    console.error("[crunchbase] pipeline lookup failed:", pipelineError.message);
    return NextResponse.json(
      { error: "Couldn't check that pipeline. Please try again." },
      { status: 500 }
    );
  }
  if (!pipeline) {
    return NextResponse.json({ error: "Unknown pipeline." }, { status: 400 });
  }

  let run: { runId: string; datasetId: string };
  try {
    run = await startCrunchbaseActor(filters, count);
  } catch (err) {
    console.error(
      "[crunchbase] start failed:",
      redactSecrets(err instanceof Error ? err.message : String(err), [
        process.env.APIFY_API_TOKEN,
      ])
    );
    return NextResponse.json(
      { error: "Couldn't start the Crunchbase import. Please try again." },
      { status: 502 }
    );
  }

  const { data: created, error: insertError } = await admin
    .from("lead_imports")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      pipeline_id: pipelineId,
      source: "crunchbase",
      search_url: crunchbaseFiltersSummary(filters),
      requested_count: count,
      actor_run_id: run.runId,
      dataset_id: run.datasetId,
      status: "running",
      details: { filters },
    })
    .select("id")
    .single();

  if (insertError || !created) {
    console.error(
      "[crunchbase] import row insert failed:",
      insertError?.message
    );
    return NextResponse.json(
      {
        error:
          "The import started but couldn't be tracked. Please try again in a moment.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, id: created.id });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const workspaceId = await requireWorkspaceId();
  const admin = createAdminClient();
  const idParam = new URL(request.url).searchParams.get("id");

  if (!idParam) {
    // This actor needs no cookies or account, so the source is always ready.
    return NextResponse.json({ ok: true, configured: true });
  }

  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Unknown import." }, { status: 400 });
  }

  const { data, error } = await admin
    .from("lead_imports")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("[crunchbase] import lookup failed:", error.message);
    return NextResponse.json(
      { error: "Couldn't load that import. Please try again." },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Import not found." }, { status: 404 });
  }

  const row = data as LeadImportRow;
  if (row.status !== "running") {
    return NextResponse.json(summary(row));
  }

  const ageMs = Date.now() - new Date(row.created_at).getTime();
  if (ageMs > RUN_TIMEOUT_MS) {
    const message =
      "The import took too long and was stopped. Please try again.";
    await finishImport(admin, row, { status: "failed", error: message });
    return NextResponse.json({ status: "failed", error: message });
  }

  if (!row.actor_run_id) {
    const message = "The import didn't start correctly. Please try again.";
    await finishImport(admin, row, { status: "failed", error: message });
    return NextResponse.json({ status: "failed", error: message });
  }

  let run;
  try {
    run = await getActorRun(row.actor_run_id);
  } catch (err) {
    console.error(
      "[crunchbase] run lookup failed:",
      redactSecrets(err instanceof Error ? err.message : String(err), [
        process.env.APIFY_API_TOKEN,
      ])
    );
    return NextResponse.json({ status: "running" });
  }

  const runStatus = run.status.toUpperCase();
  if (runStatus === "READY" || runStatus === "RUNNING") {
    return NextResponse.json({ status: "running" });
  }

  if (runStatus !== "SUCCEEDED") {
    const message =
      "The Crunchbase import failed before returning results. Please try again.";
    await finishImport(admin, row, {
      status: "failed",
      cost: run.usageTotalUsd,
      error: message,
    });
    return NextResponse.json({ status: "failed", error: message });
  }

  const datasetId = run.datasetId || row.dataset_id;
  if (!datasetId) {
    const message = "The Crunchbase run finished without a dataset.";
    await finishImport(admin, row, {
      status: "failed",
      cost: run.usageTotalUsd,
      error: message,
    });
    return NextResponse.json({ status: "failed", error: message });
  }

  let items: unknown[];
  try {
    items = await getDatasetItems(
      datasetId,
      Math.min(Number(row.requested_count ?? 25), 100)
    );
  } catch (err) {
    console.error(
      "[crunchbase] dataset fetch failed:",
      redactSecrets(err instanceof Error ? err.message : String(err), [
        process.env.APIFY_API_TOKEN,
      ])
    );
    const message =
      "Couldn't download the Crunchbase results. Please try again.";
    await finishImport(admin, row, {
      status: "failed",
      cost: run.usageTotalUsd,
      error: message,
    });
    return NextResponse.json({ status: "failed", error: message });
  }

  const previousDetails =
    row && (row as unknown as { details?: Record<string, unknown> }).details;
  const attempts = Number(previousDetails?.attempts ?? 1);

  if (items.length === 0 && attempts < 3) {
    const filters =
      (previousDetails?.filters as Record<string, unknown> | undefined) ?? null;
    if (filters) {
      let retry: { runId: string; datasetId: string } | null = null;
      try {
        retry = await startCrunchbaseActor(filters, row.requested_count);
      } catch (err) {
        console.error(
          "[crunchbase] retry start failed:",
          redactSecrets(err instanceof Error ? err.message : String(err), [
            process.env.APIFY_API_TOKEN,
          ])
        );
      }
      if (retry) {
        const { error: retryError } = await admin
          .from("lead_imports")
          .update({
            actor_run_id: retry.runId,
            dataset_id: retry.datasetId,
            details: { ...previousDetails, attempts: attempts + 1 },
          })
          .eq("id", row.id)
          .eq("workspace_id", row.workspace_id);
        if (!retryError) {
          return NextResponse.json({ status: "running" });
        }
        console.error("[crunchbase] retry update failed:", retryError.message);
      }
    }
  }

  const { companies, dropped } = normalizeCrunchbaseItems(items);
  const details = {
    ...previousDetails,
    fetched: items.length,
    returned: companies.length,
    dropped,
    attempts,
    sample: items.length > 0 ? sampleOf(items[0]) : null,
  };

  const { data: existing, error: existingError } = await admin
    .from("organizations")
    .select("name, website, linkedin_url")
    .eq("workspace_id", workspaceId);
  if (existingError) {
    console.error("[crunchbase] organization lookup failed:", existingError.message);
    const message =
      "Couldn't check existing companies for duplicates. Please try again.";
    await finishImport(admin, row, {
      status: "failed",
      cost: run.usageTotalUsd,
      error: message,
    });
    return NextResponse.json({ status: "failed", error: message });
  }

  const names = new Set<string>();
  const domains = new Set<string>();
  const linkedins = new Set<string>();
  for (const org of existing ?? []) {
    if (org.name) names.add(normalizeCompanyName(org.name));
    const domain = bareDomain(org.website);
    if (domain) domains.add(domain);
    const linkedin = normalizeLinkedinUrl(org.linkedin_url);
    if (linkedin) linkedins.add(linkedin);
  }

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const company of companies) {
    const domain = company.domainKey;
    const linkedin = normalizeLinkedinUrl(company.linkedin);
    if (
      names.has(company.nameKey) ||
      (domain !== null && domains.has(domain)) ||
      (linkedin !== null && linkedins.has(linkedin))
    ) {
      skipped += 1;
      continue;
    }
    names.add(company.nameKey);
    if (domain) domains.add(domain);
    if (linkedin) linkedins.add(linkedin);
    rows.push({
      list: row.pipeline_id,
      kind: "lead",
      status: "new",
      workspace_id: workspaceId,
      created_by: userId,
      name: company.name,
      website: company.website,
      linkedin_url: company.linkedin,
      notes: company.notes,
    });
  }

  let imported = 0;
  let importedIds: number[] = [];
  if (rows.length > 0) {
    const { data: createdRows, error: writeError } = await admin
      .from("organizations")
      .insert(rows)
      .select("id, name");
    if (writeError) {
      console.error("[crunchbase] company insert failed:", writeError.message);
      const message = "Couldn't save the imported companies. Please try again.";
      await finishImport(admin, row, {
        status: "failed",
        skipped,
        cost: run.usageTotalUsd,
        error: message,
        details,
      });
      return NextResponse.json({ status: "failed", error: message });
    }
    imported = createdRows?.length ?? rows.length;
    importedIds = (createdRows ?? []).map((row) => row.id as number);

    const byName = new Map(companies.map((company) => [company.nameKey, company]));
    for (const created of createdRows ?? []) {
      const company = byName.get(normalizeCompanyName(created.name as string));
      if (company?.website) {
        await enqueueJob(workspaceId, "signal_scan", {
          orgId: created.id,
          enrich: true,
          userId,
        });
      }
    }
    const appliedFilters =
      (previousDetails?.filters as Record<string, unknown> | undefined) ?? {};
    const appliedCategory =
      typeof appliedFilters.category === "string"
        ? appliedFilters.category
        : null;
    const industryLabel =
      INDUSTRY_OPTIONS.find((entry) => entry.value === appliedCategory)?.label ??
      appliedCategory;
    for (const created of createdRows ?? []) {
      const company = byName.get(normalizeCompanyName(created.name as string));
      if (!company) continue;
      const location = parseLocationText(company.location);
      await upsertFirmographics(created.id as number, workspaceId, {
        industry: industryLabel,
        employee_band:
          parseEmployeeBandText(company.employees) ??
          employeeBandFromCount(null),
        funding_stage: parseFundingStage(company.funding),
        hq_city: location.city,
        hq_region: location.region,
        hq_country: location.country,
        data_sources: { crunchbase: true },
        confidence: 0.8,
      });
      if (company.email) {
        await admin.from("company_emails").upsert(
          [
            {
              org_id: created.id,
              workspace_id: workspaceId,
              email: company.email.toLowerCase(),
              kind: "general",
              source: "crunchbase",
            },
          ],
          { onConflict: "org_id,email", ignoreDuplicates: true }
        );
      }
      await recordFundingSignal(
        created.id as number,
        workspaceId,
        company.funding,
        company.crunchbaseUrl
      );
      await scoreOrg(created.id as number, workspaceId).catch((err) => {
        console.error("[crunchbase] score failed:", err instanceof Error ? err.message : err);
      });
    }
  }

  await finishImport(admin, row, {
    status: "ok",
    imported,
    skipped,
    cost: run.usageTotalUsd,
    details: { ...details, imported_ids: importedIds },
  });

  return NextResponse.json({
    status: "ok",
    imported,
    skipped,
    importedIds,
  });
}
