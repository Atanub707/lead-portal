import Link from "next/link";
import { redirect } from "next/navigation";
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

  return (
    <div className="min-h-screen lg:flex">
      <aside className="flex flex-col bg-slate-900 lg:w-60 lg:shrink-0">
        <div className="border-b border-slate-800 px-5 py-5">
          <Link
            href="/dashboard"
            className="text-base font-semibold tracking-tight text-white"
          >
            Lead Portal
          </Link>
          <p className="mt-0.5 text-[11px] text-slate-500">
            POS + Compliance pipelines
          </p>
        </div>

        <SidebarNav isOwner={isOwner} />

        <div className="border-t border-slate-800 px-5 py-4">
          <p className="truncate text-xs text-slate-400">{user.email}</p>
          <p className="text-[11px] capitalize text-slate-500">
            {profile?.role ?? "editor"}
          </p>
          <form action={signOut} className="mt-2">
            <button className="text-xs text-slate-400 transition-colors hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 bg-slate-50">{children}</main>
    </div>
  );
}
