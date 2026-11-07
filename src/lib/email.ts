import { generateObject, generateText } from "ai";
import nodemailer from "nodemailer";
import { z } from "zod";
import { NO_AI_KEY_MESSAGE, pickModel } from "./ai";
import { FLAVORS } from "./flavors";
import {
  classifyRecipient,
  ctaInstruction,
  firstNameOf,
  strategyInstruction,
  type RecipientProfile,
} from "./recipient";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

// Re-exported for server-side consumers; the source lives in ./flavors so
// client components can import it without pulling server code.
export { FLAVORS };
export type FlavorId = (typeof FLAVORS)[number]["id"];

const DraftSchema = z.object({
  subject: z.string(),
  alternative_subjects: z.array(z.string()).min(2).max(4),
  body: z.string(),
});

const DRAFT_SYSTEM = `You are a senior B2B sales copywriter. Write cold emails that earn a reply, not just attention.

Structure every email in this order (no headings in the email):
1. Subject: 1-5 words, concrete and honest, tied to a real business priority. No hype, no fake Re:/Fwd:.
2. Opening: one verified observation about the company or the recipient's role.
3. Business problem: one plausible problem from their perspective (not a list).
4. Credibility: one brief line on why we are relevant. Use only supplied proof; never invent clients, results, certifications or numbers.
5. Value: the outcome, plus one useful asset when appropriate (assessment, benchmark, checklist, overview).
6. CTA: exactly one low-friction question. Prefer interest over a meeting request.

Rules:
- Evidence only. If a personalization detail is not in the supplied evidence, use segment-level relevance instead; never fabricate.
- One problem, one value proposition, one question.
- Natural, conversational English. Short paragraphs (1-2 sentences). No generic intros, no "leading provider" language, no excessive adjectives.
- Match the persona and length target supplied in the prompt.
- Follow-ups must add a new angle; never write "just checking in" or repeating the same pitch.
- Never use exclamation marks, em/en dashes, bullet lists, links (first contact), or a signature. The system appends the signature.
- Vary wording from recent emails supplied to you.
- Always provide three subject options: "subject" (the best) plus exactly two in "alternative_subjects", each 1-5 words, honest and concrete.
- Return valid JSON only: { "subject": string, "alternative_subjects": string[], "body": string }`;

export interface EmailQuality {
  score: number;
  words: number;
  issues: string[];
  evidence: string[];
}

export interface EmailDraft {
  ok: true;
  to: string;
  subject: string;
  body: string;
  firstContact: boolean;
  quality: EmailQuality;
  alternatives: string[];
  recipient: RecipientProfile;
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


const BANNED_PHRASES = [
  /hope (this|you)/i,
  /i came across/i,
  /i wanted to introduce/i,
  /leading provider/i,
  /world[- ]class/i,
  /revolutionary/i,
  /\bguarantee/i,
  /risk[- ]free/i,
  /just checking in/i,
  /circle back/i,
  /\bleverage\b/i,
  /\bpassionate\b/i,
  /\bexcited\b/i,
  /\bthrilled\b/i,
];

interface Persona {
  label: string;
  focus: string;
  min: number;
  max: number;
}

function personaFor(title: string | null): Persona {
  const value = (title ?? "").toLowerCase();
  if (/(founder|co-?founder|ceo|owner|president|managing director)/i.test(value)) {
    return { label: "Founder / CEO", focus: "growth, revenue, enterprise expansion, business risk", min: 50, max: 90 };
  }
  if (/(cto|chief technology|vp engineering|head of engineering|engineering (lead|manager))/i.test(value)) {
    return { label: "CTO / engineering leader", focus: "infrastructure, engineering productivity, technical risk, security architecture", min: 60, max: 110 };
  }
  if (/(ciso|chief information security|security (lead|manager|head)|compliance (lead|manager|head)|head of compliance)/i.test(value)) {
    return { label: "Security / compliance leader", focus: "risk management, security posture, governance, vendor requirements", min: 60, max: 110 };
  }
  if (/(coo|chief operating|operations (lead|manager|head)|head of operations)/i.test(value)) {
    return { label: "Operations leader", focus: "process efficiency, cost control, operational risk, implementation effort", min: 70, max: 120 };
  }
  if (/(cmo|chief marketing|vp marketing|head of marketing|sales (lead|manager|head)|vp sales|cro)/i.test(value)) {
    return { label: "Marketing / sales leader", focus: "customer acquisition, pipeline, revenue growth, conversion efficiency", min: 50, max: 110 };
  }
  return { label: "Decision maker", focus: "their business priorities and current initiatives", min: 50, max: 110 };
}

function pickSubject(primary: string, alternatives: string[] | undefined): string {
  const banned = /free|guarantee|act now|limited|urgent|risk[- ]?free|!!|\?|^re:|^fwd:/i;
  const candidates = [primary, ...(alternatives ?? [])]
    .map((entry) => humanize(entry))
    .filter(Boolean);
  for (const candidate of candidates) {
    const words = candidate.split(/\s+/).length;
    if (words >= 1 && words <= 6 && !banned.test(candidate)) {
      return candidate.split(/\s+/).slice(0, 8).join(" ").slice(0, 160);
    }
  }
  return (candidates[0] ?? "").split(/\s+/).slice(0, 8).join(" ").slice(0, 160);
}

function qualityCheck(
  body: string,
  opts: {
    firstContact: boolean;
    persona: Persona;
    followUp: boolean;
    recipient: RecipientProfile;
    contactName?: string | null;
  }
): { score: number; words: number; issues: string[] } {
  const words = body.replace(/\n+/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const issues: string[] = [];
  if (opts.followUp) {
    if (words < 25 || words > 90) issues.push(`length ${words} words (target 30-80)`);
  } else if (opts.recipient.type === "shared") {
    if (words < 35 || words > 100) issues.push(`length ${words} words (target 40-90)`);
  } else if (words < opts.persona.min - 15 || words > opts.persona.max + 20) {
    issues.push(`length ${words} words (target ${opts.persona.min}-${opts.persona.max})`);
  }
  const questions = (body.match(/\?/g) ?? []).length;
  if (questions > 1) issues.push("more than one question");
  if ((body.match(/!/g) ?? []).length > 0) issues.push("exclamation marks");
  if (BANNED_PHRASES.some((pattern) => pattern.test(body))) {
    issues.push("generic or hype phrasing");
  }
  if (opts.firstContact && /https?:\/\//i.test(body)) {
    issues.push("link in first contact");
  }
  if (opts.recipient.type === "shared") {
    if (opts.contactName && body.includes(firstNameOf(opts.contactName))) {
      issues.push("personal name used in a shared-inbox email");
    }
    if (
      opts.recipient.strategy !== "do_not_contact" &&
      !/(point me|who (handles|is responsible)|forward|right (person|team|contact|department)|appropriate (person|team|contact)|direct me|reach the right)/i.test(body)
    ) {
      issues.push("shared-inbox email needs a routing question");
    }
    if (opts.recipient.strategy === "do_not_contact") {
      issues.push("no-reply address — find another contact");
    }
  }
  if (opts.recipient.type === "personal" && /hello team/i.test(body)) {
    issues.push("team greeting used for a personal recipient");
  }
  return { score: Math.max(0, 100 - issues.length * 12), words, issues };
}

export async function generateEmailDraft(opts: {
  userId: string;
  orgId: number;
  contactId?: number | null;
  flavor: string;
  to?: string | null;
  admin?: boolean;
  stepNo?: number;
}): Promise<EmailDraftResult> {
  const flavor = FLAVORS.find((entry) => entry.id === opts.flavor);
  if (!flavor) return { ok: false, error: "Pick a flavor first." };

  const model = pickModel(opts.userId);
  if (!model) return { ok: false, error: NO_AI_KEY_MESSAGE };
  const activeModel = model;

  const supabase = opts.admin ? createAdminClient() : await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, notes, website, list, workspace_id")
    .eq("id", opts.orgId)
    .maybeSingle();
  if (!org) return { ok: false, error: "Company not found." };

  const nowIso = new Date().toISOString();
  const [
    pipelineResult,
    contactResult,
    emailsResult,
    priorResult,
    recentSendsResult,
    settingsResult,
    briefResult,
    signalsResult,
    firmResult,
    defsResult,
    profileResult,
  ] = await Promise.all([
    supabase
      .from("pipelines")
      .select("pitch, value_props, proof_points, cta")
      .eq("id", org.list)
      .maybeSingle(),
    opts.contactId
      ? supabase
          .from("contacts")
          .select("name, title, email, email_status")
          .eq("id", opts.contactId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("company_emails").select("email").eq("org_id", opts.orgId).limit(1),
    supabase
      .from("sent_emails")
      .select("subject, created_at")
      .eq("org_id", opts.orgId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("sent_emails")
      .select("body")
      .eq("sent_by", opts.userId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("user_email_settings")
      .select("from_name, signature_phone, signature_link")
      .eq("user_id", opts.userId)
      .maybeSingle(),
    supabase
      .from("company_briefs")
      .select("summary, priorities, likely_objections, suggested_angle")
      .eq("org_id", opts.orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("company_signals")
      .select("signal_key, evidence, confidence, observed_at")
      .eq("org_id", opts.orgId)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("observed_at", { ascending: false })
      .limit(6),
    supabase.from("company_firmographics").select("*").eq("org_id", opts.orgId).maybeSingle(),
    supabase
      .from("signal_definitions")
      .select("key, label")
      .eq("workspace_id", org.workspace_id as string),
    supabase
      .from("business_profiles")
      .select("name, service_categories, positioning")
      .eq("workspace_id", org.workspace_id as string)
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const pipeline = pipelineResult.data;
  const contact = contactResult.data as {
    name: string | null;
    title: string | null;
    email: string | null;
    email_status: string | null;
  } | null;
  const to =
    opts.to?.trim() || contact?.email || emailsResult.data?.[0]?.email || null;
  if (!to) {
    return { ok: false, error: "No email address on this company — add one first." };
  }

  const { count: priorSends } = await supabase
    .from("sent_emails")
    .select("id", { count: "exact", head: true })
    .eq("org_id", opts.orgId)
    .eq("to_email", to);
  const firstContact = (priorSends ?? 0) === 0;

  const companyEmail = (emailsResult.data ?? [])[0] as
    | { email?: string; verified?: boolean }
    | undefined;
  const recipient = classifyRecipient({
    email: to,
    contactName: contact?.name ?? null,
    contactTitle: contact?.title ?? null,
    emailStatus: contact?.email_status ?? null,
    verified:
      companyEmail?.email?.toLowerCase() === to.toLowerCase()
        ? Boolean(companyEmail?.verified)
        : undefined,
  });
  const greeting = recipient.greeting;
  const stepNo = Math.max(1, Math.round(opts.stepNo ?? 1));
  const followUp = stepNo > 1 || flavor.id === "follow-up";
  const prior = followUp ? priorResult.data?.[0] ?? null : null;
  const persona =
    recipient.type === "personal"
      ? personaFor(contact?.title ?? null)
      : { label: "Team inbox", focus: "routing the message to the right owner", min: 40, max: 100 };

  const pitchLines = [
    profileResult.data?.name ? `Business profile: ${profileResult.data.name}` : null,
    profileResult.data?.service_categories?.length
      ? `Services: ${(profileResult.data.service_categories as string[]).join(", ")}`
      : null,
    pipeline?.pitch ? `Offering: ${pipeline.pitch}` : null,
    pipeline?.value_props?.length
      ? `Value we bring:\n- ${pipeline.value_props.join("\n- ")}`
      : null,
    pipeline?.proof_points?.length
      ? `Proof points (use only when relevant; never invent): ${pipeline.proof_points.join("; ")}`
      : null,
    pipeline?.cta ? `Preferred ask if natural: ${pipeline.cta}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const brief = briefResult.data as {
    summary: string | null;
    priorities: string[] | null;
    likely_objections: string[] | null;
    suggested_angle: string | null;
  } | null;

  const labels = new Map(
    (defsResult.data ?? []).map((row) => [row.key as string, row.label as string])
  );
  const firm = (firmResult.data ?? null) as Record<string, unknown> | null;
  const factParts = [
    typeof firm?.industry === "string" ? firm.industry : null,
    typeof firm?.employee_band === "string" ? `${firm.employee_band} employees` : null,
    [firm?.hq_city, firm?.hq_region, firm?.hq_country].filter(Boolean).join(", ") || null,
    typeof firm?.funding_stage === "string" ? `funding: ${firm.funding_stage}` : null,
  ].filter((value): value is string => Boolean(value));

  const signalLines = ((signalsResult.data ?? []) as {
    signal_key: string;
    evidence: unknown;
    confidence: number;
  }[]).map((signal) => {
    const label = labels.get(signal.signal_key) ?? signal.signal_key;
    const evidence = (signal.evidence ?? {}) as Record<string, unknown>;
    const snippet =
      typeof evidence.snippet === "string" ? evidence.snippet.slice(0, 140) : "";
    return `${label}${snippet ? ` — ${snippet}` : ""}`;
  });

  const evidenceLabels = [
    ...new Set([
      ...factParts.slice(0, 2),
      ...((signalsResult.data ?? []) as { signal_key: string }[])
        .slice(0, 3)
        .map((signal) => labels.get(signal.signal_key) ?? signal.signal_key),
    ]),
  ];

  const stepAngle = !followUp
    ? "First touch: open with the verified observation, introduce one problem and offer one useful next step."
    : recipient.type === "shared"
      ? "Shared-inbox follow-up: keep it shorter; ask whether the note reached the right team. Do not repeat the pitch."
      : stepNo <= 1
      ? "Follow-up: add one new useful perspective on the same business problem. Do not repeat the previous email."
      : stepNo === 2
        ? "Follow-up #2 (day 3): add a new perspective on the same problem. Do not repeat the first email."
        : stepNo === 3
          ? "Follow-up #3 (day 7): add useful evidence such as a checklist, benchmark or practical observation. Use only substantiated claims."
          : "Final follow-up (day 12): polite close or referral request. Make it easy to decline.";

  const prompt = `Company: ${org.name}${org.website ? ` (${org.website})` : ""}
What they do: ${org.notes ?? "(no description captured yet)"}
${factParts.length > 0 ? `Verified company facts: ${factParts.join(" · ")}` : "Verified company facts: none"}
${signalLines.length > 0 ? `Verified signals (personalize only from these):\n- ${signalLines.join("\n- ")}` : "Verified signals: none — use segment-level relevance only; do not invent personalization."}
${brief ? `Account brief: ${(brief.summary ?? "").slice(0, 500)}\nSuggested angle: ${(brief.suggested_angle ?? "").slice(0, 240)}` : ""}
${pitchLines || "Offering: (no pitch defined — keep it a first conversation, no specifics)"}
Recipient: ${contact?.name ? `${contact.name}${contact.title ? `, ${contact.title}` : ""}` : "unknown — use the greeting line below"}
Recipient classification: ${recipient.label} (${recipient.strategyLabel}). Verification: ${recipient.verification}.
${strategyInstruction(recipient)}
${ctaInstruction(recipient)}
Persona: ${persona.label}. Focus on: ${persona.focus}. Target length: ${persona.min}-${persona.max} words.
Greeting line to use exactly: ${greeting}
${recipient.type === "shared" ? "Never use a person's name in the body; the reader may be any team member and the message should be easy to forward." : ""}
Flavor: ${flavor.label} — ${flavor.brief}
${stepAngle}
First contact: ${firstContact ? "yes — no links" : "no"}
${prior ? `Prior email we sent on ${prior.created_at.slice(0, 10)}, subject: “${prior.subject}” — add a new angle; do not repeat it.` : ""}${
  (recentSendsResult.data ?? []).length > 0
    ? `\n\nRecent emails we sent to OTHER recipients. Write a clearly DIFFERENT email: no reused phrasing, structure or ask:\n${(recentSendsResult.data ?? [])
        .map((row, index) => `--- recent ${index + 1} ---\n${(row.body ?? "").slice(0, 450)}`)
        .join("\n")}`
    : ""
}`;

  async function attempt(extra: string) {
    const system = `${DRAFT_SYSTEM}\n\nUse this exact greeting as the first line: ${greeting}\n${extra}`;
    try {
      const { text } = await generateText({ model: activeModel, system, prompt });
      const parsed = parseJsonObject(text);
      if (parsed) {
        const result = DraftSchema.safeParse(parsed);
        if (result.success) return result.data;
      }
    } catch {
      // Fall back to JSON mode.
    }
    try {
      const { object } = await generateObject({ model: activeModel, schema: DraftSchema, system, prompt });
      return object;
    } catch (err) {
      console.error("[email.draft] generation failed:", err instanceof Error ? err.message : err);
      return null;
    }
  }

  let draft = await attempt("");
  if (!draft) {
    return { ok: false, error: "The AI couldn't draft this email. Please try again." };
  }

  let quality = qualityCheck(humanize(draft.body), {
    firstContact,
    persona,
    followUp,
    recipient,
    contactName: contact?.name ?? null,
  });
  if (quality.issues.length > 0) {
    const retry = await attempt(`Fix these issues in the new draft: ${quality.issues.join("; ")}`);
    if (retry) {
      const retryQuality = qualityCheck(humanize(retry.body), {
        firstContact,
        persona,
        followUp,
        recipient,
        contactName: contact?.name ?? null,
      });
      if (retryQuality.score >= quality.score) {
        draft = retry;
        quality = retryQuality;
      }
    }
  }

  const cleanBody = humanize(draft.body);
  const cleanSubject =
    pickSubject(draft.subject, draft.alternative_subjects) ||
    `Quick note for ${org.name}`;

  const settings = settingsResult.data;
  const signature = [
    settings?.from_name,
    settings?.signature_phone,
    firstContact ? null : settings?.signature_link,
  ]
    .map((line) => (typeof line === "string" ? line.trim() : ""))
    .filter((line) => line.length > 0)
    .join("\n");

  const bodyText = firstContact
    ? cleanBody.replace(/https?:\/\/\S+/gi, "").replace(/[ \t]+$/gm, "")
    : cleanBody;
  const body = signature ? `${bodyText}\n\n${signature}` : bodyText;

  const alternatives = [
    cleanSubject,
    ...(draft.alternative_subjects ?? []).map((entry) => humanize(entry)),
  ]
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index)
    .slice(0, 3);

  return {
    ok: true,
    to,
    subject: cleanSubject,
    body,
    firstContact,
    quality: { ...quality, evidence: evidenceLabels },
    alternatives,
    recipient,
  };
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
  message: { to: string; subject: string; body: string },
  opts?: { inReplyTo?: string; references?: string; subjectOverride?: string }
): Promise<{ messageId: string }> {
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
    const info = await transport.sendMail({
      from,
      to: message.to,
      subject: opts?.subjectOverride ?? message.subject,
      text: message.body,
      replyTo: fromAddress,
      ...(opts?.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts?.references ? { references: opts.references } : {}),
    });
    // Canonical stored form is BARE (no angle brackets) — nodemailer returns
    // `<uuid@domain>`; inbound headers are compared unbraced.
    return {
      messageId: (info.messageId ?? `${Date.now()}@leadportal`).replace(
        /[<>]/g,
        ""
      ),
    };
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
