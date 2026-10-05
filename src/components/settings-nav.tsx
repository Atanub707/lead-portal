"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; ownerOnly?: boolean }[] = [
  { href: "/settings", label: "General" },
  { href: "/settings/members", label: "Members" },
  { href: "/settings/pipelines", label: "Pipelines", ownerOnly: true },
  { href: "/settings/email", label: "Email & SMTP" },
];

export function SettingsNav({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="mt-5 flex items-center gap-5 border-b border-zinc-200"
    >
      {TABS.filter((tab) => !tab.ownerOnly || isOwner).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] transition-colors ${
              active
                ? "border-zinc-900 font-medium text-zinc-900"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
