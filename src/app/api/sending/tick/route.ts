import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireWorkspaceId } from "@/lib/data";
import { processDueSends } from "@/lib/send-queue";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(request: Request) {
  try {
    if (cronAuthorized(request)) {
      const result = await processDueSends({ limit: 5 });
      return NextResponse.json({ ok: true, scope: "all", ...result });
    }
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const workspaceId = await requireWorkspaceId();
    const result = await processDueSends({ workspaceId, limit: 3 });
    return NextResponse.json({ ok: true, scope: "workspace", ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send tick failed";
    const status = /email_send_|relation .* does not exist|schema cache/i.test(message) ? 503 : 500;
    return NextResponse.json(
      { ok: false, error: status === 503 ? "Apply the Phase 3 migration first." : message },
      { status }
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
