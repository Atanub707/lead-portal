import { AgentCopilot } from "@/components/agent-copilot";
import { activeWorkspaceId } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface LogRow {
  id: number;
  summary: string;
  created_at: string;
  details: { plan?: { steps?: unknown[] }; result?: { status?: string } } | null;
}

export default async function AgentPage() {
  const workspaceId = await activeWorkspaceId();
  const admin = createAdminClient();
  const { data } = await admin
    .from("activity_log")
    .select("id, summary, created_at, details")
    .eq("workspace_id", workspaceId)
    .eq("action", "agent.run")
    .order("created_at", { ascending: false })
    .limit(6);

  const recentRuns = ((data ?? []) as LogRow[]).map((row) => ({
    id: row.id,
    summary: row.summary,
    createdAt: row.created_at,
    steps: Array.isArray(row.details?.plan?.steps) ? row.details.plan.steps.length : 0,
    status: row.details?.result?.status ?? "done",
  }));

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Copilot
        </h1>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-zinc-500">
          Describe the outcome you want. Copilot turns it into a reviewable plan
          and runs only the steps you approve. It can search, enrich, score and
          draft — it never sends email.
        </p>
      </header>
      <div className="mt-6">
        <AgentCopilot recentRuns={recentRuns} />
      </div>
    </div>
  );
}
