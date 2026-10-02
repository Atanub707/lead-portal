import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";
import { signOut } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  const isOwner = profile?.role === "owner";
  const initial = (user.email ?? "?").charAt(0).toUpperCase();

  return (
    <div className="min-h-dvh lg:flex">
      <aside className="flex w-full flex-col border-b border-zinc-200 bg-[#fafafa] lg:sticky lg:top-0 lg:h-dvh lg:w-[220px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-bold text-white">
            L
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-zinc-900">
              Lead Portal
            </p>
            <p className="truncate text-[11px] text-zinc-500 capitalize">
              {profile?.role ?? "editor"}
            </p>
          </div>
        </div>

        <SidebarNav isOwner={isOwner} />

        <div className="border-t border-zinc-200/80 px-3 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
              {initial}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-zinc-500">
              {user.email}
            </p>
            <form action={signOut}>
              <button
                type="submit"
                title="Sign out"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
