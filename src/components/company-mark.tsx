"use client";

import { useState } from "react";
import { CompanyAvatar } from "@/components/badges";

function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// The company's real logo (favicon) when we know its website — a splash of
// colour in tables and headers. Falls back to the coloured initials tile.
export function CompanyMark({
  name,
  website,
  size = 18,
}: {
  name: string;
  website: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const domain = domainOf(website);

  if (domain && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-[5px] bg-white object-contain ring-1 ring-black/5"
        style={{ width: size, height: size }}
      />
    );
  }

  return <CompanyAvatar name={name} size={size >= 24 ? 24 : 20} />;
}
