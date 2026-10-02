"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { toggleBookmark } from "@/lib/actions";

export function BookmarkToggle({
  orgId,
  bookmarked,
}: {
  orgId: number;
  bookmarked: boolean;
}) {
  const [on, setOn] = useState(bookmarked);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);
    startTransition(async () => {
      const result = await toggleBookmark(orgId, next);
      if (!result.ok) setOn(!next);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? "Remove bookmark" : "Bookmark this company"}
      title={on ? "Bookmarked" : "Bookmark"}
      className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-zinc-100 disabled:opacity-60"
    >
      <Star
        className={`h-3.5 w-3.5 ${
          on ? "fill-amber-400 text-amber-400" : "text-zinc-300"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
