"use client";

// Tiling/dock manager.
//
// CHOICE + RATIONALE: hand-rolled CSS-grid presets (1-up, 2-up H/V, 4-up)
// with header-drag reorder — NO external dock library (rc-dock /
// golden-layout / react-grid-layout). Reasons: (1) zero new bundle/API
// surface — Vercel-parity build stays green with no new deps; (2) the
// workspace is a fixed split-pane grid like the mockup, not a free-form IDE
// dock — presets + per-panel maximize + reorder cover it; (3) desk
// components assume container width, not absolute dock coordinates, so grid
// keeps every desk's responsive rules intact. Layout switching lives in the
// status bar; panels are cheap — duplicate instead of tab-docking.

import { useRef, useState } from "react";
import type { PanelSpec, TilingPreset } from "@/lib/terminal/workspaceStore";
import Panel from "./Panel";

export default function PanelWorkspace({
  panels,
  layout,
  focusedId,
  maximizedId,
  showNumbers,
  onFocus,
  onClose,
  onMaximize,
  onChange,
  onDuplicate,
  onDetach,
  onReorder,
}: {
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
  maximizedId: string | null;
  showNumbers: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMaximize: (id: string) => void;
  onChange: (id: string, next: PanelSpec) => void;
  onDuplicate: (id: string) => void;
  onDetach: (id: string) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (maximizedId) {
    const idx = panels.findIndex((p) => p.id === maximizedId);
    const p = panels[idx];
    if (p) {
      return (
        <div className="term-grid" data-layout="max">
          <Panel
            spec={p} index={idx} focused showNumber={false} maximized
            onFocus={() => onFocus(p.id)} onClose={() => onClose(p.id)}
            onMaximize={() => onMaximize(p.id)} onChange={(n) => onChange(p.id, n)}
            onDuplicate={() => onDuplicate(p.id)} onDetach={() => onDetach(p.id)}
          />
        </div>
      );
    }
  }

  return (
    <div className="term-grid" data-layout={layout}>
      {panels.map((p, i) => (
        <div
          key={p.id}
          className={`term-cell${dragOver === i ? " dragover" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
          onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i);
            dragFrom.current = null;
            setDragOver(null);
          }}
        >
          <div
            draggable
            onDragStart={(e) => {
              const t = e.target as HTMLElement;
              if (!t.closest(".term-panel-head")) { e.preventDefault(); return; }
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => { dragFrom.current = null; setDragOver(null); }}
            style={{ display: "contents" }}
          >
            <Panel
              spec={p} index={i} focused={p.id === focusedId} maximized={false} showNumber={showNumbers}
              onFocus={() => onFocus(p.id)} onClose={() => onClose(p.id)}
              onMaximize={() => onMaximize(p.id)} onChange={(n) => onChange(p.id, n)}
              onDuplicate={() => onDuplicate(p.id)} onDetach={() => onDetach(p.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
