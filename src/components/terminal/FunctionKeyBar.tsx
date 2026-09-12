"use client";

import { FUNCTION_KEYS } from "@/lib/terminal/functionKeyMap";

// Fixed function-key bar (bottom, above status bar). Bottom-horizontal is
// closest to BBG's keyboard-row metaphor. Color-grouped loosely with the
// existing palette: amber = core equity/options, green = screeners/risk,
// yellow-outline = macro/news/AI.
function groupColor(category: string): string {
  if (category === "Technical" || category === "Options" || category === "Fundamental") return "fk-amber";
  if (category === "Screener" || category === "Risk") return "fk-green";
  return "fk-yellow";
}

export default function FunctionKeyBar({ onTrigger }: { onTrigger: (funcId: string, label: string) => void }) {
  return (
    <nav className="term-fkeys" aria-label="Function keys">
      {FUNCTION_KEYS.map((d) => (
        <button
          key={d.key}
          className={`fk ${groupColor(d.category)}`}
          onClick={() => onTrigger(d.funcId, d.label)}
          title={`${d.key} — ${d.label} (${d.funcId})`}
          aria-label={`${d.key} ${d.label}`}
        >
          <span className="fk-key">{d.key}</span>
          <span className="fk-label">{d.label}</span>
        </button>
      ))}
    </nav>
  );
}
