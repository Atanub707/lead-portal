import { SettingsNav } from "@/components/settings-nav";
import { getCurrentProfile } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: LayoutProps<"/settings">) {
  const profile = await getCurrentProfile();
  const isOwner = profile?.role === "owner";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
        Settings
      </h1>
      <SettingsNav isOwner={isOwner} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
