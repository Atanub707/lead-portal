import Link from "next/link";
import { CrunchbaseImport } from "@/components/crunchbase-import";
import { IcpDiscovery } from "@/components/icp-discovery";
import { getWorkspaceContext } from "@/lib/data";
import { planFromIcp } from "@/lib/discovery";
import { getIntelligenceBundle } from "@/lib/intelligence-data";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp?.tab === "filters" ? "filters" : "icp";

  const [bundle, ctx] = await Promise.all([
    getIntelligenceBundle(),
    getWorkspaceContext(),
  ]);

  const pipelines = bundle.pipelines.map((entry) => ({
    id: entry.id,
    name: entry.name,
  }));
  const plan = bundle.icp
    ? planFromIcp(bundle.criteria, { count: 25, detailed: true })
    : null;
  const defaultPipelineId =
    bundle.pipelines.find((entry) => entry.icp_id === bundle.icp?.id)?.id ??
    bundle.pipelines[0]?.id ??
    null;

  const tabs = [
    { id: "icp", label: "By ICP" },
    { id: "filters", label: "Manual filters" },
  ] as const;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Find leads
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Discover companies from your ICP or with manual filters. Everything is
          imported, scored and queued for signal scans automatically.
        </p>
      </header>

      <nav
        aria-label="Discovery mode"
        className="mt-5 flex items-center gap-5 border-b border-zinc-200"
      >
        {tabs.map((entry) => {
          const active = tab === entry.id;
          return (
            <Link
              key={entry.id}
              href={`/leads?tab=${entry.id}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] transition-colors ${
                active
                  ? "border-zinc-900 font-medium text-zinc-900"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">
        {ctx?.canWrite === false ? (
          <div className="card p-5">
            <p className="text-[13px] text-zinc-500">
              Read-only account — ask the workspace owner to unlock changes.
            </p>
          </div>
        ) : tab === "icp" ? (
          <IcpDiscovery
            icp={
              bundle.icp
                ? { id: bundle.icp.id, name: bundle.icp.name }
                : null
            }
            initialPlan={plan}
            pipelines={pipelines}
            defaultPipelineId={defaultPipelineId}
            canWrite
          />
        ) : (
          <CrunchbaseImport
            variant="page"
            list={pipelines[0]?.id ?? "pos"}
            pipelines={pipelines}
          />
        )}
      </div>
    </div>
  );
}
