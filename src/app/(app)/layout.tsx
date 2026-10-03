import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { getPipelines } from "@/lib/data";
import { ensureProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, pipelines] = await Promise.all([
    ensureProfile(),
    getPipelines(),
  ]);

  if (!profile) {
    redirect("/sign-in");
  }

  return (
    <Shell
      isOwner={profile.role === "owner"}
      email={profile.email ?? ""}
      role={profile.role}
      pipelines={pipelines}
    >
      {children}
    </Shell>
  );
}
