"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2 } from "lucide-react";
import { AVATAR_PRESETS } from "@/lib/types";
import { isCustomAvatar, UserAvatar } from "@/components/badges";
import { uploadAvatar } from "@/lib/actions";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

// Crop the picked image to a centred square and downscale to 256×256 JPEG so
// every avatar — preset or custom — renders at the same size everywhere.
async function squareDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    256,
    256
  );
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

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
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (PNG, JPEG, or WebP).");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("That image is too large — 8 MB max.");
      return;
    }
    setError("");
    startUpload(async () => {
      try {
        const dataUrl = await squareDataUrl(file);
        const result = await uploadAvatar(dataUrl);
        if (!result.ok || !result.url) {
          setError(result.error ?? "Upload failed.");
          return;
        }
        setSelected(result.url);
        router.refresh();
      } catch {
        setError("Couldn't read that image.");
      }
    });
  }

  const tile = (active: boolean) =>
    `rounded-full transition-shadow ${
      active ? "ring-2 ring-zinc-900 ring-offset-2" : "hover:opacity-80"
    }`;

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
          className={tile(selected === null)}
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
            className={tile(selected === preset.id)}
          >
            <UserAvatar avatar={preset.id} size={32} />
          </button>
        ))}
        {isCustomAvatar(selected) ? (
          <button
            type="button"
            role="radio"
            aria-checked
            title="Your photo"
            className={tile(true)}
          >
            <UserAvatar avatar={selected} size={32} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload your own photo"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-800 disabled:opacity-60"
        >
          {uploading ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span className="sr-only">Upload your own photo</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickFile}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[11px] text-rose-700">
          {error}
        </p>
      ) : (
        <p className="mt-1.5 text-[11px] text-zinc-400">
          {uploading
            ? "Uploading…"
            : "Shown next to your name everywhere. “Automatic” picks one for you — or upload your own photo."}
        </p>
      )}
    </div>
  );
}
