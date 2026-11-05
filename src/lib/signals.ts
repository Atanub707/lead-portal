import { createHash } from "node:crypto";

// Pure helpers for signal detection, snippets and dedupe hashes.

export function extractKeywords(config: unknown): string[] {
  if (Array.isArray(config)) {
    return config.filter((entry): entry is string => typeof entry === "string");
  }
  if (!config || typeof config !== "object") return [];
  const record = config as Record<string, unknown>;
  if (Array.isArray(record.keywords)) {
    return record.keywords.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
  }
  if (typeof record.technology === "string") return [record.technology];
  if (typeof record.keyword === "string") return [record.keyword];
  return [];
}

export function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 90);
  return collapse(text.slice(start, end)).slice(0, 240);
}

export function findKeywordMatches(
  text: string,
  keywords: string[]
): { keyword: string; snippet: string }[] {
  const haystack = text.toLowerCase();
  const seen = new Set<string>();
  const matches: { keyword: string; snippet: string }[] = [];
  for (const keyword of keywords) {
    const needle = keyword.trim().toLowerCase();
    if (!needle || seen.has(needle)) continue;
    const index = haystack.indexOf(needle);
    if (index === -1) continue;
    seen.add(needle);
    matches.push({ keyword: keyword.trim(), snippet: snippetAround(text, index, needle.length) });
  }
  return matches;
}

export function signalDedupeHash(parts: (string | number | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function expiryFor(decayDays: number): string | null {
  if (!Number.isFinite(decayDays) || decayDays <= 0) return null;
  return new Date(Date.now() + decayDays * 86_400_000).toISOString();
}

export function fundingStageLabel(text: string): string | null {
  const series = text.match(/series\s*[a-j]/i);
  if (series) return series[0].toLowerCase().replace(/\s+/g, " ");
  if (/pre[\s_-]?seed/i.test(text)) return "pre-seed";
  if (/\bseed\b/i.test(text)) return "seed";
  if (/private[\s_-]?equity/i.test(text)) return "private equity";
  if (/\bangel\b/i.test(text)) return "angel";
  return null;
}
