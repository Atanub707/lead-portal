import { auth } from "@clerk/nextjs/server";
import { AutopilotPanel } from "@/components/autopilot-panel";
import { activeWorkspaceId } from "@/lib/data";
import {
  defaultAutopilotSettings,
  getAutopilotSettings,
  listAutopilotOutbox,
  listAutopilotRuns,
  type AutopilotOutboxRow,
  type AutopilotRunRow,
  type AutopilotSettings,
} from "@/lib/autopilot";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function AutopilotPage() {
  const { userId } = await auth();
  const workspaceId = await activeWorkspaceId();
  const admin = createAdminClient();
  const { data: pipelineRows } = await admin
    .from("pipelines")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("sort_order");
  const pipelines = (pipelineRows ?? []) as { id: string; name: string }[];

  let available = true;
  let settings: AutopilotSettings = defaultAutopilotSettings(workspaceId);
  let runs: AutopilotRunRow[] = [];
  let outbox: AutopilotOutboxRow[] = [];
  try {
    [settings, runs, outbox] = await Promise.all([
      getAutopilotSettings(workspaceId),
      listAutopilotRuns(workspaceId),
      listAutopilotOutbox(workspaceId),
    ]);
  } catch {
    available = false;
  }

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Autopilot</h1>
        <p className="mt-1 max-w-[85ch] text-[13px] leading-relaxed text-zinc-500">
          Autopilot Assist finds qualified companies, writes grounded drafts and puts
          them in a human-reviewed Outbox. Nothing leaves until you approve it.
        </p>
      </header>
      <div className="mt-6">
        <AutopilotPanel
          available={available}
          initialSettings={settings}
          initialRuns={runs}
          initialOutbox={outbox}
          pipelines={pipelines}
        />
      </div>
    </div>
  );
}
