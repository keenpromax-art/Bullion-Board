"use client";

import { FUNCTION_KEYS } from "@/lib/terminal/functionKeyMap";
import { MODULE_MAP } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";

function codeFor(funcId: string): string {
  if (MODULE_MAP[funcId]) return funcCode(funcId);
  return funcId;
}

export default function FunctionKeyBar({ onTrigger }: { onTrigger: (funcId: string, label: string) => void }) {
  return (
    <nav className="term-fkeys" aria-label="Function keys">
      {FUNCTION_KEYS.map((d) => (
        <button
          key={d.key}
          className="fkey"
          onClick={() => onTrigger(d.funcId, d.label)}
          title={`${d.key} — ${d.label} (${codeFor(d.funcId)})`}
          aria-label={`${d.key} ${d.label}`}
        >
          <span className="k">{d.key}</span>
          <span className="l">{d.label}</span>
          <span className="c">{codeFor(d.funcId)}</span>
        </button>
      ))}
    </nav>
  );
}
