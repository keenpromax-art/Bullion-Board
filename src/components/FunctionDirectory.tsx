"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ModuleInfo } from "@/lib/types";
import { funcCode } from "@/lib/terminal";
import { deskLink } from "@/lib/functionMenus";

// Function directory: dense FNC | DESK | DESCRIPTION table.
// Clicking a row opens its desk directly for the active ticker.
export default function FunctionDirectory({
  ticker,
  modules,
  total,
}: {
  ticker: string;
  modules: ModuleInfo[];
  total: number;
}) {
  const router = useRouter();

  const counts = useMemo(() => `${modules.length}/${total}`, [modules.length, total]);

  function open(mod: ModuleInfo) {
    router.push(deskLink(mod, ticker));
  }

  return (
    <div className="panel fndir-panel">
      <p className="p-head">
        Function directory — {counts}
        <span className="faint" style={{ fontWeight: 400 }}>
          {" "}
          · CLICK A ROW TO OPEN ITS DESK
        </span>
      </p>
      <table className="fntbl fndir">
        <thead>
          <tr>
            <th style={{ width: 72 }}>FNC</th>
            <th style={{ width: 300 }}>DESK</th>
            <th>DESCRIPTION</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => {
            const code = funcCode(m.id);
            return (
              <tr
                key={m.id}
                onClick={() => open(m)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(m);
                  }
                }}
                tabIndex={0}
                title={`${code} — OPEN ${m.label.toUpperCase()} FOR ${ticker}`}
              >
                <td className="fnc">{code}</td>
                <td className="desk">{m.label}</td>
                <td className="desc">{m.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {modules.length === 0 && <p className="muted">NO FUNCTIONS MATCH — CLEAR THE FILTER.</p>}
    </div>
  );
}
