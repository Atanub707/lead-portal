import { EmailSettingsForm } from "@/components/email-settings-form";
import { getMyEmailSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const settings = await getMyEmailSettings();

  return (
    <div className="max-w-[880px]">
      <header>
        <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Email & SMTP
        </h2>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Connect your mailbox to send outreach. Only you can see these
          settings.
        </p>
      </header>

      <div className="mt-5">
        <EmailSettingsForm initial={settings} />
      </div>
    </div>
  );
}
