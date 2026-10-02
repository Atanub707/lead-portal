import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
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

  return (
    <Shell
      isOwner={profile?.role === "owner"}
      email={user.email ?? ""}
      role={profile?.role ?? "editor"}
    >
      {children}
    </Shell>
  );
}
