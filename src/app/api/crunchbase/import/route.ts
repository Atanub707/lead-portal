import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getActorRun, getDatasetItems } from "@/lib/apify";
import {
  bareDomain,
  CRUNCHBASE_SEARCH_PREFIX,
  normalizeCompanyName,
  normalizeCrunchbaseItems,
  normalizeLinkedinUrl,
  startCrunchbaseActor,
} from "@/lib/crunchbase";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { requireWorkspaceId } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const RUN_TIMEOUT_MS = 30 * 60_000;
const COOKIES_MESSAGE =
  "Add your Crunchbase cookies once — they're needed to read Crunchbase search results.";

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

function isCookieJson(value: string) {
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const workspaceId = await requireWorkspaceId();
  const admin = createAdminClient();

  const body = (await request.json().catch(() => null)) as {
    searchUrl?: unknown;
    count?: unknown;
    cookies?: unknown;
    pipelineId?: unknown;
  } | null;

  const searchUrl =
    typeof body?.searchUrl === "string" ? body.searchUrl.trim() : "";
  if (!searchUrl.startsWith(CRUNCHBASE_SEARCH_PREFIX)) {
    return NextResponse.json(
      {
        error:
          "Paste a Crunchbase search URL that starts with https://www.crunchbase.com/.",
      },
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

  const providedCookies =
    typeof body?.cookies === "string" ? body.cookies.trim() : "";
  let cookies = providedCookies;
  if (cookies) {
    if (!isCookieJson(cookies)) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like the Cookie-Editor JSON export. Copy the whole JSON array and paste it here.",
        },
        { status: 400 }
      );
    }
  } else {
    const { data: settings, error: settingsError } = await admin
      .from("lead_source_settings")
      .select("crunchbase_cookies_enc")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (settingsError) {
      console.error(
        "[crunchbase] settings lookup failed:",
        settingsError.message
      );
    }
    const envelope = settings?.crunchbase_cookies_enc;
    if (typeof envelope === "string" && envelope) {
      try {
        cookies = decryptSecret(envelope);
      } catch {
        console.error("[crunchbase] stored cookies could not be decrypted");
      }
    }
  }

  if (!cookies) {
    return NextResponse.json({ error: COOKIES_MESSAGE }, { status: 400 });
  }

  if (providedCookies) {
    const { error: saveError } = await admin.from("lead_source_settings").upsert(
      {
        workspace_id: workspaceId,
        crunchbase_cookies_enc: encryptSecret(providedCookies),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );
    if (saveError) {
      console.error("[crunchbase] settings save failed:", saveError.message);
      return NextResponse.json(
        { error: "Couldn't save your Crunchbase cookies. Please try again." },
        { status: 500 }
      );
    }
  }

  let run: { runId: string; datasetId: string };
  try {
    run = await startCrunchbaseActor({ searchUrl, count, cookies });
  } catch (err) {
    console.error(
      "[crunchbase] start failed:",
      redactSecrets(
        err instanceof Error ? err.message : String(err),
        [cookies, process.env.APIFY_API_TOKEN]
      )
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
      search_url: searchUrl,
      requested_count: count,
      actor_run_id: run.runId,
      dataset_id: run.datasetId,
      status: "running",
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
    const { data, error } = await admin
      .from("lead_source_settings")
      .select("crunchbase_cookies_enc")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) {
      console.error("[crunchbase] settings lookup failed:", error.message);
      return NextResponse.json({ ok: true, configured: false });
    }
    return NextResponse.json({
      ok: true,
      configured: Boolean(data?.crunchbase_cookies_enc),
    });
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
      redactSecrets(
        err instanceof Error ? err.message : String(err),
        [process.env.APIFY_API_TOKEN]
      )
    );
    return NextResponse.json({ status: "running" });
  }

  const runStatus = run.status.toUpperCase();
  if (runStatus === "READY" || runStatus === "RUNNING") {
    return NextResponse.json({ status: "running" });
  }

  if (runStatus !== "SUCCEEDED") {
    const message =
      "The Crunchbase import failed before returning results. Check that your cookies are still valid and try again.";
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
      redactSecrets(
        err instanceof Error ? err.message : String(err),
        [process.env.APIFY_API_TOKEN]
      )
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

  const { companies, dropped } = normalizeCrunchbaseItems(items);
  const details = {
    fetched: items.length,
    returned: companies.length,
    dropped,
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
  if (rows.length > 0) {
    const { error: writeError } = await admin
      .from("organizations")
      .insert(rows);
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
    imported = rows.length;
  }

  await finishImport(admin, row, {
    status: "ok",
    imported,
    skipped,
    cost: run.usageTotalUsd,
    details,
  });

  return NextResponse.json({ status: "ok", imported, skipped });
}
