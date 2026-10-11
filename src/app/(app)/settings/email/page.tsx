import { EmailSettingsForm } from "@/components/email-settings-form";
import { getMyEmailSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

const FREE_MAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
];

export default async function EmailSettingsPage() {
  const settings = await getMyEmailSettings();
  const fromDomain =
    settings.from_email?.split("@")[1]?.toLowerCase() ??
    settings.smtp_user?.split("@")[1]?.toLowerCase() ??
    null;
  const isFreeMailbox = fromDomain ? FREE_MAIL_DOMAINS.includes(fromDomain) : false;

  return (
    <div>
      <header>
        <h2 className="text-[15px] font-semibold tracking-tight text-zinc-900">
          Email & SMTP
        </h2>
        <p className="mt-0.5 text-[12px] text-zinc-500">
          Connect your mailbox to send outreach. Only you can see these
          settings.
        </p>
      </header>

      {isFreeMailbox ? (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-800"
        >
          You&apos;re sending from a free mailbox (@{fromDomain}). Cold
          outreach from free addresses usually lands in spam — use a mailbox
          on a domain you own (with SPF, DKIM and DMARC set up) for the best
          inbox placement.
        </p>
      ) : null}

      <div className="mt-5">
        <EmailSettingsForm initial={settings} />
      </div>

      <section className="card mt-5 p-5">
        <h3 className="text-[13px] font-semibold text-zinc-900">
          Deliverability tips
        </h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[12px] leading-relaxed text-zinc-600">
          <li>
            <strong>Send from a domain you own</strong> (e.g.
            atanu@yourdomain.com). Free mailboxes (gmail.com, outlook.com) get
            filtered for cold outreach — set up SPF, DKIM and DMARC on your
            domain.
          </li>
          <li>
            <strong>Warm up slowly</strong> — 10–20 sends/day in the first
            weeks. The app caps you at 30/day per mailbox.
          </li>
          <li>
            <strong>Prefer people over role inboxes</strong> — info@,
            contacto@, admon@ addresses are filtered heavily. Use Deep Research
            to find the decision maker&apos;s own email.
          </li>
          <li>
            <strong>Keep first emails plain</strong> — short, no links, no
            images, one clear question. The composer already keeps drafts lean.
          </li>
          <li>
            <strong>Personalise the first line</strong> — the flavors (e.g.
            insight-first) do this from the company&apos;s real website data.
          </li>
        </ul>
      </section>
    </div>
  );
}
