import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
} from "ai";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { groq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

// OpenCode Go subscription — key from https://opencode.ai/auth (subscribe to Go).
// Per the OpenCode docs, Go uses the /zen/go/v1 endpoint path and expects clients
// to identify themselves with a user agent + a stable session ID header.
const OPENCODE_MODEL = "deepseek-v4.1-flash";
const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1";

function openCodeGoModel(sessionId: string) {
  const provider = createOpenAICompatible({
    name: "opencode-go",
    baseURL: OPENCODE_GO_BASE_URL,
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    headers: {
      "User-Agent": "lead-portal/1.0",
      "x-opencode-session": sessionId,
    },
  });
  return provider(OPENCODE_MODEL);
}

function pickModel(sessionId: string) {
  if (process.env.OPENCODE_API_KEY) {
    return openCodeGoModel(sessionId);
  }
  if (process.env.OPENAI_API_KEY) {
    return openai(process.env.AI_MODEL ?? "gpt-4o-mini");
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return google(process.env.AI_MODEL ?? "gemini-2.5-flash");
  }
  if (process.env.GROQ_API_KEY) {
    return groq(process.env.AI_MODEL ?? "llama-3.3-70b-versatile");
  }
  return null;
}

const SYSTEM_PROMPT = `You are the assistant inside "Lead Portal", an internal CRM with two separate pipelines (databases):
- "pos" — POS Pipeline: restaurant/hospitality technology companies (leads, partners, competitors of a restaurant POS product).
- "compliance" — Compliance Pipeline: organizations that may buy SOC 2 / ISO 27000 readiness and compliance services.

Pipeline stages — pos: new, contacted, demo, proposal, won, lost. compliance: new, contacted, scoping, proposal, won, lost.
Company type: lead | partner | competitor | other. Priority: high | medium | low.

Users paste raw research (links, notes, member lists, email signatures). Your job: extract the data and record it correctly using the tools.

Rules:
1. The user must state which list ("add to POS" or "add to compliance"). If it is missing and cannot be confidently inferred, ask ONE short question before creating anything.
2. Before creating a company, ALWAYS call findCompany first (match by name or domain). If it already exists, update it / add missing contacts instead of creating a duplicate.
3. Extract only facts present in the message. NEVER invent titles, emails, or details. Leave unknown fields out.
4. Parse pasted member details into contacts (name required; title / LinkedIn / email / phone when present).
5. After finishing, reply with a short summary: what was created or updated, in which list, how many contacts were added, and the record path (e.g. /companies/123).
6. Keep replies short and operational — no filler.
7. You can also update companies (status, priority, next action, notes) and log interactions when the user reports them.`;

function sanitize(query: string) {
  return query.replace(/[%(),]/g, " ").trim();
}

function buildTools(
  supabase: Awaited<ReturnType<typeof createClient>>
): ToolSet {
  return {
    findCompany: tool({
      description:
        "Search existing companies by name or website domain. Always call this before creating a company to avoid duplicates.",
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => {
        const q = sanitize(query);
        if (!q) return { results: [] };
        const { data, error } = await supabase
          .from("organizations")
          .select("id, name, list, website, status")
          .or(`name.ilike.%${q}%,website.ilike.%${q}%`)
          .limit(5);
        if (error) return { error: error.message };
        return { results: data ?? [] };
      },
    }),

    createCompany: tool({
      description:
        "Create a company in one of the two pipelines. Use list 'pos' or 'compliance'. Check findCompany first.",
      inputSchema: z.object({
        list: z.enum(["pos", "compliance"]),
        name: z.string().min(1),
        website: z.string().optional(),
        linkedin_url: z.string().optional(),
        kind: z.enum(["lead", "partner", "competitor", "other"]).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        next_action: z.string().optional(),
        notes: z.string().optional(),
      }),
      execute: async (input) => {
        const { data, error } = await supabase
          .from("organizations")
          .insert({
            list: input.list,
            name: input.name,
            website: input.website ?? null,
            linkedin_url: input.linkedin_url ?? null,
            kind: input.kind ?? "lead",
            status: "new",
            priority: input.priority ?? null,
            next_action: input.next_action ?? null,
            notes: input.notes ?? null,
          })
          .select("id, name, list")
          .single();
        if (error) return { error: error.message };
        return { created: data };
      },
    }),

    updateCompany: tool({
      description:
        "Update an existing company's fields (status, priority, next action, notes, website, LinkedIn, type).",
      inputSchema: z.object({
        id: z.number(),
        status: z
          .enum([
            "new",
            "contacted",
            "demo",
            "scoping",
            "proposal",
            "won",
            "lost",
          ])
          .optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        next_action: z.string().optional(),
        notes: z.string().optional(),
        website: z.string().optional(),
        linkedin_url: z.string().optional(),
        kind: z.enum(["lead", "partner", "competitor", "other"]).optional(),
      }),
      execute: async ({ id, ...patch }) => {
        const clean = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined)
        );
        if (Object.keys(clean).length === 0) return { error: "Nothing to update" };
        const { error } = await supabase
          .from("organizations")
          .update(clean)
          .eq("id", id);
        if (error) return { error: error.message };
        return { updated: id };
      },
    }),

    addContact: tool({
      description:
        "Add a person (member/contact) to an existing company. Get the company id from findCompany or createCompany first.",
      inputSchema: z.object({
        company_id: z.number(),
        name: z.string().min(1),
        title: z.string().optional(),
        linkedin_url: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
      }),
      execute: async (input) => {
        const { error } = await supabase.from("contacts").insert({
          org_id: input.company_id,
          name: input.name,
          title: input.title ?? null,
          linkedin_url: input.linkedin_url ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
        });
        if (error) return { error: error.message };
        return { added: input.name };
      },
    }),

    logInteraction: tool({
      description:
        "Log an interaction (call, email, meeting, LinkedIn) against a company. Updates the company's last-contact date.",
      inputSchema: z.object({
        company_id: z.number(),
        summary: z.string().min(1),
        channel: z.string().optional(),
        outcome: z.string().optional(),
        occurred_on: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      }),
      execute: async (input) => {
        const occurredOn =
          input.occurred_on ?? new Date().toISOString().slice(0, 10);
        const { error } = await supabase.from("interactions").insert({
          org_id: input.company_id,
          occurred_on: occurredOn,
          channel: input.channel ?? null,
          summary: input.summary,
          outcome: input.outcome ?? null,
        });
        if (error) return { error: error.message };

        const { data: org } = await supabase
          .from("organizations")
          .select("last_contact")
          .eq("id", input.company_id)
          .maybeSingle();
        const current = (org as { last_contact: string | null } | null)
          ?.last_contact;
        if (!current || occurredOn > current) {
          await supabase
            .from("organizations")
            .update({ last_contact: occurredOn })
            .eq("id", input.company_id);
        }
        return { logged: true };
      },
    }),
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const model = pickModel(user.id);
  if (!model) {
    return Response.json(
      {
        error:
          "No AI key configured. Add OPENCODE_API_KEY (OpenCode Go subscription — https://opencode.ai/auth) to .env.local (and Vercel), then restart. OpenAI / Google / Groq keys also work as fallbacks.",
      },
      { status: 503 }
    );
  }

  const { messages } = await req.json();

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: buildTools(supabase),
    stopWhen: stepCountIs(6),
  });

  return result.toUIMessageStreamResponse();
}
