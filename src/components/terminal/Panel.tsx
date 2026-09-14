"use client";

import { Component, useEffect, useRef, useState } from "react";
import { PSEUDO_DESKS } from "@/lib/terminal/functionKeyMap";
import { MODULE_MAP } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import type { PanelSpec } from "@/lib/terminal/workspaceStore";
import { parseTerminalCommand, resolveFuncId, suggestSymbols } from "@/lib/terminal/commandParser";
import { WATCHLIST } from "@/lib/watchlist";
import DeskRenderer, { SYMBOL_LESS } from "./DeskRenderer";

export function panelTitle(p: PanelSpec): string {
  if (PSEUDO_DESKS[p.funcId]) return PSEUDO_DESKS[p.funcId].label;
  const m = MODULE_MAP[p.funcId];
  return m ? m.label : p.funcId;
}

// Desks rendered as hosted-route iframes get an OPEN FULL shortcut in the
// panel header (beside the window controls) instead of an in-body label.
const FULL_HREF: Record<string, string> = {
  "101": "/portfolio",
  "102": "/alerts",
  "103": "/compare",
  "104": "/corr",
  "106": "/events",
  "107": "/breadth",
  "38": "/macro",
};

function fullHrefFor(spec: PanelSpec): string | null {
  const base = FULL_HREF[spec.funcId];
  if (!base) return null;
  return spec.symbol ? `${base}?symbol=${encodeURIComponent(spec.symbol)}` : base;
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

interface LookupRow { symbol: string; name: string; exch: string; type: string }

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
  onOpenNew,
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
  onOpenNew?: (funcId: string, symbol: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mini, setMini] = useState(`${spec.symbol ? spec.symbol.replace(".NS", "") : ""} ${panelCode(spec)}`.trim());
  const [miniErr, setMiniErr] = useState("");
  const [isFav, setIsFav] = useState(() => {
    try { return store.isFavorite(spec.funcId); } catch { return false; }
  });
  const menuRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLInputElement>(null);
  // Company autofill for the mini editor (SYM FNC): live Yahoo-backed
  // lookup on the first token, same source as the page command bar.
  const [secs, setSecs] = useState<LookupRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [sugHi, setSugHi] = useState(0);
  const [sugMoved, setSugMoved] = useState(false);
  const lookupSeq = useRef(0);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMini(`${spec.symbol ? spec.symbol.replace(".NS", "") : ""} ${panelCode(spec)}`.trim()); }, [spec.symbol, spec.funcId]);
  useEffect(() => {
    try { setIsFav(store.isFavorite(spec.funcId)); } catch { setIsFav(false); }
  }, [spec.funcId]);
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === "iss.favorites") {
        try { setIsFav(store.isFavorite(spec.funcId)); } catch { /* ignore */ }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [spec.funcId]);
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

  // Debounced company lookup while the mini editor is open. Local
  // watchlist matches show instantly (so NSE names like ADA → ADANIENT
  // appear even before/slow Yahoo); live lookup merges in on top.
  // Skips when the first token is already a function code (e.g. STRAT).
  useEffect(() => {
    if (!editing) {
      setSecs([]); setScanning(false); setSugMoved(false); setSugHi(0);
      return;
    }
    const first = (mini.split(/[\s,;]+/).filter(Boolean)[0] ?? "").toUpperCase();
    if (!first || resolveFuncId(first)) {
      setSecs([]); setScanning(false);
      return;
    }
    let local: LookupRow[] = [];
    try {
      const w = store.getWatchlist();
      const uni = w.length > 0 ? w : WATCHLIST;
      local = suggestSymbols(first, uni, 6).map((s) => ({
        symbol: s,
        name: s.replace(/\.NS$|\.BO$/, "").replace(/\^/g, "").replace(/=.*$/, ""),
        exch: s.endsWith(".BO") ? "BSE" : "NSE",
        type: "EQ",
      }));
    } catch { local = []; }
    setSecs(local);
    setSugHi(0);
    setScanning(true);
    const my = ++lookupSeq.current;
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup?q=${encodeURIComponent(first)}`);
        const j = await r.json();
        if (lookupSeq.current !== my) return;
        const rows = ((j.rows ?? []) as LookupRow[]).slice();
        const seen = new Set(rows.map((x) => x.symbol));
        for (const l of local) {
          if (rows.length >= 8) break;
          if (!seen.has(l.symbol)) { seen.add(l.symbol); rows.push(l); }
        }
        setSecs(rows.slice(0, 6));
        setSugHi(0);
      } catch {
        if (lookupSeq.current === my) setSecs(local);
      } finally {
        if (lookupSeq.current === my) setScanning(false);
      }
    }, 220);
    return () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); };
  }, [mini, editing]);

  function pickMiniSecurity(row: LookupRow) {
    const rest = mini.split(/[\s,;]+/).filter(Boolean).slice(1).join(" ");
    setMini(rest ? `${row.symbol} ${rest}` : `${row.symbol} `);
    lookupSeq.current++;
    setSecs([]); setSugMoved(false); setSugHi(0); setScanning(false);
    miniRef.current?.focus();
  }

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

  function toggleFav() {
    try {
      const next = store.toggleFavorite(spec.funcId);
      setIsFav(next.some((x) => x.toUpperCase() === spec.funcId.toUpperCase()));
    } catch { /* quota — ignore */ }
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
        {spec.symbol && !SYMBOL_LESS.has(spec.funcId) ? (
          <>
            <span className="term-panel-sep">|</span>
            <button
              type="button"
              className="term-panel-sym as-btn"
              title="Change ticker — click to edit symbol"
              aria-label={`Change ticker (current ${spec.symbol})`}
              onClick={(e) => { e.stopPropagation(); onFocus(); setEditing(true); }}
            >
              {spec.symbol}
            </button>
          </>
        ) : null}
        <span className="term-panel-sp" />
        {spec.funcId !== "DIR" && (
          <button className="term-icon" title="Back to directory (DIR)" aria-label="Back to directory" onClick={(e) => { e.stopPropagation(); onFocus(); onChange({ ...spec, funcId: "DIR", task: null }); }}>⌂</button>
        )}
        <button className={`term-icon fav${isFav ? " active" : ""}`} title={isFav ? "Remove from favorites (★)" : "Make favorite tile (☆)"} aria-label={isFav ? "Remove from favorites" : "Make favorite"} aria-pressed={isFav} onClick={(e) => { e.stopPropagation(); onFocus(); toggleFav(); }}>{isFav ? "★" : "☆"}</button>
        {fullHrefFor(spec) && (
          <a
            className="term-icon" href={fullHrefFor(spec) as string}
            title="Open full page (OPEN FULL →)" aria-label="Open full page"
            onClick={(e) => e.stopPropagation()}
            style={{ textDecoration: "none" }}
          >↗</a>
        )}
        <button className="term-icon" title={maximized ? "Restore (Ctrl+M)" : "Maximize (Ctrl+M)"} aria-label="Maximize panel" onClick={(e) => { e.stopPropagation(); onMaximize(); }}>▢</button>
        <button className="term-icon danger" title="Close panel (Ctrl+W)" aria-label="Close panel" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
        {menu && (
          <div ref={menuRef} className="term-menu" role="menu" aria-label="Panel actions">
            <button role="menuitem" onClick={() => { setMenu(false); onChange({ ...spec, funcId: "DIR", task: null }); }}>⌂ BACK TO MENU (DIR)</button>
            <button role="menuitem" onClick={() => { setMenu(false); toggleFav(); }}>{isFav ? "★ REMOVE FROM FAVORITES" : "☆ MAKE FAVORITE TILE"}</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDuplicate(); }}>⧉ DUPLICATE PANEL</button>
            <button role="menuitem" onClick={() => { setMenu(false); setEditing(true); }}>✎ CHANGE FUNCTION…</button>
            <button role="menuitem" onClick={() => { setMenu(false); onFocus(); onChange({ ...spec, funcId: "SET", task: null }); }}>⚙ OPEN SETTINGS DESK (SET)</button>
            <button role="menuitem" onClick={() => { setMenu(false); onDetach(); }}>⇪ DETACH TO NEW PANEL</button>
            <button role="menuitem" onClick={() => { setMenu(false); onMaximize(); }}>{maximized ? "⧉ RESTORE" : "▢ MAXIMIZE"}</button>
            <button role="menuitem" className="danger" onClick={() => { setMenu(false); onClose(); }}>✕ CLOSE</button>
          </div>
        )}
      </header>
      {editing && (
        <div style={{ position: "relative" }}>
          <div className="term-minirow">
            <span className="cmd-prompt" aria-hidden>&gt;</span>
            <input
              ref={miniRef}
              value={mini}
              onChange={(e) => { setMini(e.target.value.toUpperCase()); setSugHi(0); setSugMoved(false); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                const open = secs.length > 0;
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  if (!open) return;
                  e.preventDefault();
                  setSugMoved(true);
                  setSugHi((h) => (e.key === "ArrowDown" ? (h + 1) % secs.length : (h - 1 + secs.length) % secs.length));
                  return;
                }
                if (e.key === "Tab" && open) {
                  e.preventDefault();
                  pickMiniSecurity(secs[sugHi] ?? secs[0]);
                  return;
                }
                if (e.key === "Enter") {
                  if (open && sugMoved && secs[sugHi]) { e.preventDefault(); pickMiniSecurity(secs[sugHi]); return; }
                  applyMini();
                  return;
                }
                if (e.key === "Escape") {
                  if (open) { setSecs([]); setSugMoved(false); return; }
                  setEditing(false); setMiniErr("");
                }
              }}
              onBlur={() => { setEditing(false); setMiniErr(""); }}
              placeholder="SYM FNC — TYPE A COMPANY, TAB TO FILL"
              aria-label="Change panel symbol and function"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {secs.length > 0 && (
            <div className="suggest" role="listbox" aria-label="Company suggestions">
              <div className="sug-head">COMPANIES — ↑↓ + TAB/ENTER TO FILL · CLICK TO PICK</div>
              {secs.map((s, i) => (
                <div
                  key={s.symbol}
                  role="option"
                  aria-selected={i === sugHi}
                  className={`sug-row${i === sugHi ? " active" : ""}`}
                  onMouseDown={(ev) => { ev.preventDefault(); pickMiniSecurity(s); }}
                  onMouseEnter={() => { setSugHi(i); setSugMoved(true); }}
                >
                  <span className="sug-sym">{s.symbol}</span>
                  <span className="sug-name">{s.name}</span>
                  <span className="sug-meta">{s.exch} {s.type}</span>
                </div>
              ))}
            </div>
          )}
          {scanning && secs.length === 0 && (
            <div className="suggest" aria-hidden>
              <div className="sug-row"><span className="sug-meta">SCANNING COMPANIES…</span></div>
            </div>
          )}
        </div>
      )}
      {miniErr && <div className="term-mini-err" role="alert">{miniErr}</div>}
      {showNumber && <div className="term-expose" aria-hidden>{index + 1}</div>}
      <div className="term-panel-body">
        <div className="desk-fill">
          <PanelErrorBoundary key={`${spec.funcId}|${spec.symbol}|${spec.task ?? ""}`} label={title}>
            <DeskRenderer
              funcId={spec.funcId} symbol={spec.symbol} task={spec.task}
              onOpen={(f, s) => onChange({ ...spec, funcId: f, symbol: s, task: null })}
              onExpand={() => onChange({ ...spec, task: null })}
              onOpenNew={onOpenNew ? (f, s) => onOpenNew(f, s) : undefined}
            />
          </PanelErrorBoundary>
        </div>
      </div>
    </section>
  );
}
