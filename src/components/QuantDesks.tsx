"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sma, ema, rsi, last, logReturns, hurst, halfLife, pctReturns } from "@/lib/indicators";
import { suggestSymbols } from "@/lib/terminal/commandParser";
import { WATCHLIST } from "@/lib/watchlist";
import { historicalVol, volRegime, blackScholes } from "@/lib/options";
import { ewmaVol, maxDrawdown } from "@/lib/risk";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";
import { BarChart, LineChart, HBars, Histogram, AreaChart } from "./charts";
import { mulberry32 } from "@/lib/utils";

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

function Spark({ data, h = 64 }: { data: number[]; h?: number }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data);
  const W = 300;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 8)).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: "100%", height: h }} preserveAspectRatio="none">
      <title>{data.length ? `LAST ${data[data.length - 1].toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""}</title>
      <polyline points={pts} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.8" />
    </svg>
  );
}

/* ---------------- volatility term structure ---------------- */

export function VolTerm({ closes }: { closes: number[] }) {
  if (closes.length < 60) return null;
  const lr = logReturns(closes);
  const h10 = historicalVol(lr, 10), h30 = historicalVol(lr, 30), h252 = historicalVol(lr);
  const ew = ewmaVol(pctReturns(closes));
  const ewLast = ew[ew.length - 1] * Math.sqrt(252) * 100;
  return (
    <div className="panel">
      <p className="p-head">Vol term — annualised</p>
      <KV k="HV 10D" v={`${(h10 * 100).toFixed(1)}%`} />
      <KV k="HV 30D" v={`${(h30 * 100).toFixed(1)}%`} />
      <KV k="HV 252D" v={`${(h252 * 100).toFixed(1)}%`} />
      <KV k="EWMA NOW" v={`${ewLast.toFixed(1)}%`} />
      <KV k="REGIME" v={volRegime(h10, h252)} cls={volRegime(h10, h252).includes("EXPAND") ? "neg" : volRegime(h10, h252).includes("COMPRESS") ? "pos" : ""} />
    </div>
  );
}

/* ---------------- ML dossier ---------------- */

const ML_SPEC: Record<string, { name: string; arch: string; inputs: string }> = {
  "7": { name: "XGB SIGNAL", arch: "GBDT ×5 + LOGISTIC STACK", inputs: "RSI/MACD/ADX/BB/OBV LAGS + VOL" },
  "9": { name: "QUANT ENSEMBLE", arch: "ENSEMBLE MEAN + GARCH CAL", inputs: "RET MOMENTS + VOL CLUSTERING" },
  "10": { name: "ARIMA-LSTM META", arch: "ARIMA + LSTM META MIXER", inputs: "SEQ WINDOWS + RESIDUALS" },
  "54": { name: "ALPHA AUTOENCODER", arch: "BOTTLENECK AE, LATENT FACTORS", inputs: "ENGINEERED SIGNAL PANEL" },
  "55": { name: "GARCH-LSTM HYBRID", arch: "GARCH FEATS → LSTM/TRANS/TCN", inputs: "RET + VOL + RANGE FEATS" },
  "56": { name: "DUAL-HEAD TRANSFORMER", arch: "TRANSFORMER + NLL UNCERTAINTY", inputs: "POS-ENCODED WINDOWS" },
  "58": { name: "FEDERATED SWARM", arch: "8 NODES + BYZANTINE FILTER", inputs: "MOM/MR/TREND/OBV/AUTOCORR/VOL/SR" },
  "59": { name: "NEURAL ODE", arch: "LATENT ODE TIME SERIES", inputs: "SCALED WINDOWS" },
  "61": { name: "RL AGENT", arch: "POLICY AGENT, DISCRETE ACTS", inputs: "STATE = TECH SNAPSHOT" },
};

export function MLDossier({ id, closes }: { id: string; closes: number[] }) {
  const spec = ML_SPEC[id] ?? { name: "ML DESK", arch: "ENSEMBLE", inputs: "TECH SNAPSHOT" };
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  if (closes.length < 60) return null;
  const e20 = last<number>(sma(closes, 20)) ?? 0;
  const e50 = last<number>(sma(closes, 50)) ?? 0;
  const r = last<number>(rsi(closes, 14)) ?? 50;
  const lr = logReturns(closes);
  const hv = historicalVol(lr, 30);
  const hu = hurst(closes.slice(-150));
  const dd = maxDrawdown(closes).pct;
  const trend = e20 > e50 ? "UP" : "DOWN";

  async function critic() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.quantCritic() },
        { role: "user", content: `${spec.name} ${spec.arch}. LIVE FEATS: TREND ${trend} RSI ${r.toFixed(1)} HV30 ${(hv * 100).toFixed(1)}% HURST ${hu.toFixed(2)} DD ${dd.toFixed(1)}%. TASK: OVERFIT RISK + WHEN IT BREAKS + 1 GUARDRAIL. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="panel panel-glow">
      <p className="p-head">{spec.name} — live feature snapshot</p>
      <KV k="ARCH" v={spec.arch} />
      <KV k="INPUTS" v={spec.inputs} />
      <KV k="TREND 20/50" v={trend} cls={trend === "UP" ? "pos" : "neg"} />
      <KV k="RSI 14" v={r.toFixed(1)} />
      <KV k="HV 30D" v={`${(hv * 100).toFixed(1)}%`} />
      <KV k="HURST" v={hu.toFixed(2)} cls={hu > 0.55 ? "pos" : hu < 0.45 ? "neg" : ""} />
      <KV k="MAX DD" v={`${dd.toFixed(1)}%`} cls="neg" />
      <p className="muted" style={{ fontSize: 11.5 }}>GPU TRAINING RUNS OFF-TERMINAL — THIS DOSSIER + CRITIC IS THE LIVE DESK SURFACE.</p>
      <div><button className="btn" onClick={critic} disabled={aiLoading}>{aiLoading ? "RUNNING…" : "RUN MODEL CRITIC"}</button></div>
      {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
    </div>
  );
}

/* ---------------- pairs ---------------- */

interface LegRow { symbol: string; name: string; exch: string; type: string }

// Company autofill for pair legs: instant watchlist matches + live lookup.
function LegInput({ value, onChange, onRun, label }: {
  value: string; onChange: (v: string) => void; onRun: () => void; label: string;
}) {
  const [rows, setRows] = useState<LegRow[]>([]);
  const [hi, setHi] = useState(0);
  const [moved, setMoved] = useState(false);
  const [touched, setTouched] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Suggest only after user interaction — never pop open on mount/prefill.
    if (!touched) { setRows([]); return; }
    const q = value.trim().toUpperCase();
    if (!q) { setRows([]); return; }
    let local: LegRow[] = [];
    try {
      const w = store.getWatchlist();
      const uni = w.length > 0 ? w : WATCHLIST;
      local = suggestSymbols(q, uni, 5).map((s) => ({
        symbol: s, name: s.replace(/\.NS$|\.BO$/, "").replace(/\^/g, ""),
        exch: s.endsWith(".BO") ? "BSE" : "NSE", type: "EQ",
      }));
    } catch { local = []; }
    setRows(local); setHi(0);
    const my = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (seq.current !== my) return;
        const live = ((j.rows ?? []) as LegRow[]).slice();
        const seen = new Set(live.map((x) => x.symbol));
        for (const l of local) {
          if (live.length >= 7) break;
          if (!seen.has(l.symbol)) { seen.add(l.symbol); live.push(l); }
        }
        setRows(live.slice(0, 6)); setHi(0);
      } catch { /* local rows stand */ }
    }, 220);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, touched]);
  function pick(r: LegRow) {
    seq.current++;
    setRows([]); setMoved(false); setHi(0); setTouched(false);
    onChange(r.symbol);
    inputRef.current?.focus();
  }
  const open = rows.length > 0;
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        ref={inputRef}
        className="box" value={value} onChange={(e) => { onChange(e.target.value.toUpperCase()); setHi(0); setMoved(false); setTouched(true); }}
        onFocus={() => { if (value.trim()) setTouched(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            if (!open) return;
            e.preventDefault(); setMoved(true);
            setHi((h) => (e.key === "ArrowDown" ? (h + 1) % rows.length : (h - 1 + rows.length) % rows.length));
            return;
          }
          if (e.key === "Tab" && open) { e.preventDefault(); pick(rows[hi] ?? rows[0]); return; }
          if (e.key === "Enter") {
            if (open && moved && rows[hi]) { e.preventDefault(); pick(rows[hi]); return; }
            setRows([]);
            onRun();
            return;
          }
          if (e.key === "Escape" && open) { setRows([]); setMoved(false); return; }
          e.stopPropagation();
        }}
        onBlur={() => setTimeout(() => setRows([]), 150)}
        placeholder={label} aria-label={label} spellCheck={false} autoComplete="off"
      />
      {open && (
        <div className="suggest" role="listbox" aria-label={`${label} suggestions`}>
          <div className="sug-head">COMPANIES — TAB/ENTER TO FILL</div>
          {rows.map((s, i) => (
            <div
              key={s.symbol} role="option" aria-selected={i === hi}
              className={`sug-row${i === hi ? " active" : ""}`}
              onMouseDown={(ev) => { ev.preventDefault(); pick(s); }}
              onMouseEnter={() => { setHi(i); setMoved(true); }}
            >
              <span className="sug-sym">{s.symbol}</span>
              <span className="sug-name">{s.name}</span>
              <span className="sug-meta">{s.exch} {s.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PairDesk({ symbol }: { symbol: string }) {
  const [a, setA] = useState(symbol);
  const [b, setB] = useState("^NSEI");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => { setA(symbol); }, [symbol]);

  async function run(ca = a, cb = b) {
    if (!ca.trim() || !cb.trim()) return;
    setLoading(true); setData(null); setAiOut("");
    try {
      const r = await fetch(`/api/pair?symbolA=${encodeURIComponent(ca.trim().toUpperCase())}&symbolB=${encodeURIComponent(cb.trim().toUpperCase())}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "pair failed");
      setData(j);
    } catch (e: any) {
      setData({ error: true, msg: e.message });
    }
    finally { setLoading(false); }
  }

  useEffect(() => { run(a, b); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function askAI() {
    if (!data || data.error) return;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.pairs() },
        {
          role: "user",
          content: `PAIR ${data.symA} / ${data.symB} (N=${data.n} SHARED BARS). HEDGE β ${data.hedge} CORR ${data.corr} HALFLIFE ${data.halfLifeDays ?? "?"}D Z ${data.z60 >= 0 ? "+" : ""}${data.z60} SIGNAL ${data.signal} HURST ${data.hurst}. ` +
            `BACKTEST ${data.backtest?.n ?? 0} SIGNALS HIT ${data.backtest?.hitPct ?? "?"}% AVG ${data.backtest?.avgBps ?? "?"}BPS. ` +
            `TASK: TRADE VERDICT + EDGE READ + 2 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  const hl = data && !data.error ? data.halfLifeDays : null;
  const hlVerdict = hl === null || hl === undefined
    ? { t: "NO REVERSION", cls: "neg" }
    : hl <= 21 ? { t: "TRADEABLE", cls: "pos" } : hl <= 63 ? { t: "SLOW", cls: "" } : { t: "AVOID", cls: "neg" };

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Pairs — returns hedge · half-life · z</p>
        <div className="toolbar">
          <LegInput value={a} onChange={setA} onRun={() => run()} label="LEG A… (TYPE A COMPANY)" />
          <LegInput value={b} onChange={setB} onRun={() => run()} label="LEG B… (^NSEI)" />
          <button className="btn" onClick={() => run()}>RUN</button>
        </div>
        {loading && <p className="muted">FITTING HEDGE…</p>}
        {data && !data.error && (
          <>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">Hedge β</div><div className="val">{data.hedge}</div><div className="sub">returns OLS</div></div>
              <div className="cell"><div className="lbl">Corr</div><div className={`val ${(data.corr ?? 0) >= 0.7 ? "pos" : (data.corr ?? 0) < 0.3 ? "neg" : ""}`}>{data.corr}</div><div className="sub">returns 1Y</div></div>
              <div className="cell"><div className="lbl">Half-life</div><div className="val">{hl ?? "∞"}</div><div className="sub">{hl === null ? "no rev" : `${hl} days`}</div></div>
              <div className="cell"><div className="lbl">Z 60D</div><div className={`val ${Math.abs(data.z60) > 2 ? "neg" : ""}`}>{data.z60 >= 0 ? "+" : ""}{data.z60}</div><div className="sub">spread</div></div>
              <div className="cell"><div className="lbl">Hurst</div><div className="val">{data.hurst}</div><div className="sub">leg A</div></div>
              <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 14 }}>{data.signal}</div><div className="sub">{hlVerdict.t}</div></div>
            </div>
            <div className="kv" style={{ marginTop: 8 }}>
              <span className="muted">PER ₹1L LONG {String(data.symA).replace(".NS", "")} → SHORT {inrShort(data)}</span>
              <strong>{hlVerdict.t === "TRADEABLE" && Math.abs(data.z60) > 2 ? <span className="pos">SETUP ARMED</span> : <span className="faint">WAIT FOR |Z|&gt;2 + TRADEABLE HL</span>}</strong>
            </div>
          </>
        )}
        {data?.error && <p className="neg">PAIR FAILED — {data.msg ?? "CHECK SYMBOLS."} <button className="ghost" style={{ marginLeft: 6 }} onClick={() => run()}>RETRY</button></p>}
      </div>
      {data && !data.error && (
        <>
          <ZChart z={data.zTail ?? []} cur={data.z60} />
          <div className="duo">
            <div className="panel">
              <p className="p-head">Spread % — log residual · last {Number(data.spreadTail?.[data.spreadTail.length - 1] ?? NaN).toFixed(2)}</p>
              <SpreadChart data={data.spreadTail ?? []} />
            </div>
            <div className="panel">
              <p className="p-head">Rebased — {String(data.symA).replace(".NS", "")} vs {String(data.symB)} · 100-base</p>
              <RebasedChart a={data.aTail ?? []} b={data.bTail ?? []} symA={String(data.symA).replace(".NS", "")} symB={String(data.symB)} />
            </div>
          </div>
          <div className="duo">
            <div className="panel">
              <p className="p-head">Signal backtest — |z|&gt;2 → 10D · {data.backtest?.n ?? 0} signals</p>
              <div className="kv"><span className="muted">HIT RATE</span><strong className={data.backtest?.hitPct === null || data.backtest?.hitPct === undefined ? "" : data.backtest.hitPct >= 50 ? "pos" : "neg"}>{data.backtest?.hitPct === null || data.backtest?.hitPct === undefined ? "—" : `${data.backtest.hitPct}%`}</strong></div>
              <div className="kv"><span className="muted">AVG / SIGNAL</span><strong className={data.backtest?.avgBps >= 0 ? "pos" : "neg"}>{data.backtest?.avgBps === null || data.backtest?.avgBps === undefined ? "—" : `${data.backtest.avgBps >= 0 ? "+" : ""}${data.backtest.avgBps} BPS`}</strong></div>
              <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>MEAN-REVERSION ONLY · COSTS/SLIPPAGE NOT INCLUDED</p>
            </div>
            <div>
              <p className="p-head">AI analyst — PR</p>
              <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : "RUN AI"}</button></div>
              {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
            </div>
          </div>
          <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>HEDGE = RETURNS OLS ON {data.n} SHARED BARS · SPREAD = LOG-RESIDUAL · CORRELATION ≠ COINTEGRATION (NO ADF ON FREE FEED).</p>
        </>
      )}
    </div>
  );
}

function inrShort(data: any): string {
  try {
    const p = data.per1L;
    return `₹${Number(p.shortB).toLocaleString("en-IN")} ${String(data.symB)} (${p.sharesA}↔${p.sharesB} SH)`;
  } catch { return "—"; }
}

function ZChart({ z, cur }: { z: number[]; cur: number }) {
  if (!z.length) return null;
  const W = 640, H = 110;
  const lo = Math.min(-2.5, ...z), hi = Math.max(2.5, ...z);
  const X = (i: number) => (i / Math.max(z.length - 1, 1)) * (W - 8) + 4;
  const Y = (v: number) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 28);
  const band = (v: number, c: string) => (
    <line x1="0" x2={W} y1={Y(v)} y2={Y(v)} stroke={c} strokeWidth="1" strokeDasharray={Math.abs(v) === 2 ? "5 3" : "2 3"} />
  );
  return (
    <div className="panel">
      <p className="p-head">Z-score — 60D window · now <span className={Math.abs(cur) > 2 ? "neg" : ""}>{cur >= 0 ? "+" : ""}{cur}</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
        {band(2, "#ff453a")}{band(-2, "#ff453a")}{band(1, "#5b5b62")}{band(-1, "#5b5b62")}
        <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#26262b" strokeWidth="1" />
        <polyline points={z.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke={Math.abs(cur) > 2 ? "#ff453a" : "#ffa028"} strokeWidth="1.6" />
        <circle cx={X(z.length - 1)} cy={Y(cur)} r="3.5" fill={Math.abs(cur) > 2 ? "#ff453a" : "#ffa028"} />
      </svg>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>|Z|&gt;2 = SIGNAL BAND · FADE NEEDS TRADEABLE HALF-LIFE</p>
    </div>
  );
}

function SpreadChart({ data }: { data: number[] }) {
  if (data.length < 2) return <p className="muted">NO SPREAD.</p>;
  const W = 620, H = 110;
  const lo = Math.min(0, ...data), hi = Math.max(0, ...data);
  const X = (i: number) => (i / (data.length - 1)) * W;
  const Y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
  const up = data[data.length - 1] >= 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#26262b" strokeWidth="1" />
      <polyline points={data.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.6" />
    </svg>
  );
}

function RebasedChart({ a, b, symA, symB }: { a: number[]; b: number[]; symA: string; symB: string }) {
  const n = Math.min(a.length, b.length);
  if (n < 10) return <p className="muted">NO OVERLAY.</p>;
  const aa = a.slice(-n), bb = b.slice(-n);
  const lo = Math.min(...aa, ...bb), hi = Math.max(...aa, ...bb);
  const W = 620, H = 110;
  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
        <polyline points={bb.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#a1a1aa" strokeWidth="1.2" />
        <polyline points={aa.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")} fill="none" stroke="#ffb000" strokeWidth="1.6" />
      </svg>
      <div className="muted" style={{ fontSize: 11.5 }}><span style={{ color: "#ffb000" }}>— {symA}</span>{"  "}<span style={{ color: "#a1a1aa" }}>— {symB}</span></div>
    </div>
  );
}

/* ---------------- single-factor attribution (market model) ---------------- */

export function FactorDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`).then((r) => r.json()),
          fetch(`/api/history?symbol=%5ENSEI&range=3y&interval=1d`).then((r) => r.json()),
        ]);
        const ca: number[] = (a.bars ?? []).map((x: any) => x.close);
        const cb: number[] = (b.bars ?? []).map((x: any) => x.close);
        const n = Math.min(ca.length, cb.length);
        const ra: number[] = [], rb: number[] = [];
        for (let i = 1; i < n; i++) {
          ra.push(Math.log(ca[ca.length - n + i] / ca[ca.length - n + i - 1]));
          rb.push(Math.log(cb[cb.length - n + i] / cb[cb.length - n + i - 1]));
        }
        const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
        const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
        let cov = 0, vb = 0, va = 0;
        for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); vb += (rb[i] - mb) ** 2; va += (ra[i] - ma) ** 2; }
        const beta = vb ? cov / vb : 0;
        const alphaD = ma - beta * mb;
        const r2 = va && vb ? (cov * cov) / (va * vb) : 0;
        const te = Math.sqrt(ra.reduce((s, v, i) => s + (v - beta * rb[i]) ** 2, 0) / ra.length) * Math.sqrt(252) * 100;
        const up = ra.filter((_, i) => rb[i] > 0);
        const upB = rb.filter((v) => v > 0);
        const dn = ra.filter((_, i) => rb[i] < 0);
        const dnB = rb.filter((v) => v < 0);
        if (alive) setData({
          beta, alphaAnn: (Math.exp(alphaD * 252) - 1) * 100, r2: r2 * 100, te,
          upCap: upB.length ? (up.reduce((s, v) => s + v, 0) / upB.reduce((s, v) => s + v, 0)) * 100 : null,
          dnCap: dnB.length ? (dn.reduce((s, v) => s + v, 0) / dnB.reduce((s, v) => s + v, 0)) * 100 : null,
          n: ra.length, alphaD,
          sample: ra.map((v, i) => ({ x: rb[i] * 100, y: v * 100 })).filter((_, i) => i % 4 === 0).slice(-160),
        });
      } catch { if (alive) setData({ error: true }); }
    })();
    return () => { alive = false; };
  }, [symbol]);

  if (!data) return <div className="panel"><p className="muted">FITTING MARKET MODEL VS NIFTY…</p></div>;
  if (data.error) return <div className="panel"><p className="neg">FACTOR FIT FAILED.</p></div>;
  return (
    <div className="panel panel-glow">
      <p className="p-head">Market model — {symbol} vs NIFTY 50 · N={data.n}D</p>
      <div className="cells">
        <div className="cell"><div className="lbl">Beta</div><div className="val">{data.beta.toFixed(2)}</div><div className="sub">mkt sensitivity</div></div>
        <div className="cell"><div className="lbl">Alpha ann</div><div className={`val ${data.alphaAnn >= 0 ? "pos" : "neg"}`}>{data.alphaAnn >= 0 ? "+" : ""}{data.alphaAnn.toFixed(1)}%</div><div className="sub">excess</div></div>
        <div className="cell"><div className="lbl">R²</div><div className="val">{data.r2.toFixed(0)}%</div><div className="sub">mkt-driven</div></div>
        <div className="cell"><div className="lbl">Track err</div><div className="val">{data.te.toFixed(1)}%</div><div className="sub">ann</div></div>
        <div className="cell"><div className="lbl">Up capture</div><div className="val">{data.upCap !== null ? `${data.upCap.toFixed(0)}%` : "—"}</div><div className="sub">up days</div></div>
        <div className="cell"><div className="lbl">Down capture</div><div className="val">{data.dnCap !== null ? `${data.dnCap.toFixed(0)}%` : "—"}</div><div className="sub">down days</div></div>
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>SINGLE-FACTOR MARKET MODEL ON FREE DATA — FULL FAMA-FRENCH 3F NEEDS A FACTOR FEED.</p>
      {data.sample?.length > 10 && (
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Daily % — X: NIFTY · Y: {symbol} + β {data.beta?.toFixed(2)} line</p>
          {(() => {
            const pts: Array<{ x: number; y: number }> = data.sample;
            const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const y0 = Math.min(...ys), y1 = Math.max(...ys);
            const W2 = 620, H2 = 170;
            const X = (v: number) => 30 + ((v - x0) / (x1 - x0 || 1)) * (W2 - 40);
            const Y = (v: number) => H2 - 14 - ((v - y0) / (y1 - y0 || 1)) * (H2 - 28);
            const b = data.beta ?? 0, ad = (data.alphaD ?? 0) * 100;
            return (
              <svg viewBox={`0 0 ${W2} ${H2}`} style={{ width: "100%", height: H2 }}>
                {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="4" fill="transparent"><title>NIFTY {p.x.toFixed(2)}% · {symbol} {p.y.toFixed(2)}%</title></circle>)}
                {pts.map((p, i) => <circle key={`d${i}`} cx={X(p.x)} cy={Y(p.y)} r="2" fill="#8f7bff" opacity="0.6" pointerEvents="none" />)}
                <line x1={X(x0)} y1={Y(ad + b * x0)} x2={X(x1)} y2={Y(ad + b * x1)} stroke="#ffa028" strokeWidth="1.5" />
              </svg>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ---------------- merton jump-diffusion desk ---------------- */

function gaussFactory(rand: () => number) {
  let spare: number | null = null;
  return (): number => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

const pct1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function MertonDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [horizon, setHorizon] = useState(63);
  const [thresh, setThresh] = useState(3);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const SIMS = 500;

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(""); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=2y&interval=1d`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `history ${r.status}`);
        if (alive) setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, close: b.close })));
      })
      .catch((e) => { if (alive) { setBars([]); setErr(e instanceof Error ? e.message : "fetch failed"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const model = useMemo(() => {
    if (bars.length < 60) return null;
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);
    const lr = logReturns(closes);
    const n = lr.length;
    const mean = lr.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(lr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    if (!(sd > 0)) return null;
    const years = n / 252;
    // Jump detection: |daily move − mean| beyond Kσ — event list kept for the desk.
    const isJump = lr.map((r) => Math.abs(r - mean) > thresh * sd);
    const jumps = lr.map((r, i) => ({ r, i })).filter((x) => isJump[x.i]);
    const calm = lr.filter((_, i) => !isJump[i]);
    const upJ = jumps.filter((x) => x.r > mean).length;
    const lam = jumps.length / years;
    const muJ = jumps.length ? jumps.reduce((a, b) => a + b.r, 0) / jumps.length : 0;
    const sigJ = jumps.length > 1 ? Math.sqrt(jumps.reduce((s, v) => s + (v.r - muJ) ** 2, 0) / (jumps.length - 1)) : 0;
    const calmMean = calm.length ? calm.reduce((a, b) => a + b, 0) / calm.length : mean;
    const muD = (mean - (lam / 252) * muJ) * 252; // compensator: same mean as GBM
    const sigD = (calm.length > 1
      ? Math.sqrt(calm.reduce((s, v) => s + (v - calmMean) ** 2, 0) / (calm.length - 1))
      : sd) * Math.sqrt(252);
    const sigTot = sd * Math.sqrt(252);
    const jumpVarShare = sigTot > 0 ? (lam * (sigJ * sigJ + muJ * muJ)) / (sigTot * sigTot) * 100 : 0;
    const skew = sd > 0 ? lr.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n : 0;
    const kurt = sd > 0 ? lr.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3 : 0;
    const events = jumps
      .map((x) => ({ date: dates[x.i + 1] ?? `#${x.i + 1}`, size: x.r * 100, up: x.r > mean }))
      .sort((a, b) => Math.abs(b.size) - Math.abs(a.size));

    const S0 = closes[closes.length - 1];
    if (!(S0 > 0)) return null;
    const muD_d = muD / 252, sigD_d = sigD / Math.sqrt(252);
    const muG_d = mean, sigG_d = sd;
    const run = (lamY: number, seed: number, sims: number, H: number, start = S0) => {
      const rand = gaussFactory(mulberry32(seed));
      const gbm: number[][] = [], mj: number[][] = [];
      for (let s = 0; s < sims; s++) {
        const pg = [start], pm = [start];
        for (let d = 0; d < H; d++) {
          const z1 = rand(), z2 = rand();
          pg.push(pg[d] * Math.exp(muG_d - 0.5 * sigG_d * sigG_d + sigG_d * z1));
          let jump = 0;
          if (rand() < lamY / 252) {
            const zj = rand();
            jump = muJ + sigJ * zj;
          }
          pm.push(pm[d] * Math.exp(muD_d - 0.5 * sigD_d * sigD_d + sigD_d * z2 + jump));
        }
        gbm.push(pg); mj.push(pm);
      }
      return { gbm, mj };
    };
    const base = run(lam, 42, SIMS, horizon);
    const q = (arr: number[], p: number) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
    };
    const ends = (paths: number[][]) => paths.map((p) => p[p.length - 1]);
    const es = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const tail = s.slice(0, Math.max(1, Math.floor(s.length * 0.05)));
      return tail.reduce((a, b) => a + b, 0) / tail.length;
    };
    const stats = (arr: number[]) => ({
      p1: q(arr, 1), p5: q(arr, 5), p50: q(arr, 50), p95: q(arr, 95),
      pLoss: (arr.filter((v) => v < S0).length / arr.length) * 100,
      es5: es(arr),
    });
    const eG = ends(base.gbm), eM = ends(base.mj);
    // Per-day GBM band for the overlay (median + P5–P95 envelope).
    const gBand = { p5: [] as number[], p50: [] as number[], p95: [] as number[] };
    const mMed: number[] = [];
    for (let d = 1; d <= horizon; d++) {
      const gd = base.gbm.map((p) => p[d]).sort((a, b) => a - b);
      gBand.p5.push(q(gd, 5)); gBand.p50.push(q(gd, 50)); gBand.p95.push(q(gd, 95));
      mMed.push(q(base.mj.map((p) => p[d]).sort((a, b) => a - b), 50));
    }
    // λ sensitivity: half / base / double jump intensity.
    const sens = [0.5, 1, 2].map((f) => {
      const r = run(lam * f, 1000 + Math.round(f * 10), SIMS, horizon);
      const e = ends(r.mj);
      return { f, ...stats(e) };
    });
    // Walk-forward backtest: 6 origins, H ahead — P50 err + P5–P95 coverage.
    const bt: Array<{ origin: string; errPct: number; inside: boolean }> = [];
    for (let o = 1; o <= 6; o++) {
      const idx = closes.length - 1 - horizon - o * Math.max(21, Math.floor(horizon / 2));
      if (idx < 130) continue;
      const actual = closes[idx + horizon];
      if (!(actual > 0)) continue;
      const r2 = run(lam, 7000 + o, 300, horizon, closes[idx]);
      const pe = ends(r2.mj).sort((a, b) => a - b);
      const p50 = q(pe, 50);
      bt.push({
        origin: dates[idx] ?? `#${idx}`,
        errPct: ((p50 - actual) / actual) * 100,
        inside: actual >= q(pe, 5) && actual <= q(pe, 95),
      });
    }
    const btHit = bt.length ? (bt.filter((b) => b.inside).length / bt.length) * 100 : NaN;
    const btMae = bt.length ? bt.reduce((s, b) => s + Math.abs(b.errPct), 0) / bt.length : NaN;
    const gStats = stats(eG), mStats = stats(eM);
    // 1%-rule sizing off the Merton tail: shares per ₹1L equity.
    const riskRs = S0 - mStats.es5;
    const per1L = riskRs > 0 ? Math.floor(1000 / riskRs) : 0;
    return {
      S0, muAnn: mean * 252 * 100, sigTot: sigTot * 100, sigD: sigD * 100,
      lam, nJumps: jumps.length, upJ, dnJ: jumps.length - upJ, muJ: muJ * 100, sigJ: sigJ * 100,
      jumpVarShare, skew, kurt, hurstV: hurst(closes.slice(-150)),
      hv30: historicalVol(lr.slice(-30)) * 100, events,
      mjShow: base.mj.filter((_, i) => i % 8 === 0).slice(0, 60),
      gBand, mMed, gStats, mStats, eG, eM, sens, bt, btHit, btMae, per1L, riskRs,
      histTail: closes.slice(-90),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, horizon, thresh]);

  async function askAI() {
    if (!model) return;
    const m = model;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.merton() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${m.S0.toFixed(2)} ${horizon}D MJ FAN. CALIB: λ ${m.lam.toFixed(1)}/YR (${m.nJumps} EVTS: ${m.upJ} UP/${m.dnJ} DN) μJ ${m.muJ.toFixed(2)}% σJ ${m.sigJ.toFixed(2)}% JUMPVAR ${m.jumpVarShare.toFixed(0)}% SKEW ${m.skew.toFixed(2)} KURT ${m.kurt.toFixed(2)} H ${m.hurstV.toFixed(2)}. ` +
            `TAILS: GBM P1 ${m.gStats.p1.toFixed(0)} ES5 ${m.gStats.es5.toFixed(0)} PLOSS ${m.gStats.pLoss.toFixed(0)}% VS MJ P1 ${m.mStats.p1.toFixed(0)} ES5 ${m.mStats.es5.toFixed(0)} PLOSS ${m.mStats.pLoss.toFixed(0)}%. ` +
            `BACKTEST ${m.bt.length} ORIGINS: COVER ${m.btHit.toFixed(0)}% MAE ${m.btMae.toFixed(1)}%. SIZE: ${m.per1L} SH/₹1L @1% OFF ES. TASK: TAIL VERDICT + JUMP READ + POSITION NOTE. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <div className="panel"><p className="muted">CALIBRATING JUMPS FOR {symbol}…</p></div>;
  if (err && !bars.length) return <div className="panel"><p className="neg">JUMP FEED ERR: {err} <button className="ghost" style={{ marginLeft: 6 }} onClick={() => { setErr(""); setLoading(true); fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=2y&interval=1d`).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `history ${r.status}`); setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, close: b.close }))); }).catch((e) => setErr(e instanceof Error ? e.message : "fetch failed")).finally(() => setLoading(false)); }}>RETRY</button></p></div>;
  if (!model) return <div className="panel"><p className="neg">NEED 60+ DAILY BARS FOR CALIBRATION.</p></div>;
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  // Overlay fan geometry: 90D history + H-day Merton paths, GBM band behind.
  const HISTN = 90;
  const hist = model.histTail.slice(-HISTN);
  const W = 640, Hh = 150;
  const allV = [...hist, ...model.mjShow.flat(), model.gBand.p95[model.gBand.p95.length - 1] ?? 0, model.gBand.p5[0] ?? 0];
  const lo = Math.min(...allV), hi = Math.max(...allV);
  const X = (i: number) => (i / (HISTN + horizon - 1)) * (W - 8) + 4;
  const Y = (v: number) => Hh - 18 - ((v - lo) / (hi - lo || 1)) * (Hh - 34);
  const gPoly = model.gBand.p95.map((_, i) => `${X(HISTN - 1 + i).toFixed(1)},${Y(model.gBand.p95[i]).toFixed(1)}`).join(" ") + " " +
    model.gBand.p5.map((_, i) => `${X(HISTN - 1 + (model.gBand.p5.length - 1 - i)).toFixed(1)},${Y(model.gBand.p5[model.gBand.p5.length - 1 - i]).toFixed(1)}`).join(" ");
  const line = (arr: number[], off: number) => arr.map((v, i) => `${X(off + i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  // Shared-bin histograms (same x-scale — comparable tails).
  const combined = [...model.eG, ...model.eM];
  const cLo = Math.min(...combined), cHi = Math.max(...combined);
  const BINS = 24;
  const edges = Array.from({ length: BINS + 1 }, (_, i) => cLo + ((cHi - cLo) * i) / BINS);
  const counts = (arr: number[]) => {
    const c = new Array(BINS).fill(0);
    for (const v of arr) {
      let b = Math.floor(((v - cLo) / (cHi - cLo || 1)) * BINS);
      if (b >= BINS) b = BINS - 1;
      if (b < 0) b = 0;
      c[b]++;
    }
    return c;
  };

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">
          Merton calibration — {symbol} · {model.nJumps} jumps ({model.upJ}↑/{model.dnJ}↓) · {thresh}σ
        </p>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <div className="pills">
            {[21, 63, 126, 252].map((h) => (
              <button key={h} className={`pill${horizon === h ? " active" : ""}`} onClick={() => setHorizon(h)}>{h}D</button>
            ))}
          </div>
          <div className="pills">
            {[2.5, 3, 3.5].map((t) => (
              <button key={t} className={`pill${thresh === t ? " active" : ""}`} onClick={() => setThresh(t)} title="Jump detection threshold">{t}σ</button>
            ))}
          </div>
          <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>{SIMS} PATHS × {horizon}D · SEED 42</span>
        </div>
        <div className="cells">
          <div className="cell"><div className="lbl">Total vol σ</div><div className="val">{model.sigTot.toFixed(1)}%</div><div className="sub">HV30 {model.hv30.toFixed(1)}%</div></div>
          <div className="cell"><div className="lbl">Diffusive σ</div><div className="val">{model.sigD.toFixed(1)}%</div><div className="sub">ex-jumps</div></div>
          <div className="cell"><div className="lbl">Jump λ</div><div className="val">{model.lam.toFixed(1)}/yr</div><div className="sub">{model.nJumps} evts</div></div>
          <div className="cell"><div className="lbl">Jump μ/σ</div><div className="val" style={{ fontSize: 14 }}>{pct1(model.muJ)}/{model.sigJ.toFixed(1)}%</div><div className="sub">per event</div></div>
          <div className="cell"><div className="lbl">Jump var</div><div className="val">{model.jumpVarShare.toFixed(0)}%</div><div className="sub">of total</div></div>
          <div className="cell"><div className="lbl">Skew/Kurt</div><div className="val" style={{ fontSize: 14 }}>{model.skew.toFixed(2)}/{model.kurt.toFixed(1)}</div><div className="sub">H {model.hurstV.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Fan — Merton vs GBM · {horizon}D · amber paths = jumps · grey band = GBM P5–P95 · P50 {inr(model.mStats.p50)}</p>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
          <polygon points={gPoly} fill="rgba(161,161,170,0.16)" />
          <polyline points={line(model.gBand.p50, HISTN - 1)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" strokeDasharray="5 3" />
          {model.mjShow.map((p, i) => (
            <polyline key={i} points={line(p.filter((_, d) => d % 3 === 0), HISTN - 1)} fill="none" stroke="#ffa028" strokeWidth="1" opacity="0.25" />
          ))}
          <polyline points={line(model.mMed, HISTN - 1)} fill="none" stroke="#ffa028" strokeWidth="1.8" />
          <polyline points={line(hist, 0)} fill="none" stroke="#f5f5f4" strokeWidth="1.2" />
        </svg>
        <div className="pills" style={{ marginTop: 8 }}>
          <span className="badge fnc">— MJ MEDIAN</span>
          <span className="badge">- - GBM MEDIAN</span>
          <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>60/{SIMS} PATHS SHOWN · ENDS P5–P95 {inr(model.mStats.p5)}–{inr(model.mStats.p95)}</span>
        </div>
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Jump events — top {Math.min(8, model.events.length)} by size · {thresh}σ</p>
          {model.events.length === 0 ? (
            <p className="muted">NO {thresh}σ JUMPS IN 2Y — PURE DIFFUSION. TRY 2.5σ.</p>
          ) : (
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>DATE</th><th style={{ textAlign: "right" }}>SIZE</th><th style={{ textAlign: "right" }}>DIR</th></tr></thead>
              <tbody>
                {model.events.slice(0, 8).map((e) => (
                  <tr key={`${e.date}-${e.size.toFixed(2)}`}>
                    <td>{e.date}</td>
                    <td style={{ textAlign: "right" }} className={e.up ? "pos" : "neg"}>{e.up ? "+" : ""}{e.size.toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }}>{e.up ? <span className="pos">▲ UP</span> : <span className="neg">▼ DN</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel">
          <p className="p-head">Tail read — spot {inr(model.S0)}</p>
          <table className="plain">
            <thead><tr><th></th><th style={{ textAlign: "right" }}>GBM</th><th style={{ textAlign: "right" }}>MERTON</th></tr></thead>
            <tbody>
              <tr><td><strong>P1 crash</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p1)}</td><td style={{ textAlign: "right" }} className="neg">{inr(model.mStats.p1)}</td></tr>
              <tr><td><strong>P5</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p5)}</td><td style={{ textAlign: "right" }}>{inr(model.mStats.p5)}</td></tr>
              <tr><td><strong>P50</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p50)}</td><td style={{ textAlign: "right" }}>{inr(model.mStats.p50)}</td></tr>
              <tr><td><strong>P95</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p95)}</td><td style={{ textAlign: "right" }}>{inr(model.mStats.p95)}</td></tr>
              <tr><td><strong>P(loss)</strong></td><td style={{ textAlign: "right" }}>{model.gStats.pLoss.toFixed(0)}%</td><td style={{ textAlign: "right" }}>{model.mStats.pLoss.toFixed(0)}%</td></tr>
              <tr><td><strong>ES 5%</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.es5)}</td><td style={{ textAlign: "right" }} className="neg">{inr(model.mStats.es5)}</td></tr>
              <tr><td><strong>Size/₹1L</strong></td><td style={{ textAlign: "right" }} className="faint">—</td><td style={{ textAlign: "right" }}><strong>{model.per1L} SH</strong> <span className="faint">@1%</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Terminal distribution — {horizon}D · shared scale</p>
          <Histogram prebinned={{ counts: counts(model.eM), edges }} height={110} color="#ffa028" />
          <p className="muted" style={{ fontSize: 11.5 }}>MERTON ENDS · FAT LEFT TAIL VS GBM</p>
          <Histogram prebinned={{ counts: counts(model.eG), edges }} height={70} color="#5b5b62" />
          <p className="muted" style={{ fontSize: 11.5 }}>GBM ENDS · SAME MEAN · SAME BINS</p>
        </div>
        <div className="grid" style={{ gap: 10 }}>
          <div className="panel">
            <p className="p-head">Fan backtest — {model.bt.length} origins · cover {isFinite(model.btHit) ? `${model.btHit.toFixed(0)}%` : "—"}</p>
            {model.bt.length === 0 ? (
              <p className="muted">NOT ENOUGH HISTORY FOR {horizon}D ORIGINS.</p>
            ) : (
              <table className="plain">
                <thead><tr><th style={{ textAlign: "left" }}>FROM</th><th style={{ textAlign: "right" }}>P50 ERR</th><th style={{ textAlign: "right" }}>IN BAND</th></tr></thead>
                <tbody>
                  {model.bt.map((b) => (
                    <tr key={b.origin}>
                      <td>{b.origin.slice(0, 10)}</td>
                      <td style={{ textAlign: "right" }} className={Math.abs(b.errPct) < 5 ? "pos" : "neg"}>{b.errPct >= 0 ? "+" : ""}{b.errPct.toFixed(1)}%</td>
                      <td style={{ textAlign: "right" }}>{b.inside ? <span className="pos">● YES</span> : <span className="neg">○ NO</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>MAE {isFinite(model.btMae) ? `${model.btMae.toFixed(1)}%` : "—"} · BAND = FAN P5–P95 FROM THAT DATE</p>
          </div>
          <div className="panel">
            <p className="p-head">λ sensitivity — halve/double intensity</p>
            <table className="plain">
              <thead><tr><th>λ ×</th><th style={{ textAlign: "right" }}>P5</th><th style={{ textAlign: "right" }}>P50</th><th style={{ textAlign: "right" }}>P95</th></tr></thead>
              <tbody>
                {model.sens.map((s) => (
                  <tr key={s.f} className={s.f === 1 ? "active" : ""}>
                    <td><strong>{s.f}×</strong></td>
                    <td style={{ textAlign: "right" }}>{inr(s.p5)}</td>
                    <td style={{ textAlign: "right" }}>{inr(s.p50)}</td>
                    <td style={{ textAlign: "right" }}>{inr(s.p95)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — MJ</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading || !model}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- intraday day desk ---------------- */

export function DayDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1d&interval=5m`)
      .then((r) => r.json())
      .then((j) => { if (alive) setBars(j.bars ?? []); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  if (loading) return <div className="panel"><p className="muted">TAPING TODAY…</p></div>;
  if (!bars.length) return <div className="panel"><p className="neg">NO INTRADAY TAPE (MKT CLOSED OR FEED GAP).</p></div>;
  const n = bars.length;
  const times = bars.map((b: any, i: number) => {
    if (b.time) {
      const d = new Date((b.time + 19800) * 1000);
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    }
    return `#${i + 1}`;
  });
  const x3: [string, string, string] = [times[0] ?? "", times[Math.floor(n / 2)] ?? "", times[n - 1] ?? ""];
  const closes = bars.map((b) => b.close);
  const typical = bars.map((b) => (b.high + b.low + b.close) / 3);
  const vol = bars.map((b) => b.volume || 0);
  const totV = vol.reduce((a, b) => a + b, 0);

  // Session VWAP series + ±1σ bands (12-print rolling dispersion)
  let cpv = 0, cv = 0;
  const vwapS: (number | null)[] = typical.map((t, i) => {
    cpv += t * vol[i]; cv += vol[i];
    return cv ? cpv / cv : null;
  });
  const sd = typical.map((_, i) => {
    const w = typical.slice(Math.max(0, i - 11), i + 1);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length);
  });
  const up1 = vwapS.map((v, i) => (v === null ? null : v + sd[i]));
  const lo1 = vwapS.map((v, i) => (v === null ? null : v - sd[i]));

  // Delta proxy: volume signed by close-location-value, cumulated
  const delta = bars.map((b) => {
    const r = b.high - b.low;
    const clv = r ? ((b.close - b.low) - (b.high - b.close)) / r : 0;
    return clv * (b.volume || 0);
  });
  let cdAcc = 0;
  const cumD = delta.map((d) => (cdAcc += d));
  const cumDLast = cumD[cumD.length - 1] ?? 0;

  const last = closes[n - 1];
  const open = bars[0].open;
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const vwap = vwapS[n - 1] ?? last;

  // Initial balance: first 12 prints ≈ opening hour
  const ibBars = bars.slice(0, 12);
  const ibH = Math.max(...ibBars.map((b) => b.high));
  const ibL = Math.min(...ibBars.map((b) => b.low));
  const ibPos = last > ibH ? "ABOVE IB" : last < ibL ? "BELOW IB" : "INSIDE IB";

  // Volume profile across 14 price levels → POC + 70% value area
  const NB = 14;
  const bins = new Array(NB).fill(0);
  bars.forEach((b) => {
    const v = b.volume || 0;
    if (!v || hi === lo) return;
    for (let k = 0; k < NB; k++) {
      const e0 = lo + ((hi - lo) * k) / NB, e1 = lo + ((hi - lo) * (k + 1)) / NB;
      const ov = Math.max(0, Math.min(b.high, e1) - Math.max(b.low, e0));
      bins[k] += v * (ov / ((b.high - b.low) || 1));
    }
  });
  if (hi === lo) bins[Math.floor(NB / 2)] = totV;
  const totP = bins.reduce((a, b) => a + b, 0) || 1;
  const pocI = bins.indexOf(Math.max(...bins));
  const pocPx = lo + ((hi - lo) * (pocI + 0.5)) / NB;
  let vaLo = pocI, vaHi = pocI, vaV = bins[pocI];
  while (vaV < totP * 0.7 && (vaLo > 0 || vaHi < NB - 1)) {
    const l = vaLo > 0 ? bins[vaLo - 1] : -1;
    const h = vaHi < NB - 1 ? bins[vaHi + 1] : -1;
    if (h >= l && vaHi < NB - 1) { vaHi++; vaV += bins[vaHi]; }
    else if (vaLo > 0) { vaLo--; vaV += bins[vaLo]; }
    else break;
  }
  const pxAt = (k: number) => lo + ((hi - lo) * (k + 0.5)) / NB;

  const avgV = totV / Math.max(n, 1);
  const bigCount = vol.filter((v) => v > 2 * avgV).length;
  const f1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Tape — {symbol} · 5M · {n} prints · {last >= vwap ? "ABOVE VWAP" : "BELOW VWAP"}</p>
        <div className="cells">
          <div className="cell"><div className="lbl">Last</div><div className={`val ${last >= vwap ? "pos" : "neg"}`}>{f1(last)}</div><div className="sub">vs VWAP</div></div>
          <div className="cell"><div className="lbl">VWAP</div><div className="val">{f1(vwap)}</div><div className="sub">session</div></div>
          <div className="cell"><div className="lbl">POC</div><div className="val">{f1(pocPx)}</div><div className="sub">heaviest level</div></div>
          <div className="cell"><div className="lbl">Open</div><div className="val">{f1(open)}</div><div className="sub">day</div></div>
          <div className="cell"><div className="lbl">High / Low</div><div className="val" style={{ fontSize: 15 }}>{f1(hi)} / {f1(lo)}</div><div className="sub">range</div></div>
          <div className="cell"><div className="lbl">IB {ibPos}</div><div className="val" style={{ fontSize: 15 }}>{f1(ibH)} / {f1(ibL)}</div><div className="sub">first-hour box</div></div>
          <div className="cell"><div className="lbl">Day chg</div><div className={`val ${last >= open ? "pos" : "neg"}`}>{(((last - open) / open) * 100).toFixed(2)}%</div><div className="sub">open→last</div></div>
          <div className="cell"><div className="lbl">Cum Δ</div><div className={`val ${cumDLast >= 0 ? "pos" : "neg"}`}>{cumDLast >= 0 ? "+" : ""}{(cumDLast / 1e6).toFixed(2)}M</div><div className="sub">signed flow</div></div>
          <div className="cell"><div className="lbl">Volume</div><div className="val">{(totV / 1e6).toFixed(1)}M</div><div className="sub">{bigCount} big prints</div></div>
        </div>

        <div style={{ marginTop: 10 }}>
          <p className="p-head">Price + VWAP ±1σ + IB box</p>
          <LineChart
            series={[
              { label: "CLOSE", color: "#ffb000", values: closes },
              { label: "VWAP", color: "#ffa028", values: vwapS },
              { label: "+1σ", color: "#5b5b62", values: up1, dashed: true },
              { label: "−1σ", color: "#5b5b62", values: lo1, dashed: true },
              { label: "IBH", color: "#00d664", values: closes.map(() => ibH), dashed: true },
              { label: "IBL", color: "#ff453a", values: closes.map(() => ibL), dashed: true },
            ]}
            height={170} yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            dates={times} xLabels={x3}
          />
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <p className="p-head">Cumulative Δ — tape pressure</p>
            <LineChart
              series={[{ label: "CUM Δ", color: cumDLast >= 0 ? "#00d664" : "#ff453a", values: cumD }]}
              height={110} yFmt={(v) => `${(v / 1e6).toFixed(2)}M`} dates={times} xLabels={x3}
            />
          </div>
          <div>
            <p className="p-head">Volume profile — POC {f1(pocPx)}</p>
            <HBars
              rows={bins.map((v, k) => ({
                label: f1(pxAt(k)),
                value: v,
                display: `${(v / 1e6).toFixed(2)}M`,
                color: k === pocI ? "#ffa028" : k >= vaLo && k <= vaHi ? "#8f7bff" : "#5b5b62",
              })).reverse()}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <p className="p-head">Volume tape — gray bars, big prints flagged</p>
          <BarChart values={vol} labels={times} height={70} posColor="#5b5b62" negColor="#5b5b62" />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Print tape — signed Δ per 5M · ⚡ = &gt;2× avg print</p>
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table className="plain">
            <thead><tr><th>TIME</th><th style={{ textAlign: "right" }}>O</th><th style={{ textAlign: "right" }}>H</th><th style={{ textAlign: "right" }}>L</th><th style={{ textAlign: "right" }}>C</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>VWAP</th><th style={{ textAlign: "right" }}>Δ</th></tr></thead>
            <tbody>
              {bars.map((b, i) => {
                const big = vol[i] > 2 * avgV;
                return (
                  <tr key={i} style={big ? { background: "rgba(255,160,40,0.07)" } : undefined}>
                    <td>{times[i]}{big ? " ⚡" : ""}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.open)}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.high)}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.low)}</td>
                    <td style={{ textAlign: "right" }}><span className={b.close >= b.open ? "pos" : "neg"}>{f1(b.close)}</span></td>
                    <td style={{ textAlign: "right" }}>{(vol[i] / 1e6).toFixed(2)}M</td>
                    <td style={{ textAlign: "right" }}>{vwapS[i] === null ? "—" : f1(vwapS[i] as number)}</td>
                    <td style={{ textAlign: "right" }}><span className={delta[i] >= 0 ? "pos" : "neg"}>{delta[i] >= 0 ? "+" : ""}{(delta[i] / 1e3).toFixed(0)}k</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- rolling risk desk (module 23, stripped) ---------------- */
// Advanced rolling risk on 3Y daily + Nifty benchmark: vol term structures,
// Sharpe/Sortino, beta/correlation, drawdown episodes, VaR/CVaR, AI analyst.

/* ---------------- price forecast ensemble (module 9) ---------------- */
// Honest quant ensemble: GBM Monte Carlo + block bootstrap + damped EMA
// trend + OU mean-reversion, inverse-MAE weighted by walk-forward backtest.

const FC_HORIZONS = [5, 10, 21, 63];
const FC_SIMS = 800;

function fcQ(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))];
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const stdev = (a: number[], m?: number) => {
  if (a.length < 2) return 0;
  const mu = m ?? avg(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1));
};

export function ForecastDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState(21);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, close: b.close })));
      })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const eng = useMemo(() => {
    if (bars.length < 260) return null;
    const HMAX = 63;
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);
    const S0 = closes[closes.length - 1];
    if (!(S0 > 0)) return null;
    const lr = logReturns(closes);
    const mu = avg(lr);
    const sd = stdev(lr, mu);
    if (!(sd > 0)) return null;
    // Vol calibration: sample vs EWMA-latest — regime-aware, conservative max.
    const ew = ewmaVol(lr);
    const ewNow = ew.length ? ew[ew.length - 1] : sd;
    const useSd = Math.max(sd, ewNow);
    const hv10 = historicalVol(lr.slice(-10)) * 100;
    const hv30 = historicalVol(lr.slice(-30)) * 100;
    const hu = hurst(closes.slice(-150));
    const rsiV = last<number>(rsi(closes, 14)) ?? 50;
    const e20 = last<number>(ema(closes, 20)) ?? S0;
    const e50 = last<number>(ema(closes, 50)) ?? S0;
    const s50 = last<number>(sma(closes, 50)) ?? S0;
    let hl = 21;
    try {
      const h = halfLife(closes.slice(-252));
      if (isFinite(h)) hl = Math.min(126, Math.max(2, h));
    } catch { /* fallback 21 */ }
    const regime = hu > 0.55 ? "TRENDING" : hu < 0.45 ? "RANGING" : "MIXED";

    // Full-sample stochastic paths (GBM + block bootstrap), seeded.
    const g1 = gaussFactory(mulberry32(42));
    const g2 = gaussFactory(mulberry32(43));
    const gbm: number[][] = [];
    const boot: number[][] = [];
    for (let s = 0; s < FC_SIMS; s++) {
      const pg = [S0], pb = [S0];
      for (let d = 0; d < HMAX; d++) {
        pg.push(pg[d] * Math.exp(mu - 0.5 * useSd * useSd + useSd * g1()));
      }
      gbm.push(pg);
      let bi = Math.floor(g2() * Math.max(1, lr.length - 5));
      for (let d = 0; d < HMAX; d++) {
        if (d % 5 === 0) bi = Math.floor(Math.abs(g2()) * Math.max(1, lr.length - 5)) % Math.max(1, lr.length - 5);
        pb.push(pb[d] * Math.exp(lr[bi % lr.length]));
      }
      boot.push(pb);
    }
    // Deterministic paths: damped EMA trend + OU pull to SMA50.
    const slope = e20 !== 0 && closes.length > 25
      ? (e20 / ((last<number>(ema(closes.slice(0, -5), 20)) ?? e20) || e20) - 1) / 5
      : 0;
    const trend: number[] = [S0];
    let acc = 0;
    for (let d = 1; d <= HMAX; d++) {
      acc += slope * Math.exp(-d / 21);
      trend.push(S0 * Math.exp(acc));
    }
    const k = Math.LN2 / hl;
    const x0 = Math.log(S0), th = Math.log(Math.max(s50, S0 * 0.01));
    const mr: number[] = [S0];
    for (let d = 1; d <= HMAX; d++) mr.push(Math.exp(th + (x0 - th) * Math.exp(-k * d)));

    // Per-day pooled bands from the stochastic pair.
    const bands: Array<{ p10: number; p25: number; p50: number; p75: number; p90: number }> = [];
    for (let d = 1; d <= HMAX; d++) {
      const pool = [...gbm.map((p) => p[d]), ...boot.map((p) => p[d])].sort((a, b) => a - b);
      bands.push({ p10: fcQ(pool, 10), p25: fcQ(pool, 25), p50: fcQ(pool, 50), p75: fcQ(pool, 75), p90: fcQ(pool, 90) });
    }
    const dayVals = (d: number) => [...gbm.map((p) => p[d]), ...boot.map((p) => p[d])];

    // Point-forecast fns (reused by the walk-forward backtest on slices).
    function pointsAt(c: number[], h: number): { gbm: number; boot: number; trend: number; mr: number } {
      const s0 = c[c.length - 1];
      const r = logReturns(c);
      const m = avg(r);
      const s = Math.max(stdev(r, m), 1e-6);
      const g = gaussFactory(mulberry32(7));
      const endsG: number[] = [], endsB: number[] = [];
      for (let i = 0; i < 200; i++) {
        let pg = s0;
        for (let d = 0; d < h; d++) pg *= Math.exp(m - 0.5 * s * s + s * g());
        endsG.push(pg);
        let pb = s0;
        let bi = Math.floor(Math.abs(g()) * Math.max(1, r.length - 5)) % Math.max(1, r.length - 5);
        for (let d = 0; d < h; d++) {
          if (d % 5 === 0) bi = Math.floor(Math.abs(g()) * Math.max(1, r.length - 5)) % Math.max(1, r.length - 5);
          pb *= Math.exp(r[bi % r.length]);
        }
        endsB.push(pb);
      }
      endsG.sort((a, b) => a - b); endsB.sort((a, b) => a - b);
      const e20b = last<number>(ema(c, 20)) ?? s0;
      const e20prev = last<number>(ema(c.slice(0, -5), 20)) ?? e20b;
      const sl = e20b !== 0 && c.length > 25 ? (e20b / (e20prev || e20b) - 1) / 5 : 0;
      let a2 = 0;
      for (let d = 1; d <= h; d++) a2 += sl * Math.exp(-d / 21);
      const s50b = last<number>(sma(c, 50)) ?? s0;
      let hlb = 21;
      try {
        const hh = halfLife(c.slice(-252));
        if (isFinite(hh)) hlb = Math.min(126, Math.max(2, hh));
      } catch { /* 21 */ }
      const kb = Math.LN2 / hlb;
      return {
        gbm: fcQ(endsG, 50),
        boot: fcQ(endsB, 50),
        trend: s0 * Math.exp(a2),
        mr: Math.exp(Math.log(Math.max(s50b, s0 * 0.01)) + (Math.log(s0) - Math.log(Math.max(s50b, s0 * 0.01))) * Math.exp(-kb * h)),
      };
    }

    // Walk-forward backtest: 12 origins × H ahead.
    function backtest(h: number) {
      const mods = ["gbm", "boot", "trend", "mr"] as const;
      const agg: Record<string, { mae: number; hit: number; n: number }> = {
        gbm: { mae: 0, hit: 0, n: 0 }, boot: { mae: 0, hit: 0, n: 0 },
        trend: { mae: 0, hit: 0, n: 0 }, mr: { mae: 0, hit: 0, n: 0 },
      };
      for (let o = 0; o < 12; o++) {
        const idx = closes.length - 1 - h - o * 5;
        if (idx < 260) continue;
        const slice = closes.slice(0, idx + 1);
        const actual = closes[idx + h];
        const sOrig = closes[idx];
        if (!(actual > 0) || !(sOrig > 0)) continue;
        const pts = pointsAt(slice, h);
        for (const m of mods) {
          const a = agg[m];
          a.mae += Math.abs(pts[m] - actual) / actual;
          if (Math.sign(pts[m] - sOrig) === Math.sign(actual - sOrig)) a.hit += 1;
          a.n += 1;
        }
      }
      const out: Record<string, { maePct: number; hitPct: number; n: number }> = {};
      for (const m of mods) {
        const a = agg[m];
        out[m] = { maePct: a.n ? (a.mae / a.n) * 100 : NaN, hitPct: a.n ? (a.hit / a.n) * 100 : NaN, n: a.n };
      }
      return out;
    }
    const btCache = new Map<number, ReturnType<typeof backtest>>();
    const bt = (h: number) => {
      let b = btCache.get(h);
      if (!b) { b = backtest(h); btCache.set(h, b); }
      return b;
    };
    function weights(h: number): Record<string, number> {
      const b = bt(h);
      const inv: Record<string, number> = {};
      let tot = 0;
      for (const m of ["gbm", "boot", "trend", "mr"]) {
        const v = b[m].maePct;
        const w = v && isFinite(v) && v > 0 ? 1 / v : 0;
        inv[m] = w; tot += w;
      }
      const out: Record<string, number> = {};
      for (const m of ["gbm", "boot", "trend", "mr"]) out[m] = tot > 0 ? inv[m] / tot : 0.25;
      return out;
    }
    function ensemble(h: number) {
      const w = weights(h);
      const pts = {
        gbm: fcQ(gbm.map((p) => p[h]).sort((a, b) => a - b), 50),
        boot: fcQ(boot.map((p) => p[h]).sort((a, b) => a - b), 50),
        trend: trend[h], mr: mr[h],
      };
      let tgt = 0;
      for (const m of ["gbm", "boot", "trend", "mr"] as const) tgt += w[m] * pts[m];
      const dv = dayVals(h).filter(isFinite);
      const up = dv.length ? (dv.filter((v) => v > S0).length / dv.length) * 100 : NaN;
      return { tgt, pts, w, up };
    }

    return {
      S0, closes, dates, bands, gbm, boot, trend, mr, dayVals,
      hv10, hv30, useSd: useSd * Math.sqrt(252) * 100, hu, rsiV, hl, regime,
      e20, e50, s50, bt, weights, ensemble,
    };
  }, [bars]);

  if (loading) return <div className="panel"><p className="muted">CALIBRATING ENSEMBLE FOR {symbol}…</p></div>;
  if (!eng) return <div className="panel"><p className="neg">NEED 260+ DAILY BARS FOR CALIBRATION.</p></div>;

  const H = horizon;
  const ens = eng.ensemble(H);
  const b = eng.bands[H - 1];
  const expPct = ((ens.tgt - eng.S0) / eng.S0) * 100;
  const btH = eng.bt(H);
  const inr = (v: number) => (isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : "—");
  const f1 = (v: number) => (isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
  const MLABEL: Record<string, string> = { gbm: "GBM MC", boot: "BOOTSTRAP", trend: "EMA TREND", mr: "MEAN-REV" };

  async function askAI() {
    const e = eng;
    if (!e) return;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.forecast() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${e.S0.toFixed(2)} HURST ${e.hu.toFixed(2)} (${e.regime}) RSI ${e.rsiV.toFixed(1)} HV10/30 ${e.hv10.toFixed(1)}/${e.hv30.toFixed(1)} HALFLIFE ${e.hl.toFixed(0)}D. ` +
            `ENSEMBLE ${H}D TARGET ${ens.tgt.toFixed(2)} (${f1(expPct)}) P10-P90 ${b.p10.toFixed(2)}-${b.p90.toFixed(2)} P-UP ${ens.up.toFixed(0)}%. ` +
            `WEIGHTS GBM ${(ens.w.gbm * 100).toFixed(0)}/BOOT ${(ens.w.boot * 100).toFixed(0)}/TREND ${(ens.w.trend * 100).toFixed(0)}/MR ${(ens.w.mr * 100).toFixed(0)}. ` +
            `BACKTEST MAE GBM ${btH.gbm.maePct.toFixed(1)}%/BOOT ${btH.boot.maePct.toFixed(1)}%/TREND ${btH.trend.maePct.toFixed(1)}%/MR ${btH.mr.maePct.toFixed(1)}%. ` +
            `TASK: READ THE ENSEMBLE — VERDICT + WHICH MODEL TO TRUST HERE + 3 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  // Fan chart: last 90 history + H-day bands.
  const HIST = 90;
  const hist = eng.closes.slice(-HIST);
  const W = 640, Hh = 150;
  const allV = [...hist, b.p90, b.p10];
  const lo = Math.min(...allV), hi = Math.max(...allV);
  const X = (i: number) => (i / (HIST + H - 1)) * (W - 8) + 4;
  const Y = (v: number) => Hh - 18 - ((v - lo) / (hi - lo || 1)) * (Hh - 34);
  const bandPoly = (top: number[], bot: number[]) =>
    top.map((_, i) => `${X(HIST - 1 + i).toFixed(1)},${Y(top[i]).toFixed(1)}`).join(" ") + " " +
    bot.map((_, i) => `${X(HIST - 1 + (bot.length - 1 - i)).toFixed(1)},${Y(bot[bot.length - 1 - i]).toFixed(1)}`).join(" ");
  const seq = Array.from({ length: H }, (_, i) => i + 1);
  const p10s = seq.map((d) => eng.bands[d - 1].p10);
  const p25s = seq.map((d) => eng.bands[d - 1].p25);
  const p50s = seq.map((d) => eng.bands[d - 1].p50);
  const p75s = seq.map((d) => eng.bands[d - 1].p75);
  const p90s = seq.map((d) => eng.bands[d - 1].p90);
  const trendS = seq.map((d) => eng.trend[d]);
  const mrS = seq.map((d) => eng.mr[d]);
  const line = (arr: number[], off: number) => arr.map((v, i) => `${X(off + i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="toolbar">
        <div className="pills">
          {FC_HORIZONS.map((h) => (
            <button key={h} className={`pill${H === h ? " active" : ""}`} onClick={() => setHorizon(h)}>{h}D</button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 11 }}>{FC_SIMS * 2} PATHS · 12-ORIGIN BACKTEST · SEED 42/43</span>
      </div>
      <div className="cells">
        <div className="cell"><div className="lbl">Last</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.S0)}</div><div className="sub">{eng.regime} · H {eng.hu.toFixed(2)}</div></div>
        <div className="cell"><div className="lbl">Ens target {H}D</div><div className={`val ${expPct >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{inr(ens.tgt)}</div><div className="sub">{f1(expPct)} expected</div></div>
        <div className="cell"><div className="lbl">P10–P90</div><div className="val" style={{ fontSize: 13 }}>{inr(b.p10)}–{inr(b.p90)}</div><div className="sub">P25–P75 {inr(b.p25)}–{inr(b.p75)}</div></div>
        <div className="cell"><div className="lbl">P(up)</div><div className={`val ${ens.up >= 50 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{ens.up.toFixed(0)}%</div><div className="sub">pooled paths</div></div>
        <div className="cell"><div className="lbl">Vol calib</div><div className="val" style={{ fontSize: 15 }}>{eng.useSd.toFixed(1)}%</div><div className="sub">HV30 {eng.hv30.toFixed(1)}%</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{expPct > 2 ? "LEAN LONG" : expPct < -2 ? "LEAN SHORT" : "NEUTRAL"}</div><div className="sub">±2% rule</div></div>
      </div>
      <div>
        <p className="p-head">Fan — last {HIST}D + {H}D ahead · amber = median · blue = trend · purple = mean-rev</p>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
          <polygon points={bandPoly(p90s, p10s)} fill="rgba(255,160,40,0.13)" />
          <polygon points={bandPoly(p75s, p25s)} fill="rgba(255,160,40,0.22)" />
          <polyline points={line(hist, 0)} fill="none" stroke="#f5f5f4" strokeWidth="1.4" />
          <polyline points={line(p50s, HIST - 1)} fill="none" stroke="#ffa028" strokeWidth="1.8" />
          <polyline points={line(trendS, HIST - 1)} fill="none" stroke="#00c8ff" strokeWidth="1.2" strokeDasharray="5 3" />
          <polyline points={line(mrS, HIST - 1)} fill="none" stroke="#8f7bff" strokeWidth="1.2" strokeDasharray="5 3" />
          <circle cx={X(HIST + H - 1)} cy={Y(ens.tgt)} r="3.5" fill="#00d664" />
          <text x={Math.min(X(HIST + H - 1) - 4, W - 120)} y={Math.max(Y(ens.tgt) - 8, 12)} fontSize="11" fill="#00d664" fontWeight="700" textAnchor="end">{inr(ens.tgt)}</text>
          <text x="4" y={Hh - 4} fontSize="9" fill="#5b5b62">{eng.dates[eng.dates.length - HIST] ?? ""}</text>
          <text x={W - 4} y={Hh - 4} fontSize="9" fill="#5b5b62" textAnchor="end">T+{H}</text>
        </svg>
      </div>
      <div className="panel">
        <p className="p-head">Models — {H}D target · inverse-MAE weights from backtest</p>
        <table className="plain">
          <thead><tr><th>MODEL</th><th style={{ textAlign: "right" }}>TARGET</th><th style={{ textAlign: "right" }}>EXP%</th><th style={{ textAlign: "right" }}>WGT</th><th style={{ textAlign: "right" }}>BT MAE</th><th style={{ textAlign: "right" }}>HIT%</th></tr></thead>
          <tbody>
            {(["gbm", "boot", "trend", "mr"] as const).map((m) => {
              const pv = ens.pts[m];
              const ep = ((pv - eng.S0) / eng.S0) * 100;
              return (
                <tr key={m}>
                  <td><strong>{MLABEL[m]}</strong></td>
                  <td style={{ textAlign: "right" }}>{inr(pv)}</td>
                  <td style={{ textAlign: "right" }} className={ep >= 0 ? "pos" : "neg"}>{f1(ep)}</td>
                  <td style={{ textAlign: "right" }}>{(ens.w[m] * 100).toFixed(0)}%</td>
                  <td style={{ textAlign: "right" }}>{isFinite(btH[m].maePct) ? `${btH[m].maePct.toFixed(1)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }}>{isFinite(btH[m].hitPct) ? `${btH[m].hitPct.toFixed(0)}%` : "—"}</td>
                </tr>
              );
            })}
            <tr className="active">
              <td><strong className="sec">ENSEMBLE</strong></td>
              <td style={{ textAlign: "right" }}><strong>{inr(ens.tgt)}</strong></td>
              <td style={{ textAlign: "right" }} className={expPct >= 0 ? "pos" : "neg"}><strong>{f1(expPct)}</strong></td>
              <td style={{ textAlign: "right" }}>100%</td>
              <td style={{ textAlign: "right" }} className="faint">—</td>
              <td style={{ textAlign: "right" }} className="faint">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <p className="p-head">Forecast table — horizon × path</p>
        <table className="plain">
          <thead><tr><th>H</th><th style={{ textAlign: "right" }}>P10</th><th style={{ textAlign: "right" }}>P25</th><th style={{ textAlign: "right" }}>P50</th><th style={{ textAlign: "right" }}>P75</th><th style={{ textAlign: "right" }}>P90</th><th style={{ textAlign: "right" }}>ENS</th><th style={{ textAlign: "right" }}>P UP</th></tr></thead>
          <tbody>
            {FC_HORIZONS.map((h) => {
              const e2 = eng.ensemble(h);
              const bb = eng.bands[h - 1];
              return (
                <tr key={h} className={h === H ? "active" : ""} onClick={() => setHorizon(h)} style={{ cursor: "pointer" }}>
                  <td><strong>{h}D</strong></td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p10)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p25)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p50)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p75)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p90)}</td>
                  <td style={{ textAlign: "right" }}><strong className="sec">{inr(e2.tgt)}</strong></td>
                  <td style={{ textAlign: "right" }} className={e2.up >= 50 ? "pos" : "neg"}>{e2.up.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
          REGIME {eng.regime} (H {eng.hu.toFixed(2)}) · RSI {eng.rsiV.toFixed(0)} · HV10/30 {eng.hv10.toFixed(1)}/{eng.hv30.toFixed(1)} · MR HALFLIFE {eng.hl.toFixed(0)}D ·
          BACKTEST = 12 WALK-FORWARD ORIGINS · EDUCATIONAL, NOT A TIP.
        </p>
      </div>
      <div>
        <p className="p-head">AI analyst — FC</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- arima-lstm meta forecaster (module 10) ---------------- */
// Live leg: ARIMA(p,1,0) with AIC order selection + residual diagnostics,
// meta-ensemble of ARIMA / SES / DRIFT / NAIVE / SEASONAL-21 with inverse-MAE
// walk-forward weights. The GPU/LSTM leg trains off-terminal — this ARIMA +
// meta surface is the live desk.

const AM_HORIZONS = [5, 10, 21, 63];
const AM_SIMS = 800;

function solveOLS(X: number[][], y: number[]): number[] | null {
  const k = X[0].length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    const tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let cc = c; cc <= k; cc++) M[r][cc] -= f * M[c][cc];
    }
  }
  return M.map((row, i) => row[k] / M[i][i]);
}

function fitAR(dy: number[], p: number): { coef: number[]; sse: number; resid: number[]; aic: number } | null {
  if (p === 0) {
    const m = avg(dy);
    const resid = dy.map((v) => v - m);
    const sse = resid.reduce((s, v) => s + v * v, 0);
    return { coef: [m], sse, resid, aic: dy.length * Math.log(Math.max(sse / dy.length, 1e-12)) + 2 };
  }
  const X: number[][] = [], y: number[] = [];
  for (let i = p; i < dy.length; i++) {
    X.push([1, ...Array.from({ length: p }, (_, j) => dy[i - 1 - j])]);
    y.push(dy[i]);
  }
  if (X.length < 30) return null;
  const coef = solveOLS(X, y);
  if (!coef) return null;
  const resid = y.map((v, i) => v - (coef[0] + coef.slice(1).reduce((s, c, j) => s + c * X[i][j + 1], 0)));
  const sse = resid.reduce((s, v) => s + v * v, 0);
  return { coef, sse, resid, aic: y.length * Math.log(Math.max(sse / y.length, 1e-12)) + 2 * (p + 1) };
}

function forecastAR(dy: number[], coef: number[], p: number, h: number, lastPx: number): number[] {
  const hist = dy.slice();
  const path = [lastPx];
  let px = lastPx;
  for (let d = 1; d <= h; d++) {
    let m = coef[0];
    for (let j = 0; j < p; j++) m += coef[j + 1] * hist[hist.length - 1 - j];
    hist.push(m);
    px *= Math.exp(m);
    path.push(px);
  }
  return path;
}

function fitSES(closes: number[]): { alpha: number; level: number } {
  const c = closes.slice(-252);
  let bestA = 0.2, bestS = Infinity;
  for (let a = 5; a <= 95; a += 5) {
    const al = a / 100;
    let lv = c[0], sse = 0;
    for (let i = 1; i < c.length; i++) { sse += (c[i] - lv) ** 2; lv = al * c[i] + (1 - al) * lv; }
    if (sse < bestS) { bestS = sse; bestA = al; }
  }
  let lv = c[0];
  for (let i = 1; i < c.length; i++) lv = bestA * c[i] + (1 - bestA) * lv;
  return { alpha: bestA, level: lv };
}

export function ArimaLstmDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState(21);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, close: b.close })));
      })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const eng = useMemo(() => {
    if (bars.length < 260) return null;
    const HMAX = 63;
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);
    const S0 = closes[closes.length - 1];
    if (!(S0 > 0)) return null;
    const dy = logReturns(closes);
    // AIC order selection p = 0..5 on log-returns (d = 1).
    const fits = [0, 1, 2, 3, 4, 5]
      .map((p) => ({ p, f: fitAR(dy, p) }))
      .filter((x): x is { p: number; f: NonNullable<ReturnType<typeof fitAR>> } => !!x.f);
    if (!fits.length) return null;
    const best = fits.reduce((a, b) => (b.f.aic < a.f.aic ? b : a));
    const P = best.p, coef = best.f.coef;
    const resid = best.f.resid.map((v) => v - avg(best.f.resid));
    const rSd = stdev(best.f.resid);
    const rSk = rSd > 0 ? avg(best.f.resid.map((v) => ((v - avg(best.f.resid)) / rSd) ** 3)) : 0;
    const rKu = rSd > 0 ? avg(best.f.resid.map((v) => ((v - avg(best.f.resid)) / rSd) ** 4)) - 3 : 0;
    const jb = dy.length / 6 * (rSk * rSk + (rKu * rKu) / 4);
    let acfMax = 0;
    const rm = avg(best.f.resid);
    const rv = best.f.resid.reduce((s, v) => s + (v - rm) ** 2, 0);
    for (let L = 1; L <= 5; L++) {
      let cv = 0;
      for (let i = L; i < best.f.resid.length; i++) cv += (best.f.resid[i] - rm) * (best.f.resid[i - L] - rm);
      if (rv > 0) acfMax = Math.max(acfMax, Math.abs(cv / rv));
    }
    const ses = fitSES(closes);
    const mu = avg(dy);
    const hv30 = historicalVol(dy.slice(-30)) * 100;
    const hu = hurst(closes.slice(-150));
    const rsiV = last<number>(rsi(closes, 14)) ?? 50;

    function pointsAt(c: number[], h: number): Record<string, number> {
      const s0 = c[c.length - 1];
      const d = logReturns(c);
      const f = fitAR(d, P) ?? fitAR(d, 0)!;
      const ar = forecastAR(d, f.coef, P, h, s0)[h];
      const s = fitSES(c);
      const m = avg(d);
      const dr = s0 * Math.exp(m * h);
      const si = c.length - 1 - 21 + h;
      const sn = si < c.length ? c[si] : s0 * Math.exp(m * h);
      return { arima: ar, ses: s.level, drift: dr, naive: s0, snaive: sn };
    }

    // Residual-bootstrap ARIMA paths for bands.
    const g = gaussFactory(mulberry32(44));
    const paths: number[][] = [];
    for (let s = 0; s < AM_SIMS; s++) {
      const hist = dy.slice();
      let px = S0;
      const path = [S0];
      for (let dd = 1; dd <= HMAX; dd++) {
        let m = coef[0];
        for (let j = 0; j < P; j++) m += coef[j + 1] * hist[hist.length - 1 - j];
        const shock = resid.length ? resid[Math.floor(Math.abs(g()) * resid.length) % resid.length] : 0;
        m += shock;
        hist.push(m);
        px *= Math.exp(m);
        path.push(px);
      }
      paths.push(path);
    }
    const bands: Array<{ p10: number; p25: number; p50: number; p75: number; p90: number }> = [];
    for (let d = 1; d <= HMAX; d++) {
      const col = paths.map((p) => p[d]).sort((a, b) => a - b);
      bands.push({ p10: fcQ(col, 10), p25: fcQ(col, 25), p50: fcQ(col, 50), p75: fcQ(col, 75), p90: fcQ(col, 90) });
    }

    function backtest(h: number) {
      const keys = ["arima", "ses", "drift", "naive", "snaive"];
      const agg: Record<string, { mae: number; hit: number; n: number }> = {};
      for (const k of keys) agg[k] = { mae: 0, hit: 0, n: 0 };
      const step = Math.max(5, Math.floor(h / 3));
      for (let o = 0; o < 10; o++) {
        const idx = closes.length - 1 - h - o * step;
        if (idx < 260) continue;
        const slice = closes.slice(0, idx + 1);
        const actual = closes[idx + h];
        const sOrig = closes[idx];
        if (!(actual > 0) || !(sOrig > 0)) continue;
        const pts = pointsAt(slice, h);
        for (const k of keys) {
          const a = agg[k];
          a.mae += Math.abs(pts[k] - actual) / actual;
          if (Math.sign(pts[k] - sOrig) === Math.sign(actual - sOrig)) a.hit += 1;
          a.n += 1;
        }
      }
      const out: Record<string, { maePct: number; hitPct: number; n: number }> = {};
      for (const k of keys) {
        const a = agg[k];
        out[k] = { maePct: a.n ? (a.mae / a.n) * 100 : NaN, hitPct: a.n ? (a.hit / a.n) * 100 : NaN, n: a.n };
      }
      return out;
    }
    const btCache = new Map<number, ReturnType<typeof backtest>>();
    const bt = (h: number) => {
      let b = btCache.get(h);
      if (!b) { b = backtest(h); btCache.set(h, b); }
      return b;
    };
    function weights(h: number): Record<string, number> {
      const b = bt(h);
      let tot = 0;
      const inv: Record<string, number> = {};
      for (const k of Object.keys(b)) {
        const v = b[k].maePct;
        const w = v && isFinite(v) && v > 0 ? 1 / v : 0;
        inv[k] = w; tot += w;
      }
      const out: Record<string, number> = {};
      for (const k of Object.keys(b)) out[k] = tot > 0 ? inv[k] / tot : 0.2;
      return out;
    }
    function ensemble(h: number) {
      const w = weights(h);
      const pts = pointsAt(closes, h);
      let tgt = 0;
      for (const k of Object.keys(w)) tgt += w[k] * (pts[k] ?? 0);
      const col = paths.map((p) => p[h]);
      const up = col.length ? (col.filter((v) => v > S0).length / col.length) * 100 : NaN;
      return { tgt, pts, w, up };
    }

    return {
      S0, closes, dates, bands, paths, P, coef, fits, ses, mu, hv30, hu, rsiV,
      rSd, rSk, rKu, jb, acfMax, bt, weights, ensemble, pointsAt,
    };
  }, [bars]);

  if (loading) return <div className="panel"><p className="muted">FITTING ARIMA FOR {symbol}…</p></div>;
  if (!eng) return <div className="panel"><p className="neg">NEED 260+ DAILY BARS FOR ARIMA FIT.</p></div>;

  const H = horizon;
  const ens = eng.ensemble(H);
  const b = eng.bands[H - 1];
  const expPct = ((ens.tgt - eng.S0) / eng.S0) * 100;
  const btH = eng.bt(H);
  const inr = (v: number) => (isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : "—");
  const f1 = (v: number) => (isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
  const MLABEL: Record<string, string> = { arima: `ARIMA(${eng.P},1,0)`, ses: `SES α${eng.ses.alpha.toFixed(2)}`, drift: "DRIFT", naive: "NAIVE", snaive: "SEAS-21" };

  async function askAI() {
    const e = eng;
    if (!e) return;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.arima() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${e.S0.toFixed(2)} ARIMA(${e.P},1,0) AIC ${e.fits.find((x) => x.p === e.P)!.f.aic.toFixed(1)} ` +
            `RESID σ ${(e.rSd * 100).toFixed(2)}% SKEW ${e.rSk.toFixed(2)} KURT ${e.rKu.toFixed(2)} JB ${e.jb.toFixed(1)} |ACF|max ${e.acfMax.toFixed(2)} ` +
            `HURST ${e.hu.toFixed(2)} RSI ${e.rsiV.toFixed(0)} HV30 ${e.hv30.toFixed(1)}%. ` +
            `META ${H}D TARGET ${ens.tgt.toFixed(2)} (${f1(expPct)}) P10-P90 ${b.p10.toFixed(2)}-${b.p90.toFixed(2)} P-UP ${ens.up.toFixed(0)}%. ` +
            `W ARIMA ${(ens.w.arima * 100).toFixed(0)}/SES ${(ens.w.ses * 100).toFixed(0)}/DRIFT ${(ens.w.drift * 100).toFixed(0)}/NAIVE ${(ens.w.naive * 100).toFixed(0)}/SEAS ${(ens.w.snaive * 100).toFixed(0)}. ` +
            `BT MAE ARIMA ${btH.arima.maePct.toFixed(1)}%/SES ${btH.ses.maePct.toFixed(1)}%/DRIFT ${btH.drift.maePct.toFixed(1)}%. ` +
            `TASK: MODEL VERDICT + WHICH LEG TO TRUST + 3 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  // Fan: last 90 history + H-day ARIMA bootstrap bands + model lines.
  const HIST = 90;
  const hist = eng.closes.slice(-HIST);
  const W = 640, Hh = 150;
  const arMed = Array.from({ length: H }, (_, i) => eng.bands[i].p50);
  const sesLine = Array.from({ length: H }, () => eng.ensemble(H).pts.ses);
  const driftLine = Array.from({ length: H }, (_, i) => eng.S0 * Math.exp(eng.mu * (i + 1)));
  const allV = [...hist, b.p90, b.p10, ...sesLine, ...driftLine];
  const lo = Math.min(...allV), hi = Math.max(...allV);
  const X = (i: number) => (i / (HIST + H - 1)) * (W - 8) + 4;
  const Y = (v: number) => Hh - 18 - ((v - lo) / (hi - lo || 1)) * (Hh - 34);
  const seq = Array.from({ length: H }, (_, i) => i + 1);
  const bandPoly = (top: number[], bot: number[]) =>
    top.map((_, i) => `${X(HIST - 1 + i).toFixed(1)},${Y(top[i]).toFixed(1)}`).join(" ") + " " +
    bot.map((_, i) => `${X(HIST - 1 + (bot.length - 1 - i)).toFixed(1)},${Y(bot[bot.length - 1 - i]).toFixed(1)}`).join(" ");
  const line = (arr: number[], off: number) => arr.map((v, i) => `${X(off + i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="toolbar">
        <div className="pills">
          {AM_HORIZONS.map((h) => (
            <button key={h} className={`pill${H === h ? " active" : ""}`} onClick={() => setHorizon(h)}>{h}D</button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 11 }}>ARIMA({eng.P},1,0) · {AM_SIMS} BOOT PATHS · 10-ORIGIN META</span>
      </div>
      <div className="cells">
        <div className="cell"><div className="lbl">Last</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.S0)}</div><div className="sub">H {eng.hu.toFixed(2)}</div></div>
        <div className="cell"><div className="lbl">Meta target {H}D</div><div className={`val ${expPct >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{inr(ens.tgt)}</div><div className="sub">{f1(expPct)} expected</div></div>
        <div className="cell"><div className="lbl">P10–P90</div><div className="val" style={{ fontSize: 13 }}>{inr(b.p10)}–{inr(b.p90)}</div><div className="sub">AR boot bands</div></div>
        <div className="cell"><div className="lbl">P(up)</div><div className={`val ${ens.up >= 50 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{ens.up.toFixed(0)}%</div><div className="sub">boot paths</div></div>
        <div className="cell"><div className="lbl">Resid σ</div><div className="val" style={{ fontSize: 15 }}>{(eng.rSd * 100).toFixed(2)}%</div><div className="sub">daily</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{expPct > 2 ? "LEAN LONG" : expPct < -2 ? "LEAN SHORT" : "NEUTRAL"}</div><div className="sub">±2% rule</div></div>
      </div>
      <div className="duo">
        <div className="panel">
          <p className="p-head">AR order — AIC select · p = {eng.P}</p>
          <table className="plain">
            <thead><tr><th>P</th><th style={{ textAlign: "right" }}>AIC</th><th style={{ textAlign: "right" }}>Δ VS BEST</th></tr></thead>
            <tbody>
              {eng.fits.map((x) => (
                <tr key={x.p} className={x.p === eng.P ? "active" : ""}>
                  <td><strong>{x.p}</strong></td>
                  <td style={{ textAlign: "right" }}>{x.f.aic.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }} className="faint">+{(x.f.aic - eng.fits.find((y) => y.p === eng.P)!.f.aic).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
            φ {eng.coef.slice(1).map((c) => c.toFixed(3)).join(" · ") || "— (MEAN ONLY)"} · c {eng.coef[0].toExponential(1)}
          </p>
        </div>
        <div className="panel">
          <p className="p-head">Residual diagnostics</p>
          <div className="kv"><span className="muted">SKEW / KURT</span><strong>{eng.rSk.toFixed(2)} / {eng.rKu.toFixed(2)}</strong></div>
          <div className="kv"><span className="muted">JB STAT</span><strong className={eng.jb < 6 ? "pos" : "neg"}>{eng.jb.toFixed(1)} {eng.jb < 6 ? "≈ NORMAL" : "NON-NORMAL"}</strong></div>
          <div className="kv"><span className="muted">|ACF| MAX L1-5</span><strong className={eng.acfMax < 0.1 ? "pos" : "neg"}>{eng.acfMax.toFixed(2)} {eng.acfMax < 0.1 ? "CLEAN" : "LEFTOVER"}</strong></div>
          <div className="kv"><span className="muted">SES α</span><strong>{eng.ses.alpha.toFixed(2)}</strong></div>
          <div className="kv"><span className="muted">REGIME</span><strong>H {eng.hu.toFixed(2)} · RSI {eng.rsiV.toFixed(0)}</strong></div>
        </div>
      </div>
      <div>
        <p className="p-head">Fan — last {HIST}D + {H}D ahead · amber = AR median · blue = SES · grey = drift</p>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
          <polygon points={bandPoly(seq.map((d) => eng.bands[d - 1].p90), seq.map((d) => eng.bands[d - 1].p10))} fill="rgba(255,160,40,0.13)" />
          <polygon points={bandPoly(seq.map((d) => eng.bands[d - 1].p75), seq.map((d) => eng.bands[d - 1].p25))} fill="rgba(255,160,40,0.22)" />
          <polyline points={line(hist, 0)} fill="none" stroke="#f5f5f4" strokeWidth="1.2" />
          <polyline points={line(arMed, HIST - 1)} fill="none" stroke="#ffa028" strokeWidth="1.8" />
          <polyline points={line(sesLine, HIST - 1)} fill="none" stroke="#00c8ff" strokeWidth="1.2" strokeDasharray="5 3" />
          <polyline points={line(driftLine, HIST - 1)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" strokeDasharray="5 3" />
          <circle cx={X(HIST + H - 1)} cy={Y(ens.tgt)} r="3.5" fill="#00d664" />
          <text x={Math.min(X(HIST + H - 1) - 4, W - 120)} y={Math.max(Y(ens.tgt) - 8, 12)} fontSize="11" fill="#00d664" fontWeight="700" textAnchor="end">{inr(ens.tgt)}</text>
          <text x="4" y={Hh - 4} fontSize="9" fill="#5b5b62">{eng.dates[eng.dates.length - HIST] ?? ""}</text>
          <text x={W - 4} y={Hh - 4} fontSize="9" fill="#5b5b62" textAnchor="end">T+{H}</text>
        </svg>
      </div>
      <div className="panel">
        <p className="p-head">Models — {H}D target · inverse-MAE meta weights</p>
        <table className="plain">
          <thead><tr><th>MODEL</th><th style={{ textAlign: "right" }}>TARGET</th><th style={{ textAlign: "right" }}>EXP%</th><th style={{ textAlign: "right" }}>WGT</th><th style={{ textAlign: "right" }}>BT MAE</th><th style={{ textAlign: "right" }}>HIT%</th></tr></thead>
          <tbody>
            {Object.keys(MLABEL).map((m) => {
              const pv = ens.pts[m] ?? NaN;
              const ep = isFinite(pv) ? ((pv - eng.S0) / eng.S0) * 100 : NaN;
              return (
                <tr key={m}>
                  <td><strong>{MLABEL[m]}</strong></td>
                  <td style={{ textAlign: "right" }}>{inr(pv)}</td>
                  <td style={{ textAlign: "right" }} className={ep >= 0 ? "pos" : "neg"}>{f1(ep)}</td>
                  <td style={{ textAlign: "right" }}>{((ens.w[m] ?? 0) * 100).toFixed(0)}%</td>
                  <td style={{ textAlign: "right" }}>{isFinite(btH[m].maePct) ? `${btH[m].maePct.toFixed(1)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }}>{isFinite(btH[m].hitPct) ? `${btH[m].hitPct.toFixed(0)}%` : "—"}</td>
                </tr>
              );
            })}
            <tr className="active">
              <td><strong className="sec">META</strong></td>
              <td style={{ textAlign: "right" }}><strong>{inr(ens.tgt)}</strong></td>
              <td style={{ textAlign: "right" }} className={expPct >= 0 ? "pos" : "neg"}><strong>{f1(expPct)}</strong></td>
              <td style={{ textAlign: "right" }}>100%</td>
              <td style={{ textAlign: "right" }} className="faint">—</td>
              <td style={{ textAlign: "right" }} className="faint">—</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <p className="p-head">Forecast table — horizon × path</p>
        <table className="plain">
          <thead><tr><th>H</th><th style={{ textAlign: "right" }}>P10</th><th style={{ textAlign: "right" }}>P25</th><th style={{ textAlign: "right" }}>P50</th><th style={{ textAlign: "right" }}>P75</th><th style={{ textAlign: "right" }}>P90</th><th style={{ textAlign: "right" }}>META</th><th style={{ textAlign: "right" }}>P UP</th></tr></thead>
          <tbody>
            {AM_HORIZONS.map((h) => {
              const e2 = eng.ensemble(h);
              const bb = eng.bands[h - 1];
              return (
                <tr key={h} className={h === H ? "active" : ""} onClick={() => setHorizon(h)} style={{ cursor: "pointer" }}>
                  <td><strong>{h}D</strong></td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p10)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p25)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p50)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p75)}</td>
                  <td style={{ textAlign: "right" }}>{inr(bb.p90)}</td>
                  <td style={{ textAlign: "right" }}><strong className="sec">{inr(e2.tgt)}</strong></td>
                  <td style={{ textAlign: "right" }} className={e2.up >= 50 ? "pos" : "neg"}>{e2.up.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
          GPU/LSTM LEG TRAINS OFF-TERMINAL — THIS ARIMA + META SURFACE IS THE LIVE DESK · EDUCATIONAL, NOT A TIP.
        </p>
      </div>
      <div>
        <p className="p-head">AI analyst — AM</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- vol trading framework (module 26) ---------------- */
// Live vol desk: HV term structure, vol percentile vs 1y cone, expected-move
// ladder, Parkinson gap read, regime-matched setup picker + AI strategist.

const VT_TENORS = [7, 14, 30, 60, 90];

export function VolFrameworkDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; open: number; high: number; low: number; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(""); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=2y&interval=1d`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `history ${r.status}`);
        if (alive) setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close })));
      })
      .catch((e) => { if (alive) { setBars([]); setErr(e instanceof Error ? e.message : "fetch failed"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const eng = useMemo(() => {
    if (bars.length < 300) return null;
    const closes = bars.map((b) => b.close);
    const S0 = closes[closes.length - 1];
    if (!(S0 > 0)) return null;
    const lr = logReturns(closes);
    const hv = (w: number) => historicalVol(lr.slice(-w)) * 100;
    const h5 = hv(5), h10 = hv(10), h21 = hv(21), h30 = hv(30), h63 = hv(63), h126 = hv(126), h252 = historicalVol(lr) * 100;
    const ew = ewmaVol(lr);
    const ewNow = (ew.length ? ew[ew.length - 1] : 0) * Math.sqrt(252) * 100;
    const regime = volRegime(h10, h252);
    const compressing = h10 < h252;
    // Vol percentile: today's HV30 ranked against its own 1y history.
    const h30hist: number[] = [];
    for (let i = 0; i <= lr.length - 30; i++) h30hist.push(historicalVol(lr.slice(i, i + 30)) * 100);
    const yr = h30hist.slice(-252);
    const pctile = yr.length ? (yr.filter((v) => v <= h30).length / yr.length) * 100 : NaN;
    const coneLo = yr.length ? Math.min(...yr) : NaN;
    const coneHi = yr.length ? Math.max(...yr) : NaN;
    const coneMd = yr.length ? [...yr].sort((a, b) => a - b)[Math.floor(yr.length / 2)] : NaN;
    // Parkinson (high-low) vs close-close: overnight/gap component.
    let park: number | null = null;
    try {
      const hl = bars.slice(-30);
      if (hl.every((b) => b.high > 0 && b.low > 0 && b.high >= b.low)) {
        const s = hl.reduce((a, b) => a + Math.log(b.high / b.low) ** 2, 0) / (4 * Math.log(2) * hl.length);
        park = Math.sqrt(Math.max(s, 0)) * Math.sqrt(252) * 100;
      }
    } catch { park = null; }
    const gapShare = park !== null && h30 > 0 ? Math.max(0, (1 - (park * park) / (h30 * h30)) * 100) : null;
    const hu = hurst(closes.slice(-150));
    const rsiV = last<number>(rsi(closes, 14)) ?? 50;
    const move = (days: number) => {
      const sd = (h30 / 100) * Math.sqrt(days / 365);
      return { pts: S0 * sd, pct: sd * 100, up: S0 * (1 + sd), dn: S0 * (1 - sd) };
    };
    const straddle30 = S0 * (h30 / 100) * Math.sqrt(30 / 365) * 1.0; // ±1SD move ≈ ATM straddle
    // Regime-matched setup shortlist (educational candidates, not tips).
    const cheap = pctile < 30, rich = pctile > 70;
    const setups: Array<{ s: string; when: string; why: string; risk: string; fit: boolean }> = [
      { s: "LONG STRADDLE", when: "VOL < 30th %ile", why: "CHEAP PREMIUM + EXPANSION AHEAD", risk: "THETA BLEED IF DEAD", fit: cheap },
      { s: "SHORT STRANGLE", when: "VOL > 70th %ile + RANGE", risk: "UNLIMITED TAIL — SIZE SMALL", why: "RICH PREMIUM + DECAY", fit: rich && hu < 0.55 },
      { s: "LONG STRANGLE", when: "SQUEEZE + BREAKOUT RISK", why: "CHEAP WINGS, DEFINED RISK", risk: "NEEDS REAL MOVE", fit: cheap && hu > 0.5 },
      { s: "IRON CONDOR", when: "VOL > 60th %ile + RANGE", why: "DEFINED-RISK DECAY", risk: "GAP THROUGH WING", fit: rich && hu < 0.5 },
      { s: "CALENDAR SPREAD", when: "STEEP CONTANGO (H10<H30)", why: "TERM DECAY DIFFERENTIAL", risk: "SPOT PIN ±", fit: h10 < h30 * 0.9 },
    ];
    return {
      S0, h5, h10, h21, h30, h63, h126, h252, ewNow, regime, compressing,
      pctile, coneLo, coneHi, coneMd, park, gapShare, hu, rsiV, move, straddle30, setups,
      term: [5, 10, 21, 30, 63, 126, 252].map((w) => ({ w, v: historicalVol(lr.slice(-w)) * 100 })),
      coneSeries: yr.slice(-126),
    };
  }, [bars]);

  async function askAI() {
    if (!eng) return;
    const e = eng;
    setAiLoading(true); setAiOut("");
    try {
      const m30 = e.move(30);
      const txt = await chatComplete([
        { role: "system", content: aiSystem.vol() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${e.S0.toFixed(2)} HV10/30/252 ${e.h10.toFixed(1)}/${e.h30.toFixed(1)}/${e.h252.toFixed(1)} ${e.regime} VOL%ILE ${e.pctile.toFixed(0)} ` +
            `30D EXP ±${m30.pct.toFixed(1)}% (${m30.dn.toFixed(0)}–${m30.up.toFixed(0)}) STRADDLE≈${e.straddle30.toFixed(0)} HURST ${e.hu.toFixed(2)} RSI ${e.rsiV.toFixed(0)} ` +
            `PARK ${e.park === null ? "?" : e.park.toFixed(1)} GAP-SHARE ${e.gapShare === null ? "?" : e.gapShare.toFixed(0) + "%"}. ` +
            `TASK: VOL VERDICT + BEST SETUP FAMILY + 3 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e2: any) {
      setAiOut(`AI ERR: ${e2.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <div className="panel"><p className="muted">MEASURING VOL FOR {symbol}…</p></div>;
  if (err && !bars.length) return <div className="panel"><p className="neg">VOL FEED ERR: {err}</p></div>;
  if (!eng) return <div className="panel"><p className="neg">NEED 300+ DAILY BARS FOR VOL TERM.</p></div>;

  const inr = (v: number) => (isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : "—");
  const m30 = eng.move(30);
  const W = 640, Hh = 130;
  const tv = eng.term.map((t) => t.v);
  const tLo = Math.min(...tv, eng.ewNow), tHi = Math.max(...tv, eng.ewNow);
  const TX = (i: number) => (i / Math.max(eng.term.length - 1, 1)) * (W - 8) + 4;
  const TY = (v: number) => Hh - 18 - ((v - tLo) / (tHi - tLo || 1)) * (Hh - 34);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="cells">
        <div className="cell"><div className="lbl">HV30</div><div className="val">{eng.h30.toFixed(1)}%</div><div className="sub">{eng.regime}</div></div>
        <div className="cell"><div className="lbl">Vol %ile 1Y</div><div className={`val ${eng.pctile < 30 ? "pos" : eng.pctile > 70 ? "neg" : ""}`}>{eng.pctile.toFixed(0)}</div><div className="sub">{eng.pctile < 30 ? "CHEAP" : eng.pctile > 70 ? "RICH" : "MID"}</div></div>
        <div className="cell"><div className="lbl">30D exp ±</div><div className="val" style={{ fontSize: 15 }}>{m30.pct.toFixed(1)}%</div><div className="sub">{inr(m30.dn)}–{inr(m30.up)}</div></div>
        <div className="cell"><div className="lbl">Straddle≈</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.straddle30)}</div><div className="sub">ATM 30D</div></div>
        <div className="cell"><div className="lbl">Parkinson</div><div className="val" style={{ fontSize: 15 }}>{eng.park === null ? "—" : `${eng.park.toFixed(1)}%`}</div><div className="sub">{eng.gapShare === null ? "H/L feed gap" : `gap ${eng.gapShare.toFixed(0)}%`}</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{eng.pctile < 30 ? "BUY VOL" : eng.pctile > 70 ? "SELL VOL" : "NEUTRAL"}</div><div className="sub">%ile rule</div></div>
      </div>
      <div className="panel">
        <p className="p-head">HV term structure — {eng.compressing ? "BACKWARDATION (SHORT HOT)" : "CONTANGO (CALM FRONT)"} · EWMA {eng.ewNow.toFixed(1)}%</p>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
          <polyline points={eng.term.map((t, i) => `${TX(i).toFixed(1)},${TY(t.v).toFixed(1)}`).join(" ")} fill="none" stroke="#ffa028" strokeWidth="1.8" />
          {eng.term.map((t, i) => (
            <g key={t.w}>
              <circle cx={TX(i)} cy={TY(t.v)} r="3" fill="#ffa028" />
              <text x={TX(i)} y={TY(t.v) - 8} fontSize="10" fill="#f5f5f4" textAnchor="middle">{t.v.toFixed(1)}</text>
              <text x={TX(i)} y={Hh - 4} fontSize="9" fill="#5b5b62" textAnchor="middle">{t.w}D</text>
            </g>
          ))}
          <line x1="0" x2={W} y1={TY(eng.ewNow)} y2={TY(eng.ewNow)} stroke="#00c8ff" strokeWidth="1" strokeDasharray="5 3" />
          <text x={W - 4} y={TY(eng.ewNow) - 5} fontSize="10" fill="#00c8ff" textAnchor="end">EWMA {eng.ewNow.toFixed(1)}</text>
        </svg>
      </div>
      <div className="duo">
        <div className="panel">
          <p className="p-head">Expected moves — ±1SD off HV30</p>
          <table className="plain">
            <thead><tr><th>TENOR</th><th style={{ textAlign: "right" }}>±%</th><th style={{ textAlign: "right" }}>DOWN</th><th style={{ textAlign: "right" }}>UP</th></tr></thead>
            <tbody>
              {VT_TENORS.map((d) => {
                const m = eng.move(d);
                return (
                  <tr key={d} className={d === 30 ? "active" : ""}>
                    <td><strong>{d}D</strong></td>
                    <td style={{ textAlign: "right" }}>±{m.pct.toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }} className="neg">{inr(m.dn)}</td>
                    <td style={{ textAlign: "right" }} className="pos">{inr(m.up)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <p className="p-head">Vol cone — HV30 vs own 1Y · now {eng.h30.toFixed(1)}%</p>
          <div className="kv"><span className="muted">1Y LOW / MED / HIGH</span><strong>{eng.coneLo.toFixed(1)} / {eng.coneMd.toFixed(1)} / {eng.coneHi.toFixed(1)}</strong></div>
          <div className="kv"><span className="muted">PERCENTILE</span><strong className={eng.pctile < 30 ? "pos" : eng.pctile > 70 ? "neg" : ""}>{eng.pctile.toFixed(0)}TH</strong></div>
          <div style={{ marginTop: 8 }}>
            <Spark data={eng.coneSeries} h={64} />
          </div>
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>HURST {eng.hu.toFixed(2)} · RSI {eng.rsiV.toFixed(0)} · PAIR WITH PRE DESK FOR EVENT DATES</p>
        </div>
      </div>
      <div className="panel">
        <p className="p-head">Setup picker — regime-matched candidates (educational)</p>
        <table className="plain">
          <thead><tr><th style={{ textAlign: "left" }}>SETUP</th><th style={{ textAlign: "left" }}>WHEN</th><th style={{ textAlign: "left" }}>WHY HERE</th><th style={{ textAlign: "left" }}>RISK</th><th style={{ textAlign: "right" }}>FIT</th></tr></thead>
          <tbody>
            {eng.setups.map((s) => (
              <tr key={s.s} className={s.fit ? "active" : ""}>
                <td><strong className={s.fit ? "sec" : ""}>{s.s}</strong></td>
                <td style={{ fontSize: 12 }}>{s.when}</td>
                <td style={{ fontSize: 12 }}>{s.fit ? s.why : <span className="faint">—</span>}</td>
                <td style={{ fontSize: 12 }}>{s.risk}</td>
                <td style={{ textAlign: "right" }}>{s.fit ? <span className="pos">● NOW</span> : <span className="faint">○</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="p-head">AI strategist — VT</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- garch volatility (module 24) ---------------- */
// Real GARCH(1,1) MLE (variance-targeted grid + refine): conditional vol
// series, forward curve, GARCH fan vs constant-vol fan, coverage backtest.

const GV_SIMS = 800;
const GV_TENORS = [1, 5, 10, 21, 63, 126];

export function GarchDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(""); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `history ${r.status}`);
        if (alive) setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close)).map((b) => ({ date: b.date, close: b.close })));
      })
      .catch((e) => { if (alive) { setBars([]); setErr(e instanceof Error ? e.message : "fetch failed"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const eng = useMemo(() => {
    if (bars.length < 300) return null;
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);
    const S0 = closes[closes.length - 1];
    if (!(S0 > 0)) return null;
    const lr = logReturns(closes).slice(-750);
    const mu = avg(lr);
    const x = lr.map((v) => v - mu);
    const vbar = x.reduce((s, v) => s + v * v, 0) / x.length;
    if (!(vbar > 0)) return null;
    const ll = (a: number, b: number) => {
      if (a <= 0 || b <= 0 || a + b >= 0.9999) return -Infinity;
      const om = vbar * (1 - a - b);
      let v = vbar, s = 0;
      for (let i = 0; i < x.length; i++) {
        v = om + a * x[i] * x[i] + b * v;
        if (!(v > 0)) return -Infinity;
        s += Math.log(v) + (x[i] * x[i]) / v;
      }
      return -0.5 * s;
    };
    let bA = 0.08, bB = 0.9, bL = -Infinity;
    for (let a = 2; a <= 20; a += 2) for (let bb = 70; bb <= 96; bb += 2) {
      const L = ll(a / 100, bb / 100);
      if (L > bL) { bL = L; bA = a / 100; bB = bb / 100; }
    }
    for (let a = bA * 100 - 1.5; a <= bA * 100 + 1.5; a += 0.5) for (let bb = bB * 100 - 1.5; bb <= bB * 100 + 1.5; bb += 0.5) {
      const L = ll(a / 100, bb / 100);
      if (L > bL) { bL = L; bA = a / 100; bB = bb / 100; }
    }
    const om = vbar * (1 - bA - bB);
    const pers = bA + bB;
    const hl = pers < 1 && pers > 0 ? -Math.LN2 / Math.log(pers) : NaN;
    // Full-sample conditional variance path.
    const cond: number[] = [];
    let v = vbar;
    for (let i = 0; i < x.length; i++) { v = om + bA * x[i] * x[i] + bB * v; cond.push(v); }
    const condAnn = cond.map((vv) => Math.sqrt(Math.max(vv, 0)) * Math.sqrt(252) * 100);
    const condNow = condAnn[condAnn.length - 1];
    const uncond = Math.sqrt(vbar) * Math.sqrt(252) * 100;
    // Forward expected-variance curve (mean reversion to vbar).
    const fwd = GV_TENORS.map((k) => {
      const ev = vbar + Math.pow(pers, k) * (cond[cond.length - 1] - vbar);
      return { k, v: Math.sqrt(Math.max(ev, 0)) * Math.sqrt(252) * 100 };
    });
    const hv30 = historicalVol(logReturns(closes).slice(-30)) * 100;
    // Fans: GARCH-evolving vol vs constant-vol GBM, same drift.
    const g = gaussFactory(mulberry32(45));
    const mud = mu;
    const cSd = Math.sqrt(vbar);
    const garch: number[][] = [], gbm: number[][] = [];
    for (let s = 0; s < GV_SIMS; s++) {
      let pg = S0, pm = S0, vv = cond[cond.length - 1];
      const fg = [S0], fm = [S0];
      for (let d = 0; d < 63; d++) {
        const z = g();
        const rr = mud + Math.sqrt(Math.max(vv, 0)) * z;
        pm *= Math.exp(rr);
        vv = om + bA * rr * rr + bB * vv;
        fm.push(pm);
        const z2 = g();
        pg *= Math.exp(mud - 0.5 * cSd * cSd + cSd * z2);
        fg.push(pg);
      }
      garch.push(fm); gbm.push(fg);
    }
    const ends = (pp: number[][]) => pp.map((p) => p[p.length - 1]).sort((a, b) => a - b);
    const eG = ends(garch), eB = ends(gbm);
    const qq = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor((p / 100) * arr.length)))];
    const gStats = { p5: qq(eG, 5), p50: qq(eG, 50), p95: qq(eG, 95), loss: (eG.filter((x) => x < S0).length / eG.length) * 100 };
    const bStats = { p5: qq(eB, 5), p50: qq(eB, 50), p95: qq(eB, 95), loss: (eB.filter((x) => x < S0).length / eB.length) * 100 };
    const band = (pp: number[][]) => {
      const o: Array<{ p5: number; p50: number; p95: number }> = [];
      for (let d = 1; d <= 63; d++) {
        const col = pp.map((p) => p[d]).sort((a, b) => a - b);
        o.push({ p5: qq(col, 5), p50: qq(col, 50), p95: qq(col, 95) });
      }
      return o;
    };
    // Coverage backtest: lagged 1-day conditional σ vs |realized| over 126d.
    let c1 = 0, c2 = 0, nB = 0, bias = 0;
    const start = Math.max(1, cond.length - 126);
    for (let i = start; i < x.length; i++) {
      const sig = Math.sqrt(Math.max(cond[i - 1], 0));
      const a = Math.abs(x[i]);
      if (a <= sig) c1++;
      if (a <= 2 * sig) c2++;
      bias += sig - a;
      nB++;
    }
    const hu = hurst(closes.slice(-150));
    return {
      S0, alpha: bA, beta: bB, omega: om, ll: bL, pers, hl, condAnn, condNow, uncond,
      fwd, hv30, garch, gbm, eG, eB, gStats, bStats, bandG: band(garch), bandB: band(gbm),
      cov1: nB ? (c1 / nB) * 100 : NaN, cov2: nB ? (c2 / nB) * 100 : NaN,
      bias: nB ? bias / nB : NaN, nB, hu, dates,
      regime: condNow > uncond * 1.15 ? "ELEVATED" : condNow < uncond * 0.85 ? "DEPRESSED" : "NORMAL",
    };
  }, [bars]);

  async function askAI() {
    if (!eng) return;
    const e = eng;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.garch() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${e.S0.toFixed(2)} GARCH(1,1) α ${e.alpha.toFixed(3)} β ${e.beta.toFixed(3)} PERS ${e.pers.toFixed(3)} HL ${isFinite(e.hl) ? e.hl.toFixed(0) + "D" : "?"} ` +
            `COND ${e.condNow.toFixed(1)}% VS UNCOND ${e.uncond.toFixed(1)}% (${e.regime}) HV30 ${e.hv30.toFixed(1)}% H ${e.hu.toFixed(2)}. ` +
            `FWD 63D ${e.fwd.find((f) => f.k === 63)!.v.toFixed(1)}% FAN63 GARCH P5-P95 ${e.gStats.p5.toFixed(0)}-${e.gStats.p95.toFixed(0)} PLOSS ${e.gStats.loss.toFixed(0)}%. ` +
            `COVER 1σ ${e.cov1.toFixed(0)}% 2σ ${e.cov2.toFixed(0)}% (TARGET 68/95). TASK: VOL VERDICT + PERSISTENCE READ + 3 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e2: any) {
      setAiOut(`AI ERR: ${e2.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <div className="panel"><p className="muted">FITTING GARCH FOR {symbol}…</p></div>;
  if (err && !bars.length) return <div className="panel"><p className="neg">GARCH FEED ERR: {err}</p></div>;
  if (!eng) return <div className="panel"><p className="neg">NEED 300+ DAILY BARS FOR GARCH FIT.</p></div>;

  const inr = (v: number) => (isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : "—");
  const W = 640, Hh = 130;
  const tail = eng.condAnn.slice(-252);
  const cLo = Math.min(...tail), cHi = Math.max(...tail);
  const CX = (i: number) => (i / Math.max(tail.length - 1, 1)) * (W - 8) + 4;
  const CY = (vv: number) => Hh - 18 - ((vv - cLo) / (cHi - cLo || 1)) * (Hh - 34);
  const HIST = 90;
  const hist = bars.map((x) => x.close).slice(-HIST);
  const allV = [...hist, ...eng.garch.flat(), eng.bandG[62].p95, eng.bandG[62].p5];
  const lo = Math.min(...allV), hi = Math.max(...allV);
  const X = (i: number) => (i / (HIST + 63 - 1)) * (W - 8) + 4;
  const Y = (vv: number) => Hh - 18 - ((vv - lo) / (hi - lo || 1)) * (Hh - 34);
  const line = (arr: number[], off: number) => arr.map((vv, i) => `${X(off + i).toFixed(1)},${Y(vv).toFixed(1)}`).join(" ");
  const gPoly = eng.bandG.map((bb, i) => `${X(HIST - 1 + i).toFixed(1)},${Y(bb.p95).toFixed(1)}`).join(" ") + " " +
    eng.bandG.map((bb, i) => `${X(HIST - 1 + (eng.bandG.length - 1 - i)).toFixed(1)},${Y(eng.bandG[eng.bandG.length - 1 - i].p5).toFixed(1)}`).join(" ");
  const FW = eng.fwd;
  const fLo = Math.min(...FW.map((f) => f.v), eng.uncond), fHi = Math.max(...FW.map((f) => f.v), eng.uncond);
  const FX = (i: number) => (i / Math.max(FW.length - 1, 1)) * (W - 8) + 4;
  const FY = (vv: number) => Hh - 18 - ((vv - fLo) / (fHi - fLo || 1)) * (Hh - 34);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="cells">
        <div className="cell"><div className="lbl">Cond vol now</div><div className="val">{eng.condNow.toFixed(1)}%</div><div className="sub">{eng.regime} vs {eng.uncond.toFixed(1)}</div></div>
        <div className="cell"><div className="lbl">α / β</div><div className="val" style={{ fontSize: 15 }}>{eng.alpha.toFixed(3)}/{eng.beta.toFixed(3)}</div><div className="sub">persist {eng.pers.toFixed(3)}</div></div>
        <div className="cell"><div className="lbl">Shock HL</div><div className="val">{isFinite(eng.hl) ? `${eng.hl.toFixed(0)}D` : "—"}</div><div className="sub">mean-revert</div></div>
        <div className="cell"><div className="lbl">Fwd 63D</div><div className="val">{FW.find((f) => f.k === 63)!.v.toFixed(1)}%</div><div className="sub">exp vol</div></div>
        <div className="cell"><div className="lbl">Cover 1σ/2σ</div><div className="val" style={{ fontSize: 15 }}>{eng.cov1.toFixed(0)}/{eng.cov2.toFixed(0)}%</div><div className="sub">tgt 68/95</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{eng.regime === "ELEVATED" ? "FADE SPIKE" : eng.regime === "DEPRESSED" ? "BUY DIP-VOL" : "NEUTRAL"}</div><div className="sub">rev-to-mean</div></div>
      </div>
      <div className="panel">
        <p className="p-head">Conditional vol — 1Y · GARCH(1,1) α {eng.alpha.toFixed(3)} β {eng.beta.toFixed(3)}</p>
        <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
          <line x1="0" x2={W} y1={CY(eng.uncond)} y2={CY(eng.uncond)} stroke="#5b5b62" strokeWidth="1" strokeDasharray="5 3" />
          <polyline points={tail.map((vv, i) => `${CX(i).toFixed(1)},${CY(vv).toFixed(1)}`).join(" ")} fill="none" stroke="#ffa028" strokeWidth="1.6" />
          <circle cx={W - 4} cy={CY(eng.condNow)} r="3" fill={eng.regime === "ELEVATED" ? "#ff453a" : eng.regime === "DEPRESSED" ? "#00d664" : "#ffa028"} />
          <text x={W - 8} y={CY(eng.uncond) - 5} fontSize="10" fill="#5b5b62" textAnchor="end">UNCOND {eng.uncond.toFixed(1)}</text>
          <text x="4" y={Hh - 4} fontSize="9" fill="#5b5b62">-1Y</text>
          <text x={W - 4} y={Hh - 4} fontSize="9" fill="#5b5b62" textAnchor="end">NOW {eng.condNow.toFixed(1)}</text>
        </svg>
      </div>
      <div className="duo">
        <div className="panel">
          <p className="p-head">Forward curve — expected vol by tenor</p>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
            <line x1="0" x2={W} y1={FY(eng.uncond)} y2={FY(eng.uncond)} stroke="#5b5b62" strokeWidth="1" strokeDasharray="5 3" />
            <polyline points={FW.map((f, i) => `${FX(i).toFixed(1)},${FY(f.v).toFixed(1)}`).join(" ")} fill="none" stroke="#00c8ff" strokeWidth="1.8" />
            {FW.map((f, i) => (
              <g key={f.k}>
                <circle cx={FX(i)} cy={FY(f.v)} r="3" fill="#00c8ff" />
                <text x={FX(i)} y={FY(f.v) - 8} fontSize="10" fill="#f5f5f4" textAnchor="middle">{f.v.toFixed(1)}</text>
                <text x={FX(i)} y={Hh - 4} fontSize="9" fill="#5b5b62" textAnchor="middle">{f.k}D</text>
              </g>
            ))}
          </svg>
          <table className="plain" style={{ marginTop: 8 }}>
            <thead><tr><th>TENOR</th><th style={{ textAlign: "right" }}>EXP VOL</th></tr></thead>
            <tbody>
              {FW.map((f) => (
                <tr key={f.k} className={f.k === 63 ? "active" : ""}>
                  <td><strong>{f.k}D</strong></td>
                  <td style={{ textAlign: "right" }}>{f.v.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <p className="p-head">Fan — GARCH vol paths vs const-vol · 63D</p>
          <svg viewBox={`0 0 ${W} ${Hh}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
            <polygon points={gPoly} fill="rgba(255,160,40,0.16)" />
            <polyline points={line(eng.bandB.map((bb) => bb.p50), HIST - 1)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" strokeDasharray="5 3" />
            {eng.garch.filter((_, i) => i % 13 === 0).slice(0, 60).map((p, i) => (
              <polyline key={i} points={line(p.filter((_, d) => d % 3 === 0), HIST - 1)} fill="none" stroke="#ffa028" strokeWidth="1" opacity="0.25" />
            ))}
            <polyline points={line(hist, 0)} fill="none" stroke="#f5f5f4" strokeWidth="1.2" />
          </svg>
          <table className="plain" style={{ marginTop: 8 }}>
            <thead><tr><th></th><th style={{ textAlign: "right" }}>GARCH</th><th style={{ textAlign: "right" }}>CONST-σ</th></tr></thead>
            <tbody>
              <tr><td><strong>P5–P95</strong></td><td style={{ textAlign: "right" }}>{inr(eng.gStats.p5)}–{inr(eng.gStats.p95)}</td><td style={{ textAlign: "right" }}>{inr(eng.bStats.p5)}–{inr(eng.bStats.p95)}</td></tr>
              <tr><td><strong>P50</strong></td><td style={{ textAlign: "right" }}>{inr(eng.gStats.p50)}</td><td style={{ textAlign: "right" }}>{inr(eng.bStats.p50)}</td></tr>
              <tr><td><strong>P(loss)</strong></td><td style={{ textAlign: "right" }}>{eng.gStats.loss.toFixed(0)}%</td><td style={{ textAlign: "right" }}>{eng.bStats.loss.toFixed(0)}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="duo">
        <div className="panel">
          <p className="p-head">Fit — params + backtest</p>
          <div className="kv"><span className="muted">ω / α / β</span><strong>{eng.omega.toExponential(1)} / {eng.alpha.toFixed(3)} / {eng.beta.toFixed(3)}</strong></div>
          <div className="kv"><span className="muted">LOG-LIK</span><strong>{eng.ll.toFixed(0)}</strong></div>
          <div className="kv"><span className="muted">COVER 1σ</span><strong className={Math.abs(eng.cov1 - 68) < 8 ? "pos" : "neg"}>{eng.cov1.toFixed(0)}% (TGT 68)</strong></div>
          <div className="kv"><span className="muted">COVER 2σ</span><strong className={Math.abs(eng.cov2 - 95) < 4 ? "pos" : "neg"}>{eng.cov2.toFixed(0)}% (TGT 95)</strong></div>
          <div className="kv"><span className="muted">HURST</span><strong>{eng.hu.toFixed(2)}</strong></div>
        </div>
        <div>
          <p className="p-head">AI analyst — GV</p>
          <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
          {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- advanced greeks (module 36) ---------------- */
// Full second-order surface: per-strike delta/gamma/theta/vega + vanna/
// vomma/charm/speed, ATM + delta-40 picker, pin/charm risk read.

const AG_TENORS = [7, 14, 30, 60, 90];

function agStep(s: number): number {
  if (s >= 5000) return 100;
  if (s >= 1000) return 50;
  if (s >= 500) return 20;
  if (s >= 100) return 10;
  return 5;
}

export function AdvGreeksDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [dte, setDte] = useState(30);
  const [side, setSide] = useState<"CALL" | "PUT">("CALL");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setBars([]); setAiOut("");
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1y&interval=1d`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setBars(((j.bars ?? []) as any[]).filter((b) => typeof b.close === "number" && isFinite(b.close) && b.close > 0).map((b) => ({ close: b.close })));
      })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const eng = useMemo(() => {
    if (bars.length < 60) return null;
    const closes = bars.map((b) => b.close);
    const S0 = closes[closes.length - 1];
    const lr = logReturns(closes);
    const hv10 = historicalVol(lr.slice(-10)), hv30 = historicalVol(lr.slice(-30)), hv252 = historicalVol(lr);
    const sigma = hv30 || hv252 || 0.3;
    const r = 0.065, T = dte / 365;
    const step = agStep(S0);
    const atm = Math.round(S0 / step) * step;
    const strikes = Array.from({ length: 11 }, (_, i) => atm + (i - 5) * step);
    const rows = strikes.map((K) => ({ K, g: blackScholes(S0, K, T, r, sigma, side) })).filter((x) => x.g);
    if (!rows.length) return null;
    const byDelta = [...rows].sort((a, b) => Math.abs(Math.abs(a.g!.delta) - 0.4) - Math.abs(Math.abs(b.g!.delta) - 0.4))[0];
    const byGamma = [...rows].sort((a, b) => b.g!.gamma - a.g!.gamma)[0];
    const byVanna = [...rows].sort((a, b) => Math.abs(b.g!.vanna) - Math.abs(a.g!.vanna))[0];
    const byVomma = [...rows].sort((a, b) => b.g!.vomma - a.g!.vomma)[0];
    const atmRow = rows.reduce((a, b) => (Math.abs(b.K - S0) < Math.abs(a.K - S0) ? b : a));
    return {
      S0, sigma, hv10, hv30, hv252, regime: volRegime(hv10, hv252),
      rows, atm: atmRow.K, d40: byDelta.K, maxG: byGamma.K, maxVanna: byVanna.K, maxVomma: byVomma.K,
      expMove: S0 * sigma * Math.sqrt(T),
    };
  }, [bars, dte, side]);

  async function askAI() {
    if (!eng) return;
    const e = eng;
    const a = e.rows.find((x) => x.K === e.atm)!.g!;
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.advGreeks() },
        {
          role: "user",
          content: `SEC ${symbol} PX ${e.S0.toFixed(2)} ${side} ${dte}D σ ${(e.sigma * 100).toFixed(1)}% ${e.regime}. ` +
            `ATM ${e.atm} Δ ${a.delta.toFixed(2)} Γ ${a.gamma.toExponential(1)} Θ ${a.theta.toFixed(2)}/D CHARM ${a.charm.toExponential(1)}/D. ` +
            `MAX-Γ ${e.maxG} Δ40 ${e.d40} MAX-VANNA ${e.maxVanna} MAX-VOMMA ${e.maxVomma} EXP ±${e.expMove.toFixed(0)}. ` +
            `TASK: GREEK VERDICT + BIGGEST HIDDEN RISK + 1 ADJUST NOTE. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e2: any) {
      setAiOut(`AI ERR: ${e2.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading) return <div className="panel"><p className="muted">PRICING SURFACE FOR {symbol}…</p></div>;
  if (!eng) return <div className="panel"><p className="neg">NEED 60+ DAILY BARS FOR VOL.</p></div>;

  const f2 = (v: number) => (isFinite(v) ? v.toFixed(2) : "—");
  const fE = (v: number) => (isFinite(v) ? (Math.abs(v) >= 0.01 ? v.toFixed(4) : v.toExponential(1)) : "—");
  const inr = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="toolbar">
        <div className="pills">
          {(["CALL", "PUT"] as const).map((s) => (
            <button key={s} className={`pill${side === s ? " active" : ""}`} onClick={() => setSide(s)}>{s}</button>
          ))}
        </div>
        <div className="pills">
          {AG_TENORS.map((d) => (
            <button key={d} className={`pill${dte === d ? " active" : ""}`} onClick={() => setDte(d)}>{d}D</button>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 11 }}>σ HV30 {(eng.sigma * 100).toFixed(1)}% · R 6.5%</span>
      </div>
      <div className="cells">
        <div className="cell"><div className="lbl">Spot</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.S0)}</div><div className="sub">{eng.regime}</div></div>
        <div className="cell"><div className="lbl">ATM Δ/Γ</div><div className="val" style={{ fontSize: 15 }}>{eng.rows.find((x) => x.K === eng.atm)!.g!.delta.toFixed(2)}/{eng.rows.find((x) => x.K === eng.atm)!.g!.gamma.toExponential(1)}</div><div className="sub">@ {inr(eng.atm)}</div></div>
        <div className="cell"><div className="lbl">Max-Γ pin</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.maxG)}</div><div className="sub">pin risk</div></div>
        <div className="cell"><div className="lbl">Δ40 pick</div><div className="val sec" style={{ fontSize: 15 }}>{inr(eng.d40)}</div><div className="sub">{side} {dte}D</div></div>
        <div className="cell"><div className="lbl">Max vanna</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.maxVanna)}</div><div className="sub">spot/vol x</div></div>
        <div className="cell"><div className="lbl">Exp move ±</div><div className="val" style={{ fontSize: 15 }}>{inr(eng.expMove)}</div><div className="sub">1SD {dte}D</div></div>
      </div>
      <div className="panel">
        <p className="p-head">Surface — {side} · {dte}D · strikes ±5 around ATM</p>
        <div className="scrollx">
          <table className="plain">
            <thead><tr>
              <th style={{ textAlign: "left" }}>STRIKE</th><th style={{ textAlign: "right" }}>PX</th>
              <th style={{ textAlign: "right" }}>Δ</th><th style={{ textAlign: "right" }}>Γ</th>
              <th style={{ textAlign: "right" }}>Θ/D</th><th style={{ textAlign: "right" }}>VEGA</th>
              <th style={{ textAlign: "right" }}>VANNA</th><th style={{ textAlign: "right" }}>VOMMA</th>
              <th style={{ textAlign: "right" }}>CHARM/D</th><th style={{ textAlign: "right" }}>P(ITM)</th>
            </tr></thead>
            <tbody>
              {eng.rows.map(({ K, g }) => {
                const isATM = K === eng.atm, is40 = K === eng.d40;
                return (
                  <tr key={K} className={isATM ? "active" : undefined} style={is40 && !isATM ? { background: "rgba(0,200,255,0.06)" } : undefined}>
                    <td><strong className={isATM ? "sec" : ""}>{inr(K)}{isATM ? " ●" : ""}{is40 ? " Δ40" : ""}</strong></td>
                    <td style={{ textAlign: "right" }}>{f2(g!.price)}</td>
                    <td style={{ textAlign: "right" }}>{f2(g!.delta)}</td>
                    <td style={{ textAlign: "right" }}>{g!.gamma.toExponential(1)}</td>
                    <td style={{ textAlign: "right" }} className="neg">{f2(g!.theta)}</td>
                    <td style={{ textAlign: "right" }}>{f2(g!.vega)}</td>
                    <td style={{ textAlign: "right" }}>{fE(g!.vanna)}</td>
                    <td style={{ textAlign: "right" }}>{fE(g!.vomma)}</td>
                    <td style={{ textAlign: "right" }}>{fE(g!.charm)}</td>
                    <td style={{ textAlign: "right" }}>{(g!.probITM * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
          ● ATM · Δ40 = CLOSEST TO 0.40 DELTA · VANNA = Δ/σ · VOMMA = VEGA CONVEXITY · CHARM = Δ BLEED/DAY · BS ON HV30, NO DIVS
        </p>
      </div>
      <div>
        <p className="p-head">AI analyst — AGRK</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

export function RollingRiskDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [bench, setBench] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(""); setBars([]); setBench([]);
    Promise.all([
      fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`).then((r) => r.json()),
      fetch(`/api/history?symbol=${encodeURIComponent("^NSEI")}&range=3y&interval=1d`).then((r) => r.json()).catch(() => null),
    ])
      .then(([a, b]) => {
        if (!alive) return;
        if (a.error) throw new Error(a.error);
        setBars(a.bars ?? []);
        if (b && !b.error) setBench(b.bars ?? []);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol]);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.rollingRisk() },
        { role: "user", content: `SEC ${symbol}. 3Y ROLLING VOL/SHARPE/BETA/DD/VAR ON TAPE. TASK: REGIME CALL + 3 RISKS + HEDGE NOTE. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (err) return <div className="panel"><p className="neg">ROLLING RISK ERR: {err} (FEED THROTTLED — RETRY)</p></div>;
  if (bars.length < 130) return <div className="panel"><p className="muted">BUILDING 3Y ROLLING RISK FOR {symbol}…</p></div>;

  // Align symbol + benchmark dates
  const bMap = new Map<string, number>();
  bench.forEach((b: any) => { if (typeof b.close === "number") bMap.set(b.date, b.close); });
  const dates: string[] = [];
  const closes: number[] = [];
  const bcloses: number[] = [];
  bars.forEach((b: any) => {
    if (typeof b.close !== "number") return;
    dates.push(b.date);
    closes.push(b.close);
    bcloses.push(bMap.get(b.date) ?? NaN);
  });
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  const brets: number[] = [];
  for (let i = 1; i < bcloses.length; i++) brets.push(bcloses[i - 1] && isFinite(bcloses[i - 1]) && isFinite(bcloses[i]) ? (bcloses[i] - bcloses[i - 1]) / bcloses[i - 1] : NaN);
  const rdates = dates.slice(1);
  const RF = 0.065 / 252;

  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const std = (a: number[]) => {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  };
  const roll = (w: number, fn: (win: number[]) => number): (number | null)[] =>
    rets.map((_, i) => (i + 1 < w ? null : fn(rets.slice(i + 1 - w, i + 1))));
  const rollVol = (w: number) => roll(w, (a) => std(a) * Math.sqrt(252) * 100);
  const rollSharpe = (w: number) => roll(w, (a) => { const s = std(a); return s > 0 ? (mean(a) - RF) / s * Math.sqrt(252) : null as unknown as number; });
  const rollSortino = (w: number) => roll(w, (a) => {
    const ex = a.map((v) => v - RF);
    const neg = ex.filter((v) => v < 0);
    const ds = neg.length > 1 ? std(neg) : std(a);
    return ds > 0 ? (mean(ex) / ds) * Math.sqrt(252) : 0;
  });
  const rollBeta = (w: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = rets.slice(i + 1 - w, i + 1);
    const b = brets.slice(i + 1 - w, i + 1);
    if (b.some((v) => !isFinite(v))) return null;
    const ms = mean(s), mb = mean(b);
    let cov = 0, vb = 0;
    for (let k = 0; k < w; k++) { cov += (s[k] - ms) * (b[k] - mb); vb += (b[k] - mb) * (b[k] - mb); }
    return vb > 0 ? cov / vb : null;
  });
  const rollCorr = (w: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = rets.slice(i + 1 - w, i + 1);
    const b = brets.slice(i + 1 - w, i + 1);
    if (b.some((v) => !isFinite(v))) return null;
    const ms = mean(s), mb = mean(b);
    let cov = 0, vs = 0, vb = 0;
    for (let k = 0; k < w; k++) { cov += (s[k] - ms) * (b[k] - mb); vs += (s[k] - ms) * (s[k] - ms); vb += (b[k] - mb) * (b[k] - mb); }
    return vs > 0 && vb > 0 ? cov / Math.sqrt(vs * vb) : null;
  });
  const rollVaR = (w: number, q: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = [...rets.slice(i + 1 - w, i + 1)].sort((a, b) => a - b);
    return s[Math.floor(q * (s.length - 1))] * 100;
  });
  const rollCVaR = (w: number, q: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = [...rets.slice(i + 1 - w, i + 1)].sort((a, b) => a - b);
    const k = Math.max(1, Math.floor(q * s.length));
    const tail = s.slice(0, k);
    return (tail.reduce((a, b) => a + b, 0) / tail.length) * 100;
  });

  const vol21 = rollVol(21), vol63 = rollVol(63), vol126 = rollVol(126);
  const sh63 = rollSharpe(63), sh126 = rollSharpe(126), so63 = rollSortino(63);
  const beta63 = rollBeta(63), corr63 = rollCorr(63);
  const var95 = rollVaR(63, 0.05), cvar95 = rollCVaR(63, 0.05);

  // Drawdown + episodes (≥2% to register)
  const eq = [100];
  for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
  let runPeak = eq[0], runPeakI = 0, runTrough = eq[0], runTroughI = 0;
  interface Ep { peak: string; trough: string; rec: string; depth: number; days: number; open: boolean }
  const eps: Ep[] = [];
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] >= runPeak) {
      const depth = ((runTrough - runPeak) / runPeak) * 100;
      if (depth <= -2) eps.push({ peak: dates[runPeakI] ?? "", trough: dates[runTroughI] ?? "", rec: dates[i] ?? "", depth, days: i - runPeakI, open: false });
      runPeak = eq[i]; runPeakI = i; runTrough = eq[i]; runTroughI = i;
    } else if (eq[i] < runTrough) { runTrough = eq[i]; runTroughI = i; }
  }
  const curDD = ((eq[eq.length - 1] - runPeak) / runPeak) * 100;
  if (curDD <= -2) eps.push({ peak: dates[runPeakI] ?? "", trough: dates[runTroughI] ?? "", rec: "OPEN", depth: curDD, days: eq.length - 1 - runPeakI, open: true });
  const ddSeries = eq.map((v, i) => {
    let pk = eq[0];
    for (let k = 1; k <= i; k++) if (eq[k] > pk) pk = eq[k];
    return ((v - pk) / pk) * 100;
  });
  const worst = Math.min(...ddSeries);
  const top = [...eps].sort((a, b) => a.depth - b.depth).slice(0, 5);

  const lastV = (a: (number | null)[]) => { for (let i = a.length - 1; i >= 0; i--) { const v = a[i]; if (v !== null && isFinite(v)) return v; } return null; };
  const f1 = (v: number | null, suf = "") => (v === null ? "—" : `${v.toFixed(2)}${suf}`);
  const lv63 = lastV(vol63), ls63 = lastV(sh63), lso = lastV(so63), lb = lastV(beta63), lv = lastV(var95);
  const regime = lv63 !== null && vol126[vol126.length - 1] ? (lv63 > (lastV(vol126) ?? 0) * 1.2 ? "HEATING UP" : lv63 < (lastV(vol126) ?? 0) * 0.8 ? "COOLING OFF" : "NORMAL") : "—";
  const shortD = rdates.map((d) => d.slice(2, 7));
  const x3: [string, string, string] = [shortD[0] ?? "", shortD[Math.floor(shortD.length / 2)] ?? "", shortD[shortD.length - 1] ?? ""];
  const hasBench = bench.length > 50;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{symbol} — rolling risk verdict · 63D window · 3Y tape</p>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Vol 63D</div><div className="val">{lv63 === null ? "—" : `${lv63.toFixed(1)}%`}</div><div className="sub">annualised</div></div>
          <div className="cell"><div className="lbl">Sharpe 63D</div><div className={`val ${(ls63 ?? 0) >= 1 ? "pos" : (ls63 ?? 0) < 0 ? "neg" : ""}`}>{f1(ls63)}</div><div className="sub">good &gt;1</div></div>
          <div className="cell"><div className="lbl">Sortino 63D</div><div className={`val ${(lso ?? 0) >= 1 ? "pos" : (lso ?? 0) < 0 ? "neg" : ""}`}>{f1(lso)}</div><div className="sub">downside</div></div>
          <div className="cell"><div className="lbl">Beta Nifty</div><div className="val">{lb === null ? "—" : lb.toFixed(2)}</div><div className="sub">63D</div></div>
          <div className="cell"><div className="lbl">VaR95 D</div><div className="val neg">{lv === null ? "—" : `${lv.toFixed(2)}%`}</div><div className="sub">daily</div></div>
          <div className="cell"><div className="lbl">Drawdown</div><div className={`val ${curDD < -10 ? "neg" : ""}`}>{worst.toFixed(1)}% / {curDD.toFixed(1)}%</div><div className="sub">worst / now</div></div>
          <div className="cell"><div className="lbl">Regime</div><div className={`val ${regime.includes("HEAT") ? "neg" : regime.includes("COOL") ? "pos" : ""}`} style={{ fontSize: 13 }}>{regime}</div><div className="sub">vol term</div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Vol term-structure — ann % (21/63/126D)</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => `${v.toFixed(1)}%`} series={[
            { label: "HV21", color: "#00c8ff", values: vol21 },
            { label: "HV63", color: "#ffa028", values: vol63 },
            { label: "HV126", color: "#5b5b62", values: vol126 },
          ]} />
        </div>
        <div className="panel">
          <p className="p-head">Risk-adjusted — rolling Sharpe/Sortino</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[
            { label: "SH63", color: "#ffa028", values: sh63 },
            { label: "SH126", color: "#5b5b62", values: sh126 },
            { label: "SO63", color: "#00d664", values: so63 },
          ]} />
          <p className="faint" style={{ fontSize: 11 }}>GUIDES: +1 GOOD · 0 BREAK-EVEN · RF 6.5%.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Beta & correlation vs Nifty — 63D</p>
          {hasBench ? (
            <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[
              { label: "BETA", color: "#ffa028", values: beta63 },
              { label: "CORR", color: "#00c8ff", values: corr63 },
            ]} />
          ) : <p className="muted">BENCHMARK LEG THROTTLED — RETRY.</p>}
        </div>
        <div className="panel">
          <p className="p-head">Tail — rolling VaR95 / CVaR95 % daily</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => `${v.toFixed(2)}%`} series={[
            { label: "VAR95", color: "#ff453a", values: var95 },
            { label: "CVAR95", color: "#8f7bff", values: cvar95 },
          ]} />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Underwater — worst {worst.toFixed(1)}% · now {curDD.toFixed(1)}%</p>
        <AreaChart values={ddSeries} height={110} color="#ff453a" fill="rgba(255,69,58,0.15)" fmt={(v) => `${v.toFixed(1)}%`} label="DD" dates={rdates} />
      </div>

      <div className="panel">
        <p className="p-head">Drawdown episodes — top 5 by depth (≥2%)</p>
        {top.length ? (
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>PEAK</th><th style={{ textAlign: "left" }}>TROUGH</th><th style={{ textAlign: "left" }}>RECOVERY</th><th style={{ textAlign: "right" }}>DEPTH</th><th style={{ textAlign: "right" }}>DAYS</th></tr></thead>
              <tbody>
                {top.map((e, i) => (
                  <tr key={i}>
                    <td><strong>{e.peak}</strong></td>
                    <td>{e.trough}</td>
                    <td>{e.open ? <span className="neg">OPEN</span> : e.rec}</td>
                    <td style={{ textAlign: "right" }} className="neg">{e.depth.toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }}>{e.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">NO ≥2% EPISODES IN WINDOW.</p>}
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — RR</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}


