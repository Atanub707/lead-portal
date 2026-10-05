import { Mail, Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/badges";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { InviteButton } from "@/components/invite-form";
import { RoleSelect } from "@/components/role-select";
import { deleteInvitation, removeUser, revokeInvitation } from "@/lib/actions";
import { getClerkDirectory } from "@/lib/clerk-directory";
import { getCurrentProfile, getProfiles, getWorkspaceContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const removeError = typeof sp.remove_error === "string" ? sp.remove_error : "";
  const removed = typeof sp.removed === "string" ? sp.removed : "";

  const [profile, users, directory, workspaceCtx] = await Promise.all([
    getCurrentProfile(),
    getProfiles(),
    getClerkDirectory(),
    getWorkspaceContext(),
  ]);
  const isOwner = profile?.role === "owner";
  const activeUsers = directory?.activeUsers ?? null;
  const invitations = directory?.invitations ?? [];
  const pendingCount = invitations.filter(
    (invitation) => invitation.status === "pending"
  ).length;

  return (
    <div>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
            Members
          </h2>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            People with access to this workspace.
          </p>
        </div>
        {isOwner && workspaceCtx?.canWrite ? <InviteButton /> : null}
      </header>

      {removed ? (
        <p
          role="status"
          className="mt-5 rounded-lg bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-800"
        >
          User removed. They lose access immediately.
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

      <section className="card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h3 className="text-[13px] font-semibold text-zinc-900">People</h3>
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
                  <UserAvatar
                    seed={user.id}
                    name={user.email}
                    avatar={user.avatar}
                    size={28}
                  />
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
                          <input type="hidden" name="user_id" value={user.id} />
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
                          <span className="capitalize">{invitation.role}</span>
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
  );
}
