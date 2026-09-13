"use client";

// Tiling/dock manager.
//
// CHOICE + RATIONALE: hand-rolled split-pane presets (1-up, 2-up H/V, 4-up,
// 3-up-r / 3-up-l spanning layouts) with header-drag reorder — NO external
// dock library (rc-dock / golden-layout / react-grid-layout). Reasons: (1) zero new bundle/API
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
  const flexRef = useRef<HTMLDivElement>(null);
  const leftColRef = useRef<HTMLDivElement>(null);
  const rightColRef = useRef<HTMLDivElement>(null);
  const splitDrag = useRef<"col" | "row" | null>(null);
  const flexDrag = useRef<"col" | "rowL" | "rowR" | null>(null);
  const [splitActive, setSplitActive] = useState<"col" | "row" | null>(null);
  const [flexActive, setFlexActive] = useState<"col" | "rowL" | "rowR" | null>(null);

  const rowL = splits.row;
  const rowR = splits.row2 ?? splits.row;

  // Nested-flex layouts size each column's rows independently, so every
  // quadrant is resizable without moving the other side. Grid fallback
  // covers 1-up / 2-up and degenerate counts.
  const useFlex =
    layout === "4-up" ||
    ((layout === "3-up-r" || layout === "3-up-l") && panels.length <= 3);

  // Inline track sizes so panels are draggable (stylesheet holds the
  // defaults for 1-up / maximized, which have no divider).
  function gridStyle(): React.CSSProperties | undefined {
    if (layout === "2-up-v") return { gridTemplateColumns: `${splits.col}fr ${1 - splits.col}fr` };
    if (layout === "2-up-h") return { gridTemplateRows: `minmax(0,${splits.row}fr) minmax(0,${1 - splits.row}fr)` };
    if (layout === "4-up" || layout === "3-up-r" || layout === "3-up-l") return {
      gridTemplateColumns: `${splits.col}fr ${1 - splits.col}fr`,
      gridTemplateRows: `minmax(0,${splits.row}fr) minmax(0,${1 - splits.row}fr)`,
    };
    return undefined;
  }

  // Spanning placement: 3-up-r = left stack (0,1) + tall right (2);
  // 3-up-l = tall left (0) + right stack (1,2). Degenerate counts degrade
  // gracefully: 1 panel spans all, 2 panels sit side-by-side tall, 4+
  // panels fall back to plain 2x2 flow (same as 4-up).
  function cellStyle(i: number): React.CSSProperties | undefined {
    const n = panels.length;
    if (layout === "3-up-r") {
      if (n <= 1) return { gridColumn: "1 / span 2", gridRow: "1 / span 2" };
      if (n === 2) return i === 0 ? { gridColumn: "1", gridRow: "1 / span 2" } : { gridColumn: "2", gridRow: "1 / span 2" };
      if (n === 3) {
        if (i === 0) return { gridColumn: "1", gridRow: "1" };
        if (i === 1) return { gridColumn: "1", gridRow: "2" };
        return { gridColumn: "2", gridRow: "1 / span 2" };
      }
      return undefined;
    }
    if (layout === "3-up-l") {
      if (n <= 1) return { gridColumn: "1 / span 2", gridRow: "1 / span 2" };
      if (n === 2) return i === 0 ? { gridColumn: "1", gridRow: "1 / span 2" } : { gridColumn: "2", gridRow: "1 / span 2" };
      if (n === 3) {
        if (i === 0) return { gridColumn: "1", gridRow: "1 / span 2" };
        if (i === 1) return { gridColumn: "2", gridRow: "1" };
        return { gridColumn: "2", gridRow: "2" };
      }
      return undefined;
    }
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

  function flexMove(e: React.PointerEvent) {
    const kind = flexDrag.current;
    if (!kind) return;
    if (kind === "col") {
      const el = flexRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0) onSplits({ ...splits, col: clampRatio((e.clientX - r.left) / r.width) });
    } else {
      const el = kind === "rowL" ? leftColRef.current : rightColRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height <= 0) return;
      const v = clampRatio((e.clientY - r.top) / r.height);
      if (kind === "rowL") onSplits({ ...splits, row: v });
      else onSplits({ ...splits, row: splits.row, row2: v });
    }
  }

  function endFlex() {
    flexDrag.current = null;
    setFlexActive(null);
  }

  function flexKey(kind: "col" | "rowL" | "rowR") {
    return (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (kind === "col" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        onSplits({ ...splits, col: clampRatio(splits.col + (e.key === "ArrowRight" ? step : -step)) });
      }
      if (kind !== "col" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const d = e.key === "ArrowDown" ? step : -step;
        if (kind === "rowL") onSplits({ ...splits, row: clampRatio(splits.row + d) });
        else onSplits({ ...splits, row: splits.row, row2: clampRatio(rowR + d) });
      }
    };
  }

  function flexHandle(kind: "col" | "rowL" | "rowR") {
    const vertical = kind === "col";
    const label =
      kind === "col" ? "Resize left/right columns"
      : kind === "rowL" ? "Resize left top/bottom panels"
      : "Resize right top/bottom panels";
    return (
      <div
        className={`term-flex-${vertical ? "v" : "h"}${flexActive === kind ? " active" : ""}`}
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={label}
        tabIndex={0}
        title="DRAG TO RESIZE PANELS"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          flexDrag.current = kind;
          setFlexActive(kind);
        }}
        onPointerMove={flexMove}
        onPointerUp={endFlex}
        onPointerCancel={endFlex}
        onLostPointerCapture={endFlex}
        onKeyDown={flexKey(kind)}
      />
    );
  }

  function cell(i: number, basis?: string) {
    const p = panels[i];
    return (
      <div
        key={p ? p.id : `empty-${i}`}
        className={`term-cell${dragOver === i ? " dragover" : ""}${p ? "" : " empty"}`}
        style={basis ? { flex: `0 0 ${basis}`, minHeight: 0, minWidth: 0 } : undefined}
        onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
        onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
        onDrop={(e) => {
          e.preventDefault();
          if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i);
          dragFrom.current = null;
          setDragOver(null);
        }}
      >
        {p ? (
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
        ) : null}
      </div>
    );
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

  // Nested-flex render: each column's top/bottom split drags independently,
  // so all four quadrants are resizable without moving the other side.
  // Index mapping stays row-major ([0 TL, 1 TR, 2 BL, 3 BR]) like the old grid.
  if (useFlex) {
    const colBasis = `calc((100% - 9px) * ${splits.col})`;
    if (layout === "3-up-r") {
      if (panels.length <= 1) {
        return (
          <div className="term-flex" data-layout={layout} ref={flexRef}>
            <div className="term-col" ref={leftColRef} style={{ flex: "1 1 auto" }}>{cell(0)}</div>
          </div>
        );
      }
      if (panels.length === 2) {
        return (
          <div className="term-flex" data-layout={layout} ref={flexRef}>
            <div className="term-col" ref={leftColRef} style={{ flex: `0 0 ${colBasis}` }}>{cell(0)}</div>
            {flexHandle("col")}
            <div className="term-col" ref={rightColRef} style={{ flex: "1 1 auto" }}>{cell(1)}</div>
          </div>
        );
      }
      const topBasis = `calc((100% - 9px) * ${rowL})`;
      return (
        <div className="term-flex" data-layout={layout} ref={flexRef}>
          <div className="term-col" ref={leftColRef} style={{ flex: `0 0 ${colBasis}` }}>
            {cell(0, topBasis)}
            {flexHandle("rowL")}
            {cell(1)}
          </div>
          {flexHandle("col")}
          <div className="term-col" ref={rightColRef} style={{ flex: "1 1 auto" }}>
            {cell(2)}
          </div>
        </div>
      );
    }
    if (layout === "3-up-l") {
      if (panels.length <= 1) {
        return (
          <div className="term-flex" data-layout={layout} ref={flexRef}>
            <div className="term-col" ref={leftColRef} style={{ flex: "1 1 auto" }}>{cell(0)}</div>
          </div>
        );
      }
      if (panels.length === 2) {
        return (
          <div className="term-flex" data-layout={layout} ref={flexRef}>
            <div className="term-col" ref={leftColRef} style={{ flex: `0 0 ${colBasis}` }}>{cell(0)}</div>
            {flexHandle("col")}
            <div className="term-col" ref={rightColRef} style={{ flex: "1 1 auto" }}>{cell(1)}</div>
          </div>
        );
      }
      const topBasis = `calc((100% - 9px) * ${rowR})`;
      return (
        <div className="term-flex" data-layout={layout} ref={flexRef}>
          <div className="term-col" ref={leftColRef} style={{ flex: `0 0 ${colBasis}` }}>
            {cell(0)}
          </div>
          {flexHandle("col")}
          <div className="term-col" ref={rightColRef} style={{ flex: "1 1 auto" }}>
            {cell(1, topBasis)}
            {flexHandle("rowR")}
            {cell(2)}
          </div>
        </div>
      );
    }
    // 4-up (any count ≤ 4; missing slots render as empty fillers).
    const topL = `calc((100% - 9px) * ${rowL})`;
    const topR = `calc((100% - 9px) * ${rowR})`;
    return (
      <div className="term-flex" data-layout={layout} ref={flexRef}>
        <div className="term-col" ref={leftColRef} style={{ flex: `0 0 ${colBasis}` }}>
          {cell(0, topL)}
          {flexHandle("rowL")}
          {cell(2)}
        </div>
        {flexHandle("col")}
        <div className="term-col" ref={rightColRef} style={{ flex: "1 1 auto" }}>
          {cell(1, topR)}
          {flexHandle("rowR")}
          {cell(3)}
        </div>
      </div>
    );
  }

  return (
    <div className="term-grid" data-layout={layout} ref={gridRef} style={gridStyle()}>
      {(layout === "2-up-v") && divider("col", splits.col)}
      {(layout === "2-up-h") && divider("row", splits.row)}
      {panels.map((p, i) => (
        <div
          key={p.id}
          className={`term-cell${dragOver === i ? " dragover" : ""}`}
          style={cellStyle(i)}
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
