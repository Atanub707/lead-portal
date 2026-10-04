"use client";

import { useEffect, useRef, useState } from "react";
import { createWorkspace } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";

export function OnboardingForm() {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <form action={createWorkspace} className="mt-5 space-y-4">
      <div>
        <label htmlFor="workspace-name" className="label">
          Workspace name
        </label>
        <input
          ref={inputRef}
          id="workspace-name"
          name="name"
          required
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Acme Sales"
          className="input"
        />
      </div>
      <SubmitButton
        className="btn-primary w-full justify-center"
        pendingText="Creating…"
      >
        Create workspace
      </SubmitButton>
      <p className="text-[11px] leading-relaxed text-zinc-400">
        Your workspace is private to your team. Platform access is limited to
        support and is logged.
      </p>
    </form>
  );
}
