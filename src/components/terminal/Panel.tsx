"use client";

import { Component, useEffect, useRef, useState } from "react";
import { PSEUDO_DESKS } from "@/lib/terminal/functionKeyMap";
import { MODULE_MAP } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import type { PanelSpec } from "@/lib/terminal/workspaceStore";
import { parseTerminalCommand } from "@/lib/terminal/commandParser";
import DeskRenderer from "./DeskRenderer";
import FitBody from "./FitBody";

export function panelTitle(p: PanelSpec): string {
  if (PSEUDO_DESKS[p.funcId]) return PSEUDO_DESKS[p.funcId].label;
  const m = MODULE_MAP[p.funcId];
  return m ? m.label : p.funcId;
}

export function panelCode(p: PanelSpec): string {
  if (PSEUDO_DESKS[p.funcId]) return p.funcId;
  return funcCode(p.funcId);
}

// One bad desk must never blank the whole workspace — contain the crash
// to its panel with a retry path.
class PanelErrorBoundary extends Component<{ label: string; children: React.ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : "render failed" };
  }
  componentDidCatch() { /* contained per-panel; nothing global to report */ }
  render() {
    if (this.state.err) {
      return (
        <div>
          <p className="neg">DESK ERR: {this.state.err}</p>
          <button className="ghost" onClick={() => this.setState({ err: null })}>RETRY</button>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{this.props.label} · RIGHT-CLICK HEADER TO CHANGE FUNCTION</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Panel({
  spec,
  index,
  focused,
  maximized,
  showNumber,
  onFocus,
  onClose,
  onMaximize,
  onChange,
  onDuplicate,
  onDetach,
}: {
  spec: PanelSpec;
  index: number;
  focused: boolean;
  maximized: boolean;
  showNumber: boolean;
  onFocus: () => void;
  onClose: () => void;
  onMaximize: () => void;
  onChange: (next: PanelSpec) => void;
  onDuplicate: () => void;
  onDetach: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mini, setMini] = useState(`${spec.symbol ? spec.symbol.replace(".NS", "") : ""} ${panelCode(spec)}`.trim());
  const [miniErr, setMiniErr] = useState("");
  const [zoomPct, setZoomPct] = useState(1);
  const menuRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMini(`${spec.symbol ? spec.symbol.replace(".NS", "") : ""} ${panelCode(spec)}`.trim()); }, [spec.symbol, spec.funcId]);
  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setMenu(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [menu]);
  useEffect(() => { if (editing) miniRef.current?.focus(); }, [editing]);

  function applyMini() {
    const p = parseTerminalCommand(mini);
    if (!p.funcId && !p.ticker && p.unknown) {
      setMiniErr(`UNKNOWN “${p.unknown}” — TRY: TICKER FNC`);
      return;
    }
    setMiniErr("");
    setEditing(false);
    onChange({
      ...spec,
      funcId: p.funcId ?? spec.funcId,
      symbol: p.ticker ?? spec.symbol,
      task: null,
    });
  }

  const title = panelTitle(spec);
  const zoomMode = spec.zoomMode ?? "fit";

  function toggleZoom() {
    onChange({ ...spec, zoomMode: zoomMode === "fit" ? "full" : "fit" });
  }

  return (
    <section
      className={`term-panel${focused ? " focused" : ""}${maximized ? " maximized" : ""}`}
      onMouseDown={onFocus}
      onFocus={onFocus}
      aria-label={`Panel ${index + 1}: ${title} ${spec.symbol}`}
      data-panel-id={spec.id}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "SECTION") onFocus();
      }}
    >
      <header
        className="term-panel-head"
        onDoubleClick={onMaximize}
        onContextMenu={(e) => { e.preventDefault(); onFocus(); setMenu(true); }}
        draggable={false}
        title="Double-click to maximize · right-click for actions · drag to reorder"
      >
        <span className="cmd-mark" aria-hidden>▮</span>
        <span className="term-panel-title">{title}</span>
        {spec.symbol ? (
          <>
            <span className="term-panel-sep">|</span>
            <span className="term-panel-sym">{spec.symbol}</span>
          </>
        ) : null}
        <span className="term-panel-sp" />
        <button
          className="term-icon zoom-toggle"
          title={zoomMode === "fit" ? `FIT ${Math.round(zoomPct * 100)}% — CLICK FOR 1:1 + SCROLL` : "1:1 — CLICK TO FIT PANEL"}
          aria-label="Toggle fit to panel"
          onClick={(e) => { e.stopPropagation(); toggleZoom(); }}
        >
          {zoomMode === "fit" ? `${Math.round(zoomPct * 100)}%` : "1:1"}
        </button>
        <button className="term-icon" title={maximized ? "Restore (Ctrl+M)" : "Maximize (Ctrl+M)"} aria-label="Maximize panel" onClick={(e) => { e.stopPropagation(); onMaximize(); }}>▢</button>
        <button className="term-icon danger" title="Close panel (Ctrl+W)" aria-label="Close panel" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
        {menu && (
          <div ref={menuRef} className="term-menu" role="menu" aria-label="Panel actions">
            <button role="menuitem" onClick={() => { setMenu(false); onChange({ ...spec, funcId: "DIR", task: null }); }}>⌂ BACK TO MENU (DIR)</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDuplicate(); }}>⧉ DUPLICATE PANEL</button>
            <button role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>✎ CHANGE FUNCTION…</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDetach(); }}>⇪ DETACH TO NEW PANEL</button>
            <button role="menuitem" onClick={() => { setMenu(false); onMaximize(); }}>{maximized ? "⧉ RESTORE" : "▢ MAXIMIZE"}</button>
            <button role="menuitem" className="danger" onClick={() => { setMenu(false); onClose(); }}>✕ CLOSE</button>
          </div>
        )}
      </header>
      {editing && (
        <div className="term-minirow">
          <span className="cmd-prompt" aria-hidden>&gt;</span>
          <input
            ref={miniRef}
            value={mini}
            onChange={(e) => setMini(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") applyMini();
              if (e.key === "Escape") { setEditing(false); setMiniErr(""); }
            }}
            onBlur={() => { setEditing(false); setMiniErr(""); }}
            placeholder="SYM FNC"
            aria-label="Change panel symbol and function"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      )}
      {miniErr && <div className="term-mini-err" role="alert">{miniErr}</div>}
      {showNumber && <div className="term-expose" aria-hidden>{index + 1}</div>}
      <div className="term-panel-body">
        <div className="desk-fill">
          <PanelErrorBoundary key={`${spec.funcId}|${spec.symbol}|${spec.task ?? ""}`} label={title}>
            <FitBody mode={zoomMode} onZoom={setZoomPct}>
              <DeskRenderer
                funcId={spec.funcId} symbol={spec.symbol} task={spec.task}
                onOpen={(f, s) => onChange({ ...spec, funcId: f, symbol: s, task: null })}
                onExpand={() => onChange({ ...spec, task: null })}
              />
            </FitBody>
          </PanelErrorBoundary>
        </div>
      </div>
    </section>
  );
}
