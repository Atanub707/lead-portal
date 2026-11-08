import { auth } from "@clerk/nextjs/server";
import { AgentCopilot } from "@/components/agent-copilot";
import { activeWorkspaceId } from "@/lib/data";
import { listAgentRuns } from "@/lib/agent/runs";
import { getSendOverview } from "@/lib/send-queue";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const { userId } = await auth();
  const workspaceId = await activeWorkspaceId();
  const recentRuns = userId ? await listAgentRuns(userId, workspaceId, 6) : [];
  const activeRun =
    recentRuns.find((run) => run.status === "running" || run.status === "failed") ?? null;
  const sendOverview = userId
    ? await getSendOverview(workspaceId, userId)
    : null;

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Copilot
        </h1>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-zinc-500">
          Describe the outcome you want. Copilot plans, runs only the steps you
          approve, and saves every run so you can refine, resume or retry. It can
          search, enrich, score and draft — it never sends email.
        </p>
      </header>
      <div className="mt-6">
        <AgentCopilot
          recentRuns={recentRuns}
          activeRun={activeRun}
          sendOverview={sendOverview}
        />
      </div>
    </div>
  );
}
