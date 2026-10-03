import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { startDeepResearch } from "@/lib/deep-research";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const { orgId } = (await request.json()) as { orgId?: number };
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });

  const supabase = await createClient();
  const { data: company } = await supabase
    .from("organizations")
    .select("id, name, website, linkedin_url")
    .eq("id", orgId)
    .maybeSingle();
  if (!company) return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });

  const result = await startDeepResearch(supabase, { orgId, userId, company });
  if (!result.ok) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
