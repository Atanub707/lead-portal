import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { TrialBanner } from "@/components/trial-banner";
import { logActivity, shouldLogSuperadminView } from "@/lib/activity";
import {
  activeWorkspaceId,
  getAllWorkspaces,
  getPipelines,
  getWorkspaceContext,
} from "@/lib/data";
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

  const isSuperAdmin = profile.is_super_admin;
  const [pipelines, context] = await Promise.all([
    getPipelines(),
    getWorkspaceContext(),
  ]);

  let viewedWorkspaceId = profile.workspace_id;
  let workspaces: { id: string; name: string }[] = [];
  if (isSuperAdmin) {
    const [viewed, all] = await Promise.all([
      activeWorkspaceId(),
      getAllWorkspaces(),
    ]);
    viewedWorkspaceId = viewed;
    workspaces = all.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
    }));
  }

  const viewingCustomer =
    isSuperAdmin && viewedWorkspaceId !== profile.workspace_id;
  if (viewingCustomer && shouldLogSuperadminView(profile.id, viewedWorkspaceId)) {
    await logActivity({
      actorId: profile.id,
      workspaceId: viewedWorkspaceId,
      action: "superadmin.view",
      targetType: "workspace",
      targetId: viewedWorkspaceId,
      summary: "HI Labs viewed this workspace",
      details: { via: "navigation" },
    });
  }

  const workspace = context?.workspace;

  return (
    <Shell
      userId={profile.id}
      isOwner={profile.role === "owner"}
      email={profile.email ?? ""}
      role={profile.role}
      pipelines={pipelines}
      switcher={
        isSuperAdmin
          ? {
              workspaces,
              currentId: profile.workspace_id,
              viewingId: viewedWorkspaceId,
            }
          : null
      }
      banner={
        viewingCustomer ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-[12px] text-rose-800">
            Viewing another workspace — read-only. Every visit is logged.
          </div>
        ) : workspace ? (
          <TrialBanner
            trialDaysLeft={context?.trialDaysLeft ?? null}
            trialEnded={context?.trialEnded ?? false}
          />
        ) : null
      }
    >
      {children}
    </Shell>
  );
}
