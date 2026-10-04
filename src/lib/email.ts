import { generateObject, generateText } from "ai";
import nodemailer from "nodemailer";
import { z } from "zod";
import { NO_AI_KEY_MESSAGE, pickModel } from "./ai";
import { isGenericEmail } from "./people";
import { createClient } from "./supabase/server";

// The six outreach flavors. Ids are binding — the composer and pipeline
// default-flavor select use them verbatim.
export const FLAVORS = [
  {
    id: "short-direct",
    label: "Short & direct",
    brief: "One value prop, straight to the point. 60-80 words.",
  },
  {
    id: "pain-first",
    label: "Pain-first",
    brief:
      "Open with a problem they likely have, tie it to the pitch. 70-90 words.",
  },
  {
    id: "insight-authority",
    label: "Insight & authority",
    brief:
      "Lead with an insight or deadline relevant to their space, position expertise. 70-90 words.",
  },
  {
    id: "warm-intro",
    label: "Warm intro",
    brief:
      "Reference something specific from their website or profile. Friendly. 70-90 words.",
  },
  {
    id: "founder-founder",
    label: "Founder-to-founder",
    brief: "Peer tone, casual, low-pressure. 50-70 words.",
  },
  {
    id: "follow-up",
    label: "Follow-up",
    brief:
      "Gentle bump. If a prior sent email is provided, reference it; otherwise a short intro. 30-50 words.",
  },
] as const;

export type FlavorId = (typeof FLAVORS)[number]["id"];

const DraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

const DRAFT_SYSTEM = `You write cold outreach emails that read like a real human wrote them.

Hard rules:
- Start with the greeting line given to you, exactly, followed by a newline. Nothing may come before it.
- Write in the first person ("we"/"I"). Never refer to yourself in the third person.
- Keep it SHORT: 60-90 words total (Follow-up flavor: 30-50). Maximum two short paragraphs. Short sentences.
- Open with one confident line about what we do, then one line on why it fits them, then a soft ask.
- Use ONLY the facts provided. NEVER invent numbers, client names, certifications, deadlines, or claims.
- NEVER use: "I hope this email finds you well", "I'm writing to", "leverage", "passionate", "excited", "thrilled", exclamation marks, bullet points, or listicles.
- PUNCTUATION: never use em-dashes or en-dashes. Commas, periods, and normal hyphens only.
- Do NOT include any signature, name, phone, link, or sign-off. The system appends it.
- Return valid JSON only, no markdown: { "subject": string (max 8 words, no fluff), "body": string }`;

export interface EmailDraft {
  ok: true;
  to: string;
  subject: string;
  body: string;
}

export type EmailDraftResult = EmailDraft | { ok: false; error: string };

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

// Deterministic cleanup — plain punctuation, no double spaces, no stray commas.
function humanize(value: string): string {
  return value
    .replace(/[\u2014\u2013]/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function firstNameFrom(name: string | null): string {
  if (!name) return "";
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (first.length < 2) return "";
  // Titles like "Sales Team" or company-ish tokens are not personal names.
  if (/^(sales|team|info|contact|support|admin|hello|hr|marketing|office)$/i.test(first)) {
    return "";
  }
  return first[0].toUpperCase() + first.slice(1);
}

function greetingName(to: string, contactName: string | null): string {
  const fromContact = firstNameFrom(contactName);
  if (fromContact) return fromContact;
  const local = to.split("@")[0]?.replace(/[._-]+/g, " ").trim() ?? "";
  if (!local || isGenericEmail(local.split(/\s+/)[0] ?? "")) return "";
  const first = local.split(/\s+/)[0] ?? "";
  if (first.length < 4) return "";
  return firstNameFrom(first);
}

export async function generateEmailDraft(opts: {
  userId: string;
  orgId: number;
  contactId?: number | null;
  flavor: string;
}): Promise<EmailDraftResult> {
  const flavor = FLAVORS.find((entry) => entry.id === opts.flavor);
  if (!flavor) return { ok: false, error: "Pick a flavor first." };

  const model = pickModel(opts.userId);
  if (!model) return { ok: false, error: NO_AI_KEY_MESSAGE };

  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, notes, website, list")
    .eq("id", opts.orgId)
    .maybeSingle();
  if (!org) return { ok: false, error: "Company not found." };

  const [pipelineResult, contactResult, emailsResult, priorResult, settingsResult] =
    await Promise.all([
      supabase
        .from("pipelines")
        .select("pitch, value_props, proof_points, cta")
        .eq("id", org.list)
        .maybeSingle(),
      opts.contactId
        ? supabase
            .from("contacts")
            .select("name, title, email")
            .eq("id", opts.contactId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("company_emails")
        .select("email")
        .eq("org_id", opts.orgId)
        .limit(1),
      supabase
        .from("sent_emails")
        .select("subject, created_at")
        .eq("org_id", opts.orgId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("user_email_settings")
        .select("from_name, signature_phone, signature_link")
        .eq("user_id", opts.userId)
        .maybeSingle(),
    ]);

  const pipeline = pipelineResult.data;
  const contact = contactResult.data as {
    name: string | null;
    title: string | null;
    email: string | null;
  } | null;
  const to =
    contact?.email ?? emailsResult.data?.[0]?.email ?? null;
  if (!to) {
    return { ok: false, error: "No email address on this company — add one first." };
  }

  const name = greetingName(to, contact?.name ?? null);
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const prior =
    flavor.id === "follow-up" ? priorResult.data?.[0] ?? null : null;

  const pitchLines = [
    pipeline?.pitch ? `Our offering: ${pipeline.pitch}` : null,
    pipeline?.value_props?.length
      ? `Value we bring:\n- ${pipeline.value_props.join("\n- ")}`
      : null,
    pipeline?.proof_points?.length
      ? `Proof points (only when they fit naturally): ${pipeline.proof_points.join("; ")}`
      : null,
    pipeline?.cta ? `Preferred ask: ${pipeline.cta}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `Company: ${org.name}${org.website ? ` (${org.website})` : ""}
What they do: ${org.notes ?? "(no description captured yet)"}
Recipient: ${
    contact?.name
      ? `${contact.name}${contact.title ? `, ${contact.title}` : ""}`
      : "unknown — use the greeting line below"
  }
Greeting line to use exactly: ${greeting}
Flavor: ${flavor.label} — ${flavor.brief}
${pitchLines || "Our offering: (no pitch defined for this pipeline yet — keep it a first conversation, no specifics)"}
${
    prior
      ? `Prior email we sent on ${prior.created_at.slice(0, 10)}, subject: “${prior.subject}” — reference it naturally in one short clause.`
      : ""
  }`;

  let draft: z.infer<typeof DraftSchema> | null = null;
  const failures: string[] = [];

  try {
    const { text } = await generateText({
      model,
      system: `${DRAFT_SYSTEM}\n\nUse this exact greeting as the first line: ${greeting}`,
      prompt,
    });
    const parsed = parseJsonObject(text);
    if (parsed) {
      const result = DraftSchema.safeParse(parsed);
      if (result.success) {
        draft = result.data;
      } else {
        failures.push(
          `parse: ${result.error.issues[0]?.message ?? "schema mismatch"}`
        );
      }
    } else {
      failures.push("parse: no JSON object in the model output");
    }
  } catch (err) {
    failures.push(`text: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!draft) {
    try {
      const { object } = await generateObject({
        model,
        schema: DraftSchema,
        system: `${DRAFT_SYSTEM}\n\nUse this exact greeting as the first line: ${greeting}`,
        prompt,
      });
      draft = object;
    } catch (err) {
      failures.push(
        `object: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!draft) {
    console.error("[email.draft] generation failed:", failures.join(" | "));
    return { ok: false, error: "The AI couldn't draft this email. Please try again." };
  }

  const cleanBody = humanize(draft.body);
  const cleanSubject =
    humanize(draft.subject).split(/\s+/).slice(0, 8).join(" ").slice(0, 160) ||
    `Quick note for ${org.name}`;

  const settings = settingsResult.data;
  const signature = [
    settings?.from_name,
    settings?.signature_phone,
    settings?.signature_link,
  ]
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter((line) => line.length > 0)
    .join("\n");

  const body = signature ? `${cleanBody}\n\n${signature}` : cleanBody;
  return { ok: true, to, subject: cleanSubject, body };
}

// ─── SMTP send ────────────────────────────────────────────────────────────────

export interface SmtpSendSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string | null;
  fromEmail: string | null;
}

export async function sendEmailViaSmtp(
  settings: SmtpSendSettings,
  message: { to: string; subject: string; body: string }
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
  });

  const fromAddress = settings.fromEmail ?? settings.user;
  const from = settings.fromName
    ? `${settings.fromName} <${fromAddress}>`
    : fromAddress;

  try {
    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.body,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Send failed";
    if (/invalid login|535|authentication/i.test(detail)) {
      throw new Error(
        "Authentication failed — check username and password (Gmail needs an App Password)."
      );
    }
    if (/SSL|TLS|wrong version|handshake|ECONNRESET|socket hang up/i.test(detail)) {
      throw new Error(
        "Could not connect — check the SSL/TLS setting: port 465 uses SSL, port 587 uses STARTTLS."
      );
    }
    throw new Error(detail);
  } finally {
    transport.close();
  }
}
