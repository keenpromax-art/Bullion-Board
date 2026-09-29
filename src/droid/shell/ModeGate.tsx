"use client";

// Client-side mode gate mounted on `/` (root). Phone + non-terminal mode →
// the droid surface. Desktop or Terminal Mode → the existing shell, untouched.
//
// Escape hatches (documented in AGENTS.md):
//   ?mode=terminal  → force the full terminal, even on a phone
//   ?mode=droid     → force the droid, even on a desktop
// A `?mode=` param also persists the choice, so `?mode=terminal` is sticky
// and a later bare `/` visit keeps the terminal.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { droidStore } from "../lib/droidStore";

export default function ModeGate() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/") return;
    try {
      if (!window.matchMedia) return;

      // Explicit override wins over both the width gate and the stored mode.
      const forced = new URLSearchParams(window.location.search).get("mode");
      if (forced === "terminal") {
        droidStore.setMode("terminal");
        return;
      }
      if (forced === "droid") {
        router.replace("/home");
        return;
      }
      if (droidStore.getMode() === "terminal") return;
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      router.replace("/home");
    } catch {
      /* no gate */
    }
  }, [pathname, router]);

  return null;
}
