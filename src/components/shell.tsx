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
import { signOut } from "@/lib/actions";

const STORAGE_KEY = "tl-sidebar-collapsed";

function UserBlock({
  email,
  role,
  collapsed = false,
}: {
  email: string;
  role: string;
  collapsed?: boolean;
}) {
  const initial = (email || "?").charAt(0).toUpperCase();

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-3">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600"
          title={email}
        >
          {initial}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            title="Sign out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Sign out</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-zinc-600">{email}</p>
        <p className="text-[11px] capitalize text-zinc-400">{role}</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          title="Sign out"
          className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Sign out</span>
        </button>
      </form>
    </div>
  );
}

export function Shell({
  isOwner,
  email,
  role,
  children,
}: {
  isOwner: boolean;
  email: string;
  role: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
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

        <SidebarNav isOwner={isOwner} collapsed={collapsed} />

        <div className="shrink-0 border-t border-zinc-200/80">
          <UserBlock email={email} role={role} collapsed={collapsed} />
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
              onNavigate={() => setMobileOpen(false)}
            />
            <div className="shrink-0 border-t border-zinc-200/80">
              <UserBlock email={email} role={role} />
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
        {children}
      </main>
    </div>
  );
}
