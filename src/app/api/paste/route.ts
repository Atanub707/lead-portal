import { generateObject, generateText } from "ai";
import { z } from "zod";
import { NO_AI_KEY_MESSAGE, pickModel } from "@/lib/ai";
import { findLinkedInProfile, researchWebsite, tinyfishEnabled } from "@/lib/research";
import { createClient } from "@/lib/supabase/server";
import { LIST_LABEL, parseList, type OrgList } from "@/lib/types";

export const maxDuration = 60;

const ExtractSchema = z.object({
  name: z.string().describe("The company's official name"),
  description: z
    .string()
    .describe("One or two sentences on what the company does, taken from the site"),
  linkedin_company_url: z
    .string()
    .describe("LinkedIn company page URL exactly as found; empty string if unknown"),
  emails: z.array(z.string()).describe("Public contact emails found on the site"),
  kind: z
    .enum(["lead", "partner", "competitor", "other"])
    .describe("See classification rules"),
  contacts: z
    .array(
      z.object({
        name: z.string(),
        title: z.string().describe("Job title; empty string if unknown"),
        linkedin_url: z
          .string()
          .describe("Personal LinkedIn profile URL; empty string if unknown"),
        email: z.string().describe("Email; empty string if unknown"),
      })
    )
    .describe("Real people named on the site (team/about pages), max 12"),
});

const EXTRACT_SYSTEM = `You extract structured company data from website research for an internal CRM with two pipelines.

- POS Pipeline: restaurant/hospitality point-of-sale technology. "competitor" = a POS vendor/product company, "partner" = an integration or channel partner, "lead" = a potential customer, "other" = unclear.
- Compliance Pipeline: organizations that may buy SOC 2 / ISO 27000 readiness services. Most are "lead".

Rules:
- Use ONLY facts present in the research. Never invent people, emails, or URLs.
- contacts: only real people named on the site (team/about/leadership pages), prefer founders and senior people. Set title/linkedin_url/email to "" when not present.
- Use "" for unknown single values and [] for unknown lists.`;

const JSON_SHAPE = `Return a single JSON object with exactly these keys:
{
  "name": string,
  "description": string (1-2 sentences, "" if unknown),
  "linkedin_company_url": string ("" if unknown),
  "emails": string[] ([] if none),
  "kind": "lead" | "partner" | "competitor" | "other",
  "contacts": [{ "name": string, "title": string, "linkedin_url": string, "email": string }] (max 12, [] if none)
}
Return ONLY the JSON object — no markdown fences, no commentary.`;

function parseJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to brace slicing
  }
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

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function sanitize(query: string) {
  return query.replace(/[%(),]/g, " ").trim();
}

function normalise(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function cleanWebsite(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key) || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    url?: unknown;
    list?: unknown;
  } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const list: OrgList = parseList(
    typeof body?.list === "string" ? body.list : undefined
  );
  if (!url) {
    return Response.json({ error: "Paste a website URL first." }, { status: 400 });
  }

  const model = pickModel(user.id);
  if (!model) {
    return Response.json({ error: NO_AI_KEY_MESSAGE }, { status: 503 });
  }

  let research;
  try {
    research = await researchWebsite(url);
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error
            ? `Couldn't read that website: ${err.message}`
            : "Couldn't read that website.",
      },
      { status: 422 }
    );
  }

  const digest = {
    requested_url: research.requested_url,
    final_url: research.final_url,
    title: research.title,
    description: research.description,
    site_name: research.site_name,
    notes: research.notes,
    links: research.links,
    pages: research.pages.map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: page.excerpt.slice(0, 1500),
    })),
  };

  const userPrompt = `Here is the website research (JSON):\n\n${JSON.stringify(
    digest
  )}`;

  // Plain-text generation first: no response_format, the request shape OpenCode Go
  // handles most reliably. generateObject (JSON mode) is the second chance.
  let extracted: z.infer<typeof ExtractSchema> | null = null;
  const failures: string[] = [];

  try {
    const { text } = await generateText({
      model,
      system: `${EXTRACT_SYSTEM}\n\n${JSON_SHAPE}`,
      prompt: userPrompt,
    });
    const parsed = parseJsonObject(text);
    if (parsed) {
      const result = ExtractSchema.safeParse(parsed);
      if (result.success) {
        extracted = result.data;
      } else {
        failures.push(
          `parse: ${result.error.issues[0]?.message ?? "schema mismatch"}`
        );
      }
    } else {
      failures.push("parse: no JSON object in the model output");
    }
  } catch (err) {
    failures.push(`text: ${errorMessage(err)}`);
  }

  if (!extracted) {
    try {
      const { object } = await generateObject({
        model,
        schema: ExtractSchema,
        system: EXTRACT_SYSTEM,
        prompt: userPrompt,
      });
      extracted = object;
    } catch (err) {
      failures.push(`object: ${errorMessage(err)}`);
    }
  }

  if (!extracted) {
    console.error("[paste] extraction failed:", failures.join(" | "));
    return Response.json(
      {
        error: "The AI couldn't extract data from that site. Please try again.",
        detail: failures.join(" | ").slice(0, 300),
      },
      { status: 502 }
    );
  }

  const name =
    extracted.name.trim() ||
    research.site_name ||
    hostOf(research.final_url) ||
    "Unknown company";
  const website = cleanWebsite(research.final_url);
  const linkedin =
    (extracted.linkedin_company_url.trim() ||
      research.links.linkedin_company[0] ||
      "").trim() || null;
  const emails = [
    ...new Set(
      [...extracted.emails, ...research.links.emails]
        .map((email) => email.trim().toLowerCase())
        .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ),
  ].slice(0, 10);

  const contacts = extracted.contacts
    .map((contact) => ({
      name: contact.name.trim(),
      title: contact.title.trim(),
      linkedin_url: contact.linkedin_url.trim(),
      email: contact.email.trim().toLowerCase(),
    }))
    .filter(
      (contact) =>
        contact.name.length > 1 &&
        !/^(unknown|n\/?a|none)$/i.test(contact.name)
    )
    .slice(0, 12);

  // Free personal LinkedIn discovery (TinyFish Search) for people the site didn't link.
  let linkedinProfilesFound = 0;
  if (tinyfishEnabled()) {
    const needProfiles = contacts.filter((contact) => !contact.linkedin_url);
    const found = await Promise.all(
      needProfiles.map((contact) => findLinkedInProfile(contact.name, name))
    );
    needProfiles.forEach((contact, index) => {
      const profile = found[index];
      if (profile) {
        contact.linkedin_url = profile;
        linkedinProfilesFound += 1;
      }
    });
  }

  const usedEmails = new Set(
    contacts.map((contact) => contact.email).filter(Boolean)
  );
  const generalEmails = emails.filter((email) => !usedEmails.has(email));

  const q = sanitize(name);
  const domain = hostOf(website);
  const { data: matches } = await supabase
    .from("organizations")
    .select("id, name, website, linkedin_url, emails")
    .or(`name.ilike.%${q}%,website.ilike.%${domain}%`)
    .limit(1);
  const existing = matches?.[0] ?? null;

  let orgId: number;
  let created: boolean;
  let orgName: string;

  if (existing) {
    const patch: Record<string, string | string[]> = {};
    if (!existing.website && website) patch.website = website;
    if (!existing.linkedin_url && linkedin) patch.linkedin_url = linkedin;
    if (generalEmails.length > 0) {
      const current = (existing.emails ?? []) as string[];
      const merged = [...new Set([...current, ...generalEmails])];
      if (merged.length !== current.length) patch.emails = merged;
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from("organizations").update(patch).eq("id", existing.id);
    }
    orgId = existing.id;
    orgName = existing.name;
    created = false;
  } else {
    const { data: inserted, error } = await supabase
      .from("organizations")
      .insert({
        list,
        name,
        website,
        linkedin_url: linkedin,
        kind: extracted.kind,
        status: "new",
        notes: extracted.description.trim() || null,
        emails: generalEmails,
      })
      .select("id, name")
      .single();
    if (error || !inserted) {
      return Response.json(
        { error: error?.message ?? "Could not save the company." },
        { status: 500 }
      );
    }
    orgId = inserted.id;
    orgName = inserted.name;
    created = true;
  }

  const { data: existingContacts } = await supabase
    .from("contacts")
    .select("name, linkedin_url, email")
    .eq("org_id", orgId);

  const seenNames = new Set(
    (existingContacts ?? []).map((contact) => normalise(contact.name))
  );
  const seenLinks = new Set(
    (existingContacts ?? [])
      .map((contact) => normalise(contact.linkedin_url))
      .filter(Boolean)
  );
  const toAdd = contacts.filter((contact) => {
    const byName = normalise(contact.name);
    const byLink = normalise(contact.linkedin_url);
    if (seenNames.has(byName)) return false;
    if (byLink && seenLinks.has(byLink)) return false;
    seenNames.add(byName);
    if (byLink) seenLinks.add(byLink);
    return true;
  });

  let contactsAdded = 0;
  if (toAdd.length > 0) {
    const { error } = await supabase.from("contacts").insert(
      toAdd.map((contact) => ({
        org_id: orgId,
        name: contact.name,
        title: contact.title || null,
        linkedin_url: contact.linkedin_url || null,
        email: contact.email || null,
      }))
    );
    if (!error) contactsAdded = toAdd.length;
  }

  // Summarise the record as it stands AFTER saving — not just this run's findings,
  // so the report can never claim something is missing when the record already has it.
  const finalLinkedin = linkedin ?? existing?.linkedin_url ?? null;
  const existingRows = existingContacts ?? [];
  const finalContactCount = existingRows.length + contactsAdded;
  const finalEmails = [
    ...new Set(
      [
        ...existingRows.map((contact) => contact.email),
        ...toAdd.map((contact) => contact.email),
        ...(existing?.emails ?? []),
        ...generalEmails,
      ].filter((value): value is string => Boolean(value))
    ),
  ];
  const stillMissing: string[] = [];
  if (!finalLinkedin) stillMissing.push("LinkedIn company URL");
  if (finalContactCount === 0) stillMissing.push("team members");
  if (finalEmails.length === 0) stillMissing.push("email addresses");

  return Response.json({
    ok: true,
    created,
    company: { id: orgId, name: orgName, list },
    listLabel: LIST_LABEL[list],
    contactsAdded,
    contactsSkipped: contacts.length - toAdd.length,
    linkedinProfilesFound,
    linkedinUrl: finalLinkedin,
    warning:
      research.needs_js && stillMissing.length > 0
        ? "This site renders with JavaScript, so some details may still be missing. Add TINYFISH_API_KEY (free) for a full render."
        : undefined,
    stillMissing,
  });
}
