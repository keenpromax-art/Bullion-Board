"use client";

import { useEffect, useState } from "react";
import { FALLBACK_MODELS, type FreeModel } from "@/lib/ai";

// The live free-model catalogue, shared by every picker (terminal Settings desk,
// the /settings page, and the AI chat dock) so they cannot disagree about which
// models exist.
//
// This lives apart from lib/ai.ts on purpose. That module also exports the
// prompts and the chat helpers, which the SERVER routes import, so marking it
// "use client" to host a hook would break /api/ai/chat and /api/ai/chart — and
// dropping the hook inside it without that mark fails the build outright
// ("importing a component that needs useState ... none of its parents are marked
// with use client"). The boundary is real, so the hook gets its own module.
//
// Behaviour that matters:
//  - FALLBACK FIRST. The snapshot renders immediately, so a picker is never empty
//    and never blocks on a network round trip.
//  - Then it swaps in the live list. A previously selected model that is still
//    present is preserved; one that has LEFT the free tier is left selected
//    rather than silently rewritten, because the user may have chosen it
//    deliberately on a paid tier.
//  - The catalogue is cached 24h server-side, so repeated mounts cost nothing.

export function useFreeModels(): { models: FreeModel[]; live: boolean; loading: boolean } {
  const [models, setModels] = useState<FreeModel[]>(FALLBACK_MODELS);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/ai/models");
        const j = await r.json();
        const rows: FreeModel[] = Array.isArray(j?.models) ? j.models : [];
        if (!alive) return;
        if (rows.length) {
          setModels(rows);
          setLive(true);
        }
      } catch {
        /* the snapshot above is the fallback; a failed refresh is not worth surfacing */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return { models, live, loading };
}