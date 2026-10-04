import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { generateEmailDraft } from "@/lib/email";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: {
    orgId?: number;
    contactId?: number | null;
    flavor?: string;
    to?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const orgId = Number(body.orgId);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: "Missing company" }, { status: 400 });
  }

  const result = await generateEmailDraft({
    userId,
    orgId,
    contactId: body.contactId ?? null,
    flavor: body.flavor ?? "",
    to: body.to ?? null,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
