"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

function NavItem({
  href,
  label,
  active,
  icon: Icon,
  collapsed = false,
  onNavigate,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={`flex h-8 items-center rounded-md text-[13px] transition-colors ${
        collapsed ? "justify-center px-0" : "gap-2 px-2"
      } ${
        active
          ? "bg-zinc-100 font-medium text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      {collapsed ? null : label}
      {collapsed ? <span className="sr-only">{label}</span> : null}
    </Link>
  );
}

export function SidebarNav({
  isOwner,
  collapsed = false,
  onNavigate,
}: {
  isOwner: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const list = searchParams.get("list") ?? "pos";
  const inCompanies = pathname.startsWith("/companies");

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
      <NavItem
        href="/dashboard"
        label="Dashboard"
        icon={LayoutDashboard}
        active={pathname === "/dashboard"}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />

      {collapsed ? (
        <div className="mx-1 my-2.5 border-t border-zinc-200/80" />
      ) : (
        <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
          Pipelines
        </p>
      )}
      <NavItem
        href="/companies?list=pos"
        label="POS"
        icon={Building2}
        active={inCompanies && list !== "compliance"}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <NavItem
        href="/companies?list=compliance"
        label="Compliance"
        icon={ShieldCheck}
        active={inCompanies && list === "compliance"}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />

      {isOwner ? (
        <>
          {collapsed ? (
            <div className="mx-1 my-2.5 border-t border-zinc-200/80" />
          ) : (
            <p className="px-2 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Admin
            </p>
          )}
          <NavItem
            href="/settings"
            label="Settings"
            icon={Settings}
            active={pathname.startsWith("/settings")}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </>
      ) : null}
    </nav>
  );
}
