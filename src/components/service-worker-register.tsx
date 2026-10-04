"use client";

import { useEffect } from "react";

// Registers the PWA service worker (production only). The worker caches
// immutable build assets and leaves all live data on the network.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure only affects installability, never the app.
    });
  }, []);
  return null;
}
