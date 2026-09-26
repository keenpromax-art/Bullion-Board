"use client";

// Data table (spec §26): dense tables are NOT the primary mobile interface —
// the stacked metric view renders inline, "VIEW TABLE →" opens a full-screen
// horizontal-scroll sheet.

import { useState } from "react";
import Sheet from "./Sheet";

export default function DataTable({
  head,
  rows,
  caption,
  note,
  stacked,
}: {
  head: string[];
  rows: Array<Array<string | number | null>>;
  caption?: string;
  note?: string;
  /** Optional stacked rows shown inline on phones (metric-first, §26). */
  stacked?: Array<{ label: string; value: string }>;
}) {
  const [open, setOpen] = useState(false);

  const table = (
    <div className="dx-tablewrap">
      <table className="dx-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c === null || c === undefined || (typeof c === "number" && !isFinite(c)) ? "—" : c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="dx-card">
      {caption ? <div className="p-head">{caption}</div> : null}
      {stacked && stacked.length ? (
        <div>
          {stacked.map((s, i) => (
            <div className="dx-metric" key={i}>
              <span className="dx-ml">{s.label}</span>
              <span className="dx-mv">{s.value}</span>
            </div>
          ))}
        </div>
      ) : (
        table
      )}
      <div style={{ marginTop: 10 }}>
        <button className="dx-btn dx-ghost" onClick={() => setOpen(true)}>
          VIEW TABLE →
        </button>
      </div>
      {note ? <div className="dx-note">{note}</div> : null}

      <Sheet open={open} onClose={() => setOpen(false)} title={caption ?? "TABLE"}>
        <div style={{ overflowX: "auto", touchAction: "pan-x" }}>
          <table className="dx-table" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>
                      {c === null || c === undefined || (typeof c === "number" && !isFinite(c)) ? "—" : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {note ? <div className="dx-note">{note}</div> : null}
      </Sheet>
    </div>
  );
}
