"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

function NavItem({
  href,
  label,
  active,
  icon: Icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className={`flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${
        active
          ? "bg-zinc-100 font-medium text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      {label}
    </Link>
  );
}

export function SidebarNav({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const list = searchParams.get("list") ?? "pos";
  const inCompanies = pathname.startsWith("/companies");

  return (
    <nav className="flex-1 space-y-0.5 px-2 py-3">
      <NavItem
        href="/dashboard"
        label="Dashboard"
        icon={LayoutDashboard}
        active={pathname === "/dashboard"}
      />
      <NavItem
        href="/assistant"
        label="AI Assistant"
        icon={Sparkles}
        active={pathname.startsWith("/assistant")}
      />
      <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
        Pipelines
      </p>
      <NavItem
        href="/companies?list=pos"
        label="POS"
        icon={Building2}
        active={inCompanies && list !== "compliance"}
      />
      <NavItem
        href="/companies?list=compliance"
        label="Compliance"
        icon={ShieldCheck}
        active={inCompanies && list === "compliance"}
      />
      {isOwner ? (
        <>
          <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            Admin
          </p>
          <NavItem
            href="/settings"
            label="Settings"
            icon={Settings}
            active={pathname.startsWith("/settings")}
          />
        </>
      ) : null}
    </nav>
  );
}
