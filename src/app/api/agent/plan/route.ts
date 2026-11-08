import { auth } from "@clerk/nextjs/server";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pickModel, NO_AI_KEY_MESSAGE } from "@/lib/ai";
import { requireWorkspaceId } from "@/lib/data";
import { toolsPrompt } from "@/lib/agent/tools";
import { PlanSchema, type AgentPlan } from "@/lib/agent/types";
import { EMPLOYEE_BANDS } from "@/lib/crunchbase-options";
import { FLAVORS } from "@/lib/flavors";

export const maxDuration = 45;

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
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

function fallbackPlan(goal: string): AgentPlan {
  const wantsDraft = /draft|email|outreach|write/i.test(goal);
  const wantsEnrich = /enrich|website|research/i.test(goal);
  const steps: AgentPlan["steps"] = [
    { tool: "list_companies", reason: "Start from the highest-scoring companies in the pipeline.", args: { limit: 5 } },
  ];
  if (wantsEnrich) {
    steps.push({ tool: "enrich_websites", reason: "Read company websites for people, emails and details.", args: { limit: 3 } });
  }
  steps.push({ tool: "score_companies", reason: "Refresh ICP scores after enrichment.", args: { limit: 5 } });
  if (wantsDraft) {
    steps.push({ tool: "draft_emails", reason: "Draft review-ready emails (nothing is sent).", args: { limit: 2, flavor: "short-direct" } });
  }
  return {
    title: wantsDraft ? "Enrich, score and draft" : "Review top companies",
    summary:
      "The AI planner was unavailable, so this is a safe default plan. You can edit the command and try again.",
    steps,
    warnings: ["AI planning unavailable — using a default plan."],
  };
}

function clampPlan(plan: AgentPlan): AgentPlan {
  const bands = new Set<string>(EMPLOYEE_BANDS);
  const flavors = new Set<string>(FLAVORS.map((flavor) => flavor.id));
  return {
    ...plan,
    steps: plan.steps.map((step) => {
      const args: Record<string, unknown> = { ...step.args };
      if (step.tool === "search_companies") {
        const count = Number(args.count ?? 10);
        args.count = Number.isFinite(count) ? Math.min(15, Math.max(1, Math.round(count))) : 10;
        if (typeof args.employeeBand === "string" && !bands.has(args.employeeBand)) {
          delete args.employeeBand;
        }
        for (const key of ["category", "location"]) {
          if (typeof args[key] === "string") args[key] = (args[key] as string).slice(0, 80);
        }
      }
      if (step.tool === "list_companies") {
        const limit = Number(args.limit ?? 10);
        args.limit = Number.isFinite(limit) ? Math.min(30, Math.max(1, Math.round(limit))) : 10;
        const score = Number(args.minScore ?? 0);
        args.minScore = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
      }
      if (step.tool === "enrich_websites") {
        const limit = Number(args.limit ?? 3);
        args.limit = Number.isFinite(limit) ? Math.min(5, Math.max(1, Math.round(limit))) : 3;
      }
      if (step.tool === "score_companies") {
        const limit = Number(args.limit ?? 5);
        args.limit = Number.isFinite(limit) ? Math.min(10, Math.max(1, Math.round(limit))) : 5;
      }
      if (step.tool === "deep_search") {
        const limit = Number(args.limit ?? 2);
        args.limit = Number.isFinite(limit) ? Math.min(3, Math.max(1, Math.round(limit))) : 2;
      }
      if (step.tool === "draft_emails") {
        const limit = Number(args.limit ?? 2);
        args.limit = Number.isFinite(limit) ? Math.min(2, Math.max(1, Math.round(limit))) : 2;
        if (typeof args.flavor !== "string" || !flavors.has(args.flavor)) {
          args.flavor = "short-direct";
        }
      }
      return { ...step, args };
    }),
  };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  await requireWorkspaceId();

  const body = (await request.json().catch(() => null)) as { goal?: unknown } | null;
  const goal = typeof body?.goal === "string" ? body.goal.trim().slice(0, 600) : "";
  if (!goal) return NextResponse.json({ ok: false, error: "Describe what you want to do." }, { status: 400 });

  const model = pickModel(userId);
  if (!model) {
    return NextResponse.json({ ok: true, plan: clampPlan(fallbackPlan(goal)), ai: false });
  }

  const prompt = `User command: "${goal}"

Available tools:
${toolsPrompt()}

Return ONLY a JSON plan:
{ "title": string, "summary": string, "steps": [ { "tool": string, "reason": string, "args": object } ], "warnings": string[] }

Rules:
- Maximum 6 steps. Use the fewest steps that satisfy the command.
- Never invent tools. Use only the listed names.
- If the command asks to email someone, use draft_emails only. Sending is not available in this phase.
- Use deep_search only if the user explicitly asks for more people/contacts and accept that it costs credits.
- Prefer list_companies when the command refers to existing leads; use search_companies when it asks to find new companies.
- Respect the user's requested quantities, clamped to tool limits.`;

  try {
    const { text } = await generateText({
      model,
      system:
        "You are the planning layer of a B2B outreach copilot. You never execute actions; you only produce a safe, minimal tool plan. Be conservative and never promise sending.",
      prompt,
    });
    const parsed = parseJson(text);
    const result = PlanSchema.safeParse(parsed);
    if (!result.success) {
      return NextResponse.json({ ok: true, plan: clampPlan(fallbackPlan(goal)), ai: false });
    }
    return NextResponse.json({ ok: true, plan: clampPlan(result.data), ai: true });
  } catch (err) {
    console.error("[agent.plan] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: true, plan: clampPlan(fallbackPlan(goal)), ai: false });
  }
}
