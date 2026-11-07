// Recipient classification for adaptive email drafting.
// Pure module (no imports) so it can be unit-tested in isolation.
// Classification is inferred from the address prefix and the known contact;
// it is NOT proof of the inbox owner. Validity is tracked separately.

export type RecipientType = "personal" | "shared" | "unknown";
export type InboxCategory =
  | "general"
  | "sales"
  | "support"
  | "partnerships"
  | "security"
  | "compliance"
  | "legal"
  | "privacy"
  | "billing"
  | "careers"
  | "noreply"
  | "none";
export type DraftStrategy =
  | "decision_maker"
  | "routing_first"
  | "commercial"
  | "support_routing"
  | "partnership"
  | "security_technical"
  | "compliance_readiness"
  | "legal_formal"
  | "billing_routing"
  | "careers_caution"
  | "unknown_cautious"
  | "do_not_contact";
export type CtaType =
  | "routing"
  | "commercial"
  | "partnership"
  | "technical"
  | "compliance"
  | "formal"
  | "referral"
  | "interest"
  | "none";

export interface RecipientProfile {
  type: RecipientType;
  category: InboxCategory;
  strategy: DraftStrategy;
  strategyLabel: string;
  greeting: string;
  ctaType: CtaType;
  personalizationLevel: "contact" | "company" | "segment";
  verification: "verified" | "unverified" | "unknown";
  label: string;
  warning?: string;
}

const ROLE_MAP: Record<
  string,
  { category: InboxCategory; strategy: DraftStrategy; label: string }
> = {
  info: { category: "general", strategy: "routing_first", label: "General" },
  contact: { category: "general", strategy: "routing_first", label: "General" },
  hello: { category: "general", strategy: "routing_first", label: "General" },
  team: { category: "general", strategy: "routing_first", label: "General" },
  general: { category: "general", strategy: "routing_first", label: "General" },
  office: { category: "general", strategy: "routing_first", label: "General" },
  mail: { category: "general", strategy: "routing_first", label: "General" },
  enquiries: { category: "general", strategy: "routing_first", label: "General" },
  inquiries: { category: "general", strategy: "routing_first", label: "General" },
  reachus: { category: "general", strategy: "routing_first", label: "General" },
  sales: { category: "sales", strategy: "commercial", label: "Sales" },
  bizdev: { category: "sales", strategy: "commercial", label: "Business development" },
  business: { category: "sales", strategy: "commercial", label: "Business" },
  partnerships: { category: "partnerships", strategy: "partnership", label: "Partnerships" },
  partners: { category: "partnerships", strategy: "partnership", label: "Partnerships" },
  partner: { category: "partnerships", strategy: "partnership", label: "Partnerships" },
  support: { category: "support", strategy: "support_routing", label: "Support" },
  help: { category: "support", strategy: "support_routing", label: "Support" },
  helpdesk: { category: "support", strategy: "support_routing", label: "Support" },
  service: { category: "support", strategy: "support_routing", label: "Support" },
  security: { category: "security", strategy: "security_technical", label: "Security" },
  infosec: { category: "security", strategy: "security_technical", label: "Security" },
  compliance: { category: "compliance", strategy: "compliance_readiness", label: "Compliance" },
  audit: { category: "compliance", strategy: "compliance_readiness", label: "Compliance" },
  legal: { category: "legal", strategy: "legal_formal", label: "Legal" },
  privacy: { category: "privacy", strategy: "legal_formal", label: "Privacy" },
  dpo: { category: "privacy", strategy: "legal_formal", label: "Privacy" },
  gdpr: { category: "privacy", strategy: "legal_formal", label: "Privacy" },
  billing: { category: "billing", strategy: "billing_routing", label: "Billing" },
  accounts: { category: "billing", strategy: "billing_routing", label: "Accounts" },
  accounting: { category: "billing", strategy: "billing_routing", label: "Accounts" },
  finance: { category: "billing", strategy: "billing_routing", label: "Finance" },
  careers: { category: "careers", strategy: "careers_caution", label: "Careers" },
  jobs: { category: "careers", strategy: "careers_caution", label: "Jobs" },
  hr: { category: "careers", strategy: "careers_caution", label: "HR" },
  recruiting: { category: "careers", strategy: "careers_caution", label: "Recruiting" },
  noreply: { category: "noreply", strategy: "do_not_contact", label: "No reply" },
  donotreply: { category: "noreply", strategy: "do_not_contact", label: "No reply" },
  postmaster: { category: "noreply", strategy: "do_not_contact", label: "System" },
};

const PERSONAL_ROLE_PREFIXES = new Set([
  "founder",
  "founders",
  "ceo",
  "cto",
  "coo",
  "cmo",
  "owner",
  "president",
]);

const STRATEGY_LABELS: Record<DraftStrategy, string> = {
  decision_maker: "Decision-maker",
  routing_first: "Routing-first (shared inbox)",
  commercial: "Commercial (sales inbox)",
  support_routing: "Routing (support inbox)",
  partnership: "Partnership (partnerships inbox)",
  security_technical: "Technical security (security inbox)",
  compliance_readiness: "Compliance readiness (compliance inbox)",
  legal_formal: "Formal (legal/privacy inbox)",
  billing_routing: "Routing (billing inbox)",
  careers_caution: "Caution (careers inbox)",
  unknown_cautious: "Cautious (unknown recipient)",
  do_not_contact: "Do not contact (no-reply)",
};

function compact(value: string): string {
  return value.toLowerCase().replace(/[._-]/g, "");
}

function looksLikeName(local: string): boolean {
  return /^[a-z]+([._-][a-z]+){1,3}$/i.test(local);
}

export function firstNameOf(name: string | null | undefined): string {
  if (!name) return "";
  const first = name.trim().split(/\s+/)[0] ?? "";
  if (first.length < 2) return "";
  if (
    /^(sales|team|info|contact|support|admin|hello|hr|marketing|office|legal|security|compliance)$/i.test(
      first
    )
  ) {
    return "";
  }
  return first[0].toUpperCase() + first.slice(1);
}

export function classifyRecipient(input: {
  email: string;
  contactName?: string | null;
  contactTitle?: string | null;
  emailStatus?: string | null;
  verified?: boolean;
}): RecipientProfile {
  const email = input.email.trim().toLowerCase();
  const local = email.split("@")[0] ?? "";
  const base = (local.split("+")[0] ?? "").trim();
  const role = ROLE_MAP[compact(base)] ?? ROLE_MAP[base];
  const verification: RecipientProfile["verification"] =
    input.verified === true ||
    (input.emailStatus ?? "").toLowerCase() === "verified"
      ? "verified"
      : (input.emailStatus ?? "").toLowerCase() === "found"
        ? "unverified"
        : "unknown";
  const personalizationLevel =
    input.contactName && input.contactTitle
      ? "contact"
      : input.contactName
        ? "company"
        : "segment";

  if (role) {
    const greeting = "Hello Team,";
    const isNoReply = role.strategy === "do_not_contact";
    return {
      type: "shared",
      category: role.category,
      strategy: role.strategy,
      strategyLabel: STRATEGY_LABELS[role.strategy],
      greeting,
      ctaType: role.category === "sales" ? "commercial" : role.category === "partnerships" ? "partnership" : role.category === "security" ? "technical" : role.category === "compliance" ? "compliance" : role.category === "legal" || role.category === "privacy" ? "formal" : "routing",
      personalizationLevel: "company",
      verification,
      label: `Shared inbox · ${role.label}`,
      warning: isNoReply
        ? "This looks like a no-reply address. Messages sent here are usually not read."
        : role.strategy === "careers_caution"
          ? "This is a careers inbox. Sales outreach here is usually ignored."
          : undefined,
    };
  }

  if (PERSONAL_ROLE_PREFIXES.has(base)) {
    const greeting = input.contactName ? `Hi ${firstNameOf(input.contactName)},` : "Hi there,";
    return {
      type: "personal",
      category: "none",
      strategy: "decision_maker",
      strategyLabel: STRATEGY_LABELS.decision_maker,
      greeting,
      ctaType: "interest",
      personalizationLevel: input.contactName ? "contact" : "company",
      verification,
      label: "Personal (founder/executive alias)",
    };
  }

  if (input.contactName || input.contactTitle || looksLikeName(base)) {
    const greeting = input.contactName ? `Hi ${firstNameOf(input.contactName)},` : "Hi there,";
    return {
      type: input.contactName || input.contactTitle ? "personal" : "unknown",
      category: "none",
      strategy: input.contactName || input.contactTitle ? "decision_maker" : "unknown_cautious",
      strategyLabel:
        input.contactName || input.contactTitle
          ? STRATEGY_LABELS.decision_maker
          : STRATEGY_LABELS.unknown_cautious,
      greeting,
      ctaType: input.contactName || input.contactTitle ? "interest" : "routing",
      personalizationLevel: input.contactName ? "contact" : "segment",
      verification,
      label:
        input.contactName || input.contactTitle
          ? "Personal"
          : "Unverified personal-looking address",
      warning:
        input.contactName || input.contactTitle
          ? verification === "unverified"
            ? "This contact's email is not verified yet. Verify it before high-volume sending."
            : undefined
          : "This address looks personal but is not linked to a known contact. Draft cautiously or run contact discovery.",
    };
  }

  return {
    type: "unknown",
    category: "none",
    strategy: "unknown_cautious",
    strategyLabel: STRATEGY_LABELS.unknown_cautious,
    greeting: "Hi there,",
    ctaType: "routing",
    personalizationLevel: "segment",
    verification,
    label: "Unknown recipient",
    warning:
      "Recipient type is unclear. This draft avoids assuming a name or role; verify the address before sending.",
  };
}

export function strategyInstruction(profile: RecipientProfile): string {
  switch (profile.strategy) {
    case "decision_maker":
      return "Write directly to the decision-maker. Reference their responsibilities, one relevant business problem and one specific question. Do not address a team.";
    case "routing_first":
      return "You are writing to a shared company inbox. Do not invent a recipient name and do not assume the reader is the decision-maker. State why you are contacting the company, give the business value briefly, keep it easy to forward, and end by asking who handles the relevant area.";
    case "commercial":
      return "You are writing to a sales inbox. State the commercial value briefly, avoid a full pitch, and ask for the appropriate commercial contact.";
    case "support_routing":
      return "You are writing to a support inbox. Do not pitch. Briefly explain the business reason and ask for the right business contact.";
    case "partnership":
      return "You are writing to a partnerships inbox. Frame the message around a potential collaboration and ask who owns partnerships.";
    case "security_technical":
      return "You are writing to a security inbox. Keep it technical and relevant to security posture, controls or readiness, and ask for the person responsible for security.";
    case "compliance_readiness":
      return "You are writing to a compliance inbox. Focus on compliance readiness, evidence and governance, and ask for the person responsible for compliance.";
    case "legal_formal":
      return "You are writing to a legal or privacy inbox. Be formal and concise. Do not pitch aggressively; ask for the appropriate business owner.";
    case "billing_routing":
      return "You are writing to a finance or billing inbox. Be brief, explain the business reason and ask for the appropriate owner.";
    case "careers_caution":
      return "You are writing to a careers inbox. Do not pitch. If relevant, ask for the correct business contact; otherwise keep it minimal.";
    case "unknown_cautious":
      return "Recipient type is unknown. Do not assume a name, role or seniority. Use company-level relevance and a low-risk question; avoid personal claims.";
    case "do_not_contact":
      return "This looks like a no-reply address. Do not produce a send-ready pitch; recommend finding another contact.";
  }
}

export function ctaInstruction(profile: RecipientProfile): string {
  switch (profile.ctaType) {
    case "routing":
      return "End with one routing question: ask who handles the relevant area or ask for the message to be forwarded.";
    case "commercial":
      return "End with one question asking for the appropriate commercial contact.";
    case "partnership":
      return "End with one question asking who owns partnerships.";
    case "technical":
      return "End with one question asking for the person responsible for security.";
    case "compliance":
      return "End with one question asking for the person responsible for compliance.";
    case "formal":
      return "End with one concise question asking for the appropriate business owner.";
    case "referral":
      return "End with a polite referral question.";
    case "interest":
      return "End with one low-friction interest question, not a meeting request.";
    case "none":
      return "Do not include a CTA.";
  }
}
