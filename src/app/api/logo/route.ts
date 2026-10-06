import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Company logos via a cached same-origin proxy: Google's favicon URL redirects
// (301) and only caches ~30 min, so tables re-request it constantly. We fetch
// once per domain and serve it with a week-long browser + CDN cache.
const DOMAIN_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export async function GET(request: Request) {
  const domain =
    new URL(request.url).searchParams.get("domain")?.toLowerCase() ?? "";
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const upstream = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
      { cache: "no-store", signal: AbortSignal.timeout(5000) }
    );
    if (!upstream.ok) {
      return new NextResponse(null, { status: 404 });
    }
    const buffer = await upstream.arrayBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        "Cache-Control":
          "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400, immutable",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
