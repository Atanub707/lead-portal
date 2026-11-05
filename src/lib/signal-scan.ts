// Website + funding signal detection. Writes company_signals with evidence,
// confidence and observation timestamps; never guesses beyond the source text.
import { createAdminClient } from "./supabase/admin";
import { researchWebsite } from "./research";
import {
  expiryFor,
  extractKeywords,
  findKeywordMatches,
  fundingStageLabel,
  signalDedupeHash,
} from "./signals";
import type { SignalDefinition } from "./intelligence";

const FETCH_TIMEOUT_MS = 8000;
const EXTRA_PATHS = ["/trust", "/security", "/compliance", "/privacy"];
const USER_AGENT = "lead-portal/1.0 (+signal scan)";

function isPublicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(rawUrl: string): Promise<{ url: string; text: string } | null> {
  const url = isPublicHttpUrl(rawUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return null;
    const final = isPublicHttpUrl(res.url);
    if (!final) return null;
    const html = (await res.text()).slice(0, 500_000);
    return { url: final.toString(), text: htmlToText(html).slice(0, 60_000) };
  } catch {
    return null;
  }
}

async function refreshOrgSignalStats(orgId: number, workspaceId: string) {
  const admin = createAdminClient();
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
}

export async function scanCompanySignals(
  orgId: number,
  workspaceId: string
): Promise<{ ok: boolean; created: number; scanned: number; skipped?: string }> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, website, workspace_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || (org as { workspace_id: string }).workspace_id !== workspaceId) {
    return { ok: false, created: 0, scanned: 0, skipped: "Company not found" };
  }
  const website = (org as { website: string | null }).website;
  if (!website) {
    return { ok: true, created: 0, scanned: 0, skipped: "No website to scan" };
  }

  const { data: definitionRows } = await admin
    .from("signal_definitions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .eq("source_key", "website");
  const definitions = (definitionRows ?? []) as SignalDefinition[];
  if (definitions.length === 0) {
    return { ok: true, created: 0, scanned: 0, skipped: "No website signals configured" };
  }

  let text = "";
  const sources: { url: string; text: string }[] = [];
  try {
    const research = await researchWebsite(website);
    text += [
      research.title ?? "",
      research.description ?? "",
      research.notes ?? "",
      ...research.pages.map((page) => page.excerpt),
    ].join("\n");
    sources.push(
      ...research.pages.map((page) => ({ url: page.url, text: page.excerpt }))
    );
    const base = isPublicHttpUrl(research.final_url || website);
    if (base) {
      const existing = new Set(research.pages.map((page) => page.url));
      for (const path of EXTRA_PATHS) {
        const target = new URL(path, base.origin).toString();
        if (existing.has(target)) continue;
        const fetched = await fetchText(target);
        if (fetched) {
          text += `\n${fetched.text}`;
          sources.push(fetched);
        }
      }
    }
  } catch {
    return { ok: true, created: 0, scanned: 0, skipped: "Website unreachable" };
  }

  const rows: Record<string, unknown>[] = [];
  for (const definition of definitions) {
    const keywords = extractKeywords(definition.query_config);
    if (keywords.length === 0) continue;
    const matches = findKeywordMatches(text, keywords);
    for (const match of matches.slice(0, 3)) {
      rows.push({
        workspace_id: workspaceId,
        org_id: orgId,
        signal_key: definition.key,
        value: { keyword: match.keyword },
        evidence: {
          source: "website",
          url: sources[0]?.url ?? website,
          keyword: match.keyword,
          snippet: match.snippet,
        },
        source_key: "website",
        confidence: 0.8,
        observed_at: new Date().toISOString(),
        expires_at: expiryFor(definition.decay_days),
        dedupe_hash: signalDedupeHash([orgId, definition.key, match.keyword.toLowerCase()]),
      });
    }
  }

  let created = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("company_signals")
      .upsert(rows, {
        onConflict: "org_id,signal_key,dedupe_hash",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      console.error("[signals] insert failed:", error.message);
      return { ok: false, created: 0, scanned: definitions.length };
    }
    created = data?.length ?? 0;
  }

  await refreshOrgSignalStats(orgId, workspaceId);
  return { ok: true, created, scanned: definitions.length };
}

export async function recordFundingSignal(
  orgId: number,
  workspaceId: string,
  fundingText: string | null,
  sourceUrl?: string | null
): Promise<number> {
  if (!fundingText) return 0;
  if (!/round|funding|raised|seed|series|private equity|angel/i.test(fundingText)) {
    return 0;
  }
  const stage = fundingStageLabel(fundingText) ?? "funding";
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("company_signals")
    .upsert(
      [
        {
          workspace_id: workspaceId,
          org_id: orgId,
          signal_key: "funding_recent",
          value: { stage },
          evidence: {
            source: "crunchbase",
            url: sourceUrl ?? null,
            snippet: fundingText.slice(0, 240),
          },
          source_key: "crunchbase",
          confidence: 0.7,
          observed_at: new Date().toISOString(),
          expires_at: expiryFor(180),
          dedupe_hash: signalDedupeHash([orgId, "funding_recent", stage]),
        },
      ],
      { onConflict: "org_id,signal_key,dedupe_hash", ignoreDuplicates: true }
    )
    .select("id");
  if (error) {
    console.error("[signals] funding insert failed:", error.message);
    return 0;
  }
  await refreshOrgSignalStats(orgId, workspaceId);
  return data?.length ?? 0;
}
