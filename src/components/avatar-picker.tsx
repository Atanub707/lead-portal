"use client";

import { useState } from "react";
import { AVATAR_PRESETS } from "@/lib/types";
import { UserAvatar } from "@/components/badges";

export function AvatarPicker({
  initial,
  userId,
  name,
}: {
  initial: string | null;
  userId: string;
  name: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(initial);

  return (
    <div>
      <input type="hidden" name="avatar" value={selected ?? ""} />
      <div
        role="radiogroup"
        aria-label="Display picture"
        className="mt-1.5 flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          role="radio"
          aria-checked={selected === null}
          onClick={() => setSelected(null)}
          title="Automatic"
          className={`rounded-full transition-shadow ${
            selected === null
              ? "ring-2 ring-zinc-900 ring-offset-2"
              : "hover:opacity-80"
          }`}
        >
          <UserAvatar seed={userId} name={name} size={32} />
        </button>
        {AVATAR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="radio"
            aria-checked={selected === preset.id}
            onClick={() => setSelected(preset.id)}
            title={preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}
            className={`rounded-full transition-shadow ${
              selected === preset.id
                ? "ring-2 ring-zinc-900 ring-offset-2"
                : "hover:opacity-80"
            }`}
          >
            <UserAvatar avatar={preset.id} size={32} />
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-400">
        Shown next to your name everywhere. “Automatic” picks one for you.
      </p>
    </div>
  );
}
