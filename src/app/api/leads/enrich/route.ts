import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getActorRun, getDatasetItems, startActorRun } from "@/lib/apify";
import { requireWorkspaceId } from "@/lib/data";
import {
  APOLLO_ACTOR,
  apolloInput,
  mergeLeads,
  normalizeApolloLead,
} from "@/lib/deep-research";
import { employeeBandFromCount, parseLocationText } from "@/lib/intelligence";
import { upsertFirmographics } from "@/lib/intelligence-write";
import { scoreOrg } from "@/lib/scoring";
import { researchWebsite } from "@/lib/research";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const body = (await request.json().catch(() => null)) as { orgIds?: unknown } | null;
  const orgIds = Array.isArray(body?.orgIds)
    ? body.orgIds.map(Number).filter((id) => Number.isFinite(id)).slice(0, 10)
    : [];
  if (orgIds.length === 0) {
    return NextResponse.json({ ok: false, error: "No companies to enrich" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, website")
    .in("id", orgIds);
  const admin = createAdminClient();

  // Free first pass: published emails from each company's own website. This
  // guarantees a usable address even when the contact database has no coverage.
  const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  await Promise.all(
    (orgs ?? []).map(async (org) => {
      if (!org.website) return;
      try {
        const research = await researchWebsite(org.website as string);
        const collected = new Set<string>(research.links.emails);
        for (const page of research.pages) {
          for (const email of page.excerpt.match(emailPattern) ?? []) {
            collected.add(email);
          }
        }
        const emails = [...collected]
          .map((email) => email.trim().toLowerCase())
          .filter((email) => !/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(email))
          .slice(0, 5);
        if (emails.length > 0) {
          await admin.from("company_emails").upsert(
            emails.map((email) => ({
              org_id: org.id,
              workspace_id: workspaceId,
              email,
              kind: "general",
              source: "website",
            })),
            { onConflict: "org_id,email", ignoreDuplicates: true }
          );
        }
      } catch {
        // Website unavailable — Apollo is the fallback.
      }
    })
  );

  const runs: { orgId: number; runId: string; datasetId: string }[] = [];
  for (const org of orgs ?? []) {
    try {
      const started = await startActorRun(
        APOLLO_ACTOR,
        apolloInput({ name: org.name as string, website: org.website as string | null })
      );
      runs.push({
        orgId: org.id as number,
        runId: started.runId,
        datasetId: started.datasetId,
      });
    } catch (err) {
      console.error(
        "[quick-enrich] start failed:",
        org.id,
        err instanceof Error ? err.message : err
      );
    }
  }
  return NextResponse.json({ ok: true, runs });
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const params = new URL(request.url).searchParams;
  const orgId = Number(params.get("orgId"));
  const runId = params.get("runId");
  if (!orgId || !runId) {
    return NextResponse.json({ ok: false, error: "Missing run" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, workspace_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || (org.workspace_id as string) !== workspaceId) {
    return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });
  }

  let info;
  try {
    info = await getActorRun(runId);
  } catch {
    return NextResponse.json({ ok: true, status: "running" });
  }
  const status = info.status.toUpperCase();
  if (status === "READY" || status === "RUNNING") {
    return NextResponse.json({ ok: true, status: "running" });
  }
  if (status !== "SUCCEEDED") {
    return NextResponse.json({ ok: true, status: "failed" });
  }

  const items = await getDatasetItems(info.datasetId, 40);
  const leads = items
    .map(normalizeApolloLead)
    .filter((lead): lead is NonNullable<typeof lead> => lead !== null);
  const admin = createAdminClient();
  const merged = await mergeLeads(admin, {
    orgId,
    userId,
    leads: leads.map((lead) => ({ lead, source: "apollo" as const })),
  });

  const address = parseLocationText(merged.company.address);
  await upsertFirmographics(orgId, workspaceId, {
    employee_count: merged.company.employees ?? null,
    employee_band: employeeBandFromCount(merged.company.employees ?? null),
    founded_year: merged.company.founded ?? null,
    hq_city: address.city,
    hq_region: address.region,
    hq_country: address.country,
    data_sources: { quick_enrich: true },
    confidence: 0.7,
  });
  await scoreOrg(orgId, workspaceId).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    status: "ok",
    people: merged.people,
    emails: merged.emails,
  });
}
