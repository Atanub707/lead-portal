import { SubmitButton } from "@/components/submit-button";
import { renameWorkspace, updateMyName } from "@/lib/actions";
import { getCurrentProfile, getWorkspaceContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsGeneralPage() {
  const [profile, workspaceCtx] = await Promise.all([
    getCurrentProfile(),
    getWorkspaceContext(),
  ]);

  return (
    <div className="max-w-[760px] space-y-5">
      {workspaceCtx?.workspace ? (
        <section className="card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Workspace
            </h2>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                workspaceCtx.workspace.plan === "active"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : workspaceCtx.trialEnded
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {workspaceCtx.workspace.plan === "active"
                ? "Active"
                : workspaceCtx.trialEnded
                  ? "Trial ended"
                  : `Trial · ${workspaceCtx.trialDaysLeft ?? 0}d left`}
            </span>
          </div>
          {profile?.role === "owner" ? (
            <form
              action={renameWorkspace}
              className="mt-3 flex items-center gap-2"
            >
              <input
                name="name"
                defaultValue={workspaceCtx.workspace.name}
                required
                maxLength={60}
                aria-label="Workspace name"
                className="input max-w-[280px]"
              />
              <SubmitButton pendingText="Saving…">Save</SubmitButton>
            </form>
          ) : (
            <p className="mt-1 text-[13px] text-zinc-800">
              {workspaceCtx.workspace.name}
            </p>
          )}
          <p className="mt-1 text-[12px] text-zinc-500">
            {workspaceCtx.workspace.plan === "active"
              ? "This workspace is private to your team."
              : workspaceCtx.canWrite
                ? "14-day trial — changes pause when it ends."
                : "Trial ended — changes are paused. Contact us to continue."}
          </p>
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">
          Your profile
        </h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          Shown as “Added by …” on records you create.
        </p>
        <form action={updateMyName} className="mt-3 flex items-center gap-2">
          <input
            name="full_name"
            defaultValue={profile?.full_name ?? ""}
            placeholder="Your name"
            aria-label="Your display name"
            required
            maxLength={80}
            className="input max-w-[280px]"
          />
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>
      </section>
    </div>
  );
}
