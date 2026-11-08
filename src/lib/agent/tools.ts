// Phase 1 Outreach Copilot: tool registry (no sending tools).
export const AGENT_TOOLS = [
  {
    name: "search_companies",
    label: "Search companies",
    description:
      "Find companies from Crunchbase using industry, location, headcount and count. Imports them into the selected pipeline, auto-enriches websites and scores them.",
    args: {
      category: "string? — industry name or permalink, e.g. SaaS, FinTech, software",
      location: "string? — country or city, e.g. India, Bengaluru",
      employeeBand: "string? — one of 1-10, 11-50, 51-100, 101-250, 251-500",
      count: "number? — 1..15, default 10",
    },
    requiresApproval: false,
    cost: "Crunchbase: $2–7 per 1,000 companies",
  },
  {
    name: "list_companies",
    label: "List companies",
    description:
      "Read companies already in a pipeline, ordered by score. Use before enrich/score/deep search/draft when the command refers to existing leads.",
    args: {
      pipeline: "string? — pipeline id, e.g. compliance, pos",
      minScore: "number? — 0..100",
      limit: "number? — 1..30, default 10",
    },
    requiresApproval: false,
    cost: "Free",
  },
  {
    name: "enrich_websites",
    label: "Enrich websites",
    description:
      "Read each selected company's website to extract description, people, emails, phone and LinkedIn. No paid people database involved.",
    args: { limit: "number? — 1..5, default 3" },
    requiresApproval: false,
    cost: "Free (website fetch + AI extraction)",
  },
  {
    name: "score_companies",
    label: "Score companies",
    description: "Recompute the ICP lead score for selected companies.",
    args: { limit: "number? — 1..10, default 5" },
    requiresApproval: false,
    cost: "Free",
  },
  {
    name: "deep_search",
    label: "Deep Search",
    description:
      "Paid people search for selected companies (Apollo + LinkedIn). Use only when personal contacts/emails are missing and the user asks for them.",
    args: { limit: "number? — 1..3, default 2" },
    requiresApproval: true,
    cost: "Paid per company (uses API credits)",
  },
  {
    name: "draft_emails",
    label: "Draft emails",
    description:
      "Generate review-ready cold emails for selected companies that have an email. Never sends; the human edits and approves a send coin afterward. Returns subject, body, recipient classification and quality check.",
    args: {
      limit: "number? — 1..3, default 2",
      flavor: "string? — short-direct, pain-first, insight-authority, warm-intro, founder-founder",
    },
    requiresApproval: false,
    cost: "AI drafting only; no send",
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number]["name"];

export function toolByName(name: string) {
  return AGENT_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function toolsPrompt(): string {
  return AGENT_TOOLS.map(
    (tool) =>
      `- ${tool.name} (${tool.requiresApproval ? "requires approval" : "no approval"}): ${tool.description}\n  args: ${Object.entries(tool.args)
        .map(([key, value]) => `${key} (${value})`)
        .join(", ")}\n  cost: ${tool.cost}`
  ).join("\n");
}
