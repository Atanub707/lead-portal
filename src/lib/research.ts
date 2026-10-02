// Server-side research helpers for the "Add with AI" assistant.
// 1) researchWebsite — free: fetches a public website and extracts company data.
// 2) runApifyLinkedIn — optional: runs an Apify actor to discover LinkedIn employees.

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 800_000;
const MAX_SUBPAGES = 3;
const EXCERPT_CHARS = 2500;
const USER_AGENT = "lead-portal/1.0 (+internal lead research)";

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

  const { html, finalUrl } = await fetchHtml(url);
  const base = new URL(finalUrl);
  const allLinks: SiteLinks = {
    linkedin_company: [],
    linkedin_people: [],
    emails: [],
    socials: [],
  };

  const mergeLinks = (links: SiteLinks) => {
    allLinks.linkedin_company = [
      ...new Set([...allLinks.linkedin_company, ...links.linkedin_company]),
    ].slice(0, 5);
    allLinks.linkedin_people = [
      ...new Set([...allLinks.linkedin_people, ...links.linkedin_people]),
    ].slice(0, 15);
    allLinks.emails = [...new Set([...allLinks.emails, ...links.emails])].slice(0, 10);
    allLinks.socials = [...new Set([...allLinks.socials, ...links.socials])].slice(0, 8);
  };

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

export interface LinkedInPerson {
  name: string | null;
  title: string | null;
  linkedin_url: string | null;
  location: string | null;
}

function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function runApifyLinkedIn(
  query: string
): Promise<{ count: number; people: LinkedInPerson[] } | { error: string }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return { error: "Apify is not configured (missing APIFY_API_TOKEN)." };
  }

  const actor =
    process.env.APIFY_LINKEDIN_ACTOR_ID ?? "harvestapi/linkedin-company-employees";
  const template =
    process.env.APIFY_LINKEDIN_ACTOR_INPUT ??
    '{"companies":["{{query}}"],"profileScraperMode":"Short"}';

  let input: unknown;
  try {
    input = JSON.parse(template.replaceAll("{{query}}", query.replace(/"/g, '\\"')));
  } catch {
    return { error: "APIFY_LINKEDIN_ACTOR_INPUT is not valid JSON." };
  }

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?token=${token}&timeout=45`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(55000),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return { error: `Apify ${res.status}: ${text.slice(0, 300)}` };
    }

    const items = (await res.json()) as Record<string, unknown>[];
    const people: LinkedInPerson[] = items
      .slice(0, 15)
      .map((item) => ({
        name:
          pickString(item, ["name", "fullName"]) ??
          ([pickString(item, ["firstName"]), pickString(item, ["lastName"])]
            .filter(Boolean)
            .join(" ") ||
            null),
        title: pickString(item, [
          "headline",
          "position",
          "jobTitle",
          "currentPosition",
        ]),
        linkedin_url: pickString(item, ["linkedinUrl", "url", "profileUrl"]),
        location: pickString(item, ["location", "locationName"]),
      }))
      .filter((person) => person.name || person.linkedin_url);

    return { count: items.length, people };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Apify request failed",
    };
  }
}
