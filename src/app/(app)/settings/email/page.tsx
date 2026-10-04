import { EmailSettingsForm } from "@/components/email-settings-form";
import { getMyEmailSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const settings = await getMyEmailSettings();

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Email sending
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Send outreach from your own mailbox. Only you can see these settings.
        </p>
      </header>

      <div className="mt-6">
        <EmailSettingsForm initial={settings} />
      </div>
    </div>
  );
}
