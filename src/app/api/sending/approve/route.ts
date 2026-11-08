import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import { approveAndSchedule } from "@/lib/send-queue";

export const maxDuration = 45;

const BodySchema = z.object({
  orgId: z.number().int().positive(),
  contactId: z.number().int().positive().nullable().optional(),
  to: z.string().min(3).max(320),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  agentRunId: z.number().int().positive().nullable().optional(),
  timezone: z.string().max(80).optional(),
});

function migrationError(message: string): boolean {
  return /email_send_(policies|coins|queue)|relation .* does not exist|schema cache/i.test(message);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid approval request" }, { status: 400 });
  }
  try {
    const result = await approveAndSchedule({
      workspaceId,
      userId,
      orgId: parsed.data.orgId,
      contactId: parsed.data.contactId ?? null,
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
      agentRunId: parsed.data.agentRunId ?? null,
      timezone: parsed.data.timezone,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, errors: result.errors, warnings: result.warnings },
        { status: 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      coin: result.approval.coin,
      queue: result.approval.queue,
      day: result.approval.day,
      warnings: result.approval.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not schedule the send";
    const status = migrationError(message) ? 503 : 500;
    return NextResponse.json(
      {
        ok: false,
        error: status === 503
          ? "Send coins are not set up yet. Apply the Phase 3 migration first."
          : message,
      },
      { status }
    );
  }
}
