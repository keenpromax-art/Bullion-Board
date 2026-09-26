"use client";

// Registers the hand-rolled service worker (PWA phase). Production only —
// dev builds must never be cached.

import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const id = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support unavailable — app still works online */
      });
    }, 1200);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
