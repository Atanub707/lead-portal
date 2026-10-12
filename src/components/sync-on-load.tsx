"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Kicks a mailbox sync once when the page mounts, then re-renders the server
// side if anything new arrived. Failures stay quiet here — the settings card
// surfaces sync problems.
export function SyncOnLoad() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/email/sync", { method: "POST" })
      .then((response) => response.json())
      .then((data: { ok?: boolean }) => {
        if (!cancelled && data.ok) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
