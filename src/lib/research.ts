// Server-side research helper for the "Paste URL with AI" flow.
// researchWebsite — free: fetches a public website and extracts company data.
// Uses TinyFish (optional TINYFISH_API_KEY) for JS-rendered fetch + LinkedIn
// company URL search, and falls back to a built-in fetcher when not configured.

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 800_000;
const MAX_SUBPAGES = 3;
const EXCERPT_CHARS = 2500;
const USER_AGENT = "lead-portal/1.0 (+internal lead research)";

// TinyFish (https://tinyfish.ai) — Fetch and Search are free on every plan.
// Create a key at https://agent.tinyfish.ai and set TINYFISH_API_KEY to enable.
const TINYFISH_FETCH_URL = "https://api.fetch.tinyfish.ai";
const TINYFISH_SEARCH_URL = "https://api.search.tinyfish.ai";
const TINYFISH_TIMEOUT_MS = 20000;

function isPublicHttpUrl(value: string): URL | null {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
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

async function fetchHtml(url: URL): Promise<{ html: string; finalUrl: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Re-validate the redirect destination to keep the fetch on public hosts.
  const final = isPublicHttpUrl(res.url);
  if (!final) throw new Error("Redirected to a non-public address");

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("Not an HTML page");

  const html = (await res.text()).slice(0, MAX_HTML_BYTES);
  return { html, finalUrl: final.toString() };
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&#x27;": "'",
};

function decodeEntities(input: string) {
  return input.replace(/&[a-z#0-9x]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function metaTag(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${key}["']`,
      "i"
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }
  return null;
}

function titleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? htmlToText(match[1]).slice(0, 200) : null;
}

interface SiteLinks {
  linkedin_company: string[];
  linkedin_people: string[];
  emails: string[];
  socials: string[];
}

function collectLinks(html: string, base: URL): SiteLinks {
  const sets = {
    linkedin_company: new Set<string>(),
    linkedin_people: new Set<string>(),
    emails: new Set<string>(),
    socials: new Set<string>(),
  };

  const hrefRe = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html))) {
    const raw = match[1].trim();
    if (raw.toLowerCase().startsWith("mailto:")) {
      const email = raw.slice(7).split("?")[0].trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) sets.emails.add(email);
      continue;
    }
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const clean = url.origin + url.pathname.replace(/\/$/, "");
    if (host.endsWith("linkedin.com")) {
      if (url.pathname.startsWith("/company/")) sets.linkedin_company.add(clean);
      else if (url.pathname.startsWith("/in/")) sets.linkedin_people.add(clean);
    } else if (
      host.endsWith("instagram.com") ||
      host.endsWith("twitter.com") ||
      host.endsWith("x.com") ||
      host.endsWith("facebook.com")
    ) {
      sets.socials.add(clean);
    }
  }

  // Emails written in plain text (not mailto links)
  const text = htmlToText(html);
  for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    if (!/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(email)) sets.emails.add(email);
  }

  return {
    linkedin_company: [...sets.linkedin_company].slice(0, 5),
    linkedin_people: [...sets.linkedin_people].slice(0, 15),
    emails: [...sets.emails].slice(0, 10),
    socials: [...sets.socials].slice(0, 8),
  };
}

function findSubpages(html: string, base: URL): URL[] {
  const wanted = /(about|team|contact|company|careers|people|leadership)/i;
  const found: URL[] = [];
  const seen = new Set<string>([base.origin + base.pathname.replace(/\/$/, "")]);

  const hrefRe = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) && found.length < MAX_SUBPAGES * 3) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    const clean = url.origin + url.pathname.replace(/\/$/, "");
    if (seen.has(clean)) continue;
    if (!wanted.test(url.pathname)) continue;
    seen.add(clean);
    found.push(url);
  }

  // Prioritise /about and /team before contact/careers
  found.sort((a, b) => {
    const rank = (u: URL) =>
      /about/i.test(u.pathname) ? 0 : /team|people|leadership/i.test(u.pathname) ? 1 : 2;
    return rank(a) - rank(b);
  });

  return found.slice(0, MAX_SUBPAGES);
}

function mergeSiteLinks(target: SiteLinks, links: SiteLinks) {
  target.linkedin_company = [
    ...new Set([...target.linkedin_company, ...links.linkedin_company]),
  ].slice(0, 5);
  target.linkedin_people = [
    ...new Set([...target.linkedin_people, ...links.linkedin_people]),
  ].slice(0, 15);
  target.emails = [...new Set([...target.emails, ...links.emails])].slice(0, 10);
  target.socials = [...new Set([...target.socials, ...links.socials])].slice(0, 8);
}

function collectLinksFromText(text: string): SiteLinks {
  const sets = {
    linkedin_company: new Set<string>(),
    linkedin_people: new Set<string>(),
    emails: new Set<string>(),
    socials: new Set<string>(),
  };

  const urlRe = /https?:\/\/[^\s)\]"'<>]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRe.exec(text))) {
    let url: URL;
    try {
      url = new URL(match[0].replace(/[.,;:]+$/, ""));
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    const clean = url.origin + url.pathname.replace(/\/$/, "");
    if (host.endsWith("linkedin.com")) {
      if (url.pathname.startsWith("/company/")) sets.linkedin_company.add(clean);
      else if (url.pathname.startsWith("/in/")) sets.linkedin_people.add(clean);
    } else if (
      host.endsWith("instagram.com") ||
      host.endsWith("twitter.com") ||
      host.endsWith("x.com") ||
      host.endsWith("facebook.com")
    ) {
      sets.socials.add(clean);
    }
  }

  for (const email of text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    if (!/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(email)) sets.emails.add(email);
  }

  return {
    linkedin_company: [...sets.linkedin_company].slice(0, 5),
    linkedin_people: [...sets.linkedin_people].slice(0, 15),
    emails: [...sets.emails].slice(0, 10),
    socials: [...sets.socials].slice(0, 8),
  };
}

function findSubpagesFromMarkdown(text: string, base: URL): URL[] {
  const wanted = /(about|team|contact|company|careers|people|leadership)/i;
  const found = new Map<string, URL>();
  const baseClean = base.origin + base.pathname.replace(/\/$/, "");

  const linkRe = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    let url: URL;
    try {
      url = new URL(match[1]);
    } catch {
      continue;
    }
    if (url.hostname !== base.hostname) continue;
    const clean = url.origin + url.pathname.replace(/\/$/, "");
    if (clean === baseClean) continue;
    if (!wanted.test(url.pathname)) continue;
    found.set(clean, url);
  }

  const list = [...found.values()];
  list.sort((a, b) => {
    const rank = (u: URL) =>
      /about/i.test(u.pathname) ? 0 : /team|people|leadership/i.test(u.pathname) ? 1 : 2;
    return rank(a) - rank(b);
  });
  return list.slice(0, MAX_SUBPAGES);
}

interface TinyfishPage {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  text?: string;
}

function tinyfishKey(): string | null {
  const key = process.env.TINYFISH_API_KEY?.trim();
  return key ? key : null;
}

async function tinyfishFetch(urls: string[]): Promise<TinyfishPage[]> {
  const key = tinyfishKey();
  if (!key) throw new Error("TinyFish is not configured");
  const res = await fetch(TINYFISH_FETCH_URL, {
    method: "POST",
    headers: {
      "X-API-Key": key,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ urls: urls.slice(0, 10), format: "markdown" }),
    signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TinyFish fetch HTTP ${res.status}`);
  const json = (await res.json()) as { results?: TinyfishPage[] };
  return json.results ?? [];
}

interface TinyfishSearchResult {
  title?: string;
  snippet?: string;
  url?: string;
}

async function tinyfishSearch(
  query: string,
  purpose: string
): Promise<TinyfishSearchResult[]> {
  const key = tinyfishKey();
  if (!key) return [];
  const url = new URL(TINYFISH_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("purpose", purpose);
  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": key, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TINYFISH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: TinyfishSearchResult[] };
    return json.results ?? [];
  } catch {
    return [];
  }
}

function normaliseLinkedInUrl(
  raw: string | undefined,
  kind: "in" | "company"
): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    const match = url.pathname.match(new RegExp(`^/${kind}/([^/]+)`));
    if (!match) return null;
    return `https://www.linkedin.com/${kind}/${match[1]}`;
  } catch {
    return null;
  }
}

export function tinyfishEnabled(): boolean {
  return tinyfishKey() !== null;
}

async function tinyfishSearchLinkedInCompany(
  name: string,
  domain: string
): Promise<string[]> {
  const query = name
    ? `site:linkedin.com/company "${name}"`
    : `site:linkedin.com/company ${domain}`;
  const results = await tinyfishSearch(
    query,
    `Find the official LinkedIn company page for ${name || domain}`
  );
  const found: string[] = [];
  for (const result of results) {
    const clean = normaliseLinkedInUrl(result.url, "company");
    if (clean && !found.includes(clean)) found.push(clean);
    if (found.length >= 2) break;
  }
  return found;
}

export async function findLinkedInProfile(
  name: string,
  company?: string | null
): Promise<string | null> {
  const cleanName = name.trim();
  const parts = cleanName
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length >= 2);
  if (parts.length === 0) return null;

  const companyName = company?.trim() ?? "";
  const query = companyName
    ? `site:linkedin.com/in "${cleanName}" "${companyName}"`
    : `site:linkedin.com/in "${cleanName}"`;
  const results = await tinyfishSearch(
    query,
    `Find the personal LinkedIn profile of ${cleanName}${
      companyName ? ` at ${companyName}` : ""
    }`
  );

  for (const result of results.slice(0, 6)) {
    const candidate = normaliseLinkedInUrl(result.url, "in");
    if (!candidate) continue;
    const haystack = `${result.title ?? ""} ${result.snippet ?? ""}`.toLowerCase();
    if (!parts.every((part) => haystack.includes(part))) continue;
    if (companyName) {
      const companyWords = companyName
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 2);
      if (
        companyWords.length > 0 &&
        !companyWords.some((word) => haystack.includes(word))
      ) {
        continue;
      }
    }
    return candidate;
  }
  return null;
}

function deriveSiteName(title: string | null | undefined, fallback: string): string {
  if (!title) return fallback;
  const clean = title.split(/\s*[|·]\s*|\s+[—–]\s+/)[0]?.trim();
  return clean || fallback;
}

async function researchWebsiteTinyfish(
  url: URL,
  rawUrl: string
): Promise<WebsiteResearch> {
  const first = await tinyfishFetch([url.toString()]);
  const home = first[0];
  if (!home?.text) throw new Error("TinyFish returned no content");

  const finalUrl = home.final_url ?? home.url ?? url.toString();
  const base = new URL(finalUrl);
  const allLinks: SiteLinks = {
    linkedin_company: [],
    linkedin_people: [],
    emails: [],
    socials: [],
  };
  const mergeLinks = (links: SiteLinks) => mergeSiteLinks(allLinks, links);

  const pages: WebsiteResearch["pages"] = [
    {
      url: finalUrl,
      title: home.title ?? null,
      excerpt: home.text.slice(0, EXCERPT_CHARS),
    },
  ];
  mergeLinks(collectLinksFromText(home.text));

  const discovered = findSubpagesFromMarkdown(home.text, base);
  const candidates = discovered.length
    ? discovered
    : (["/about", "/team", "/contact"] as const).map((p) => new URL(p, base));

  try {
    const subs = await tinyfishFetch(candidates.map((c) => c.toString()));
    for (const page of subs) {
      if (!page.text) continue;
      pages.push({
        url: page.final_url ?? page.url,
        title: page.title ?? null,
        excerpt: page.text.slice(0, EXCERPT_CHARS),
      });
      mergeLinks(collectLinksFromText(page.text));
    }
  } catch {
    // Subpage failures are non-fatal.
  }

  let notes = "Fetched with TinyFish (renders JavaScript-heavy pages).";
  if (allLinks.linkedin_company.length === 0) {
    const found = await tinyfishSearchLinkedInCompany(
      deriveSiteName(home.title, ""),
      base.hostname
    );
    if (found.length) {
      allLinks.linkedin_company = found;
      notes +=
        " LinkedIn company URL recovered via TinyFish Search (it is not linked on the site).";
    }
  }

  return {
    requested_url: rawUrl,
    final_url: finalUrl,
    title: home.title ?? null,
    description: home.description ?? null,
    site_name: home.title ? deriveSiteName(home.title, base.hostname) : null,
    links: allLinks,
    pages,
    notes,
  };
}

export interface WebsiteResearch {
  requested_url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  site_name: string | null;
  links: SiteLinks;
  pages: { url: string; title: string | null; excerpt: string }[];
  notes?: string;
}

export async function researchWebsite(rawUrl: string): Promise<WebsiteResearch> {
  const url = isPublicHttpUrl(rawUrl);
  if (!url) throw new Error("Not a valid public http(s) URL");

  if (tinyfishKey()) {
    try {
      return await researchWebsiteTinyfish(url, rawUrl);
    } catch {
      // TinyFish unavailable — fall back to the built-in fetcher below.
    }
  }
  return researchWebsiteDirect(url, rawUrl);
}

async function researchWebsiteDirect(url: URL, rawUrl: string): Promise<WebsiteResearch> {
  const { html, finalUrl } = await fetchHtml(url);
  const base = new URL(finalUrl);
  const allLinks: SiteLinks = {
    linkedin_company: [],
    linkedin_people: [],
    emails: [],
    socials: [],
  };

  const mergeLinks = (links: SiteLinks) => mergeSiteLinks(allLinks, links);

  const pages: WebsiteResearch["pages"] = [
    {
      url: finalUrl,
      title: titleTag(html),
      excerpt: htmlToText(html).slice(0, EXCERPT_CHARS),
    },
  ];
  mergeLinks(collectLinks(html, base));

  for (const sub of findSubpages(html, base)) {
    try {
      const { html: subHtml, finalUrl: subFinal } = await fetchHtml(sub);
      pages.push({
        url: subFinal,
        title: titleTag(subHtml),
        excerpt: htmlToText(subHtml).slice(0, EXCERPT_CHARS),
      });
      mergeLinks(collectLinks(subHtml, new URL(subFinal)));
    } catch {
      // Subpage failures are non-fatal.
    }
  }

  return {
    requested_url: rawUrl,
    final_url: finalUrl,
    title: titleTag(html),
    description: metaTag(html, "description") ?? metaTag(html, "og:description"),
    site_name: metaTag(html, "og:site_name"),
    links: allLinks,
    pages,
  };
}

