import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { getPipelines } from "@/lib/data";
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

  const [{ data: profile }, pipelines] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    getPipelines(),
  ]);

  return (
    <Shell
      isOwner={profile?.role === "owner"}
      email={user.email ?? ""}
      role={profile?.role ?? "editor"}
      pipelines={pipelines}
    >
      {children}
    </Shell>
  );
}
