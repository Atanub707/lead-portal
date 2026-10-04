import { generateObject, generateText } from "ai";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { matchEmailToContact, matchLinkedInProfile } from "@/lib/match";
import { logActivity } from "@/lib/activity";
import { NO_AI_KEY_MESSAGE, pickModel } from "@/lib/ai";
import { requireWorkspaceId } from "@/lib/data";
import { isDecisionTitle } from "@/lib/people";
import {
  findLinkedInProfile,
  researchWebsite,
  tinyfishEnabled,
  verifyLinkedInCompany,
} from "@/lib/research";
import { createClient } from "@/lib/supabase/server";
import { parseList, type OrgList } from "@/lib/types";

export const maxDuration = 60;

const ExtractSchema = z.object({
  name: z.string().describe("The company's official name"),
  description: z
    .string()
    .describe("One or two sentences on what the company does, taken from the site"),
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
  const { userId } = await auth();
  if (!userId) return new Response("Unauthorized", { status: 401 });
  const supabase = await createClient();
  const workspaceId = await requireWorkspaceId();

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

  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id, name")
    .eq("id", list)
    .maybeSingle();
  if (!pipeline) {
    return Response.json({ error: "Unknown pipeline." }, { status: 400 });
  }

  const model = pickModel(userId);
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
  const pipelineHint =
    list === "pos" || list === "compliance"
      ? ""
      : `\nThe user selected the "${pipeline.name}" pipeline — classify kind as "lead" unless the research clearly shows a partner or competitor relationship.`;

  // Plain-text generation first: no response_format, the request shape OpenCode Go
  // handles most reliably. generateObject (JSON mode) is the second chance.
  let extracted: z.infer<typeof ExtractSchema> | null = null;
  const failures: string[] = [];

  try {
    const { text } = await generateText({
      model,
      system: `${EXTRACT_SYSTEM}${pipelineHint}\n\n${JSON_SHAPE}`,
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
        system: `${EXTRACT_SYSTEM}${pipelineHint}`,
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
  const domain = hostOf(website);

  // LinkedIn company URL — verified sources only, never the AI's guess:
  // 1) a link on the company's own site, if the slug matches name/domain
  // 2) a verified search result (name in snippet + matching slug)
  // Unverified candidates are reported, not saved.
  // LinkedIn comes ONLY from the company's own website (the source of truth).
  // If the site doesn't link it, it stays empty — we never search-guess.
  const siteCandidate = research.links.linkedin_company[0] ?? null;
  let linkedin: string | null = null;
  let linkedinSource: "site" | null = null;
  let unverifiedLinkedin: string | null = null;

  if (siteCandidate && verifyLinkedInCompany(siteCandidate, name, domain)) {
    linkedin = siteCandidate;
    linkedinSource = "site";
  } else if (siteCandidate) {
    unverifiedLinkedin = siteCandidate;
  }
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
      source: "website",
    }))
    .filter(
      (contact) =>
        contact.name.length > 1 &&
        !/^(unknown|n\/?a|none|info|sales|support|contact|admin|hello|team|press|media|office|help|billing|hr)$/i.test(
          contact.name
        )
    )
    .slice(0, 12);

  // Personal LinkedIn profiles published on the site itself come first (source of truth).
  const claimedProfiles = new Set(
    contacts.map((contact) => contact.linkedin_url).filter(Boolean)
  );
  for (const contact of contacts) {
    if (contact.linkedin_url) continue;
    const matched = matchLinkedInProfile(
      contact.name,
      research.links.linkedin_people
    );
    if (matched && !claimedProfiles.has(matched)) {
      contact.linkedin_url = matched;
      claimedProfiles.add(matched);
    }
  }

  // Free search fills the rest (strict name + company verification).
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
        contact.source = "search";
        linkedinProfilesFound += 1;
      }
    });
  }

  // Match found emails to the right person when the address carries their name
  // (dorian.ciavarella@…). Unmatched emails stay as company-level emails.
  const claimedEmails = new Set(
    contacts.map((contact) => contact.email).filter(Boolean)
  );
  for (const contact of contacts) {
    if (contact.email) continue;
    const matched = matchEmailToContact(contact.name, emails);
    if (matched && !claimedEmails.has(matched)) {
      contact.email = matched;
      claimedEmails.add(matched);
    }
  }

  const usedEmails = new Set(
    contacts.map((contact) => contact.email).filter(Boolean)
  );
  const generalEmails = emails.filter((email) => !usedEmails.has(email));

  const q = sanitize(name);
  const { data: matches } = await supabase
    .from("organizations")
    .select("id, name, website, linkedin_url")
    .or(`name.ilike.%${q}%,website.ilike.%${domain}%`)
    .limit(1);
  const existing = matches?.[0] ?? null;

  let orgId: number;
  let created: boolean;
  let orgName: string;

  if (existing) {
    const patch: Record<string, string> = {};
    if (!existing.website && website) patch.website = website;
    // The website is the source of truth: a verified site link replaces a
    // different stored value (this is how wrong search-guesses get corrected).
    if (linkedin && existing.linkedin_url !== linkedin) {
      patch.linkedin_url = linkedin;
      patch.linkedin_source = "site";
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
        workspace_id: workspaceId,
        name,
        website,
        linkedin_url: linkedin,
        linkedin_source: linkedin ? linkedinSource : null,
        kind: extracted.kind,
        status: "new",
        notes: extracted.description.trim() || null,
        created_by: userId,
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

  // Company emails are typed rows; duplicates across runs are ignored.
  if (generalEmails.length > 0) {
    await supabase.from("company_emails").upsert(
      generalEmails.map((email) => ({
        org_id: orgId,
        workspace_id: workspaceId,
        email,
        kind: "general",
        source: tinyfishEnabled() ? "tinyfish" : "website",
      })),
      { onConflict: "org_id,email", ignoreDuplicates: true }
    );
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
  const seenEmails = new Set(
    (existingContacts ?? [])
      .map((contact) => normalise(contact.email))
      .filter(Boolean)
  );
  const toAdd = contacts.filter((contact) => {
    const byName = normalise(contact.name);
    const byLink = normalise(contact.linkedin_url);
    const byEmail = normalise(contact.email);
    if (seenNames.has(byName)) return false;
    if (byLink && seenLinks.has(byLink)) return false;
    if (byEmail && seenEmails.has(byEmail)) return false;
    seenNames.add(byName);
    if (byLink) seenLinks.add(byLink);
    if (byEmail) seenEmails.add(byEmail);
    return true;
  });

  let contactsAdded = 0;
  if (toAdd.length > 0) {
    const rows = toAdd.map((contact) => ({
      org_id: orgId,
      workspace_id: workspaceId,
      name: contact.name,
      title: contact.title || null,
      linkedin_url: contact.linkedin_url || null,
      email: contact.email || null,
      source: contact.source,
      is_decision_maker: isDecisionTitle(contact.title),
      email_status: contact.email ? "found" : null,
      created_by: userId,
    }));

    let { error } = await supabase.from("contacts").insert(rows);
    if (error && /created_by/.test(error.message)) {
      // Attribution column not migrated yet — insert without it so people still land.
      const stripped = rows.map(({ created_by, ...rest }) => rest);
      ({ error } = await supabase.from("contacts").insert(stripped));
    }
    if (error) {
      console.error("[paste] contact insert failed:", error.message);
    } else {
      contactsAdded = toAdd.length;
    }
  }

  // Enrichment audit trail (what this run found, from where, at what cost).
  await supabase.from("enrichment_runs").insert({
    org_id: orgId,
    workspace_id: workspaceId,
    kind: "website_research",
    source: tinyfishEnabled() ? "tinyfish" : "builtin",
    status: "ok",
    people_found: contacts.length,
    emails_found: emails.length,
    cost_usd: 0,
    details: {
      requested_url: research.requested_url,
      final_url: research.final_url,
      needs_js: research.needs_js ?? false,
      linkedin_source: linkedinSource,
      unverified_linkedin: unverifiedLinkedin,
    },
    created_by: userId,
  });

  // Summarise the record as it stands AFTER saving — not just this run's findings,
  // so the report can never claim something is missing when the record already has it.
  const finalLinkedin = linkedin ?? existing?.linkedin_url ?? null;
  const existingRows = existingContacts ?? [];
  const finalContactCount = existingRows.length + contactsAdded;
  const { data: orgEmailRows } = await supabase
    .from("company_emails")
    .select("email")
    .eq("org_id", orgId);
  const finalEmails = [
    ...new Set(
      [
        ...existingRows.map((contact) => contact.email),
        ...toAdd.map((contact) => contact.email),
        ...(orgEmailRows ?? []).map((row) => row.email),
        ...generalEmails,
      ].filter((value): value is string => Boolean(value))
    ),
  ];
  const stillMissing: string[] = [];
  if (!finalLinkedin) stillMissing.push("LinkedIn company URL");
  if (finalContactCount === 0) stillMissing.push("team members");
  if (finalEmails.length === 0) stillMissing.push("email addresses");

  await logActivity({
    actorId: userId,
    action: "research.paste",
    orgId,
    targetType: "research",
    summary: `Pasted URL: ${orgName} (${contactsAdded} people, ${finalEmails.length} emails)`,
    details: { url, contactsAdded, emails: finalEmails.length },
  });

  return Response.json({
    ok: true,
    created,
    company: { id: orgId, name: orgName, list },
    listLabel: pipeline.name,
    contactsAdded,
    contactsSkipped: contacts.length - toAdd.length,
    linkedinProfilesFound,
    linkedinUrl: finalLinkedin,
    linkedinSource,
    unverifiedLinkedin,
    warning:
      research.needs_js && stillMissing.length > 0
        ? "This site renders with JavaScript — some details may still be missing."
        : undefined,
    stillMissing,
  });
}
