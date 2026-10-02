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
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Users and roles for this workspace.
      </p>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Users</h2>
        <p className="mt-1 text-xs text-slate-500">
          The first account is the <strong>owner</strong>. Everyone else joins
          as an <strong>editor</strong> — editors can add and edit; only the
          owner can delete records or change roles.
        </p>

        <div className="mt-4 divide-y divide-slate-100">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div>
                <p className="text-sm text-slate-800">
                  {user.email ?? user.id}
                  {user.id === profile?.id ? (
                    <span className="ml-2 text-xs text-slate-400">(you)</span>
                  ) : null}
                </p>
                <p className="text-xs capitalize text-slate-400">
                  Joined{" "}
                  {new Date(user.created_at).toISOString().slice(0, 10)}
                </p>
              </div>

              {isOwner ? (
                <form action={updateUserRole} className="flex items-center gap-2">
                  <input type="hidden" name="user_id" value={user.id} />
                  <select
                    name="role"
                    defaultValue={user.role}
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
                <span className="text-xs font-medium capitalize text-slate-600">
                  {user.role}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
