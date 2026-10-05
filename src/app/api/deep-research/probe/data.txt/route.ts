import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TEMPORARY diagnostic route — dumps raw Apify actor runs/inputs/dataset items.
// Removed immediately after debugging. Key-gated.
const DEBUG_KEY = "dr-probe-9f3a1c";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== DEBUG_KEY) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "no token" }, { status: 500 });

  const out: unknown[] = [];

  for (const datasetId of url.searchParams.getAll("ds")) {
    const info = await (
      await fetch(`https://api.apify.com/v2/datasets/${datasetId}?token=${token}`, { cache: "no-store" })
    ).json();
    const items = await (
      await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=2&clean=true`, { cache: "no-store" })
    ).json();
    out.push({
      datasetId,
      itemCount: info?.data?.itemCount ?? null,
      items: Array.isArray(items)
        ? items.map((i) => JSON.stringify(i).slice(0, 2800))
        : items,
    });
  }

  for (const runId of url.searchParams.getAll("run")) {
    const run = await (
      await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`, { cache: "no-store" })
    ).json();
    const kvStoreId = run?.data?.defaultKeyValueStoreId;
    let input: unknown = null;
    if (kvStoreId) {
      input = await (
        await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/INPUT?token=${token}`, { cache: "no-store" })
      ).json().catch(() => null);
    }
    out.push({
      runId,
      status: run?.data?.status,
      usageTotalUsd: run?.data?.usageTotalUsd,
      startedAt: run?.data?.startedAt,
      finishedAt: run?.data?.finishedAt,
      input,
    });
  }

  return NextResponse.json(out);
}
