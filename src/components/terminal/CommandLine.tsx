"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WATCHLIST } from "@/lib/watchlist";
import { store } from "@/lib/store";
import {
  parseTerminalCommand,
  suggestFunctions,
  suggestSymbols,
  loadHistory,
  pushHistory,
  resolveFuncId,
  type FuncSuggestion,
  type SpecialCommand,
} from "@/lib/terminal/commandParser";
import { useClock } from "@/components/TerminalChrome";

const TICKER_RE = /^[A-Z0-9&.=\-^]+(\.(NS|BO))?$/;

export default function CommandLine({
  focusedLabel,
  feedOk,
  onSubmit,
  inputRef,
}: {
  focusedLabel: string;
  feedOk: boolean | null;
  onSubmit: (ticker: string | null, funcId: string | null, openNew: boolean, raw: string, special: SpecialCommand) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const [cmd, setCmd] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [hi, setHi] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [flash, setFlash] = useState<"ok" | "err" | null>(null);
  const clock = useClock();
  const localRef = useRef<HTMLInputElement>(null);
  const effectiveRef = inputRef ?? localRef;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setHist(loadHistory()); }, []);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  function bump(kind: "ok" | "err") {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 450);
  }

  const parts = useMemo(() => cmd.toUpperCase().split(/[\s,;]+/).filter(Boolean), [cmd]);
  const universe = useMemo(() => {
    try {
      const w = store.getWatchlist();
      return w.length > 0 ? w : WATCHLIST.slice(0, 400);
    } catch { return WATCHLIST.slice(0, 400); }
  }, []);
  const uniSet = useMemo(() => new Set(universe), [universe]);
  const fnQuery = useMemo(() => {
    if (parts.length === 0) return "";
    if (parts.length === 1) return parts[0];
    return parts[1] === "NEW" ? parts[0] : parts[1];
  }, [parts]);
  const symQuery = useMemo(() => {
    if (parts.length === 0) return "";
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

  // BBG-style segmented echo: securities yellow, functions amber, flags dim.
  function echo(text: string): React.ReactNode {
    const segs = text.split(/(\s+)/);
    let first = true;
    return segs.map((tok, i) => {
      if (/^\s*$/.test(tok) || tok === "") return <span key={i}>{tok}</span>;
      let cls = "echo-plain";
      if (tok === "NEW") cls = "echo-dim";
      else if (tok === "?" || tok === "MENU" || tok === "CANCEL" || tok === "HELP") cls = "echo-fn";
      else if (resolveFuncId(tok)) cls = "echo-fn";
      else if (TICKER_RE.test(tok) && /[A-Z]/.test(tok) && (first || uniSet.has(tok) || /\./.test(tok) || tok.startsWith("^"))) cls = "echo-sym";
      first = false;
      return <span key={i} className={cls}>{tok}</span>;
    });
  }

  function submit(shiftNew: boolean) {
    const raw = cmd.trim();
    if (!raw) return;
    if (raw === "?") { setShowHelp(true); return; }
    const p = parseTerminalCommand(raw, shiftNew);
    if (p.special === "HELP") { setShowHelp(true); return; }
    if (p.special === "MENU" || p.special === "CANCEL") {
      const next = pushHistory(hist, raw);
      setHist(next);
      setHistIdx(-1);
      setHi(0);
      setCmd("");
      bump("ok");
      onSubmit(null, null, p.openNew, raw, p.special);
      return;
    }
    if (p.unknown && !p.ticker && !p.funcId) {
      setCmd(`? ${p.unknown} — UNKNOWN. TRY: TICKER FNC, E.G. RELIANCE STRAT`);
      bump("err");
      return;
    }
    const next = pushHistory(hist, raw + (p.openNew && !raw.toUpperCase().endsWith(" NEW") ? " NEW" : ""));
    setHist(next);
    setHistIdx(-1);
    setHi(0);
    setCmd("");
    bump("ok");
    onSubmit(p.ticker, p.funcId, p.openNew, raw, null);
  }

  function applyRow(r: Row) {
    if (r.kind === "sym" && r.sym) {
      const rest = parts.slice(1).join(" ");
      setCmd(rest ? `${r.sym} ${rest} ` : `${r.sym} `);
    } else if (r.kind === "fn" && r.fn) {
      const first = parts[0] ?? "";
      const hasSym = symSugs.includes(first) || (TICKER_RE.test(first) && /[A-Z]/.test(first));
      const sym = parts.length > 0 && hasSym ? first : "";
      setCmd(sym ? `${sym} ${r.fn.code} ` : `${r.fn.code} `);
    }
    (effectiveRef as React.RefObject<HTMLInputElement>).current?.focus();
    setHi(0);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open || rows.length === 0) {
        e.preventDefault();
        if (hist.length === 0) return;
        const next = e.key === "ArrowUp"
          ? Math.min(histIdx + 1, hist.length - 1)
          : Math.max(histIdx - 1, -1);
        setHistIdx(next);
        setCmd(next === -1 ? "" : hist[next]);
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
    <div className={`cmdbar term-cmdbar${flash === "ok" ? " go-ok" : flash === "err" ? " go-err" : ""}`}>
      <span className="cmd-prompt" aria-hidden>&gt;</span>
      <div className="cmd-field">
        <div className="cmd-echo" aria-hidden>
          {cmd ? echo(cmd) : <span className="cmd-ph">TICKER FNC &lt;GO&gt;</span>}
        </div>
        <input
          ref={effectiveRef as any}
          data-cmdline="true"
          className="cmd-input cmd-live"
          value={cmd}
          onChange={(e) => { setCmd(e.target.value.toUpperCase()); setHi(0); setHistIdx(-1); }}
          onKeyDown={onKey}
          onBlur={() => setTimeout(() => setHi(0), 150)}
          aria-label="Terminal command line"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="cmd-right">
        {focusedLabel && <span className="fn-tag" title="Focused panel function">{focusedLabel}</span>}
        <span className="cmd-feed" title={feedOk === false ? "Last fetch errored or stale" : "Data fresh"}>
          <span className="feed-dot" style={feedOk === false ? { background: "var(--red)", boxShadow: "0 0 6px var(--red)" } : feedOk === null ? { background: "var(--amber)", boxShadow: "0 0 6px var(--amber)" } : undefined} />
          FEED · {feedOk === false ? "STALE" : feedOk === null ? "SYNC" : "LIVE"}
        </span>
        <span className="cmd-clock">{clock} IST</span>
      </div>

      {showHelp && (
        <div className="suggest term-helpbox" role="dialog" aria-label="Command help">
          <div className="sug-head">COMMAND SYNTAX{focusedLabel ? ` — FOCUSED: ${focusedLabel}` : ""}</div>
          <div className="sug-row"><span className="sug-sym">SYM FNC + ENTER</span><span className="sug-name">REPLACE FOCUSED PANEL — E.G. RELIANCE STRAT</span></div>
          <div className="sug-row"><span className="sug-sym">SYM FNC + SHIFT+ENTER</span><span className="sug-name">OPEN IN NEW PANEL (OR APPEND “ NEW”)</span></div>
          <div className="sug-row"><span className="sug-sym">FNC / ID + ENTER</span><span className="sug-name">REUSE FOCUSED SYMBOL — E.G. STRAT · 70 · OCH</span></div>
          <div className="sug-row"><span className="sug-sym">SYM + ENTER</span><span className="sug-name">REOPEN LAST FNC FOR SYM (ELSE DIRECTORY)</span></div>
          <div className="sug-row"><span className="sug-sym fn">MENU + ENTER</span><span className="sug-name">BACK TO FUNCTION DIRECTORY (SHIFT+ENTER = NEW PANEL)</span></div>
          <div className="sug-row"><span className="sug-sym fn">CANCEL + ENTER</span><span className="sug-name">CLOSE FOCUSED PANEL (CONFIRMS IF LAST)</span></div>
          <div className="sug-row"><span className="sug-sym">` OR CTRL+K</span><span className="sug-name">FOCUS HERE · ESC CLEARS · ↑↓ HISTORY (50 KEPT)</span></div>
          <div className="sug-row"><span className="sug-sym fn">F1–F12</span><span className="sug-name">FUNCTION-KEY BAR MAP (CLICK OR PHYSICAL KEY)</span></div>
          <button className="ghost" style={{ margin: 12 }} onClick={() => setShowHelp(false)}>CLOSE ✕ (ESC)</button>
        </div>
      )}

      {open && rows.length > 0 && !showHelp && (
        <div className="suggest" role="listbox" aria-label="Command suggestions">
          {rows.some((r) => r.kind === "sym") && <div className="sug-head">SECURITIES — TAB/ENTER TO COMPLETE</div>}
          {rows.filter((r) => r.kind === "sym").map((r) => {
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
          <div className="sug-row"><span className="sug-meta">ENTER = COMPLETE · SHIFT+ENTER = NEW PANEL DIRECTLY · ↑↓ HISTORY WHEN CLOSED · HELP = THIS PANEL</span></div>
        </div>
      )}
    </div>
  );
}
