"use client";

// Tiling/dock manager.
//
// CHOICE + RATIONALE: hand-rolled CSS-grid presets (1-up, 2-up H/V, 4-up)
// with native `resize: both` drag handles + HTML5 header-drag reorder —
// NO external dock library (rc-dock / golden-layout / react-grid-layout).
// Reasons: (1) zero new bundle/API surface — Vercel-parity build stays green
// with no new deps; (2) real BBG workspaces here are fixed split-pane grids,
// not free-form IDE docks — presets + per-panel maximize + reorder cover the
// acceptance cases (2-up, 4-up, drag-resize, maximize/restore, close);
// (3) desk components assume container width, not absolute dock coordinates,
// so grid keeps every desk's responsive rules intact. Tab-groups-within-dock
// (rc-dock's strength) are deferred: panels are cheap — duplicate instead.

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
  onLayout,
  onAdd,
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
  onLayout: (l: TilingPreset) => void;
  onAdd: () => void;
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

  const presets: Array<{ id: TilingPreset; label: string }> = [
    { id: "1-up", label: "1-UP" },
    { id: "2-up-v", label: "2-UP ▮▮" },
    { id: "2-up-h", label: "2-UP ▬" },
    { id: "4-up", label: "4-UP ▦" },
  ];

  return (
    <div className="term-work">
      <div className="term-workbar" role="toolbar" aria-label="Layout">
        <span className="faint" style={{ fontSize: 11 }}>LAYOUT:</span>
        {presets.map((pr) => (
          <button key={pr.id} className={`pill${layout === pr.id ? " active" : ""}`} onClick={() => onLayout(pr.id)} title={`Tile ${pr.label}`}>
            {pr.label}
          </button>
        ))}
        <button className="ghost" style={{ padding: "6px 10px" }} onClick={onAdd} title="Add panel (Shift+Enter on command line also works)">+ PANEL</button>
        <span className="faint" style={{ fontSize: 11, marginLeft: "auto" }}>DRAG HEADER TO REORDER · CORNER HANDLE TO RESIZE · DOUBLE-CLICK HEADER TO MAXIMIZE</span>
      </div>
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
                // Only start reorder drags from the header grip.
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
    </div>
  );
}
