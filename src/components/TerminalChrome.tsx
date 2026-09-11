"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODULES, MODULE_MAP } from "@/lib/modules";
import { parseCommand, funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";

export function useClock(): string {
  const [now, setNow] = useState("--:--:--");
  useEffect(() => {
    const f = () => {
      const d = new Date();
      setNow(
        [d.getHours(), d.getMinutes(), d.getSeconds()]
          .map((n) => String(n).padStart(2, "0"))
          .join(":")
      );
    };
    f();
    const t = setInterval(f, 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

interface SecRow { symbol: string; name: string; exch: string; type: string }
interface FnRow { id: string; code: string; label: string }

function matchFunctions(q: string): FnRow[] {
  if (!q) return [];
  return MODULES.filter(
    (m) => funcCode(m.id) === q || funcCode(m.id).startsWith(q) || m.label.toUpperCase().includes(q)
  )
    .slice(0, 5)
    .map((m) => ({ id: m.id, code: funcCode(m.id), label: m.label.toUpperCase() }));
}

export function CommandBar({
  ticker,
  funcId,
  onTicker,
}: {
  ticker: string;
  funcId?: string;
  onTicker: (t: string) => void;
}) {
  const router = useRouter();
  const [cmd, setCmd] = useState("");
  const [secs, setSecs] = useState<SecRow[]>([]);
  const [fns, setFns] = useState<FnRow[]>(matchFunctions(""));
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [scanning, setScanning] = useState(false);
  const clock = useClock();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const flat: Array<{ kind: "sec" | "fn"; i: number }> = [
    ...secs.map((_, i) => ({ kind: "sec" as const, i })),
    ...fns.map((_, i) => ({ kind: "fn" as const, i })),
  ];

  function scheduleLookup(value: string) {
    if (timer.current) clearTimeout(timer.current);
    const first = value.split(/\s+/)[0] ?? "";
    if (!first || first.startsWith("?")) {
      setOpen(false); setSecs([]); setFns([]); setScanning(false);
      return;
    }
    setFns(matchFunctions(first));
    setOpen(true); setHi(0); setScanning(true);
    const my = ++seq.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup?q=${encodeURIComponent(first)}`);
        const j = await r.json();
        if (seq.current !== my) return;
        setSecs((j.rows ?? []) as SecRow[]);
      } catch {
        if (seq.current === my) setSecs([]);
      } finally {
        if (seq.current === my) setScanning(false);
      }
    }, 220);
  }

  function onChange(v: string) {
    setCmd(v.toUpperCase());
    scheduleLookup(v.toUpperCase());
  }

  function close() {
    setOpen(false); setHi(0);
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setScanning(false);
  }

  function pickSecurity(row: SecRow) {
    const rest = cmd.split(/\s+/).slice(1).join(" ");
    onTicker(row.symbol);
    setCmd(rest ? `${row.symbol} ${rest}` : `${row.symbol} `);
    close();
    inputRef.current?.focus();
  }

  function runFunction(fn: FnRow) {
    const first = cmd.split(/\s+/)[0] ?? "";
    const t = /^[A-Z0-9&.=\-^]+(\.(NS|BO))?$/.test(first) && !matchFunctions(first).some((f) => f.code === first)
      ? (first.includes(".") || first.startsWith("^") || first.includes("=") || /-USD$/.test(first) ? first : `${first}.NS`)
      : ticker;
    onTicker(t);
    setCmd(""); close();
    const target = MODULE_MAP[fn.id];
    const base = target && target.route !== `/module/${fn.id}` ? target.route : `/module/${fn.id}`;
    router.push(`${base}?symbol=${encodeURIComponent(t)}`);
  }

  // Press "/" anywhere to jump to the command line.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go() {
    const raw = cmd.trim();
    if (!raw) return;
    const p = parseCommand(raw);
    if (p.unknown && !p.ticker && !p.funcId) {
      setCmd(`? ${p.unknown} — UNKNOWN. TRY: TICKER FNC, E.G. RELIANCE GP`);
      close();
      return;
    }
    const nextTicker = p.ticker ?? ticker;
    onTicker(nextTicker);
    setCmd(""); close();
    if (p.funcId) router.push(`/module/${p.funcId}?symbol=${encodeURIComponent(nextTicker)}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open || flat.length === 0) return;
      e.preventDefault();
      setHi((h) => (e.key === "ArrowDown" ? (h + 1) % flat.length : (h - 1 + flat.length) % flat.length));
      return;
    }
    if (e.key === "Tab" && open && secs.length > 0) {
      e.preventDefault();
      const cur = flat[hi];
      pickSecurity(secs[cur && cur.kind === "sec" ? cur.i : 0]);
      return;
    }
    if (e.key === "Escape") { close(); return; }
    if (e.key === "Enter") {
      if (open && flat[hi]) {
        const cur = flat[hi];
        if (cur.kind === "sec") { e.preventDefault(); pickSecurity(secs[cur.i]); return; }
        e.preventDefault(); runFunction(fns[cur.i]); return;
      }
      go();
    }
  }

  return (
    <div className="cmdbar">
      <a className="cmd-logo" href="/">
        <span className="cmd-mark">▮</span>BULLION&nbsp;BOARD
      </a>
      {funcId && <span className="fn-tag">&lt;{funcId}&gt;</span>}
      <span className="cmd-prompt">&gt;</span>
      <input
        ref={inputRef}
        className="cmd-input"
        value={cmd}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => setTimeout(close, 150)}
        onFocus={() => { if (cmd.trim()) scheduleLookup(cmd); }}
        placeholder={`${ticker}  —  TICKER FNC: NSE · ^INDEX · FUTURE=F · FX=X · CRYPTO (E.G. GC=F FA)  + ENTER = <GO>`}
        aria-label="Terminal command line"
        spellCheck={false}
        autoComplete="off"
      />
      <button className="cmd-go" onClick={go}>GO</button>
      <span className="cmd-feed"><span className="feed-dot" />LIVE</span>
      <span className="cmd-clock">{clock}</span>

      {open && (secs.length > 0 || fns.length > 0 || scanning) && (
        <div className="suggest">
          {secs.length > 0 && <div className="sug-head">SECURITIES — ↑↓ + TAB/ENTER</div>}
          {secs.map((s, i) => (
            <div
              key={s.symbol}
              className={`sug-row${flat[hi]?.kind === "sec" && flat[hi]?.i === i ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pickSecurity(s); }}
            >
              <span className="sug-sym">{s.symbol}</span>
              <span className="sug-name">{s.name}</span>
              <span className="sug-meta">{s.exch} {s.type}</span>
            </div>
          ))}
          {fns.length > 0 && <div className="sug-head">FUNCTIONS</div>}
          {fns.map((f, i) => (
            <div
              key={f.id}
              className={`sug-row${flat[hi]?.kind === "fn" && flat[hi]?.i === i ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); runFunction(f); }}
            >
              <span className="sug-sym fn">{f.code} &lt;GO&gt;</span>
              <span className="sug-name">{f.label}</span>
              <span className="sug-meta">FNC</span>
            </div>
          ))}
          {scanning && secs.length === 0 && <div className="sug-row"><span className="sug-meta">SCANNING FEED…</span></div>}
        </div>
      )}
    </div>
  );
}

export function StatusBar({ ticker, extra }: { ticker?: string; extra?: string }) {
  const clock = useClock();
  return (
    <div className="statusbar">
      <span><span className="feed-dot" />YAHOO FEED</span>
      <span>{MODULES.length} FUNC</span>
      {ticker && <span className="sec">{ticker}</span>}
      {extra && <span>{extra}</span>}
      <span style={{ marginLeft: "auto" }}>{clock}</span>
    </div>
  );
}
