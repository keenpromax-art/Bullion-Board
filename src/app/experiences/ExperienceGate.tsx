"use client";

// Sends `/` to the Guided face when — and only when — the reader chose it.
//
// Two gates already live on `/`, and the order between them is deliberate:
//
//   ExperienceGate  experience is GUIDED or HYBRID -> go to /g
//   ModeGate        mode is droid (legacy)         -> go to /home
//
// ExperienceGate runs first because choosing Guided is a deliberate, current
// decision, while droid-mode is the older phone fallback. Both are no-ops for a
// desktop on Pro, which is why `/` still renders the terminal by default and
// nobody is redirected out of a face they did not pick.
//
// The redirect waits one tick after mount, because the provider resolves the
// stored preference in its own effect. Firing earlier would read the default
// ("pro") as an answer and could bounce a Pro reader.

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useExperience } from "./ExperienceProvider";

export default function ExperienceGate() {
  const router = useRouter();
  const pathname = usePathname();
  const { experience } = useExperience();
  const [settled, setSettled] = useState(false);

  useEffect(() => setSettled(true), []);

  useEffect(() => {
    if (pathname !== "/" || !settled) return;
    if (experience === "guided" || experience === "hybrid") router.replace("/g");
  }, [pathname, experience, settled, router]);

  return null;
}