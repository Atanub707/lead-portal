import Link from "next/link";
import { Mail, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/badges";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { EditPipelineDialog } from "@/components/edit-pipeline-dialog";
import { InviteButton } from "@/components/invite-form";
import { pipelineIcon } from "@/components/pipeline-icon";
import { RoleSelect } from "@/components/role-select";
import { SubmitButton } from "@/components/submit-button";
import {
  deleteInvitation,
  deletePipeline,
  removeUser,
  revokeInvitation,
  updateMyName,
} from "@/lib/actions";
import { getClerkDirectory } from "@/lib/clerk-directory";
import {
  getCurrentProfile,
  getMyEmailSettings,
  getPipelineUsage,
  getProfiles,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const removeError = typeof sp.remove_error === "string" ? sp.remove_error : "";
  const removed = typeof sp.removed === "string" ? sp.removed : "";
  const pipelineError =
    typeof sp.pipeline_error === "string" ? sp.pipeline_error : "";
  const pipelineRemoved =
    typeof sp.pipeline_removed === "string" ? sp.pipeline_removed : "";

  const [profile, users, directory, emailSettings] = await Promise.all([
    getCurrentProfile(),
    getProfiles(),
    getClerkDirectory(),
    getMyEmailSettings(),
  ]);
  const isOwner = profile?.role === "owner";
  const pipelines = isOwner ? await getPipelineUsage() : [];
  const activeUsers = directory?.activeUsers ?? null;
  const invitations = directory?.invitations ?? [];
  const pendingCount = invitations.filter(
    (invitation) => invitation.status === "pending"
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Settings
        </h1>
        {isOwner ? <InviteButton /> : null}
      </header>

      {removed ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"
        >
          User removed. They lose access immediately.
        </p>
      ) : null}
      {pipelineRemoved ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"
        >
          Pipeline deleted.
        </p>
      ) : null}
      {removeError ? (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700"
        >
          {removeError}
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

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-zinc-900">
                Email sending
              </h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  emailSettings.configured
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {emailSettings.configured ? "Configured ✓" : "Not set up"}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              {emailSettings.configured && emailSettings.from_email
                ? `Sending as ${emailSettings.from_email}. `
                : ""}
              Send outreach from your own mailbox — only you can see these
              settings.
            </p>
            <Link href="/settings/email" className="btn-ghost mt-3">
              Open email settings
            </Link>
          </section>

          <section className="card p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Your profile
            </h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              Shown as “Added by …” on records you create.
            </p>
            <form
              action={updateMyName}
              className="mt-3 flex items-center gap-2"
            >
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

          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-zinc-900">
                People
              </h2>
              <span className="text-[12px] text-zinc-400 tabular-nums">
                {users.length + pendingCount}
              </span>
            </div>

            <ul className="divide-y divide-zinc-100">
              {users.map((user) => {
                const isSelf = user.id === profile?.id;

                return (
                  <li
                    key={user.id}
                    className="flex items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <UserAvatar seed={user.id} name={user.email} size={28} />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-zinc-900">
                          {user.email ?? user.id}
                          {isSelf ? (
                            <span className="ml-1.5 text-[11px] font-normal text-zinc-400">
                              you
                            </span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                          {activeUsers
                            ? activeUsers.has(user.id)
                              ? "Active"
                              : "Joined"
                            : "Joined"}
                          <span className="mx-1.5 text-zinc-300">·</span>
                          <span className="tabular-nums">
                            {new Date(user.created_at).toISOString().slice(0, 10)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {isOwner ? (
                        <>
                          <RoleSelect userId={user.id} role={user.role} />
                          {!isSelf ? (
                            <form action={removeUser}>
                              <input
                                type="hidden"
                                name="user_id"
                                value={user.id}
                              />
                              <ConfirmSubmit
                                title="Remove this user?"
                                message={`${
                                  user.email ?? "This user"
                                } loses access immediately.`}
                                confirmLabel="Remove"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                <span className="sr-only">
                                  Remove {user.email ?? "user"}
                                </span>
                              </ConfirmSubmit>
                            </form>
                          ) : (
                            <span className="w-7" aria-hidden="true" />
                          )}
                        </>
                      ) : (
                        <span className="text-[12px] font-medium capitalize text-zinc-500">
                          {user.role}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {invitations.length > 0 ? (
              <div className="border-t border-zinc-100">
                <p className="px-5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                  Invitations
                </p>
                <ul className="divide-y divide-zinc-100">
                  {invitations.map((invitation) => {
                    const pending = invitation.status === "pending";
                    const statusText = pending
                      ? invitation.expiresInHours > 0
                        ? `Invitation sent · expires in ${invitation.expiresInHours}h`
                        : "Invitation sent · expired"
                      : invitation.status === "revoked"
                        ? "Revoked"
                        : "Expired";
                    return (
                      <li
                        key={invitation.id}
                        className="flex items-center justify-between gap-3 px-5 py-3.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                              pending
                                ? "bg-amber-50 text-amber-600"
                                : "bg-zinc-100 text-zinc-400"
                            }`}
                          >
                            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-zinc-900">
                              {invitation.email}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {statusText}
                              <span className="mx-1.5 text-zinc-300">·</span>
                              <span className="capitalize">
                                {invitation.role}
                              </span>
                            </p>
                          </div>
                        </div>

                        {isOwner ? (
                          pending ? (
                            <form action={revokeInvitation}>
                              <input
                                type="hidden"
                                name="invitation_id"
                                value={invitation.id}
                              />
                              <ConfirmSubmit
                                title="Revoke this invitation?"
                                message={`${invitation.email} won't be able to use the link anymore. You can invite them again later.`}
                                confirmLabel="Revoke"
                                className="inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                Revoke
                              </ConfirmSubmit>
                            </form>
                          ) : (
                            <form action={deleteInvitation}>
                              <input
                                type="hidden"
                                name="invitation_id"
                                value={invitation.id}
                              />
                              <ConfirmSubmit
                                title="Delete this invitation record?"
                                message="This removes it from the list for good."
                                confirmLabel="Delete"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2
                                  className="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                                <span className="sr-only">
                                  Delete invitation for {invitation.email}
                                </span>
                              </ConfirmSubmit>
                            </form>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>
        </div>

        {isOwner ? (
          <section className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
              <h2 className="text-[13px] font-semibold text-zinc-900">
                Pipelines
              </h2>
              <span className="text-[12px] text-zinc-400 tabular-nums">
                {pipelines.length}
              </span>
            </div>

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
                            pipeline.count === 1
                              ? "company is"
                              : "companies are"
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
                          <input
                            type="hidden"
                            name="id"
                            value={pipeline.id}
                          />
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
        ) : null}
      </div>
    </div>
  );
}
