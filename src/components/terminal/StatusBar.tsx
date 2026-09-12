"use client";

import { MODULES } from "@/lib/modules";
import { useClock } from "@/components/TerminalChrome";
import type { TilingPreset } from "@/lib/terminal/workspaceStore";

const LAYOUTS: Array<{ id: TilingPreset; label: string }> = [
  { id: "1-up", label: "1-UP" },
  { id: "2-up-v", label: "2-UP" },
  { id: "2-up-h", label: "2-H" },
  { id: "4-up", label: "4-UP" },
];

export default function StatusBar({
  panelCount,
  workspaceSlot,
  layout,
  onLayout,
  onAdd,
  focusLabel,
  ticker,
}: {
  panelCount: number;
  workspaceSlot: React.ReactNode;
  layout: TilingPreset;
  onLayout: (l: TilingPreset) => void;
  onAdd: () => void;
  focusLabel: string | null;
  ticker?: string;
}) {
  const clock = useClock();
  return (
    <div className="statusbar term-status" role="status" aria-label="Terminal status">
      <span><span className="feed-dot" />YAHOO FEED · LIVE</span>
      <span className="dot hide-sm">|</span>
      <span className="hide-sm">{MODULES.length} FUNC</span>
      <span className="dot">|</span>
      <span>{panelCount} PANEL{panelCount === 1 ? "" : "S"} OPEN</span>
      <span className="dot">|</span>
      {workspaceSlot}
      {focusLabel && (
        <>
          <span className="dot hide-sm">|</span>
          <span className="hide-sm">FOCUS: {focusLabel}</span>
        </>
      )}
      {ticker && <span className="sec hide-sm">{ticker}</span>}
      <span style={{ flex: 1 }} />
      <select
        className="lay-sel"
        value={layout}
        onChange={(e) => onLayout(e.target.value as TilingPreset)}
        title="Tile layout"
        aria-label="Tile layout"
      >
        {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <button className="add-btn" onClick={onAdd} title="Add panel">+ PANEL</button>
      <span>{clock} IST</span>
    </div>
  );
}
