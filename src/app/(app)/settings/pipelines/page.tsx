import { Trash2 } from "lucide-react";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { EditPipelineDialog } from "@/components/edit-pipeline-dialog";
import { NewPipelineButton } from "@/components/new-pipeline-dialog";
import { pipelineIcon } from "@/components/pipeline-icon";
import { deletePipeline } from "@/lib/actions";
import { getCurrentProfile, getPipelineUsage } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPipelinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pipelineError =
    typeof sp.pipeline_error === "string" ? sp.pipeline_error : "";
  const pipelineRemoved =
    typeof sp.pipeline_removed === "string" ? sp.pipeline_removed : "";

  const profile = await getCurrentProfile();
  const isOwner = profile?.role === "owner";

  if (!isOwner) {
    return (
      <div>
        <section className="card p-5">
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Pipelines
          </h2>
          <p className="mt-1 text-[13px] text-zinc-500">
            Only the workspace owner can manage pipelines.
          </p>
        </section>
      </div>
    );
  }

  const pipelines = await getPipelineUsage();

  return (
    <div>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Pipelines
          </h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Sections your companies are organized into.
          </p>
        </div>
        <NewPipelineButton />
      </header>

      {pipelineRemoved ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"
        >
          Pipeline deleted.
        </p>
      ) : null}
      {pipelineError ? (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700"
        >
          {pipelineError}
        </p>
      ) : null}

      <section className="card mt-5 overflow-hidden">
        <ul className="divide-y divide-zinc-100">
          {pipelines.map((pipeline) => {
            const Icon = pipelineIcon(pipeline.icon);
            const blocked = pipeline.count > 0;
            return (
              <li
                key={pipeline.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                    <Icon
                      className="h-3.5 w-3.5"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-zinc-900">
                      {pipeline.name}
                    </p>
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      {pipeline.count}{" "}
                      {pipeline.count === 1 ? "company" : "companies"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <EditPipelineDialog
                    id={pipeline.id}
                    name={pipeline.name}
                    icon={pipeline.icon}
                    pitch={pipeline.pitch}
                    value_props={pipeline.value_props}
                    proof_points={pipeline.proof_points}
                    cta={pipeline.cta}
                    default_flavor={pipeline.default_flavor}
                  />
                  {blocked ? (
                    <button
                      type="button"
                      disabled
                      title={`${pipeline.count} ${
                        pipeline.count === 1 ? "company is" : "companies are"
                      } still in this pipeline — move or delete ${
                        pipeline.count === 1 ? "it" : "them"
                      } first`}
                      aria-label={`Cannot delete ${pipeline.name} while it has companies`}
                      className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-md text-zinc-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <form action={deletePipeline}>
                      <input type="hidden" name="id" value={pipeline.id} />
                      <ConfirmSubmit
                        title={`Delete ${pipeline.name}?`}
                        message="This removes the section for everyone. It can't be undone."
                        confirmLabel="Delete"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">
                          Delete {pipeline.name}
                        </span>
                      </ConfirmSubmit>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="border-t border-zinc-100 px-5 py-2.5 text-[11px] text-zinc-400">
          Only the owner can delete pipelines.
        </p>
      </section>
    </div>
  );
}
