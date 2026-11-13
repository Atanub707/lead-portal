import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  const token = process.env.APIFY_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({ ok: false, step: "env", error: "APIFY_API_TOKEN is not set" });
  }
  const base = "https://api.apify.com/v2";
  const call = async (path: string) => {
    const res = await fetch(`${base}/${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body };
  };
  const [me, actor] = await Promise.all([
    call("users/me"),
    call("acts/omkar-cloud~crunchbase-scraper"),
  ]);
  const meBody = me.body as { data?: { username?: string; plan?: { id?: string } }; error?: { type?: string; message?: string } };
  const actorBody = actor.body as { data?: { id?: string; name?: string; isPublic?: boolean }; error?: { type?: string; message?: string } };
  return NextResponse.json({
    ok: me.status === 200 && actor.status === 200,
    token: { present: true, length: token.length },
    apify: {
      meStatus: me.status,
      meError: meBody?.error ?? null,
      username: meBody?.data?.username ?? null,
      plan: meBody?.data?.plan?.id ?? null,
      actorStatus: actor.status,
      actorError: actorBody?.error ?? null,
      actor: actorBody?.data
        ? { id: actorBody.data.id, name: actorBody.data.name, isPublic: actorBody.data.isPublic }
        : null,
    },
  });
}
