import { updateUserRole } from "@/lib/actions";
import { getCurrentProfile, getProfiles } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [profile, users] = await Promise.all([
    getCurrentProfile(),
    getProfiles(),
  ]);
  const isOwner = profile?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Users and roles for this workspace.
        </p>

        <section className="card mt-6 animate-rise animate-rise-1 p-5">
        <h2 className="text-[13px] font-semibold text-zinc-900">Users</h2>
        <p className="mt-1 text-[12px] text-zinc-500">
          The first account is the <strong>owner</strong>. Editors can add and
          edit; only the owner can delete records or change roles.
        </p>

        <div className="mt-3 divide-y divide-zinc-100">
          {users.map((user) => {
            const initial = (user.email ?? "?").charAt(0).toUpperCase();
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
                      {user.id === profile?.id ? (
                        <span className="ml-2 text-[11px] text-zinc-400">
                          (you)
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-zinc-500 tabular-nums">
                      Joined{" "}
                      {new Date(user.created_at).toISOString().slice(0, 10)}
                    </p>
                  </div>
                </div>

                {isOwner ? (
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
