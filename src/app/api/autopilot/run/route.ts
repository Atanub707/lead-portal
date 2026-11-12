import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { getAutopilotSettings, runAutopilot } from "@/lib/autopilot";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  try {
    const settings = await getAutopilotSettings(workspaceId);
    if (!settings.enabled) {
      return NextResponse.json(
        { ok: false, error: "Turn on Autopilot Assist first." },
        { status: 400 }
      );
    }
    const result = await runAutopilot(workspaceId, userId, {
      trigger: "manual",
      maxDrafts: 3,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, run: result.run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Autopilot run failed";
    const missing = /autopilot_|relation .* does not exist|schema cache/i.test(message);
    return NextResponse.json(
      { ok: false, error: missing ? "Apply the Autopilot Assist migration first." : message },
      { status: missing ? 503 : 500 }
    );
  }
}
