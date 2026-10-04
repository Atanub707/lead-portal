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
  const profile = await ensureProfile();

  if (!profile) {
    redirect("/sign-in");
  }
  // Signed in but not in a workspace yet → create-your-workspace onboarding.
  if (!profile.workspace_id) {
    redirect("/onboarding");
  }

  const pipelines = await getPipelines();

  return (
    <Shell
      userId={profile.id}
      isOwner={profile.role === "owner"}
      email={profile.email ?? ""}
      role={profile.role}
      pipelines={pipelines}
    >
      {children}
    </Shell>
  );
}
