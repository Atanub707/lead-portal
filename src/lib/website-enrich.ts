// Automatic website enrichment: the cheap first step of the lead pipeline.
// Reads the company site and extracts description, people, emails, phone and
// LinkedIn. Never calls Deep Search or any paid people database.
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { NO_AI_KEY_MESSAGE, pickModel } from "./ai";
import { matchEmailToContact, matchLinkedInProfile } from "./match";
import { isDecisionTitle } from "./people";
import { researchWebsite, verifyLinkedInCompany } from "./research";
import { createAdminClient } from "./supabase/admin";
import { normalizeCompanyName } from "./crunchbase";

const ExtractSchema = z.object({
  description: z.string(),
  phone: z.string(),
  emails: z.array(z.string()),
  contacts: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      linkedin_url: z.string(),
      email: z.string(),
    })
  ),
});

const SYSTEM = `You extract structured company data from website research.
Use ONLY facts present in the research. Never invent people, emails or URLs.
Return a single JSON object:
{"description": string (1-2 sentences), "phone": string, "emails": string[], "contacts": [{"name": string, "title": string, "linkedin_url": string, "email": string}]}
contacts are real people named on the site (team/about/leadership pages), max 8. Use "" when unknown.`;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
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
}

export interface WebsiteEnrichResult {
  orgId: number;
  ok: boolean;
  contacts: number;
  emails: number;
  skipped?: string;
}

export async function enrichCompanyFromWebsite(
  orgId: number,
  workspaceId: string,
  userId: string
): Promise<WebsiteEnrichResult> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, website, linkedin_url, notes, workspace_id")
    .eq("id", orgId)
    .maybeSingle();
  if (!org || (org.workspace_id as string) !== workspaceId) {
    return { orgId, ok: false, contacts: 0, emails: 0, skipped: "Company not found" };
  }
  const website = org.website as string | null;
  if (!website) {
    return { orgId, ok: true, contacts: 0, emails: 0, skipped: "No website" };
  }

  let research;
  try {
    research = await researchWebsite(website);
  } catch {
    return { orgId, ok: true, contacts: 0, emails: 0, skipped: "Website unreachable" };
  }

  const digest = {
    title: research.title,
    description: research.description,
    notes: research.notes,
    links: research.links,
    pages: research.pages.map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: page.excerpt.slice(0, 1200),
    })),
  };

  let extracted: z.infer<typeof ExtractSchema> | null = null;
  const model = pickModel(userId);
  if (model) {
    const prompt = `Website research JSON:\n${JSON.stringify(digest).slice(0, 7000)}`;
    try {
      const { text } = await generateText({ model, system: SYSTEM, prompt });
      const parsed = parseJson(text);
      if (parsed) {
        const result = ExtractSchema.safeParse(parsed);
        if (result.success) extracted = result.data;
      }
    } catch {
      // Fall through to JSON mode below.
    }
    if (!extracted) {
      try {
        const { object } = await generateObject({
          model,
          schema: ExtractSchema,
          system: SYSTEM,
          prompt,
        });
        extracted = object;
      } catch (err) {
        console.error(
          "[website-enrich] extraction failed:",
          err instanceof Error ? err.message : err
        );
      }
    }
  } else {
    console.warn("[website-enrich]", NO_AI_KEY_MESSAGE);
  }

  const emails = new Set<string>(research.links.emails);
  if (extracted) {
    for (const email of extracted.emails) emails.add(email);
  }
  for (const page of research.pages) {
    for (const email of page.excerpt.match(EMAIL_RE) ?? []) emails.add(email);
  }
  const cleanEmails = [...emails]
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .filter((email) => !/\.(png|jpe?g|webp|svg|gif|ico)$/i.test(email))
    .slice(0, 10);

  const description =
    extracted?.description?.trim() ||
    research.description?.trim() ||
    null;
  const phone = extracted?.phone?.trim() || null;

  const notes = (org.notes as string | null) ?? null;
  if ((!notes || notes.trim().length === 0) && description) {
    await admin
      .from("organizations")
      .update({ notes: description })
      .eq("id", orgId)
      .eq("workspace_id", workspaceId);
  }
  if (phone && !(notes ?? "").toLowerCase().includes("phone:")) {
    const base = (notes && notes.trim().length > 0 ? notes : description) ?? "";
    await admin
      .from("organizations")
      .update({ notes: `${base}\nPhone: ${phone}`.trim() })
      .eq("id", orgId)
      .eq("workspace_id", workspaceId);
  }

  const siteLinkedin = research.links.linkedin_company[0] ?? null;
  if (!org.linkedin_url && siteLinkedin) {
    const domain = (() => {
      try {
        return new URL(website).hostname.replace(/^www\./, "");
      } catch {
        return null;
      }
    })();
    if (verifyLinkedInCompany(siteLinkedin, org.name as string, domain ?? "")) {
      await admin
        .from("organizations")
        .update({ linkedin_url: siteLinkedin, linkedin_source: "site" })
        .eq("id", orgId)
        .eq("workspace_id", workspaceId);
    }
  }

  if (cleanEmails.length > 0) {
    await admin.from("company_emails").upsert(
      cleanEmails.map((email) => ({
        org_id: orgId,
        workspace_id: workspaceId,
        email,
        kind: "general",
        source: "website",
      })),
      { onConflict: "org_id,email", ignoreDuplicates: true }
    );
  }

  const { data: existing } = await admin
    .from("contacts")
    .select("name, email, linkedin_url")
    .eq("org_id", orgId);
  const seenNames = new Set(
    (existing ?? []).map((row) => normalizeCompanyName(row.name as string))
  );
  const seenEmails = new Set(
    (existing ?? [])
      .map((row) => (row.email as string | null)?.toLowerCase())
      .filter((value): value is string => Boolean(value))
  );
  const seenLinkedIn = new Set(
    (existing ?? [])
      .map((row) => (row.linkedin_url as string | null)?.toLowerCase())
      .filter((value): value is string => Boolean(value))
  );
  const rows: Record<string, unknown>[] = [];
  let contactsAdded = 0;

  for (const contact of extracted?.contacts ?? []) {
    const name = contact.name?.trim();
    if (!name || name.length < 2) continue;
    const key = normalizeCompanyName(name);
    if (seenNames.has(key)) continue;
    const email =
      contact.email?.trim().toLowerCase() ||
      matchEmailToContact(name, cleanEmails) ||
      null;
    if (email && seenEmails.has(email)) continue;
    const linkedin =
      (contact.linkedin_url?.trim() &&
      /linkedin\.com\/(in|company)\//i.test(contact.linkedin_url)
        ? contact.linkedin_url.trim()
        : null) || matchLinkedInProfile(name, research.links.linkedin_people);
    seenNames.add(key);
    if (email) seenEmails.add(email);
    if (linkedin) seenLinkedIn.add(linkedin.toLowerCase());
    rows.push({
      org_id: orgId,
      workspace_id: workspaceId,
      name,
      title: contact.title?.trim() || null,
      email,
      linkedin_url: linkedin,
      source: "website",
      is_decision_maker: isDecisionTitle(contact.title ?? null),
      email_status: email ? "found" : null,
    });
    contactsAdded += 1;
  }

  // Website team sections often link people by LinkedIn only. Keep those
  // named profiles even when the AI extractor finds no biography text.
  for (const person of research.links.linkedin_people_named) {
    const linkedin = person.url?.trim();
    const name = person.name?.trim();
    if (!linkedin || !name) continue;
    if (seenLinkedIn.has(linkedin.toLowerCase())) continue;
    const key = normalizeCompanyName(name);
    if (!key || seenNames.has(key)) continue;
    seenNames.add(key);
    seenLinkedIn.add(linkedin.toLowerCase());
    rows.push({
      org_id: orgId,
      workspace_id: workspaceId,
      name,
      title: null,
      email: null,
      linkedin_url: linkedin,
      source: "website",
      is_decision_maker: false,
      email_status: null,
    });
    contactsAdded += 1;
  }

  if (rows.length > 0) {
    const { error } = await admin.from("contacts").insert(rows);
    if (error) {
      console.error("[website-enrich] contacts insert failed:", error.message);
      contactsAdded = 0;
    }
  }

  return {
    orgId,
    ok: true,
    contacts: contactsAdded,
    emails: cleanEmails.length,
  };
}
