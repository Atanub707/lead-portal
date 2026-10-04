"use client";

import { useRef } from "react";
import { switchWorkspace } from "@/lib/actions";

// Super-admin only: switch which workspace the app views. Selecting another
// workspace puts the app in read-only mode for that workspace, and every
// navigation is logged into that workspace's audit trail.
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  viewingId,
}: {
  workspaces: { id: string; name: string }[];
  currentId: string;
  viewingId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const viewing = viewingId !== currentId;

  return (
    <form
      ref={formRef}
      action={switchWorkspace}
      className="border-b border-zinc-100 px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <select
          name="workspace_id"
          defaultValue={viewingId}
          onChange={() => formRef.current?.requestSubmit()}
          aria-label="View workspace"
          className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 text-[12px] text-zinc-700"
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
              {workspace.id === currentId ? " (mine)" : ""}
            </option>
          ))}
        </select>
        {viewing ? (
          <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700">
            Read-only
          </span>
        ) : null}
      </div>
      {viewing ? (
        <p className="mt-1 text-[10px] text-zinc-400">
          Viewing another workspace — actions are logged.
        </p>
      ) : null}
    </form>
  );
}
