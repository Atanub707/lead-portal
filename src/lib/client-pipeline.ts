export interface LeadPipelineResult {
  signals: number;
  briefs: number;
  failures: number;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function finishLeadPipeline(
  orgIds: number[],
  onProgress?: (message: string, completed: number, total: number) => void
): Promise<LeadPipelineResult> {
  const ids = [...new Set(orgIds.filter((id) => Number.isFinite(id)))];
  const result: LeadPipelineResult = { signals: 0, briefs: 0, failures: 0 };

  for (const [index, batch] of chunks(ids, 4).entries()) {
    onProgress?.(
      `Scanning signals for ${Math.min(index * 4 + 1, ids.length)}–${Math.min(
        index * 4 + batch.length,
        ids.length
      )} of ${ids.length}…`,
      index * 4,
      ids.length
    );
    const responses = await Promise.allSettled(
      batch.map((orgId) =>
        fetch("/api/signals/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        })
      )
    );
    for (const response of responses) {
      if (response.status !== "fulfilled" || !response.value.ok) {
        result.failures += 1;
        continue;
      }
      result.signals += 1;
    }
  }

  for (const [index, batch] of chunks(ids, 2).entries()) {
    onProgress?.(
      `Writing AI briefs for ${Math.min(index * 2 + 1, ids.length)}–${Math.min(
        index * 2 + batch.length,
        ids.length
      )} of ${ids.length}…`,
      ids.length,
      ids.length
    );
    const responses = await Promise.allSettled(
      batch.map((orgId) =>
        fetch("/api/briefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId }),
        })
      )
    );
    for (const response of responses) {
      if (response.status !== "fulfilled" || !response.value.ok) {
        result.failures += 1;
        continue;
      }
      const json = (await response.value.json().catch(() => null)) as
        | { ok?: boolean }
        | null;
      if (json?.ok) result.briefs += 1;
      else result.failures += 1;
    }
  }

  return result;
}
