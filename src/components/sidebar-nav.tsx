"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function NavItem({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center rounded-lg px-3 py-2 transition-colors ${
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
      }`}
    >
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
    <nav className="flex-1 space-y-1 px-3 py-4 text-sm">
      <NavItem
        href="/dashboard"
        label="Dashboard"
        active={pathname === "/dashboard"}
      />
      <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Pipelines
      </p>
      <NavItem
        href="/companies?list=pos"
        label="POS"
        active={inCompanies && list !== "compliance"}
      />
      <NavItem
        href="/companies?list=compliance"
        label="Compliance"
        active={inCompanies && list === "compliance"}
      />
      {isOwner ? (
        <>
          <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Admin
          </p>
          <NavItem
            href="/settings"
            label="Settings"
            active={pathname.startsWith("/settings")}
          />
        </>
      ) : null}
    </nav>
  );
}
