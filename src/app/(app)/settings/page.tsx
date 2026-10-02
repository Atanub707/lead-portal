import { ConfirmSubmit } from "@/components/confirm-submit";
import { inviteUser, removeUser, updateUserRole } from "@/lib/actions";
import { getCurrentProfile, getProfiles } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface AuthMeta {
  pending: boolean;
}

async function getAuthMeta(): Promise<Map<string, AuthMeta> | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (error) return null;
    const map = new Map<string, AuthMeta>();
    for (const u of data.users) {
      map.set(u.id, { pending: !u.last_sign_in_at });
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
  const invited = typeof sp.invited === "string" ? sp.invited : "";
  const inviteError = typeof sp.invite_error === "string" ? sp.invite_error : "";
  const removeError = typeof sp.remove_error === "string" ? sp.remove_error : "";

  const [profile, users, authMeta] = await Promise.all([
    getCurrentProfile(),
    getProfiles(),
    getAuthMeta(),
  ]);
  const isOwner = profile?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Invite-only workspace. Partners join when the owner invites them.
        </p>

        {invited ? (
          <p
            role="status"
            className="mt-5 rounded-md bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800"
          >
            Invitation sent to <strong>{invited}</strong>. They will get an
            email with a link to set their password.
          </p>
        ) : null}
        {inviteError ? (
          <p
            role="alert"
            className="mt-5 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
          >
            Invitation failed: {inviteError}
          </p>
        ) : null}
        {removeError ? (
          <p
            role="alert"
            className="mt-5 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700"
          >
            {removeError}
          </p>
        ) : null}

        {isOwner ? (
          <section className="card mt-6 animate-rise animate-rise-1 p-5">
            <h2 className="text-[13px] font-semibold text-zinc-900">
              Invite a partner
            </h2>
            <p className="mt-1 text-[12px] text-zinc-500">
              They receive an email with a link where they set their password.
              Invitations are the only way to join — public sign-up is disabled.
              Invited partners join as <strong>editor</strong>; change roles
              below anytime.
            </p>
            <form action={inviteUser} className="mt-3 flex flex-wrap items-center gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="partner@company.com"
                aria-label="Partner email"
                className="input max-w-sm"
              />
              <button type="submit" className="btn-primary">
                Send invitation
              </button>
            </form>
            <p className="mt-2 text-[11px] text-zinc-400">
              Note: Supabase&apos;s built-in email sender is rate-limited (a few
              per hour). For reliable delivery, connect custom SMTP (free tiers:
              Resend, Brevo) in Supabase → Authentication → SMTP.
            </p>
          </section>
        ) : null}

        <section className="card mt-6 animate-rise animate-rise-2 p-5">
          <h2 className="text-[13px] font-semibold text-zinc-900">Users</h2>
          <p className="mt-1 text-[12px] text-zinc-500">
            The owner can invite, remove, and change roles. Editors can add and
            edit pipeline data; the database blocks everything else.
          </p>

          <div className="mt-3 divide-y divide-zinc-100">
            {users.map((user) => {
              const initial = (user.email ?? "?").charAt(0).toUpperCase();
              const pending = authMeta?.get(user.id)?.pending;
              const isSelf = user.id === profile?.id;

              return (
                <div
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
                      {initial}
                    </span>
                    <div>
                      <p className="text-[13px] text-zinc-800">
                        {user.email ?? user.id}
                        {isSelf ? (
                          <span className="ml-2 text-[11px] text-zinc-400">
                            (you)
                          </span>
                        ) : null}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                        {authMeta ? (
                          pending ? (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <span
                                className="h-1 w-1 rounded-full bg-amber-500"
                                aria-hidden="true"
                              />
                              Pending invite
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <span
                                className="h-1 w-1 rounded-full bg-emerald-500"
                                aria-hidden="true"
                              />
                              Active
                            </span>
                          )
                        ) : null}
                        <span className="tabular-nums">
                          Joined{" "}
                          {new Date(user.created_at)
                            .toISOString()
                            .slice(0, 10)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isOwner ? (
                    <div className="flex items-center gap-3">
                      <form
                        action={updateUserRole}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="user_id" value={user.id} />
                        <select
                          name="role"
                          defaultValue={user.role}
                          aria-label={`Role for ${user.email ?? user.id}`}
                          className="input w-32"
                        >
                          <option value="editor">Editor</option>
                          <option value="owner">Owner</option>
                        </select>
                        <button type="submit" className="btn-ghost">
                          Save
                        </button>
                      </form>
                      {!isSelf ? (
                        <form action={removeUser}>
                          <input type="hidden" name="user_id" value={user.id} />
                          <ConfirmSubmit
                            message={`Remove ${user.email ?? "this user"}? They lose access immediately.`}
                            className="text-[11px] text-zinc-400 transition-colors hover:text-rose-600"
                          >
                            Remove
                          </ConfirmSubmit>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-[12px] font-medium capitalize text-zinc-600">
                      {user.role}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
