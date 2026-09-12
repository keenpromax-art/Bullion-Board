"use client";

// Compact summary panels for the default workspace. Each mini shows its
// whole content without scrolling at desktop heights: a stat strip, one
// short visual, one short table/chat. Full desks stay one click away via
// onExpand / onOpen — no desk logic is forked, minis only read the same
// APIs + lib math the full desks use.

import { useEffect, useMemo, useState } from "react";
import { store } from "@/lib/store";
import { WATCHLIST } from "@/lib/watchlist";
import { chatComplete } from "@/lib/ai";
import { logReturns } from "@/lib/indicators";
import { historicalVol, volRegime, trendBias } from "@/lib/options";
import { buildAllStrategies, detectBias } from "@/lib/strategyEngine";

const inr0 = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function MiniHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <p className="p-head" style={{ marginBottom: 8, flex: 1 }}>{title}</p>
      {action}
    </div>
  );
}

function FullBtn({ onFull }: { onFull: () => void }) {
  return (
    <button className="ghost" style={{ padding: "3px 8px", fontSize: 10.5 }} onClick={onFull} title="Open the full desk in this panel">
      FULL DESK →
    </button>
  );
}

// ---- Watchlist: Sym / Last / Chg / Fnc, click a row for its chart ----
export function WatchPanel({ onOpen }: { onOpen: (funcId: string, symbol: string) => void }) {
  const [rows, setRows] = useState<Array<{ symbol: string; price: number | null; chgPct: number | null }>>([]);
  const syms = useMemo(() => {
    try {
      const w = store.getWatchlist();
      return (w.length > 0 ? w.slice(0, 8) : ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ITC.NS", "SBIN.NS"]).slice(0, 8);
    } catch { return ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ITC.NS", "SBIN.NS"]; }
  }, []);
  useEffect(() => {
    let alive = true;
    Promise.all(syms.map(async (s) => {
      try {
        const r = await fetch(`/api/quote?symbol=${encodeURIComponent(s)}`);
        const j = await r.json();
        if (j.error || j.regularMarketPrice === undefined) return { symbol: s, price: null, chgPct: null };
        return { symbol: s, price: j.regularMarketPrice, chgPct: j.regularMarketChangePercent ?? 0 };
      } catch { return { symbol: s, price: null, chgPct: null }; }
    })).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [syms]);
  return (
    <div>
      <MiniHead title="Function Directory" />
      <table className="plain">
        <thead><tr><th>SYM</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG</th><th style={{ textAlign: "right" }}>FNC</th></tr></thead>
        <tbody>
          {(rows.length ? rows : syms.map((s) => ({ symbol: s, price: null, chgPct: null }))).map((r) => {
            const up = (r.chgPct ?? 0) >= 0;
            return (
              <tr key={r.symbol} onClick={() => onOpen("2", r.symbol)} style={{ cursor: "pointer" }} title={`${r.symbol} — open chart`}>
                <td className="sec">{r.symbol.replace(".NS", "")}</td>
                <td style={{ textAlign: "right" }}>{r.price !== null ? r.price.toLocaleString("en-IN", { maximumFractionDigits: r.price < 100 ? 2 : 0 }) : "—"}</td>
                <td style={{ textAlign: "right" }} className={r.chgPct === null ? "faint" : up ? "pos" : "neg"}>
                  {r.chgPct === null ? "—" : `${up ? "+" : ""}${r.chgPct.toFixed(2)}%`}
                </td>
                <td style={{ textAlign: "right" }}><span className="badge fnc">GIP</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Options strat mini: regime strip + payoff spark + top-3 ----
export function StratMini({ symbol, onFull }: { symbol: string; onFull: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/analysis/70?symbol=${encodeURIComponent(symbol)}&range=1y`)
      .then(async (r) => {
        const j = await r.json();
        if (alive && r.ok) setData(j);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [symbol]);

  const calc = useMemo(() => {
    const closes: number[] = (data?.bars ?? []).map((b: any) => b.close);
    const spot: number = data?.quote?.regularMarketPrice ?? data?.price ?? 0;
    if (closes.length < 40 || !spot) return null;
    const ind = data?.indicators ?? {};
    const risk = data?.risk ?? {};
    const lr = logReturns(closes);
    const hv10 = historicalVol(lr, 10), hv30 = historicalVol(lr, 30), hv252 = historicalVol(lr);
    const tb = trendBias(closes);
    const bias = detectBias({
      closes, hv10, hv30, hv252, trendBias01: tb,
      rsi: isFinite(ind.rsi) ? ind.rsi : null,
      macdHist: isFinite(ind.macdHist) ? ind.macdHist : null,
      adx: isFinite(ind.adx) ? ind.adx : null,
      hurst: isFinite(risk.hurst) ? risk.hurst : null,
      ivOverridePct: null,
    });
    const sigma = (bias.ivPct / 100) || hv30 || hv252 || 0.3;
    const strats = buildAllStrategies({ spot, sigma, dte: 30, bias });
    const expMove = spot * sigma * Math.sqrt(30 / 365);
    return { bias, hv10, hv30, hv252, sigma, strats: strats.slice(0, 3), expMove, regime: volRegime(hv10, hv252), spot };
  }, [data]);

  if (!calc) return <div><MiniHead title="Regime & Top Picks" action={<FullBtn onFull={onFull} />} /><p className="muted">PULLING REGIME…</p></div>;
  const top = calc.strats[0];
  const W = 600, H = 110;
  const pts = top ? (() => {
    const pnls = top.pnls, xs = top.xs;
    let mn = Math.min(...pnls, 0), mx = Math.max(...pnls, 0);
    if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
    const X = (i: number) => (i / Math.max(xs.length - 1, 1)) * W;
    const Y = (v: number) => H - 6 - ((v - mn) / (mx - mn)) * (H - 12);
    return { d: pnls.map((p, i) => `${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" "), up: pnls[pnls.length - 1] >= pnls[0] };
  })() : null;
  const bull = calc.bias.trendLabel.includes("Bull");

  return (
    <div>
      <MiniHead title="Regime & Top Picks" action={<FullBtn onFull={onFull} />} />
      <div className="cells">
        <div className="cell"><div className="lbl">Trend Bias</div><div className={`val ${bull ? "pos" : calc.bias.trendLabel.includes("Bear") ? "neg" : ""}`} style={{ fontSize: 15 }}>{calc.bias.trendLabel.replace("ish", "")}</div><div className="sub">EMA/SMA</div></div>
        <div className="cell"><div className="lbl">IV Regime</div><div className="val" style={{ fontSize: 15 }}>{calc.regime}</div><div className="sub">HV vs IV</div></div>
        <div className="cell"><div className="lbl">Exp. Move</div><div className="val" style={{ fontSize: 15 }}>±{(calc.expMove / calc.spot * 100).toFixed(1)}%</div><div className="sub">30D 1SD</div></div>
        <div className="cell"><div className="lbl">HV30 / IV</div><div className="val" style={{ fontSize: 15 }}>{calc.hv30 && calc.sigma ? (calc.hv30 / calc.sigma).toFixed(2) : "—"}</div><div className="sub">rich &gt;1</div></div>
      </div>
      {pts && (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 110, display: "block", marginTop: 8 }} preserveAspectRatio="none">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#5b5b62" strokeWidth="1" strokeDasharray="3 3" />
          <polyline points={pts.d} fill="none" stroke={pts.up ? "#00d664" : "#ff453a"} strokeWidth="1.8" />
        </svg>
      )}
      <table className="plain" style={{ marginTop: 8 }}>
        <thead><tr><th>STRATEGY</th><th style={{ textAlign: "right" }}>POP</th><th style={{ textAlign: "right" }}>MAX P/L</th><th style={{ textAlign: "right" }}>SCORE</th></tr></thead>
        <tbody>
          {calc.strats.map((s, i) => (
            <tr key={s.name} className={i === 0 ? "active" : ""}>
              <td className="sec">{s.name}</td>
              <td style={{ textAlign: "right" }}>{(s.probProfit * 100).toFixed(0)}%</td>
              <td style={{ textAlign: "right" }} className="pos">{s.maxProfitUnlimited ? "OPEN" : `+${inr0(s.maxProfit)}`}</td>
              <td style={{ textAlign: "right" }}><strong>{s.score.toFixed(0)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Fundamentals mini: key stats strip + compact table ----
export function FundaMini({ symbol, onFull }: { symbol: string; onFull: () => void }) {
  const [q, setQ] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (alive && !j.error) setQ(j);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [symbol]);
  if (!q) return <div><MiniHead title="Key Stats" action={<FullBtn onFull={onFull} />} /><p className="muted">PULLING STATS…</p></div>;
  const d = q.derived ?? {};
  const quote = q.quote ?? {};
  const rows: Array<[string, string, string?]> = [
    ["Mkt Cap", quote.marketCap ? `₹${(quote.marketCap / 1e7).toFixed(0)} Cr` : "—", "live"],
    ["Trail PE", quote.trailingPE ?? "—", `fwd ${quote.forwardPE ?? "—"}`],
    ["Yield", d.yieldPct !== undefined && d.yieldPct !== null ? `${d.yieldPct}%` : "—", "dividend"],
    ["Off 52W Hi", d.offHighPct ?? "—", "% range pos"],
    ["Avg Vol 20D", d.avgVol20?.toLocaleString("en-IN") ?? "—", "shares"],
    ["Sector", q.profile?.sector ?? "—", q.profile?.industry ?? "listed"],
  ];
  return (
    <div>
      <MiniHead title="Ratios & Profile" action={<FullBtn onFull={onFull} />} />
      <table className="plain">
        <thead><tr><th>METRIC</th><th style={{ textAlign: "right" }}>VALUE</th><th style={{ textAlign: "right" }}>NOTE</th></tr></thead>
        <tbody>
          {rows.map(([k, v, n]) => (
            <tr key={k}><td className="sec">{k}</td><td style={{ textAlign: "right" }}><strong>{v}</strong></td><td style={{ textAlign: "right" }} className="faint">{n}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- AI mini: 4-exchange log + prompt input, fits without scroll ----
export function AIMini({ symbol, onFull }: { symbol: string; onFull: () => void }) {
  const [log, setLog] = useState<Array<{ who: string; text: string }>>([
    { who: "YOU", text: `Summarize the options regime for ${symbol.replace(".NS", "")}.` },
  ]);
  const [seeded, setSeeded] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (seeded) return;
    setSeeded(true);
    let alive = true;
    setBusy(true);
    chatComplete([
      { role: "system", content: "You are a terse terminal derivatives analyst. Two sentences max, uppercase." },
      { role: "user", content: `Summarize the options regime for ${symbol}.` },
    ], { apiKey: store.getORKey(), model: store.getORModel() })
      .then((t) => { if (alive) setLog((l) => [...l, { who: "ANALYST", text: t.slice(0, 280) }]); })
      .catch((e) => { if (alive) setLog((l) => [...l, { who: "ANALYST", text: `AI ERR: ${e.message}` }]); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [seeded, symbol]);
  async function ask() {
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    setLog((l) => [...l.slice(-5), { who: "YOU", text: text.toUpperCase().slice(0, 160) }]);
    setBusy(true);
    try {
      const t = await chatComplete([
        { role: "system", content: "You are a terse terminal analyst. Two sentences max, uppercase." },
        ...log.slice(-4).map((m) => ({ role: m.who === "YOU" ? "user" as const : "assistant" as const, content: m.text })),
        { role: "user" as const, content: text },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setLog((l) => [...l.slice(-5), { who: "ANALYST", text: t.slice(0, 280) }]);
    } catch (e: any) {
      setLog((l) => [...l.slice(-5), { who: "ANALYST", text: `AI ERR: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <MiniHead title="Desk Chat" action={<FullBtn onFull={onFull} />} />
      <div style={{ display: "grid", gap: 8 }}>
        {log.slice(-4).map((m, i) => (
          <div key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.06em", color: m.who === "YOU" ? "var(--sub)" : "var(--amber)" }}>{m.who}</div>
            <div>{m.text}</div>
          </div>
        ))}
        {busy && <div className="muted" style={{ fontSize: 12 }}>ANALYST TYPING…</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, borderTop: "1px solid var(--grid)", paddingTop: 8, marginTop: 8 }}>
        <span style={{ color: "var(--amber)" }}>&gt;</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") ask(); e.stopPropagation(); }}
          placeholder="Ask the desk analyst..."
          aria-label="Ask the desk analyst"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "inherit", fontSize: 12 }}
        />
      </div>
    </div>
  );
}

// Symbol list shared with the tape fallback.
export function miniWatchlist(): string[] {
  try {
    const w = store.getWatchlist();
    if (w.length > 0) return w.slice(0, 8);
  } catch { /* ignore */ }
  return [...WATCHLIST.slice(0, 8)];
}
