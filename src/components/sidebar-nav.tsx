"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { NewPipelineButton } from "@/components/new-pipeline-dialog";
import { pipelineIcon } from "@/components/pipeline-icon";
import type { Pipeline } from "@/lib/types";

// Instant feedback on click: a small pulsing dot on the item being navigated
// to, so the app never feels stuck even when the server render takes a moment.
function NavHint({ collapsed }: { collapsed: boolean }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden="true"
      className={`nav-hint ${collapsed ? "absolute right-0.5 top-0.5" : "ml-auto"} ${
        pending ? "nav-hint-pending" : ""
      }`}
    />
  );
}

function NavItem({
  href,
  label,
  active,
  icon: Icon,
  collapsed = false,
  onNavigate,
  prefetch = true,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: LucideIcon;
  collapsed?: boolean;
  onNavigate?: () => void;
  prefetch?: boolean | "auto";
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={`relative flex h-8 items-center rounded-md text-[13px] transition duration-150 active:scale-[0.98] ${
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
      <NavHint collapsed={collapsed} />
    </Link>
  );
}

export function SidebarNav({
  isOwner,
  pipelines,
  collapsed = false,
  onNavigate,
}: {
  isOwner: boolean;
  pipelines: Pipeline[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const list = searchParams.get("list") ?? pipelines[0]?.id ?? "pos";
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

      {pipelines.map((pipeline) => (
        <NavItem
          key={pipeline.id}
          href={`/companies?list=${pipeline.id}`}
          label={pipeline.name.replace(/\s+Pipeline$/i, "")}
          icon={pipelineIcon(pipeline.icon)}
          active={inCompanies && list === pipeline.id}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      ))}

      {isOwner ? <NewPipelineButton collapsed={collapsed} /> : null}

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
            prefetch="auto"
          />
          <NavItem
            href="/audit"
            label="Audit"
            icon={ScrollText}
            active={pathname.startsWith("/audit")}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        </>
      ) : null}
    </nav>
  );
}
