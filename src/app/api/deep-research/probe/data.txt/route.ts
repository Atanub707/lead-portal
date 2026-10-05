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

  for (const datasetId of url.searchParams.getAll("dsFull")) {
    const items = await (
      await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=50&clean=true`, { cache: "no-store" })
    ).json();
    out.push({
      datasetId,
      items: Array.isArray(items)
        ? items.map((i) => JSON.stringify(i).slice(0, 4000))
        : items,
    });
  }

  for (const runId of url.searchParams.getAll("run")) {
    const run = await (
      await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`, { cache: "no-store" })
    ).json();
    const kvStoreId = run?.data?.defaultKeyValueStoreId;
    let input: unknown = null;
    let log: string | null = null;
    if (kvStoreId) {
      input = await (
        await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/INPUT?token=${token}`, { cache: "no-store" })
      ).json().catch(() => null);
      log = await (
        await fetch(`https://api.apify.com/v2/key-value-stores/${kvStoreId}/records/LOG?token=${token}`, { cache: "no-store" })
      ).text().catch(() => null);
      if (log && log.length > 4000) log = log.slice(-4000);
    }
    out.push({
      runId,
      status: run?.data?.status,
      usageTotalUsd: run?.data?.usageTotalUsd,
      startedAt: run?.data?.startedAt,
      finishedAt: run?.data?.finishedAt,
      input,
      log,
    });
  }

  // Generic read-only Apify API passthrough for diagnostics.
  const slice = Math.min(Number(url.searchParams.get("slice") ?? 6000) || 6000, 30000);
  for (const path of url.searchParams.getAll("apifyPath")) {
    const res = await fetch(`https://api.apify.com/v2/${path}${path.includes("?") ? "&" : "?"}token=${token}`, { cache: "no-store" });
    const text = await res.text();
    out.push({ apifyPath: path, status: res.status, body: text.slice(0, slice) });
  }

  // Start an actor run with a JSON input (diagnostics only).
  for (const actorSlug of url.searchParams.getAll("start")) {
    const inputRaw = url.searchParams.get("startInput") ?? "{}";
    const res = await fetch(`https://api.apify.com/v2/acts/${actorSlug.replace("/", "~")}/runs?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inputRaw,
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    out.push({
      startedActor: actorSlug,
      status: res.status,
      runId: json?.data?.id ?? null,
      datasetId: json?.data?.defaultDatasetId ?? null,
      kvStoreId: json?.data?.defaultKeyValueStoreId ?? null,
      error: json?.error ?? null,
    });
  }

  return NextResponse.json(out);
}
