"use client";

// ⓘ "Explain this" (spec §15) — taps straight into the existing Explain
// sheet, regardless of desktop hover-mode, with the metric's context attached.

import { useExplain } from "@/components/Explain";
import type { ExplainContext } from "@/lib/explain";

export default function ExplainChip({
  term,
  ctx,
  size = 14,
}: {
  term: string;
  ctx?: ExplainContext;
  size?: number;
}) {
  const { open } = useExplain();
  return (
    <button
      type="button"
      className="dx-chip-x"
      aria-label={`What is ${term}?`}
      title={`WHAT IS ${term.toUpperCase()}?`}
      style={{ fontSize: size }}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        open(term, ctx ?? {}, r);
      }}
    >
      ⓘ
    </button>
  );
}
