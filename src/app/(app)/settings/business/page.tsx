import { BusinessProfileSettings } from "@/components/business-profile-settings";
import { getWorkspaceContext } from "@/lib/data";
import { getIntelligenceBundle } from "@/lib/intelligence-data";

export const dynamic = "force-dynamic";

export default async function SettingsBusinessPage() {
  const [bundle, workspaceCtx] = await Promise.all([
    getIntelligenceBundle(),
    getWorkspaceContext(),
  ]);

  const profile =
    bundle.profiles.find(
      (entry) => entry.id === bundle.icp?.business_profile_id
    ) ??
    bundle.profiles[0] ??
    null;

  return (
    <BusinessProfileSettings
      profile={profile}
      icp={bundle.icp}
      personas={bundle.personas}
      criteria={bundle.criteria}
      model={bundle.model}
      signals={bundle.signals}
      pipelines={bundle.pipelines}
      templates={bundle.templates}
      canWrite={workspaceCtx?.canWrite !== false}
    />
  );
}
