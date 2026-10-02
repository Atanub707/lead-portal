"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LayoutDashboard, Settings, type LucideIcon } from "lucide-react";
import { NewPipelineButton } from "@/components/new-pipeline-dialog";
import { pipelineIcon } from "@/components/pipeline-icon";
import type { Pipeline } from "@/lib/types";

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
          />
        </>
      ) : null}
    </nav>
  );
}
