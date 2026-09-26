"use client";

// Client-side mode gate mounted on `/` (root). Phone + non-terminal mode →
// the droid surface. Desktop or Terminal Mode → the existing shell, untouched.

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
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      if (droidStore.getMode() === "terminal") return;
      router.replace("/home");
    } catch {
      /* no gate */
    }
  }, [pathname, router]);

  return null;
}
