import { CrunchbaseImport } from "@/components/crunchbase-import";
import { getPipelines, getWorkspaceContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [pipelines, ctx] = await Promise.all([
    getPipelines(),
    getWorkspaceContext(),
  ]);

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Find leads
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Pull targeted startups from Crunchbase straight into a pipeline. Their
          details land as companies, ready for Deep Research and the Email
          Composer.
        </p>
      </header>

      <div className="mt-6">
        {ctx?.canWrite === false ? (
          <div className="card p-5">
            <p className="text-[13px] text-zinc-500">
              Read-only account — ask the workspace owner to unlock changes.
            </p>
          </div>
        ) : (
          <CrunchbaseImport
            variant="page"
            list={pipelines[0]?.id ?? "pos"}
            pipelines={pipelines.map((entry) => ({
              id: entry.id,
              name: entry.name,
            }))}
          />
        )}
      </div>
    </div>
  );
}
