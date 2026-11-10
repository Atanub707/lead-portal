import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspaceId } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  orgIds: z.array(z.number().int().positive()).max(100),
});

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const workspaceId = await requireWorkspaceId();
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid company list" }, { status: 400 });
  }
  const wanted = new Set(parsed.data.orgIds.map(String));
  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, payload")
    .eq("workspace_id", workspaceId)
    .eq("kind", "signal_scan")
    .eq("status", "queued")
    .contains("payload", { enrich: true });
  const ids = (jobs ?? [])
    .filter((job) => {
      const orgId = (job.payload as { orgId?: unknown } | null)?.orgId;
      return orgId !== undefined && wanted.has(String(orgId));
    })
    .map((job) => job.id as number);
  if (ids.length > 0) {
    await admin
      .from("jobs")
      .update({
        status: "done",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);
  }
  return NextResponse.json({ ok: true, completed: ids.length });
}
