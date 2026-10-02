"use client";

import { useState, useTransition } from "react";
import { updateUserRole } from "@/lib/actions";
import type { UserRole } from "@/lib/types";

export function RoleSelect({
  userId,
  role,
}: {
  userId: string;
  role: UserRole;
}) {
  const [current, setCurrent] = useState<UserRole>(role);
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={current}
      disabled={pending}
      aria-label="Role"
      onChange={(event) => {
        const next = event.target.value as UserRole;
        const previous = current;
        setCurrent(next);
        startTransition(async () => {
          const result = await updateUserRole(userId, next);
          if (!result.ok) setCurrent(previous);
        });
      }}
      className="input h-7 w-[96px] px-2 py-0 text-[12px] disabled:opacity-60"
    >
      <option value="editor">Editor</option>
      <option value="owner">Owner</option>
    </select>
  );
}
