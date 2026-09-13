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
import type { PanelSpec, PanelSplits, TilingPreset } from "@/lib/terminal/workspaceStore";
import Panel from "./Panel";

function clampRatio(v: number): number {
  return Math.min(0.8, Math.max(0.2, v));
}

export default function PanelWorkspace({
  panels,
  layout,
  focusedId,
  maximizedId,
  showNumbers,
  splits,
  onFocus,
  onClose,
  onMaximize,
  onChange,
  onDuplicate,
  onDetach,
  onReorder,
  onOpenNew,
  onSplits,
}: {
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
  maximizedId: string | null;
  showNumbers: boolean;
  splits: PanelSplits;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMaximize: (id: string) => void;
  onChange: (id: string, next: PanelSpec) => void;
  onDuplicate: (id: string) => void;
  onDetach: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onOpenNew: (fromId: string, funcId: string, symbol: string) => void;
  onSplits: (next: PanelSplits) => void;
}) {
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<"col" | "row" | null>(null);
  const [splitActive, setSplitActive] = useState<"col" | "row" | null>(null);

  // Inline track sizes so panels are draggable (stylesheet holds the
  // defaults for 1-up / maximized, which have no divider).
  function gridStyle(): React.CSSProperties | undefined {
    if (layout === "2-up-v") return { gridTemplateColumns: `${splits.col}fr ${1 - splits.col}fr` };
    if (layout === "2-up-h") return { gridTemplateRows: `minmax(0,${splits.row}fr) minmax(0,${1 - splits.row}fr)` };
    if (layout === "4-up") return {
      gridTemplateColumns: `${splits.col}fr ${1 - splits.col}fr`,
      gridTemplateRows: `minmax(0,${splits.row}fr) minmax(0,${1 - splits.row}fr)`,
    };
    return undefined;
  }

  function splitMove(e: React.PointerEvent) {
    const axis = splitDrag.current;
    const el = gridRef.current;
    if (!axis || !el) return;
    const r = el.getBoundingClientRect();
    if (axis === "col" && r.width > 0) onSplits({ ...splits, col: clampRatio((e.clientX - r.left) / r.width) });
    if (axis === "row" && r.height > 0) onSplits({ ...splits, row: clampRatio((e.clientY - r.top) / r.height) });
  }

  function endSplit() {
    splitDrag.current = null;
    setSplitActive(null);
  }

  function splitKey(axis: "col" | "row") {
    return (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (axis === "col" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onSplits({ ...splits, col: clampRatio(splits.col + (e.key === "ArrowRight" ? step : -step)) });
      }
      if (axis === "row" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        onSplits({ ...splits, row: clampRatio(splits.row + (e.key === "ArrowDown" ? step : -step)) });
      }
    };
  }

  function divider(axis: "col" | "row", pos: number) {
    const vertical = axis === "col";
    return (
      <div
        className={`term-split-${vertical ? "v" : "h"}${splitActive === axis ? " active" : ""}`}
        style={vertical ? { left: `calc(${(pos * 100).toFixed(2)}% - 4px)` } : { top: `calc(${(pos * 100).toFixed(2)}% - 4px)` }}
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={vertical ? "Resize panel columns" : "Resize panel rows"}
        tabIndex={0}
        title="DRAG TO RESIZE PANELS"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          splitDrag.current = axis;
          setSplitActive(axis);
        }}
        onPointerMove={splitMove}
        onPointerUp={endSplit}
        onPointerCancel={endSplit}
        onLostPointerCapture={endSplit}
        onKeyDown={splitKey(axis)}
      />
    );
  }

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
            onOpenNew={(f, s) => onOpenNew(p.id, f, s)}
          />
        </div>
      );
    }
  }

  return (
    <div className="term-grid" data-layout={layout} ref={gridRef} style={gridStyle()}>
      {(layout === "2-up-v" || layout === "4-up") && divider("col", splits.col)}
      {(layout === "2-up-h" || layout === "4-up") && divider("row", splits.row)}
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
              onOpenNew={(f, s) => onOpenNew(p.id, f, s)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
