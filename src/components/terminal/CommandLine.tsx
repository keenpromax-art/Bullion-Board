"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODULES } from "@/lib/modules";
import { WATCHLIST } from "@/lib/watchlist";
import { store } from "@/lib/store";
import {
  parseTerminalCommand,
  suggestFunctions,
  suggestSymbols,
  loadHistory,
  pushHistory,
  type FuncSuggestion,
} from "@/lib/terminal/commandParser";
import { useClock } from "@/components/TerminalChrome";

export default function CommandLine({
  focusedLabel,
  feedOk,
  onSubmit,
  inputRef,
}: {
  focusedLabel: string;
  feedOk: boolean | null;
  onSubmit: (ticker: string | null, funcId: string | null, openNew: boolean, raw: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [cmd, setCmd] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [hi, setHi] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const clock = useClock();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = (inputRef as React.RefObject<HTMLInputElement>) ?? localRef;
  const effectiveRef = inputRef ?? localRef;

  useEffect(() => { setHist(loadHistory()); }, []);

  const parts = useMemo(() => cmd.toUpperCase().split(/[\s,;]+/).filter(Boolean), [cmd]);
  // Heuristic: first token that looks like a symbol universe hit is the
  // symbol; the function query is the other token (or the only token).
  const universe = useMemo(() => {
    try {
      const w = store.getWatchlist();
      return w.length > 0 ? w : WATCHLIST.slice(0, 400);
    } catch { return WATCHLIST.slice(0, 400); }
  }, []);
  const fnQuery = useMemo(() => {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return parts[1] === "NEW" ? parts[0] : parts[1];
  }, [parts]);
  const symQuery = useMemo(() => {
    if (parts.length === 0) return "";
    if (parts.length === 1) {
      // Single token: could be either — show both lists.
      return parts[0];
    }
    return parts[0];
  }, [parts]);

  const fnSugs: FuncSuggestion[] = useMemo(() => suggestFunctions(fnQuery, 8), [fnQuery]);
  const symSugs: string[] = useMemo(() => suggestSymbols(symQuery, universe, 6), [symQuery, universe]);

  type Row = { kind: "sym" | "fn"; sym?: string; fn?: FuncSuggestion };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (parts.length <= 1) {
      symSugs.forEach((s) => out.push({ kind: "sym", sym: s }));
      fnSugs.forEach((f) => out.push({ kind: "fn", fn: f }));
    } else {
      fnSugs.forEach((f) => out.push({ kind: "fn", fn: f }));
      symSugs.slice(0, 3).forEach((s) => out.push({ kind: "sym", sym: s }));
    }
    return out.slice(0, 12);
  }, [symSugs, fnSugs, parts.length]);

  const open = cmd.trim().length > 0 && !showHelp;

  function submit(shiftNew: boolean) {
    const raw = cmd.trim();
    if (!raw) return;
    if (raw === "?" || raw.toUpperCase() === "HELP") { setShowHelp(true); return; }
    const p = parseTerminalCommand(raw, shiftNew);
    if (p.unknown && !p.ticker && !p.funcId) {
      setCmd(`? ${p.unknown} — UNKNOWN. TRY: TICKER FNC, E.G. RELIANCE STRAT`);
      return;
    }
    const next = pushHistory(hist, raw + (p.openNew && !raw.toUpperCase().endsWith(" NEW") ? " NEW" : ""));
    setHist(next);
    setHistIdx(-1);
    setHi(0);
    setCmd("");
    onSubmit(p.ticker, p.funcId, p.openNew, raw);
  }

  function applyRow(r: Row) {
    if (r.kind === "sym" && r.sym) {
      const rest = parts.slice(1).join(" ");
      setCmd(rest ? `${r.sym} ${rest} ` : `${r.sym} `);
    } else if (r.kind === "fn" && r.fn) {
      const first = parts[0] ?? "";
      const hasSym = symSugs.includes(first) || /^[A-Z0-9&.=\-^]+(\.(NS|BO))?$/.test(first);
      const sym = parts.length > 0 && hasSym ? first : "";
      setCmd(sym ? `${sym} ${r.fn.code} ` : `${r.fn.code} `);
    }
    (effectiveRef as React.RefObject<HTMLInputElement>).current?.focus();
    setHi(0);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.key === "ArrowDown" && hist.length > 0 && !open) {
        // History cycle when closed: Down moves forward.
      }
      if (!open || rows.length === 0) {
        // Up/Down cycles history when dropdown closed.
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          if (hist.length === 0) return;
          const next = e.key === "ArrowUp"
            ? Math.min(histIdx + 1, hist.length - 1)
            : Math.max(histIdx - 1, -1);
          setHistIdx(next);
          setCmd(next === -1 ? "" : hist[next]);
        }
        return;
      }
      e.preventDefault();
      setHi((h) => (e.key === "ArrowDown" ? (h + 1) % rows.length : (h - 1 + rows.length) % rows.length));
      return;
    }
    if (e.key === "Enter") {
      if (e.shiftKey) { e.preventDefault(); submit(true); return; }
      if (open && rows[hi]) { e.preventDefault(); applyRow(rows[hi]); return; }
      submit(false);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (showHelp) { setShowHelp(false); return; }
      setCmd("");
      setHistIdx(-1);
      (effectiveRef as React.RefObject<HTMLInputElement>).current?.blur();
      return;
    }
    if (e.key === "Tab" && open && rows.length > 0) {
      e.preventDefault();
      applyRow(rows[hi] ?? rows[0]);
    }
  }

  return (
    <div className="cmdbar term-cmdbar">
      <a className="cmd-logo" href="/terminal" title="Terminal home">
        <span className="cmd-mark">▮</span>BULLION&nbsp;BOARD
      </a>
      <a href="/" className="term-home" title="Function directory (classic)">DIR</a>
      <span className="cmd-prompt" aria-hidden>&gt;</span>
      <input
        ref={effectiveRef as any}
        data-cmdline="true"
        className="cmd-input"
        value={cmd}
        onChange={(e) => { setCmd(e.target.value.toUpperCase()); setHi(0); setHistIdx(-1); }}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => setHi(0), 150)}
        placeholder="SYMBOL FNC <GO> — E.G. RELIANCE STRAT · FNC ONLY REUSES FOCUSED PANEL · SHIFT+ENTER = NEW PANEL · ? = HELP"
        aria-label="Terminal command line"
        spellCheck={false}
        autoComplete="off"
      />
      <button className="term-help" onClick={() => setShowHelp((v) => !v)} title="Command help (?)" aria-label="Command help">?</button>
      <button className="cmd-go" onClick={() => submit(false)} title="GO (Enter) — Shift+click opens new panel" onAuxClick={() => submit(true)}>GO</button>
      <span className="cmd-feed" title={feedOk === false ? "Last fetch errored or stale" : "Data fresh"}>
        <span className="feed-dot" style={feedOk === false ? { background: "var(--red)", boxShadow: "0 0 6px var(--red)" } : feedOk === null ? { background: "var(--amber)", boxShadow: "0 0 6px var(--amber)" } : undefined} />
        {feedOk === false ? "STALE" : feedOk === null ? "SYNC" : "LIVE"}
      </span>
      <span className="cmd-clock">{clock}</span>
      {focusedLabel && <span className="fn-tag" title="Focused panel">{focusedLabel}</span>}

      {showHelp && (
        <div className="suggest term-helpbox" role="dialog" aria-label="Command help">
          <div className="sug-head">COMMAND SYNTAX</div>
          <div className="sug-row"><span className="sug-sym">SYM FNC + ENTER</span><span className="sug-name">REPLACE FOCUSED PANEL — E.G. RELIANCE STRAT</span></div>
          <div className="sug-row"><span className="sug-sym">SYM FNC + SHIFT+ENTER</span><span className="sug-name">OPEN IN NEW PANEL (OR APPEND “ NEW”)</span></div>
          <div className="sug-row"><span className="sug-sym">FNC + ENTER</span><span className="sug-name">REUSE FOCUSED PANEL SYMBOL — E.G. STRAT</span></div>
          <div className="sug-row"><span className="sug-sym">SYM + ENTER</span><span className="sug-name">REOPEN LAST FNC FOR SYM (ELSE EQUITY OVERVIEW)</span></div>
          <div className="sug-row"><span className="sug-sym">` OR CTRL+K</span><span className="sug-name">FOCUS HERE · ESC CLEARS · ↑↓ HISTORY (50 KEPT)</span></div>
          <div className="sug-row"><span className="sug-sym fn">F1–F12</span><span className="sug-name">FUNCTION-KEY BAR MAP (CLICK OR PHYSICAL KEY)</span></div>
          <button className="ghost" style={{ margin: 12 }} onClick={() => setShowHelp(false)}>CLOSE ✕ (ESC)</button>
        </div>
      )}

      {open && rows.length > 0 && !showHelp && (
        <div className="suggest" role="listbox" aria-label="Command suggestions">
          {rows.some((r) => r.kind === "sym") && <div className="sug-head">SECURITIES — TAB/ENTER TO COMPLETE</div>}
          {rows.filter((r) => r.kind === "sym").map((r, i) => {
            const gi = rows.indexOf(r);
            return (
              <div key={`s${r.sym}`} role="option" aria-selected={gi === hi}
                className={`sug-row${gi === hi ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); applyRow(r); }}>
                <span className="sug-sym">{r.sym}</span>
                <span className="sug-name">SECURITY</span>
                <span className="sug-meta">SYM</span>
              </div>
            );
          })}
          {rows.some((r) => r.kind === "fn") && <div className="sug-head">FUNCTIONS — CODE · DESK · CATEGORY</div>}
          {rows.filter((r) => r.kind === "fn").map((r) => {
            const gi = rows.indexOf(r);
            return (
              <div key={`f${r.fn!.id}`} role="option" aria-selected={gi === hi}
                className={`sug-row${gi === hi ? " active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); applyRow(r); }}>
                <span className="sug-sym fn">{r.fn!.code} &lt;GO&gt;</span>
                <span className="sug-name">{r.fn!.label.toUpperCase()}</span>
                <span className="sug-meta">{r.fn!.category.toUpperCase()}</span>
              </div>
            );
          })}
          <div className="sug-row"><span className="sug-meta">ENTER = COMPLETE · SHIFT+ENTER = NEW PANEL DIRECTLY · ↑↓ HISTORY WHEN CLOSED</span></div>
        </div>
      )}
    </div>
  );
}
