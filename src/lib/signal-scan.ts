// Website + funding signal detection. Writes company_signals with evidence,
// confidence and observation timestamps; never guesses beyond the source text.
import { createAdminClient } from "./supabase/admin";
import { scoreOrg } from "./scoring";
import { researchWebsite, searchWeb, tinyfishEnabled } from "./research";
import {
  collapse,
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

// Technology fingerprints checked against the homepage HTML. Kept generic and
// conservative to avoid false positives (e.g. fonts CDNs).
const TECH_SIGNATURES: Record<string, RegExp[]> = {
  tech_aws: [/amazonaws\.com/i, /awsstatic/i, /cloudfront\.net/i, /aws-sdk/i],
  tech_azure: [/azurewebsites\.net/i, /azureedge\.net/i, /windows\.net/i, /microsoftonline\.com/i],
  tech_gcp: [/appspot\.com/i, /googleusercontent\.com/i, /firebaseapp\.com/i, /storage\.googleapis\.com/i],
  tech_kubernetes: [/kubernetes/i, /\bk8s\b/i],
  tech_okta: [/okta\.com/i, /oktapreview\.com/i],
};

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

async function fetchHtmlRaw(rawUrl: string): Promise<{ url: string; html: string } | null> {
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
    return { url: final.toString(), html };
  } catch {
    return null;
  }
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

// Reject script/style artifacts so evidence stays readable.
function isLikelyContent(snippet: string): boolean {
  if (!snippet) return false;
  if (/[{}]/.test(snippet)) return false;
  if (/@media|function\s*\(|=>|\.border-|\.bg-|\.text-|var\s+\w+\s*=/.test(snippet)) {
    return false;
  }
  return true;
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
    .in("source_key", ["website", "techstack", "news"]);
  const definitions = (definitionRows ?? []) as SignalDefinition[];
  if (definitions.length === 0) {
    return { ok: true, created: 0, scanned: 0, skipped: "No website signals configured" };
  }

  const sources: { url: string; text: string }[] = [];
  const addSource = (url: string, text: string) => {
    if (!text.trim()) return;
    const existing = sources.find((source) => source.url === url);
    if (existing) {
      if (existing.text.length < 60_000) {
        existing.text = `${existing.text}\n${text}`.slice(0, 60_000);
      }
      return;
    }
    sources.push({ url, text: text.slice(0, 60_000) });
  };

  try {
    const research = await researchWebsite(website);
    addSource(
      research.final_url || website,
      [research.title ?? "", research.description ?? ""].filter(Boolean).join("\n")
    );
    for (const page of research.pages) {
      addSource(page.url, page.excerpt);
    }
    const base = isPublicHttpUrl(research.final_url || website);
    if (base) {
      const existing = new Set(research.pages.map((page) => page.url));
      for (const path of EXTRA_PATHS) {
        const target = new URL(path, base.origin).toString();
        if (existing.has(target)) continue;
        const fetched = await fetchText(target);
        if (fetched) addSource(fetched.url, fetched.text);
      }
    }
  } catch {
    return { ok: true, created: 0, scanned: 0, skipped: "Website unreachable" };
  }

  const rows: Record<string, unknown>[] = [];

  // Technology fingerprints (free, from the homepage HTML).
  const htmlSource = await fetchHtmlRaw(website);
  for (const definition of definitions) {
    if (definition.source_key !== "techstack") continue;
    const signatures = TECH_SIGNATURES[definition.key];
    if (!signatures || !htmlSource) continue;
    for (const pattern of signatures) {
      const match = htmlSource.html.match(pattern);
      if (!match) continue;
      const index = match.index ?? 0;
      rows.push({
        workspace_id: workspaceId,
        org_id: orgId,
        signal_key: definition.key,
        value: { keyword: match[0] },
        evidence: {
          source: "website_html",
          url: htmlSource.url,
          keyword: match[0],
          snippet: collapse(
            htmlSource.html.slice(Math.max(0, index - 80), index + 160)
          ).slice(0, 240),
        },
        source_key: "techstack",
        confidence: 0.55,
        observed_at: new Date().toISOString(),
        expires_at: expiryFor(definition.decay_days),
        dedupe_hash: signalDedupeHash([orgId, definition.key, match[0].toLowerCase()]),
      });
      break;
    }
  }

  // News signals via web search (free tier), capped to two definitions.
  const newsDefinitions = definitions
    .filter((definition) => definition.source_key === "news")
    .slice(0, 2);
  if (newsDefinitions.length > 0 && tinyfishEnabled()) {
    const orgName = (org as { name: string }).name;
    const newsRows = await Promise.all(
      newsDefinitions.map(async (definition) => {
        const keywords = extractKeywords(definition.query_config).slice(0, 3);
        if (keywords.length === 0) return [];
        const query = `"${orgName}" (${keywords.join(" OR ")})`;
        const results = await searchWeb(query, "news signal detection");
        const out: Record<string, unknown>[] = [];
        for (const result of results.slice(0, 5)) {
          const text = `${result.title ?? ""} ${result.snippet ?? ""}`;
          const keyword = keywords.find((entry) =>
            text.toLowerCase().includes(entry.toLowerCase())
          );
          if (!keyword) continue;
          out.push({
            workspace_id: workspaceId,
            org_id: orgId,
            signal_key: definition.key,
            value: { keyword },
            evidence: {
              source: "news",
              url: result.url ?? null,
              title: result.title ?? null,
              keyword,
              snippet: (result.snippet ?? "").slice(0, 240),
            },
            source_key: "news",
            confidence: 0.65,
            observed_at: new Date().toISOString(),
            expires_at: expiryFor(definition.decay_days),
            dedupe_hash: signalDedupeHash([
              orgId,
              definition.key,
              keyword.toLowerCase(),
              result.url ?? "",
            ]),
          });
        }
        return out;
      })
    );
    for (const group of newsRows) rows.push(...group);
  }

  for (const definition of definitions) {
    if (definition.source_key !== "website") continue;
    const keywords = extractKeywords(definition.query_config);
    if (keywords.length === 0) continue;
    for (const keyword of keywords) {
      const match = sources
        .map((source) => {
          const found = findKeywordMatches(source.text, [keyword]);
          return found[0] ? { source, match: found[0] } : null;
        })
        .filter(
          (entry): entry is { source: { url: string; text: string }; match: { keyword: string; snippet: string } } =>
            entry !== null
        )
        .find((entry) => isLikelyContent(entry.match.snippet));
      if (!match) continue;
      rows.push({
        workspace_id: workspaceId,
        org_id: orgId,
        signal_key: definition.key,
        value: { keyword: match.match.keyword },
        evidence: {
          source: "website",
          url: match.source.url,
          keyword: match.match.keyword,
          snippet: match.match.snippet,
        },
        source_key: "website",
        confidence: 0.8,
        observed_at: new Date().toISOString(),
        expires_at: expiryFor(definition.decay_days),
        dedupe_hash: signalDedupeHash([orgId, definition.key, match.match.keyword.toLowerCase()]),
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
  await scoreOrg(orgId, workspaceId).catch((err) => {
    console.error("[signals] score failed:", err instanceof Error ? err.message : err);
  });
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
  await scoreOrg(orgId, workspaceId).catch((err) => {
    console.error("[signals] funding score failed:", err instanceof Error ? err.message : err);
  });
  return data?.length ?? 0;
}
