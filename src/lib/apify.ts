const APIFY_BASE = "https://api.apify.com/v2";

function token(): string {
  const value = process.env.APIFY_API_TOKEN;
  if (!value) throw new Error("Missing APIFY_API_TOKEN");
  return value;
}

export interface ActorRunInfo {
  runId: string;
  datasetId: string;
  status: string;
  usageTotalUsd: number;
}

export async function startActorRun(
  actorId: string,
  input: unknown
): Promise<{ runId: string; datasetId: string }> {
  const res = await fetch(
    `${APIFY_BASE}/acts/${actorId}/runs?token=${token()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Apify start failed (${res.status}): ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  return { runId: json.data.id, datasetId: json.data.defaultDatasetId };
}

export async function getActorRun(runId: string): Promise<ActorRunInfo> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${token()}`);
  if (!res.ok) throw new Error(`Apify run lookup failed (${res.status})`);
  const json = (await res.json()) as {
    data: {
      id: string;
      status: string;
      defaultDatasetId: string;
      usageTotalUsd?: number;
    };
  };
  return {
    runId: json.data.id,
    status: json.data.status,
    datasetId: json.data.defaultDatasetId,
    usageTotalUsd: json.data.usageTotalUsd ?? 0,
  };
}

export async function getDatasetItems(
  datasetId: string,
  limit = 100
): Promise<unknown[]> {
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?limit=${limit}&token=${token()}`
  );
  if (!res.ok) throw new Error(`Apify dataset fetch failed (${res.status})`);
  return (await res.json()) as unknown[];
}
