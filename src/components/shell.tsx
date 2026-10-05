"use client";

import { useEffect, useState } from "react";
import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { SidebarNav } from "@/components/sidebar-nav";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { UserAvatar } from "@/components/badges";
import type { Pipeline } from "@/lib/types";
import { signOut } from "@/lib/actions";

const STORAGE_KEY = "tl-sidebar-collapsed";

function UserBlock({
  userId,
  email,
  role,
  avatar = null,
  collapsed = false,
}: {
  userId: string;
  email: string;
  role: string;
  avatar?: string | null;
  collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-3">
        <UserAvatar seed={userId} name={email} avatar={avatar} size={24} />
        <form action={signOut}>
          <ConfirmSubmit
            title="Sign out?"
            message="You'll be returned to the sign-in page. Use your invitation link or ask the owner to get back in."
            confirmLabel="Sign out"
            tone="neutral"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Sign out</span>
          </ConfirmSubmit>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <UserAvatar seed={userId} name={email} avatar={avatar} size={24} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-zinc-600">{email}</p>
        <p className="text-[11px] capitalize text-zinc-400">{role}</p>
      </div>
      <form action={signOut}>
        <ConfirmSubmit
          title="Sign out?"
          message="You'll be returned to the sign-in page. Use your invitation link or ask the owner to get back in."
          confirmLabel="Sign out"
          tone="neutral"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Sign out</span>
        </ConfirmSubmit>
      </form>
    </div>
  );
}

export function Shell({
  userId,
  isOwner,
  email,
  role,
  avatar = null,
  pipelines,
  switcher = null,
  banner = null,
  children,
}: {
  userId: string;
  isOwner: boolean;
  email: string;
  role: string;
  avatar?: string | null;
  pipelines: Pipeline[];
  switcher?: {
    workspaces: { id: string; name: string }[];
    currentId: string;
    viewingId: string;
  } | null;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount; avoids a hydration mismatch
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // storage unavailable — keep default
    }
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setCollapsed((prev) => {
          const next = !prev;
          try {
            localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          } catch {
            // ignore
          }
          return next;
        });
      }
      if (event.key === "Escape") {
        setMobileOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    <div>
      {/* Desktop sidebar — fixed, collapsible */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-zinc-200 bg-[#fafafa] lg:flex ${
          collapsed ? "w-16" : "w-[220px]"
        }`}
      >
        <div
          className={`flex h-14 shrink-0 items-center border-b border-zinc-200/80 ${
            collapsed ? "justify-center px-2" : "gap-2.5 px-4"
          }`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-bold text-white">
            L
          </span>
          {collapsed ? null : (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-zinc-900">
                  Lead Portal
                </p>
                <p className="truncate text-[11px] capitalize text-zinc-500">
                  {role}
                </p>
              </div>
              <button
                onClick={toggleCollapsed}
                title="Collapse sidebar (⌘B)"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Collapse sidebar</span>
              </button>
            </>
          )}
        </div>

        {collapsed ? (
          <button
            onClick={toggleCollapsed}
            title="Expand sidebar (⌘B)"
            className="mx-auto mt-2 flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Expand sidebar</span>
          </button>
        ) : null}

        {collapsed ? null : switcher ? (
          <WorkspaceSwitcher
            workspaces={switcher.workspaces}
            currentId={switcher.currentId}
            viewingId={switcher.viewingId}
          />
        ) : null}

        <SidebarNav isOwner={isOwner} pipelines={pipelines} collapsed={collapsed} />

        <div className="shrink-0 border-t border-zinc-200/80">
          <UserBlock
            userId={userId}
            email={email}
            role={role}
            avatar={avatar}
            collapsed={collapsed}
          />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="text-[13px] font-semibold text-zinc-900">
          Lead Portal
        </span>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-zinc-900/30"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-[240px] flex-col border-r border-zinc-200 bg-[#fafafa]">
            <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-zinc-200/80 px-4">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-bold text-white">
                L
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-900">
                Lead Portal
              </p>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <SidebarNav
              isOwner={isOwner}
              pipelines={pipelines}
              onNavigate={() => setMobileOpen(false)}
            />
            <div className="shrink-0 border-t border-zinc-200/80">
              <UserBlock userId={userId} email={email} role={role} avatar={avatar} />
            </div>
          </div>
        </div>
      ) : null}

      {/* Content — offset by the fixed sidebar */}
      <main
        className={`min-h-dvh min-w-0 ${
          collapsed ? "lg:pl-16" : "lg:pl-[220px]"
        }`}
      >
        {banner}
        {children}
      </main>
    </div>
  );
}
