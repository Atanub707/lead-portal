"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

// Submit button with built-in pending feedback (spinner + disable).
export function SubmitButton({
  children,
  pendingText,
  className = "btn-primary",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={className}
    >
      {pending ? (
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : null}
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
