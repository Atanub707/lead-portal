import { generateObject } from "ai";
import { z } from "zod";
import { NO_AI_KEY_MESSAGE, pickModel } from "@/lib/ai";
import { researchWebsite } from "@/lib/research";
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

  const model = pickModel(user.id);
  if (!model) {
    return Response.json({ error: NO_AI_KEY_MESSAGE }, { status: 503 });
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

  let extracted: z.infer<typeof ExtractSchema>;
  try {
    const { object } = await generateObject({
      model,
      schema: ExtractSchema,
      system: EXTRACT_SYSTEM,
      prompt: `Extract the company profile and people from this website research (JSON):\n\n${JSON.stringify(
        digest
      )}`,
    });
    extracted = object;
  } catch {
    return Response.json(
      { error: "The AI couldn't extract data from that site. Please try again." },
      { status: 502 }
    );
  }

  const name =
    extracted.name.trim() ||
    research.site_name ||
    hostOf(research.final_url) ||
    "Unknown company";
  const website = research.final_url;
  const linkedin =
    (extracted.linkedin_company_url.trim() ||
      research.links.linkedin_company[0] ||
      "").trim() || null;
  const emails = [
    ...new Set(
      extracted.emails
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

  const q = sanitize(name);
  const domain = hostOf(website);
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
    if (!existing.linkedin_url && linkedin) patch.linkedin_url = linkedin;
    if (Object.keys(patch).length > 0) {
      await supabase.from("organizations").update(patch).eq("id", existing.id);
    }
    orgId = existing.id;
    orgName = existing.name;
    created = false;
  } else {
    const usedEmails = new Set(
      contacts.map((contact) => contact.email).filter(Boolean)
    );
    const generalEmails = emails.filter((email) => !usedEmails.has(email));
    const noteLines: string[] = [];
    if (extracted.description.trim()) noteLines.push(extracted.description.trim());
    if (generalEmails.length > 0) {
      noteLines.push(`Emails: ${generalEmails.join(", ")}`);
    }

    const { data: inserted, error } = await supabase
      .from("organizations")
      .insert({
        list,
        name,
        website,
        linkedin_url: linkedin,
        kind: extracted.kind,
        status: "new",
        notes: noteLines.join("\n\n") || null,
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
    .select("name, linkedin_url")
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

  const stillMissing: string[] = [];
  if (!linkedin) stillMissing.push("LinkedIn company URL");
  if (contacts.length === 0) stillMissing.push("team members");
  if (emails.length === 0 && contacts.every((contact) => !contact.email)) {
    stillMissing.push("email addresses");
  }

  return Response.json({
    ok: true,
    created,
    company: { id: orgId, name: orgName, list },
    listLabel: LIST_LABEL[list],
    contactsAdded,
    contactsSkipped: contacts.length - toAdd.length,
    linkedinUrl: linkedin,
    stillMissing,
  });
}
