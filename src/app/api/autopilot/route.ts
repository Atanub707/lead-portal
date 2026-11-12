import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import {
  getAutopilotSettings,
  listAutopilotOutbox,
  listAutopilotRuns,
  saveAutopilotSettings,
} from "@/lib/autopilot";

export const dynamic = "force-dynamic";

const SettingsSchema = z.object({
  enabled: z.boolean().optional(),
  pipeline_id: z.string().max(80).nullable().optional(),
  min_score: z.number().int().min(0).max(100).optional(),
  daily_draft_limit: z.number().int().min(1).max(20).optional(),
  run_interval_minutes: z.number().int().min(15).max(1440).optional(),
  review_required: z.boolean().optional(),
});

function migrationError(message: string): boolean {
  return /autopilot_(settings|runs|outbox)|relation .* does not exist|schema cache/i.test(message);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  try {
    const [settings, runs, outbox] = await Promise.all([
      getAutopilotSettings(workspaceId),
      listAutopilotRuns(workspaceId),
      listAutopilotOutbox(workspaceId),
    ]);
    return NextResponse.json({ ok: true, settings, runs, outbox });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load Autopilot";
    return NextResponse.json(
      {
        ok: false,
        error: migrationError(message)
          ? "Apply the Autopilot Assist migration first."
          : message,
      },
      { status: migrationError(message) ? 503 : 500 }
    );
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const parsed = SettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Check the Autopilot settings" }, { status: 400 });
  }
  try {
    const settings = await saveAutopilotSettings(workspaceId, userId, parsed.data);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save Autopilot";
    return NextResponse.json(
      {
        ok: false,
        error: migrationError(message)
          ? "Apply the Autopilot Assist migration first."
          : message,
      },
      { status: migrationError(message) ? 503 : 500 }
    );
  }
}
