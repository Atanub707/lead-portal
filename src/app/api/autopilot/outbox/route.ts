import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import {
  approveAutopilotOutbox,
  rejectAutopilotOutbox,
  updateAutopilotOutbox,
} from "@/lib/autopilot";

const BodySchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(["approve", "reject", "edit"]),
  subject: z.string().max(200).optional(),
  body: z.string().max(8000).optional(),
  timezone: z.string().max(80).optional(),
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid Outbox action" }, { status: 400 });
  }
  const { id, action, subject, body, timezone } = parsed.data;
  try {
    if (action === "reject") {
      const result = await rejectAutopilotOutbox(id, workspaceId);
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    if (action === "edit") {
      const result = await updateAutopilotOutbox(id, workspaceId, { subject, body });
      return NextResponse.json(result, { status: result.ok ? 200 : 400 });
    }
    const result = await approveAutopilotOutbox(id, workspaceId, userId, {
      subject,
      body,
      timezone,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, errors: result.errors },
        { status: 400 }
      );
    }
    return NextResponse.json({ ...result, ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Outbox action failed";
    const missing = /autopilot_|relation .* does not exist|schema cache/i.test(message);
    return NextResponse.json(
      { ok: false, error: missing ? "Apply the Autopilot Assist migration first." : message },
      { status: missing ? 503 : 500 }
    );
  }
}
