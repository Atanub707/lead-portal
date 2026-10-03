import { clerkClient } from "@clerk/nextjs/server";
import { Trash2 } from "lucide-react";
import { UserAvatar } from "@/components/badges";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { InviteButton } from "@/components/invite-form";
import { RoleSelect } from "@/components/role-select";
import { SubmitButton } from "@/components/submit-button";
import { removeUser, updateMyName } from "@/lib/actions";
import { getCurrentProfile, getProfiles } from "@/lib/data";

export const dynamic = "force-dynamic";

// id -> pending? Pending invitations are keyed by email until accepted.
async function getAuthMeta(): Promise<Map<string, boolean> | null> {
  try {
    const client = await clerkClient();
    const [users, invites] = await Promise.all([
      client.users.getUserList({ limit: 200 }),
      client.invitations.getInvitationList({ status: "pending", limit: 200 }),
    ]);
    const map = new Map<string, boolean>();
    for (const u of users.data) map.set(u.id, false);
    for (const inv of invites.data) {
      if (inv.emailAddress) {
        map.set(`email:${inv.emailAddress.toLowerCase()}`, true);
      }
    }
    return map;
  } catch {
    return null;
  }
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const removeError = typeof sp.remove_error === "string" ? sp.remove_error : "";
  const removed = typeof sp.removed === "string" ? sp.removed : "";

  const [profile, users, authMeta] = await Promise.all([
    getCurrentProfile(),
    getProfiles(),
    getAuthMeta(),
  ]);
  const isOwner = profile?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-8 sm:px-8">
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
      {removeError ? (
        <p
          role="alert"
          className="mt-5 rounded-lg bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700"
        >
          {removeError}
        </p>
      ) : null}

      <section className="card mt-6 p-5">
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
            className="input max-w-[240px]"
          />
          <SubmitButton pendingText="Saving…">Save</SubmitButton>
        </form>
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h2 className="text-[13px] font-semibold text-zinc-900">People</h2>
          <span className="text-[12px] text-zinc-400 tabular-nums">
            {users.length}
          </span>
        </div>

        <ul className="divide-y divide-zinc-100">
          {users.map((user) => {
            const pending =
              authMeta?.get(user.id) ??
              (user.email
                ? authMeta?.get(`email:${user.email.toLowerCase()}`)
                : undefined);
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
                      {authMeta
                        ? pending
                          ? "Pending invite"
                          : "Active"
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
                            message={`Remove ${
                              user.email ?? "this user"
                            }? They lose access immediately.`}
                            confirmLabel="Remove"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
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
      </section>
    </div>
  );
}
