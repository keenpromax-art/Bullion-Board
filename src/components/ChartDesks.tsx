"use client";

import { useEffect, useState } from "react";
import { useHoverIndex, HoverTip } from "./charts";
import { LineChart, BarChart, Histogram } from "./charts";
import { sma, ema, rsi, macd, bollinger, stochastic, stochRsi, adx, roc, williamsR, mfi, atr, obv, donchian } from "@/lib/indicators";

/* ---------------- svg helpers ---------------- */

const W = 640;

function pathFor(vals: (number | null)[], mn: number, mx: number, H: number, pad = 6): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  vals.forEach((v, i) => {
    if (v === null || v === undefined || !isFinite(v)) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
      return;
    }
    const x = ((i / Math.max(vals.length - 1, 1)) * W).toFixed(1);
    const y = (H - pad - ((v - mn) / (mx - mn || 1)) * (H - pad * 2)).toFixed(1);
    cur.push(`${x},${y}`);
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

function Grid({ H, lines = [0.25, 0.5, 0.75] }: { H: number; lines?: number[] }) {
  return (
    <>
      {lines.map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#26262b" strokeWidth="1" />
      ))}
    </>
  );
}

function Tag({ v, fmt }: { v: number | null; fmt: (n: number) => string }) {
  if (v === null || v === undefined || !isFinite(v)) return <span className="faint">—</span>;
  return <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(v)}</span>;
}

function XHair({ i, n, H }: { i: number; n: number; H: number }) {
  const x = (i / Math.max(n - 1, 1)) * W;
  return <line x1={x} x2={x} y1="0" y2={H} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />;
}

function Dot({ i, n, v, mn, mx, H, color, pad = 6 }: {
  i: number; n: number; v: number | null | undefined; mn: number; mx: number; H: number; color: string; pad?: number;
}) {
  if (v === null || v === undefined || !isFinite(v)) return null;
  const x = (i / Math.max(n - 1, 1)) * W;
  const y = H - pad - ((v - mn) / (mx - mn || 1)) * (H - pad * 2);
  return <circle cx={x} cy={y} r="4" fill={color} stroke="#000" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />;
}

const fPx = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 1 });

interface Bars { date: string; open: number; high: number; low: number; close: number; volume: number }
interface Series {
  rsi: (number | null)[]; macdLine: (number | null)[]; macdSig: (number | null)[]; macdHist: (number | null)[];
  bbU: (number | null)[]; bbM: (number | null)[]; bbL: (number | null)[];
  bbPctB: (number | null)[]; stochK: (number | null)[]; stochD: (number | null)[];
  mfi: (number | null)[]; willr: (number | null)[]; sma20: (number | null)[]; sma50: (number | null)[];
}

/* ---------------- master chart suite ---------------- */

export function ChartPanels({ bars, series }: { bars: Bars[]; series: Series }) {
  if (!bars.length) return null;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume || 0);
  const maxV = Math.max(...vols, 1);
  const pMn = Math.min(...closes, ...series.bbL.filter((v): v is number => v !== null));
  const pMx = Math.max(...closes, ...series.bbU.filter((v): v is number => v !== null));
  const H1 = 170;
  const d0 = bars[0].date, d1 = bars[Math.floor(bars.length / 2)].date, d2 = bars[bars.length - 1].date;
  const rsi = series.rsi.filter((v): v is number => v !== null);
  const rsiLast = rsi.length ? rsi[rsi.length - 1] : null;
  const pxLast = closes.length ? closes[closes.length - 1] : null;
  const n = bars.length;
  const hP = useHoverIndex(n);
  const hV = useHoverIndex(n);
  const hR = useHoverIndex(n);
  const hM = useHoverIndex(n);
  const barAt = (i: number | null) => (i === null ? null : bars[i]);
  const valAt = (arr: (number | null)[], i: number | null) =>
    i === null ? null : (arr[i] === null || arr[i] === undefined || !isFinite(arr[i] as number) ? null : (arr[i] as number));
  return (
    <div className="grid">
      <div className="panel">
        <p className="p-head">Price · BB(20,2) · SMA50 <span className="faint">— {d0} → {d2} · LAST {pxLast !== null ? pxLast.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—"}</span></p>
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H1}`} style={{ width: "100%", height: H1 }} preserveAspectRatio="none" {...hP.bind}>
            <Grid H={H1} />
            {pathFor(series.bbU, pMn, pMx, H1).map((d, i) => <polyline key={`u${i}`} points={d} fill="none" stroke="#5b5b62" strokeWidth="1" strokeDasharray="4 3" />)}
            {pathFor(series.bbL, pMn, pMx, H1).map((d, i) => <polyline key={`l${i}`} points={d} fill="none" stroke="#5b5b62" strokeWidth="1" strokeDasharray="4 3" />)}
            {pathFor(series.bbM, pMn, pMx, H1).map((d, i) => <polyline key={`m${i}`} points={d} fill="none" stroke="#ffa028" strokeWidth="1" strokeDasharray="6 3" />)}
            {pathFor(series.sma50, pMn, pMx, H1).map((d, i) => <polyline key={`s${i}`} points={d} fill="none" stroke="#8f7bff" strokeWidth="1.4" />)}
            {pathFor(closes, pMn, pMx, H1).map((d, i) => <polyline key={`p${i}`} points={d} fill="none" stroke="#ffb000" strokeWidth="1.8" />)}
            {hP.hover !== null && (
              <g>
                <XHair i={hP.hover} n={n} H={H1} />
                <Dot i={hP.hover} n={n} v={closes[hP.hover]} mn={pMn} mx={pMx} H={H1} color="#ffb000" />
                <Dot i={hP.hover} n={n} v={valAt(series.bbM, hP.hover)} mn={pMn} mx={pMx} H={H1} color="#ffa028" />
                <Dot i={hP.hover} n={n} v={valAt(series.sma50, hP.hover)} mn={pMn} mx={pMx} H={H1} color="#8f7bff" />
              </g>
            )}
          </svg>
          {hP.hover !== null && (() => {
            const b = barAt(hP.hover);
            if (!b) return null;
            return (
              <HoverTip
                idx={hP.hover} count={n} date={b.date}
                rows={[
                  { label: "OPEN", color: "#a1a1aa", text: fPx(b.open) },
                  { label: "HIGH", color: "#00d664", text: fPx(b.high) },
                  { label: "LOW", color: "#ff453a", text: fPx(b.low) },
                  { label: "CLOSE", color: "#ffb000", text: fPx(b.close) },
                  { label: "BB MID", color: "#ffa028", text: valAt(series.bbM, hP.hover) === null ? "—" : fPx(valAt(series.bbM, hP.hover)) },
                  { label: "SMA50", color: "#8f7bff", text: valAt(series.sma50, hP.hover) === null ? "—" : fPx(valAt(series.sma50, hP.hover)) },
                ]}
              />
            );
          })()}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
          <span>{d0}</span><span>{d1}</span><span>{d2}</span>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Volume <span className="faint">— SHARES · LAST {(vols[vols.length - 1] / 1e6).toFixed(1)}M</span></p>
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} 70`} style={{ width: "100%", height: 70 }} preserveAspectRatio="none" {...hV.bind}>
            {bars.map((b, i) => {
              const h = Math.max(1, (vols[i] / maxV) * 64);
              return <rect key={i} x={(i / bars.length) * W} y={68 - h} width={Math.max(1, W / bars.length - 0.5)} height={h} fill={b.close >= b.open ? "#00d664" : "#ff453a"} opacity={hV.hover === null || hV.hover === i ? 0.75 : 0.3} />;
            })}
            {hV.hover !== null && <XHair i={hV.hover} n={n} H={70} />}
          </svg>
          {hV.hover !== null && (() => {
            const b = barAt(hV.hover);
            if (!b) return null;
            return (
              <HoverTip
                idx={hV.hover} count={n} date={b.date}
                rows={[
                  { label: "CLOSE", color: "#ffb000", text: fPx(b.close) },
                  { label: "VOLUME", color: "#a1a1aa", text: `${(b.volume / 1e6).toFixed(2)}M` },
                ]}
              />
            );
          })()}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">RSI 14 — <Tag v={rsi[rsi.length - 1]} fmt={(n) => n.toFixed(1)} /> <span className="faint">· 0–100 · &gt;70 HOT · &lt;30 COLD</span></p>
          <div className="chart-wrap">
            <svg viewBox="0 0 640 90" style={{ width: "100%", height: 90 }} preserveAspectRatio="none" {...hR.bind}>
              <line x1="0" x2={W} y1={90 - 6 - 0.7 * 78} y2={90 - 6 - 0.7 * 78} stroke="#ff453a" strokeDasharray="4 3" strokeWidth="1" />
              <line x1="0" x2={W} y1={90 - 6 - 0.3 * 78} y2={90 - 6 - 0.3 * 78} stroke="#00d664" strokeDasharray="4 3" strokeWidth="1" />
              {pathFor(series.rsi, 0, 100, 90).map((d, i) => <polyline key={i} points={d} fill="none" stroke="#8f7bff" strokeWidth="1.6" />)}
              {hR.hover !== null && (
                <g>
                  <XHair i={hR.hover} n={n} H={90} />
                  <Dot i={hR.hover} n={n} v={valAt(series.rsi, hR.hover)} mn={0} mx={100} H={90} color="#8f7bff" />
                </g>
              )}
            </svg>
            {hR.hover !== null && (() => {
              const v = valAt(series.rsi, hR.hover);
              const zone = v === null ? "—" : v >= 70 ? "HOT" : v <= 30 ? "COLD" : "MID";
              return (
                <HoverTip
                  idx={hR.hover} count={n} date={barAt(hR.hover)?.date}
                  rows={[{ label: "RSI", color: "#8f7bff", text: v === null ? "—" : `${v.toFixed(1)} · ${zone}` }]}
                />
              );
            })()}
          </div>
        </div>
        <div className="panel">
          <p className="p-head">MACD 12·26·9 <span className="faint">— LINE / SIGNAL / HIST</span></p>
          <MacdPanel series={series} dates={bars.map((b) => b.date)} />
        </div>
      </div>
    </div>
  );
}

function MacdPanel({ series, dates }: { series: Series; dates?: string[] }) {
  const all = [...series.macdLine, ...series.macdSig].filter((v): v is number => v !== null);
  if (!all.length) return <p className="muted">NO MACD.</p>;
  const mn = Math.min(...all, 0), mx = Math.max(...all, 0);
  const H = 90;
  const lastOf = (arr: (number | null)[]) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && isFinite(arr[i] as number)) return arr[i] as number;
    return null;
  };
  const lL = lastOf(series.macdLine), lS = lastOf(series.macdSig), lH = lastOf(series.macdHist);
  const f2 = (v: number | null) => (v === null ? "—" : v.toFixed(3));
  const zeroY = H - 6 - ((0 - mn) / (mx - mn || 1)) * (H - 12);
  const n = series.macdLine.length;
  const hov = useHoverIndex(n);
  const at = (arr: (number | null)[], i: number | null) =>
    i === null ? null : (arr[i] === null || arr[i] === undefined || !isFinite(arr[i] as number) ? null : (arr[i] as number));
  const yOf = (v: number) => H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
  return (
    <div>
    <div className="chart-wrap">
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none" {...hov.bind}>
      <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#5b5b62" strokeWidth="1" />
      {series.macdHist.map((v, i) => {
        if (v === null || !isFinite(v)) return null;
        const y = H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
        return <rect key={i} x={(i / Math.max(series.macdHist.length - 1, 1)) * W - 1} y={Math.min(y, zeroY)} width={2} height={Math.max(1, Math.abs(y - zeroY))} fill={v >= 0 ? "#00d664" : "#ff453a"} opacity={hov.hover === null || hov.hover === i ? 0.8 : 0.3} />;
      })}
      {pathFor(series.macdLine, mn, mx, H).map((d, i) => <polyline key={`l${i}`} points={d} fill="none" stroke="#ffa028" strokeWidth="1.5" />)}
      {pathFor(series.macdSig, mn, mx, H).map((d, i) => <polyline key={`s${i}`} points={d} fill="none" stroke="#a1a1aa" strokeWidth="1.2" />)}
      {hov.hover !== null && (
        <g>
          <XHair i={hov.hover} n={n} H={H} />
          <Dot i={hov.hover} n={n} v={at(series.macdLine, hov.hover)} mn={mn} mx={mx} H={H} color="#ffa028" />
          <Dot i={hov.hover} n={n} v={at(series.macdSig, hov.hover)} mn={mn} mx={mx} H={H} color="#a1a1aa" />
        </g>
      )}
    </svg>
    {hov.hover !== null && (
      <HoverTip
        idx={hov.hover} count={n} date={dates?.[hov.hover]}
        rows={[
          { label: "LINE", color: "#ffa028", text: f2(at(series.macdLine, hov.hover)) },
          { label: "SIGNAL", color: "#a1a1aa", text: f2(at(series.macdSig, hov.hover)) },
          { label: "HIST", color: "#00d664", text: f2(at(series.macdHist, hov.hover)) },
        ]}
      />
    )}
    </div>
    <div style={{ display: "flex", gap: 10, fontSize: 11 }} className="faint">
      <span><span style={{ color: "#ffa028" }}>■</span> LINE {f2(lL)}</span>
      <span><span style={{ color: "#a1a1aa" }}>■</span> SIGNAL {f2(lS)}</span>
      <span>HIST {f2(lH)}</span>
    </div>
    </div>
  );
}

/* ---------------- extended chart library ---------------- */

const XPANELS: Array<{ id: string; title: string; group: "TREND" | "MOMENTUM" | "VOLATILITY" }> = [
  { id: "candles", title: "CANDLES OHLC", group: "TREND" },
  { id: "ema", title: "EMA 9·21 TREND", group: "TREND" },
  { id: "donch", title: "DONCHIAN 20", group: "TREND" },
  { id: "vwap", title: "VWAP ANCHORED", group: "TREND" },
  { id: "stoch", title: "STOCHASTIC 14·3", group: "MOMENTUM" },
  { id: "mfi", title: "MFI 14", group: "MOMENTUM" },
  { id: "willr", title: "WILLIAMS %R 14", group: "MOMENTUM" },
  { id: "roc", title: "ROC 12 %", group: "MOMENTUM" },
  { id: "srsi", title: "STOCH RSI 14", group: "MOMENTUM" },
  { id: "bbpb", title: "BB %B POSITION", group: "MOMENTUM" },
  { id: "cci", title: "CCI 20", group: "MOMENTUM" },
  { id: "cmf", title: "CMF 20", group: "MOMENTUM" },
  { id: "atr", title: "ATR 14", group: "VOLATILITY" },
  { id: "obv", title: "OBV FLOW", group: "VOLATILITY" },
  { id: "adx", title: "ADX 14 + DI", group: "VOLATILITY" },
];

const XPRESETS: Record<string, string[]> = {
  TREND: ["candles", "ema", "donch", "vwap"],
  MOMENTUM: ["stoch", "mfi", "willr", "roc", "srsi", "bbpb", "cci", "cmf"],
  VOLATILITY: ["atr", "obv", "adx"],
};

const LIB_KEY = "iss.charts.lib";
const LIB_DEFAULT = ["candles", "ema", "stoch", "mfi", "atr", "obv"];

function CandlePanel({ bars, dates, x3 }: { bars: Bars[]; dates: string[]; x3: [string, string, string] }) {
  const n = bars.length;
  const { hover, bind } = useHoverIndex(n);
  const H = 150;
  const mn = Math.min(...bars.map((b) => b.low));
  const mx = Math.max(...bars.map((b) => b.high));
  const yOf = (v: number) => H - 8 - ((v - mn) / (mx - mn || 1)) * (H - 16);
  const bw = W / n;
  const f1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return (
    <div className="panel">
      <p className="p-head">Candles OHLC <span className="faint">— green up · red down</span></p>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none" {...bind}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#26262b" strokeWidth="1" />)}
          {bars.map((b, i) => {
            const up = b.close >= b.open;
            const col = up ? "#00d664" : "#ff453a";
            const x = (i / Math.max(n - 1, 1)) * W;
            const dim = hover === null || hover === i;
            return (
              <g key={i} opacity={dim ? 1 : 0.3}>
                <line x1={x} x2={x} y1={yOf(b.high)} y2={yOf(b.low)} stroke={col} strokeWidth={1} />
                <rect
                  x={x - Math.max(1, bw / 2 - 0.5)} y={Math.min(yOf(b.open), yOf(b.close))}
                  width={Math.max(2, bw - 1)} height={Math.max(1, Math.abs(yOf(b.open) - yOf(b.close)))}
                  fill={col}
                />
              </g>
            );
          })}
          {hover !== null && <XHair i={hover} n={n} H={H} />}
        </svg>
        {hover !== null && bars[hover] && (
          <HoverTip
            idx={hover} count={n} date={dates[hover]}
            rows={[
              { label: "OPEN", color: "#a1a1aa", text: f1(bars[hover].open) },
              { label: "HIGH", color: "#00d664", text: f1(bars[hover].high) },
              { label: "LOW", color: "#ff453a", text: f1(bars[hover].low) },
              { label: "CLOSE", color: "#ffb000", text: f1(bars[hover].close) },
              { label: "CHG %", color: "#8f7bff", text: `${(((bars[hover].close - bars[hover].open) / bars[hover].open) * 100).toFixed(2)}%` },
            ]}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
        <span>{x3[0]}</span><span>{x3[1]}</span><span>{x3[2]}</span>
      </div>
    </div>
  );
}

function cciCalc(high: number[], low: number[], close: number[], p = 20): (number | null)[] {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  return tp.map((_, i) => {
    if (i < p - 1) return null;
    const win = tp.slice(i - p + 1, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / p;
    const md = win.reduce((s, v) => s + Math.abs(v - m), 0) / p;
    return md === 0 ? null : (tp[i] - m) / (0.015 * md);
  });
}

function cmfCalc(high: number[], low: number[], close: number[], vol: number[], p = 20): (number | null)[] {
  return close.map((_, i) => {
    if (i < p - 1) return null;
    let num = 0, den = 0;
    for (let j = i - p + 1; j <= i; j++) {
      const mfm = ((close[j] - low[j]) - (high[j] - close[j])) / ((high[j] - low[j]) || 1);
      num += mfm * (vol[j] || 0);
      den += vol[j] || 0;
    }
    return den ? num / den : null;
  });
}

function vwapCalc(high: number[], low: number[], close: number[], vol: number[]): (number | null)[] {
  let cumPV = 0, cumV = 0;
  return close.map((c, i) => {
    const tp = (high[i] + low[i] + c) / 3;
    cumPV += tp * (vol[i] || 0);
    cumV += vol[i] || 0;
    return cumV ? cumPV / cumV : null;
  });
}

export function ExtraPanels({ bars }: { bars: Bars[] }) {
  const [on, setOn] = useState<string[]>(() => {
    if (typeof window === "undefined") return LIB_DEFAULT;
    try {
      const v = JSON.parse(window.localStorage.getItem(LIB_KEY) ?? "null");
      if (Array.isArray(v)) {
        const clean = v.filter((x) => XPANELS.some((p) => p.id === x));
        if (clean.length) return clean;
      }
    } catch { /* corrupted pref */ }
    return LIB_DEFAULT;
  });
  useEffect(() => {
    try { window.localStorage.setItem(LIB_KEY, JSON.stringify(on)); } catch { /* quota */ }
  }, [on]);
  if (!bars.length) return null;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const vols = bars.map((b) => b.volume || 0);
  const dates = bars.map((b) => b.date);
  const x3: [string, string, string] = [dates[0] ?? "", dates[Math.floor(dates.length / 2)] ?? "", dates[dates.length - 1] ?? ""];
  const f0 = (v: number) => v.toFixed(0);
  const f1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  const fPct = (v: number) => `${v.toFixed(1)}%`;

  const toggle = (id: string) => setOn((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const D = {
    stoch: stochastic(highs, lows, closes, 14, 3),
    mfi: mfi(highs, lows, closes, vols, 14),
    willr: williamsR(highs, lows, closes, 14),
    atr: atr(highs, lows, closes, 14),
    obv: obv(closes, vols),
    roc: roc(closes, 12),
    adx: adx(highs, lows, closes, 14),
    srsi: stochRsi(rsi(closes, 14), 14),
    bb: bollinger(closes, 20, 2),
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    donch: donchian(highs, lows, 20),
    vwap: vwapCalc(highs, lows, closes, vols),
    cci: cciCalc(highs, lows, closes, 20),
    cmf: cmfCalc(highs, lows, closes, vols, 20),
  };

  const renderPanel = (id: string) => {
    const head = (t: string) => <p className="p-head">{t}</p>;
    if (id === "candles") return <CandlePanel key={id} bars={bars} dates={dates} x3={x3} />;
    switch (id) {
      case "stoch":
        return <div className="panel" key={id}>{head("STOCHASTIC 14·3")}<LineChart series={[{ label: "%K", color: "#00d664", values: D.stoch.pctK }, { label: "%D", color: "#ff453a", values: D.stoch.pctD }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "mfi":
        return <div className="panel" key={id}>{head("MFI 14 — 0·100 · >80 HOT · <20 COLD")}<LineChart series={[{ label: "MFI", color: "#8f7bff", values: D.mfi }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "willr":
        return <div className="panel" key={id}>{head("WILLIAMS %R 14 — −100·0")}<LineChart series={[{ label: "%R", color: "#ff453a", values: D.willr }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "roc":
        return <div className="panel" key={id}>{head("ROC 12 %")}<LineChart series={[{ label: "ROC", color: "#00c8ff", values: D.roc }]} height={110} yFmt={fPct} dates={dates} xLabels={x3} /></div>;
      case "srsi":
        return <div className="panel" key={id}>{head("STOCH RSI 14")}<LineChart series={[{ label: "STOCHRSI", color: "#8f7bff", values: D.srsi }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "bbpb":
        return <div className="panel" key={id}>{head("BB %B POSITION — 0·100")}<LineChart series={[{ label: "%B", color: "#a1a1aa", values: D.bb.pctB }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "cci":
        return <div className="panel" key={id}>{head("CCI 20 — >+100 HOT · <−100 COLD")}<LineChart series={[{ label: "CCI", color: "#00c8ff", values: D.cci }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "cmf":
        return <div className="panel" key={id}>{head("CMF 20 — −1·+1 FLOW")}<LineChart series={[{ label: "CMF", color: "#e3b341", values: D.cmf }]} height={110} yFmt={(v) => v.toFixed(2)} dates={dates} xLabels={x3} /></div>;
      case "atr":
        return <div className="panel" key={id}>{head("ATR 14 — ₹ RANGE")}<LineChart series={[{ label: "ATR", color: "#ffa028", values: D.atr }]} height={110} yFmt={f1} dates={dates} xLabels={x3} /></div>;
      case "obv":
        return <div className="panel" key={id}>{head("OBV FLOW")}<LineChart series={[{ label: "OBV", color: "#00d664", values: D.obv }]} height={110} yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} dates={dates} xLabels={x3} /></div>;
      case "adx":
        return <div className="panel" key={id}>{head("ADX 14 + DI — >25 TREND")}<LineChart series={[{ label: "ADX", color: "#ffa028", values: D.adx.adx }, { label: "+DI", color: "#00d664", values: D.adx.pdi }, { label: "−DI", color: "#ff453a", values: D.adx.mdi }]} height={110} yFmt={f0} dates={dates} xLabels={x3} /></div>;
      case "ema":
        return <div className="panel" key={id}>{head("EMA 9·21 TREND")}<LineChart series={[{ label: "CLOSE", color: "#ffb000", values: closes }, { label: "EMA9", color: "#00d664", values: D.ema9 }, { label: "EMA21", color: "#8f7bff", values: D.ema21 }]} height={110} yFmt={f1} dates={dates} xLabels={x3} /></div>;
      case "donch":
        return <div className="panel" key={id}>{head("DONCHIAN 20 CHANNEL")}<LineChart series={[{ label: "CLOSE", color: "#ffb000", values: closes }, { label: "UPPER", color: "#5b5b62", values: D.donch.upper, dashed: true }, { label: "LOWER", color: "#5b5b62", values: D.donch.lower, dashed: true }]} height={110} yFmt={f1} dates={dates} xLabels={x3} /></div>;
      case "vwap":
        return <div className="panel" key={id}>{head("VWAP ANCHORED")}<LineChart series={[{ label: "CLOSE", color: "#ffb000", values: closes }, { label: "VWAP", color: "#ffa028", values: D.vwap, dashed: true }]} height={110} yFmt={f1} dates={dates} xLabels={x3} /></div>;
      default:
        return null;
    }
  };

  return (
    <div className="panel">
      <p className="p-head">Chart library — {on.length}/{XPANELS.length} live · price/volume/RSI/MACD above stay pinned</p>
      <div className="pills">
        {Object.keys(XPRESETS).map((p) => (
          <button key={p} className="pill" onClick={() => setOn(XPRESETS[p])}>{p}</button>
        ))}
        <button className="pill" onClick={() => setOn(XPANELS.map((x) => x.id))}>ALL</button>
        <button className="pill" onClick={() => setOn([])}>NONE</button>
      </div>
      <div className="pills" style={{ marginTop: 8 }}>
        {XPANELS.map((p) => (
          <button key={p.id} className={`pill${on.includes(p.id) ? " active" : ""}`} onClick={() => toggle(p.id)}>{p.title}</button>
        ))}
      </div>
      {on.length > 0 && (
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          {on.map((id) => renderPanel(id))}
        </div>
      )}
    </div>
  );
}

/* ---------------- comparison lab ---------------- */

export function CmpOverlay({ series, dates }: { series: Series; dates?: string[] }) {
  const legs: Array<{ name: string; vals: (number | null)[]; color: string }> = [
    { name: "RSI", vals: series.rsi, color: "#ffa028" },
    { name: "STOCH K", vals: series.stochK, color: "#00d664" },
    { name: "STOCH D", vals: series.stochD, color: "#ff453a" },
    { name: "MFI", vals: series.mfi, color: "#8f7bff" },
    { name: "%B", vals: series.bbPctB, color: "#a1a1aa" },
  ];
  const H = 150;
  const SLICE = 120;
  const cut = legs.map((l) => l.vals.slice(-SLICE));
  const hov = useHoverIndex(SLICE);
  const last20 = (vals: (number | null)[]) => {
    const f = vals.filter((v): v is number => v !== null).slice(-20);
    return f.length ? { mn: Math.min(...f), mx: Math.max(...f), last: f[f.length - 1] } : null;
  };
  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Oscillator overlay — 0·100 scale · last 120 bars</p>
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none" {...hov.bind}>
            <Grid H={H} />
            {legs.map((l, li) => pathFor(cut[li], 0, 100, H).map((d, i) => (
              <polyline key={`${l.name}${i}`} points={d} fill="none" stroke={l.color} strokeWidth="1.5" />
            )))}
            {hov.hover !== null && (
              <g>
                <XHair i={hov.hover} n={SLICE} H={H} />
                {legs.map((l, li) => {
                  const v = cut[li][hov.hover as number];
                  if (v === null || v === undefined || !isFinite(v)) return null;
                  return <Dot key={l.name} i={hov.hover as number} n={SLICE} v={v} mn={0} mx={100} H={H} color={l.color} />;
                })}
              </g>
            )}
          </svg>
          {hov.hover !== null && (
            <HoverTip
              idx={hov.hover} count={SLICE}
              date={dates?.[(dates.length - SLICE + (hov.hover as number)) >= 0 ? dates.length - SLICE + (hov.hover as number) : (hov.hover as number)]}
              rows={legs.map((l, li) => {
                const v = cut[li][hov.hover as number];
                return { label: l.name, color: l.color, text: v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(1) };
              })}
            />
          )}
        </div>
        <div className="pills" style={{ marginTop: 8 }}>
          {legs.map((l) => {
            const f = l.vals.filter((v): v is number => v !== null && isFinite(v));
            const lv = f.length ? f[f.length - 1] : null;
            return <span key={l.name} className="badge" style={{ color: l.color }}>■ {l.name} {lv === null ? "—" : lv.toFixed(1)}</span>;
          })}
        </div>
      </div>
      <div className="panel">
        <p className="p-head">Reading + 20D range</p>
        <table className="plain">
          <thead><tr><th>OSC</th><th style={{ textAlign: "right" }}>NOW</th><th style={{ textAlign: "right" }}>20D LO–HI</th><th style={{ textAlign: "right" }}>ZONE</th></tr></thead>
          <tbody>
            {legs.map((l) => {
              const s = last20(l.vals);
              if (!s) return <tr key={l.name}><td>{l.name}</td><td style={{ textAlign: "right" }}>—</td><td style={{ textAlign: "right" }}>—</td><td style={{ textAlign: "right" }}>—</td></tr>;
              const zone = s.last >= 80 ? "HOT" : s.last <= 20 ? "COLD" : "MID";
              return (
                <tr key={l.name}>
                  <td><strong style={{ color: l.color }}>{l.name}</strong></td>
                  <td style={{ textAlign: "right" }}>{s.last.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{s.mn.toFixed(0)}–{s.mx.toFixed(0)}</td>
                  <td style={{ textAlign: "right" }}><span className={`badge ${zone === "HOT" ? "bad" : zone === "COLD" ? "ok" : ""}`}>{zone}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- pro scorecard ---------------- */

export function Scorecard({ ind, price, sma50 }: { ind: Record<string, number | null>; price: number; sma50: number | null }) {
  const num = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) ? v : NaN);
  const legs: Array<{ name: string; detail: string; score: number }> = [
    { name: "RSI 14", detail: `READ ${isFinite(num(ind.rsi)) ? num(ind.rsi).toFixed(1) : "—"}`, score: isFinite(num(ind.rsi)) ? (num(ind.rsi) < 30 ? 1 : num(ind.rsi) > 70 ? -1 : 0) : 0 },
    { name: "MACD HIST", detail: num(ind.macdHist) >= 0 ? "ABOVE SIGNAL" : "BELOW SIGNAL", score: isFinite(num(ind.macdHist)) ? (num(ind.macdHist) >= 0 ? 1 : -1) : 0 },
    { name: "ADX TREND", detail: `ADX ${isFinite(num(ind.adx)) ? num(ind.adx).toFixed(0) : "—"}`, score: isFinite(num(ind.adx)) ? (num(ind.adx) >= 25 ? 1 : num(ind.adx) >= 15 ? 0 : -1) : 0 },
    { name: "STOCHASTIC", detail: `K ${isFinite(num(ind.stochK)) ? num(ind.stochK).toFixed(0) : "—"}`, score: isFinite(num(ind.stochK)) ? (num(ind.stochK) < 20 ? 1 : num(ind.stochK) > 80 ? -1 : 0) : 0 },
    { name: "BOLLINGER %B", detail: `${isFinite(num(ind.bbPctB)) ? num(ind.bbPctB).toFixed(0) : "—"}TH PCTILE`, score: isFinite(num(ind.bbPctB)) ? (num(ind.bbPctB) < 15 ? 1 : num(ind.bbPctB) > 85 ? -1 : 0) : 0 },
    { name: "PRICE VS SMA50", detail: sma50 ? (price >= sma50 ? "ABOVE" : "BELOW") : "—", score: sma50 ? (price >= sma50 ? 1 : -1) : 0 },
    { name: "MFI FLOW", detail: `MFI ${isFinite(num(ind.mfi)) ? num(ind.mfi).toFixed(0) : "—"}`, score: isFinite(num(ind.mfi)) ? (num(ind.mfi) < 25 ? 1 : num(ind.mfi) > 75 ? -1 : 0) : 0 },
  ];
  const total = legs.reduce((s, l) => s + l.score, 0);
  const score = Math.round((total / (legs.length * 2)) * 100 + 50);
  const verdict = score >= 65 ? "BULLISH" : score <= 35 ? "BEARISH" : "NEUTRAL";
  return (
    <div className="panel panel-glow">
      <p className="p-head">Master score — {score}/100 <span className={`badge ${verdict === "BULLISH" ? "ok" : verdict === "BEARISH" ? "bad" : "fnc"}`}>{verdict}</span></p>
      <div style={{ height: 10, background: "#1a1a1e", borderRadius: 2, marginBottom: 10 }}>
        <div style={{ width: `${score}%`, height: "100%", background: score >= 65 ? "#00d664" : score <= 35 ? "#ff453a" : "#ffa028", borderRadius: 2 }} />
      </div>
      <table className="plain">
        <thead><tr><th>LEG</th><th>READ</th><th style={{ textAlign: "right" }}>VOTE</th></tr></thead>
        <tbody>
          {legs.map((l) => (
            <tr key={l.name}>
              <td><strong>{l.name}</strong></td>
              <td className="faint" style={{ fontSize: 12 }}>{l.detail}</td>
              <td style={{ textAlign: "right" }}><span className={l.score > 0 ? "pos" : l.score < 0 ? "neg" : ""}>{l.score > 0 ? "+1 BULL" : l.score < 0 ? "−1 BEAR" : "0 FLAT"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- chart desk (fetches its own payload) ---------------- */

export function ChartDesk({ symbol, id, mode, title }: { symbol: string; id: string; mode: "suite" | "compare" | "score"; title: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/analysis/${id}?symbol=${encodeURIComponent(symbol)}&range=1y`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "chart failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol, id]);

  if (err) return <div className="panel"><p className="neg">ERR: {err}</p></div>;
  if (!data) return (
    <div className="grid">
      {mode === "score" && <div className="panel"><p className="p-head">Master score</p><p className="muted">SCORING…</p></div>}
      {mode === "compare" && <div className="panel"><p className="p-head">Oscillator overlay</p><p className="muted">LOADING LEGS…</p></div>}
      <div className="panel"><p className="p-head">Price · BB(20,2) · SMA50</p><p className="muted">PLOTTING {title}…</p></div>
      <div className="panel"><p className="p-head">Volume</p><p className="muted">…</p></div>
      <div className="panel"><p className="p-head">Chart library — 14 studies</p><p className="muted">STUDIES ARM WITH DATA…</p></div>
    </div>
  );
  return (
    <div className="grid">
      {mode === "score" && <Scorecard ind={data.indicators ?? {}} price={data.price} sma50={data.indicators?.sma50 ?? null} />}
      {mode === "compare" && <CmpOverlay series={data.series} dates={(data.bars ?? []).map((b: any) => b.date)} />}
      <ChartPanels bars={data.bars ?? []} series={data.series} />
      <ExtraPanels bars={data.bars ?? []} />
    </div>
  );
}

/* ---------------- historical returns ---------------- */

const TRAIL: Array<[string, number]> = [
  ["1D", 1], ["1W", 5], ["1M", 21], ["3M", 63], ["6M", 126],
  ["1Y", 252], ["3Y", 756], ["5Y", 1260], ["10Y", 2520],
];

interface DDEp { peak: string; trough: string; rec: string | null; depth: number; len: number }

function ddEpisodes(equity: number[], dates: string[], top = 5): DDEp[] {
  const out: DDEp[] = [];
  let peak = equity[0], peakI = 0;
  let cur: { peak: number; peakI: number; trough: number; troughI: number } | null = null;
  for (let i = 1; i < equity.length; i++) {
    if (equity[i] >= peak) {
      if (cur && cur.trough < cur.peak) {
        out.push({
          peak: dates[cur.peakI], trough: dates[cur.troughI], rec: dates[i],
          depth: ((cur.trough - cur.peak) / cur.peak) * 100, len: i - cur.peakI,
        });
      }
      peak = equity[i]; peakI = i; cur = null;
    } else if (!cur || equity[i] < cur.trough) {
      cur = { peak, peakI, trough: equity[i], troughI: i };
    }
  }
  if (cur && cur.trough < cur.peak) {
    out.push({
      peak: dates[cur.peakI], trough: dates[cur.troughI], rec: null,
      depth: ((cur.trough - cur.peak) / cur.peak) * 100, len: equity.length - 1 - cur.peakI,
    });
  }
  return out.sort((a, b) => a.depth - b.depth).slice(0, top);
}

export function ReturnsDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=10y&interval=1d`)
      .then((r) => r.json())
      .then((j) => { if (alive) setBars(((j.bars ?? []) as any[]).map((b) => ({ date: b.date, close: b.close }))); })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  if (loading) return <div className="panel"><p className="muted">CRUNCHING 10Y RETURNS…</p></div>;
  if (bars.length < 30) return <div className="panel"><p className="neg">INSUFFICIENT HISTORY FOR RETURNS.</p></div>;

  const closes = bars.map((b) => b.close);
  const dates = bars.map((b) => b.date);
  const last = closes[closes.length - 1];
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);

  const trail = TRAIL.map(([label, n]) => {
    if (closes.length <= n) return { label, ret: null as number | null, cagr: null as number | null };
    const ret = closes[closes.length - 1] / closes[closes.length - 1 - n] - 1;
    return { label, ret: ret * 100, cagr: n >= 252 ? (Math.pow(1 + ret, 252 / n) - 1) * 100 : null };
  });
  const yr = new Date(dates[dates.length - 1] + "T00:00:00").getFullYear();
  const ytdBase = closes[dates.findIndex((d) => d.startsWith(String(yr)))] ?? closes[0];
  const ytd = ((last - ytdBase) / ytdBase) * 100;

  const first = closes[0];
  const mult = last / first;
  const yrsHeld = Math.max(dates.length / 252, 1 / 252);
  const cagrAll = (Math.pow(mult, 1 / yrsHeld) - 1) * 100;

  const byYear = new Map<number, { first: number; last: number }>();
  dates.forEach((d, i) => {
    const y = Number(d.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, { first: closes[i], last: closes[i] });
    else byYear.get(y)!.last = closes[i];
  });
  const years = [...byYear.entries()]
    .map(([y, v]) => ({ y, ret: ((v.last - v.first) / v.first) * 100 }))
    .sort((a, b) => a.y - b.y)
    .slice(-12);

  const upDays = rets.filter((r) => r > 0).length;
  const best = Math.max(...rets) * 100, worst = Math.min(...rets) * 100;
  let mw = 0, ml = 0, cw = 0, cl = 0;
  for (const r of rets) {
    if (r > 0) { cw++; cl = 0; mw = Math.max(mw, cw); }
    else if (r < 0) { cl++; cw = 0; ml = Math.max(ml, cl); }
    else { cw = 0; cl = 0; }
  }
  const monthly: number[] = [];
  const mKeys: string[] = [];
  dates.forEach((d, i) => {
    const k = d.slice(0, 7);
    if (mKeys[mKeys.length - 1] !== k) { mKeys.push(k); monthly.push(i); }
  });
  const mRets = monthly.slice(1).map((idx, k) => ((closes[idx] - closes[monthly[k]]) / closes[monthly[k]]) * 100);
  const bestM = mRets.length ? Math.max(...mRets) : 0;
  const worstM = mRets.length ? Math.min(...mRets) : 0;
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const calBuckets: number[][] = Array.from({ length: 12 }, () => []);
  {
    const mk: string[] = [];
    const ms: number[] = [];
    dates.forEach((d, i) => {
      const k = d.slice(0, 7);
      if (mk[mk.length - 1] !== k) { mk.push(k); ms.push(i); }
    });
    for (let k = 0; k < mk.length; k++) {
      const s = ms[k];
      const e = k + 1 < mk.length ? ms[k + 1] - 1 : closes.length - 1;
      const prev = s > 0 ? closes[s - 1] : closes[s];
      if (!prev || e <= s) continue;
      calBuckets[Number(mk[k].slice(5, 7)) - 1].push(((closes[e] / prev) - 1) * 100);
    }
  }
  const mStats = calBuckets.map((b, m) => ({
    m,
    avg: b.length ? b.reduce((a, x) => a + x, 0) / b.length : 0,
    hit: b.length ? (b.filter((x) => x > 0).length / b.length) * 100 : 0,
    n: b.length,
  }));

  const eq = [100];
  for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
  const eqDates = [dates[0], ...dates.slice(1)];
  const eps = ddEpisodes(eq, eqDates, 5);
  const rCls = (v: number | null) => (v === null ? "" : v >= 0 ? "pos" : "neg");
  const rFmt = (v: number | null, d = 1) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Historical returns — trailing windows · {dates[0]} → {dates[dates.length - 1]}</p>
        <div className="cells" style={{ marginBottom: 10 }}>
          <div className="cell"><div className="lbl">₹1L then</div><div className="val">₹{(100000 * mult).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div><div className="sub">now · {mult.toFixed(1)}×</div></div>
          <div className="cell"><div className="lbl">CAGR full</div><div className={`val ${cagrAll >= 0 ? "pos" : "neg"}`}>{cagrAll >= 0 ? "+" : ""}{cagrAll.toFixed(1)}%</div><div className="sub">{dates.length} sessions</div></div>
          <div className="cell"><div className="lbl">YTD {yr}</div><div className={`val ${ytd >= 0 ? "pos" : "neg"}`}>{ytd >= 0 ? "+" : ""}{ytd.toFixed(1)}%</div><div className="sub">this year</div></div>
          <div className="cell"><div className="lbl">Up days</div><div className="val">{((upDays / Math.max(rets.length, 1)) * 100).toFixed(0)}%</div><div className="sub">{upDays}/{rets.length} sessions</div></div>
          <div className="cell"><div className="lbl">Best day</div><div className="val pos">+{best.toFixed(1)}%</div><div className="sub">single session</div></div>
          <div className="cell"><div className="lbl">Worst day</div><div className="val neg">{worst.toFixed(1)}%</div><div className="sub">single session</div></div>
        </div>
        <table className="plain">
          <thead><tr><th>WINDOW</th><th style={{ textAlign: "right" }}>RETURN</th><th style={{ textAlign: "right" }}>CAGR</th></tr></thead>
          <tbody>
            {trail.map((t) => (
              <tr key={t.label}>
                <td><strong>{t.label}</strong></td>
                <td style={{ textAlign: "right" }}><span className={rCls(t.ret)}>{rFmt(t.ret)}</span></td>
                <td style={{ textAlign: "right" }}><span className={rCls(t.cagr)}>{rFmt(t.cagr)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Yearly returns %</p>
          <BarChart values={years.map((y) => y.ret)} labels={years.map((y) => String(y.y))} height={130} />
        </div>
        <div className="panel">
          <p className="p-head">Daily return distribution %</p>
          <Histogram values={rets.map((r) => r * 100)} bins={24} height={130} />
          <div style={{ marginTop: 8, fontSize: 12 }} className="muted">
            BEST MONTH {bestM >= 0 ? "+" : ""}{bestM.toFixed(1)}% · WORST {worstM.toFixed(1)}% · WIN STREAK {mw} · LOSE STREAK {ml}
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Monthly averages — avg % + hit rate per calendar month</p>
        <BarChart values={mStats.map((s) => Math.round(s.avg * 10) / 10)} labels={MON} height={110} />
        <table className="plain" style={{ marginTop: 8 }}>
          <thead><tr><th></th>{MON.map((m) => <th key={m} style={{ textAlign: "right" }}>{m}</th>)}</tr></thead>
          <tbody>
            <tr>
              <td><strong>AVG %</strong></td>
              {mStats.map((s) => (
                <td key={s.m} style={{ textAlign: "right", background: s.n ? (s.avg >= 0 ? `rgba(0,214,100,${Math.min(0.45, Math.abs(s.avg) / 12)})` : `rgba(255,69,58,${Math.min(0.45, Math.abs(s.avg) / 12)})`) : undefined }}>
                  {s.n ? `${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(1)}` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td><strong>HIT %</strong></td>
              {mStats.map((s) => (
                <td key={s.m} style={{ textAlign: "right" }}>
                  {s.n ? <span className={s.hit >= 60 ? "pos" : s.hit <= 40 ? "neg" : ""}>{s.hit.toFixed(0)}</span> : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <p className="p-head">Worst drawdowns — peak → trough → recovery</p>
        <table className="plain">
          <thead><tr><th>#</th><th>PEAK</th><th>TROUGH</th><th>RECOVERED</th><th style={{ textAlign: "right" }}>DEPTH</th><th style={{ textAlign: "right" }}>BARS</th></tr></thead>
          <tbody>
            {eps.map((e, i) => (
              <tr key={i}>
                <td className="faint">{i + 1}</td>
                <td>{e.peak}</td>
                <td>{e.trough}</td>
                <td>{e.rec ?? <span className="neg">OPEN</span>}</td>
                <td style={{ textAlign: "right" }}><span className="neg">{e.depth.toFixed(1)}%</span></td>
                <td style={{ textAlign: "right" }}>{e.len}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- efficient frontier ---------------- */

export function FrontierPanel({ symbols, title }: { symbols: string[]; title: string }) {
  const [pts, setPts] = useState<Array<{ vol: number; ret: number; w: number[] }> | null>(null);
  const [assets, setAssets] = useState<Array<{ s: string; ret: number; vol: number }> | null>(null);
  const [corr, setCorr] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [nonce, setNonce] = useState(0);
  const [rf, setRf] = useState(6);
  const [blend, setBlend] = useState(100);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(""); setPts(null); setAssets(null); setCorr(null); setAiOut("");
    (async () => {
      try {
        const all = await Promise.all(
          symbols.map(async (s) => {
            const r = await fetch(`/api/history?symbol=${encodeURIComponent(s)}&range=1y&interval=1d`);
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || `history ${r.status}`);
            const c: number[] = (j.bars ?? []).map((b: any) => b.close).filter((v: any) => typeof v === "number" && isFinite(v) && v > 0);
            if (c.length < 60) throw new Error(`SHORT HISTORY ${s}`);
            const lr: number[] = [];
            for (let i = 1; i < c.length; i++) lr.push(Math.log(c[i] / c[i - 1]));
            return { s, lr };
          })
        );
        const n = Math.min(...all.map((a) => a.lr.length));
        const R = all.map((a) => a.lr.slice(-n));
        const k = R.length;
        const mu = R.map((r) => (r.reduce((a, b) => a + b, 0) / r.length) * 252 * 100);
        const cov: number[][] = R.map((a) =>
          R.map((b) => {
            const ma = a.reduce((s, v) => s + v, 0) / a.length;
            const mb = b.reduce((s, v) => s + v, 0) / b.length;
            let c = 0;
            for (let t = 0; t < a.length; t++) c += (a[t] - ma) * (b[t] - mb);
            return (c / (a.length - 1)) * 252 * 10000;
          })
        );
        // Avg pairwise correlation (the diversification dial for k>2).
        let cs = 0, cn = 0;
        for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
          if (cov[a][a] > 0 && cov[b][b] > 0) { cs += cov[a][b] / Math.sqrt(cov[a][a] * cov[b][b]); cn++; }
        }
        const out: Array<{ vol: number; ret: number; w: number[] }> = [];
        const step = k <= 2 ? 0.02 : 0.1;
        const rec = (idx: number, left: number, cur: number[]) => {
          if (idx === k - 1) {
            const w = [...cur, Math.round(left * 100) / 100];
            let ret = 0;
            for (let a = 0; a < k; a++) ret += w[a] * mu[a];
            let v = 0;
            for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) v += w[a] * w[b] * cov[a][b];
            out.push({ vol: Math.sqrt(Math.max(v, 0)), ret, w });
            return;
          }
          for (let x = 0; x <= left + 1e-9; x += step) rec(idx + 1, Math.round((left - x) * 100) / 100, [...cur, Math.round(x * 100) / 100]);
        };
        rec(0, 1, []);
        if (alive) {
          setPts(out);
          setAssets(all.map((a, i) => ({
            s: symbols[i],
            ret: mu[i],
            vol: Math.sqrt(Math.max(cov[i][i], 0)),
          })));
          setCorr(cn ? cs / cn : null);
        }
      } catch (e) {
        if (alive) { setPts([]); setErr(e instanceof Error ? e.message : "fetch failed"); }
      }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join("|"), nonce]);

  async function askAI(bestW: number[], bestRet: number, bestVol: number, bestSh: number) {
    setAiLoading(true); setAiOut("");
    try {
      const { chatComplete, aiSystem, NO_INVENT } = await import("@/lib/ai");
      const { store } = await import("@/lib/store");
      const txt = await chatComplete([
        { role: "system", content: aiSystem.frontier() },
        {
          role: "user",
          content: `PORT ${assets?.map((a, i) => `${a.s.replace(".NS", "")} R${a.ret.toFixed(1)}/V${a.vol.toFixed(1)}`).join(" ")} CORR ${corr === null ? "?" : corr.toFixed(2)} RF ${rf}% ` +
            `MAXSHARPE ${bestSh.toFixed(2)} W[${bestW.map((x) => (x * 100).toFixed(0)).join("/")}] R${bestRet.toFixed(1)}/V${bestVol.toFixed(1)} ` +
            `BLEND ${blend}% SHARPE. TASK: ALLOCATION VERDICT + WHY + 2 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (loading || !pts) return <div className="panel"><p className="muted">OPTIMISING {title}…</p></div>;
  if (!pts.length || !assets) return <div className="panel"><p className="neg">FRONTIER FAILED{err ? `: ${err}` : "."} <button className="ghost" style={{ marginLeft: 6 }} onClick={() => setNonce((n) => n + 1)}>RETRY</button></p></div>;
  const RF = rf;
  const scored = pts.map((p) => ({ ...p, sh: p.vol > 0 ? (p.ret - RF) / p.vol : -Infinity }));
  const best = scored.reduce((a, b) => (b.sh > a.sh ? b : a));
  const minV = pts.reduce((a, b) => (b.vol < a.vol ? b : a));
  const vMn = Math.min(...pts.map((p) => p.vol));
  const vMx = Math.max(...pts.map((p) => p.vol));
  const rMn = Math.min(...pts.map((p) => p.ret));
  const rMx = Math.max(...pts.map((p) => p.ret));
  // Efficient envelope: max return per vol bucket (the actual frontier).
  const NB = 24;
  const env: Array<{ vol: number; ret: number }> = [];
  for (let i = 0; i < NB; i++) {
    const lo = vMn + ((vMx - vMn) * i) / NB, hi = vMn + ((vMx - vMn) * (i + 1)) / NB;
    const inB = pts.filter((p) => p.vol >= lo && p.vol <= hi);
    if (inB.length) {
      const top = inB.reduce((a, b) => (b.ret > a.ret ? b : a));
      env.push({ vol: top.vol, ret: top.ret });
    }
  }
  env.sort((a, b) => a.vol - b.vol);
  // Blend slider: min-vol ↔ max-sharpe interpolation.
  const t = blend / 100;
  const blendW = best.w.map((w, i) => t * w + (1 - t) * minV.w[i]);
  let blendRet = 0;
  for (let i = 0; i < blendW.length; i++) blendRet += blendW[i] * (assets[i] ? assets[i].ret : 0);
  const X = 640, H = 260;
  const px = (v: number) => 44 + ((v - vMn) / (vMx - vMn || 1)) * (X - 84);
  const py = (r: number) => H - 26 - ((r - rMn) / (rMx - rMn || 1)) * (H - 52);
  const wline = (w: number[]) => w.map((x, i) => `${assets[i].s.replace(".NS", "")} ${(x * 100).toFixed(0)}%`).join(" · ");
  const isBench = (s: string) => !s.endsWith(".NS");
  const lblX = (v: number) => (px(v) > X - 76 ? "end" : "start");
  const lblDx = (v: number) => (px(v) > X - 76 ? -7 : 7);

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{title} — {pts.length} portfolios · LONG-ONLY · RF {RF}%{corr !== null ? ` · CORR ${corr.toFixed(2)}` : ""}</p>
        <svg viewBox={`0 0 ${X} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
          {env.length > 1 && (
            <polyline points={env.map((e) => `${px(e.vol).toFixed(1)},${py(e.ret).toFixed(1)}`).join(" ")} fill="none" stroke="#ffa028" strokeWidth="1.6" opacity="0.85" />
          )}
          {pts.map((p, i) => <circle key={i} cx={px(p.vol)} cy={py(p.ret)} r="3.5" fill="#5b5b62" opacity="0.6"><title>VOL {p.vol.toFixed(1)}% · RET {p.ret.toFixed(1)}%</title></circle>)}
          {assets.map((a) => <g key={a.s}><circle cx={px(a.vol)} cy={py(a.ret)} r="4" fill={isBench(a.s) ? "#a1a1aa" : "#ffb000"}><title>{a.s} · VOL {a.vol.toFixed(1)}% · RET {a.ret.toFixed(1)}%</title></circle><text x={px(a.vol) + lblDx(a.vol)} y={py(a.ret) + 4} fontSize="10" fill={isBench(a.s) ? "#a1a1aa" : "#ffb000"} textAnchor={lblX(a.vol)}>{a.s.replace(".NS", "")}</text></g>)}
          <circle cx={px(minV.vol)} cy={py(minV.ret)} r="5" fill="none" stroke="#00d664" strokeWidth="2"><title>MIN VOL · VOL {minV.vol.toFixed(1)}% · RET {minV.ret.toFixed(1)}%</title></circle>
          <circle cx={px(best.vol)} cy={py(best.ret)} r="5" fill="#ffa028"><title>MAX SHARPE {best.sh.toFixed(2)} · VOL {best.vol.toFixed(1)}% · RET {best.ret.toFixed(1)}%</title></circle>
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
          <span>← VOL {vMn.toFixed(0)}% … {vMx.toFixed(0)}% →</span>
          <span>RET {rMn.toFixed(0)}% … {rMx.toFixed(0)}% ↑</span>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <div className="pills">
            <span className="badge" style={{ color: "#ffa028" }}>● MAX SHARPE {best.sh.toFixed(2)}</span>
            <span className="badge ok">○ MIN VOL</span>
            <span className="badge">● GRID</span>
            <span className="badge">— ENVELOPE</span>
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 11 }}>BLEND MIN-VOL ↔ MAX-SHARPE</span>
          <input
            type="range" min={0} max={100} value={blend} onChange={(e) => setBlend(Number(e.target.value))}
            aria-label="Blend min-vol to max-sharpe" style={{ flex: 1, accentColor: "#ffa028" }}
          />
          <span className="sec" style={{ fontSize: 12 }}>{blend}% SHARPE · R{blendRet.toFixed(1)}% · {wline(blendW)}</span>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 11 }}>RF %</span>
          <input
            className="box" value={rf} inputMode="decimal" style={{ maxWidth: 76, padding: "4px 8px" }}
            onChange={(e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setRf(Math.min(20, Math.max(0, v))); }}
            aria-label="Risk-free rate percent"
          />
        </div>
      </div>
      <div className="duo">
        <div className="panel">
          <table className="plain">
            <thead><tr><th>PORT</th><th style={{ textAlign: "right" }}>RET %</th><th style={{ textAlign: "right" }}>VOL %</th><th style={{ textAlign: "right" }}>SHARPE</th><th>WEIGHTS</th></tr></thead>
            <tbody>
              <tr className="active"><td><strong className="sec">MAX SHARPE</strong></td><td style={{ textAlign: "right" }}>{best.ret.toFixed(1)}</td><td style={{ textAlign: "right" }}>{best.vol.toFixed(1)}</td><td style={{ textAlign: "right" }}>{best.sh.toFixed(2)}</td><td className="faint" style={{ fontSize: 11.5 }}>{wline(best.w)}</td></tr>
              <tr><td><strong>MIN VOL</strong></td><td style={{ textAlign: "right" }}>{minV.ret.toFixed(1)}</td><td style={{ textAlign: "right" }}>{minV.vol.toFixed(1)}</td><td style={{ textAlign: "right" }}>{minV.vol > 0 ? ((minV.ret - RF) / minV.vol).toFixed(2) : "—"}</td><td className="faint" style={{ fontSize: 11.5 }}>{wline(minV.w)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <p className="p-head">Assets — 1Y ann.</p>
          <table className="plain">
            <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>RET %</th><th style={{ textAlign: "right" }}>VOL %</th><th style={{ textAlign: "right" }}>SHARPE</th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.s}>
                  <td><strong className={isBench(a.s) ? "" : "sec"}>{a.s.replace(".NS", "")}</strong></td>
                  <td style={{ textAlign: "right" }} className={a.ret >= 0 ? "pos" : "neg"}>{a.ret >= 0 ? "+" : ""}{a.ret.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{a.vol.toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{a.vol > 0 ? ((a.ret - RF) / a.vol).toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <p className="p-head">AI analyst — FR</p>
        <div className="toolbar">
          <button className="btn" onClick={() => askAI(best.w, best.ret, best.vol, best.sh)} disabled={aiLoading}>{aiLoading ? "RUNNING…" : "RUN AI"}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- asset dependency graph ---------------- */

const NET_PEERS = ["RELIANCE.NS", "HDFCBANK.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS", "SBIN.NS", "ITC.NS", "LT.NS"];

export function NetPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<{ labels: string[]; matrix: (number | null)[][] } | null>(null);
  const syms = [symbol, ...NET_PEERS.filter((s) => s !== symbol)].slice(0, 8);
  useEffect(() => {
    let alive = true;
    fetch(`/api/corr?syms=${encodeURIComponent(syms.join(","))}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j.labels) setData(j); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syms.join("|")]);

  if (!data) return <div className="panel"><p className="muted">MAPPING GRAPH…</p></div>;
  const n = data.labels.length;
  const R = 110, CX = 160, CY = 150;
  const pos = data.labels.map((_, i) => {
    if (i === 0) return { x: CX, y: CY };
    const a = ((i - 1) / Math.max(n - 1, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) };
  });
  const edges: Array<{ i: number; j: number; v: number }> = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = data.matrix[i][j];
    if (v !== null && Math.abs(v) >= 0.25) edges.push({ i, j, v });
  }
  return (
    <div className="grid grid-2">
      <div className="panel panel-glow">
        <p className="p-head">Dependency graph — |ρ| ≥ 0.25 · 1Y</p>
        <svg viewBox="0 0 320 300" style={{ width: "100%", height: 300 }}>
          {edges.map((e, k) => (
            <line
              key={k} x1={pos[e.i].x} y1={pos[e.i].y} x2={pos[e.j].x} y2={pos[e.j].y}
              stroke={e.v >= 0 ? "#00d664" : "#ff453a"} strokeWidth={1 + Math.abs(e.v) * 4} opacity="0.65"
            />
          ))}
          {pos.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={i === 0 ? 13 : 10} fill={i === 0 ? "#ffa028" : "#121214"} stroke="#ffa028" strokeWidth="1.5">
                <title>{data.labels[i]}{i > 0 && data.matrix[0][i] !== null ? ` · ρ ${Number(data.matrix[0][i]).toFixed(2)} vs ${data.labels[0]}` : " · CENTER"}</title>
              </circle>
              <text x={p.x} y={p.y + 24} fontSize="9" fill="#a1a1aa" textAnchor="middle">{data.labels[i].replace(".NS", "")}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="panel">
        <p className="p-head">Links to {symbol.replace(".NS", "")}</p>
        <table className="plain">
          <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>ρ</th></tr></thead>
          <tbody>
            {data.labels.slice(1).map((l, k) => {
              const v = data.matrix[0][k + 1];
              return (
                <tr key={l}>
                  <td><span className="sec">{l.replace(".NS", "")}</span></td>
                  <td style={{ textAlign: "right" }}><span className={v !== null && v >= 0.5 ? "pos" : v !== null && v < 0 ? "neg" : ""}>{v !== null ? v.toFixed(2) : "—"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- monte-carlo fan ---------------- */

export function MCFan({ paths }: { paths: number[][] }) {
  if (!paths || !paths.length) return null;
  const W2 = 640, H = 130;
  let mn = Infinity, mx = -Infinity;
  for (const p of paths) for (const v of p) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const ends = paths.map((p) => p[p.length - 1]).filter(isFinite).sort((a, b) => a - b);
  const eLo = ends.length ? ends[Math.floor(ends.length * 0.05)] : mn;
  const eHi = ends.length ? ends[Math.floor(ends.length * 0.95)] : mx;
  return (
    <div style={{ marginTop: 10 }}>
      <p className="p-head">Path fan — {paths.length} shown · P5–P95 ends ₹{Math.round(eLo).toLocaleString("en-IN")}–₹{Math.round(eHi).toLocaleString("en-IN")}</p>
      <svg viewBox={`0 0 ${W2} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
        {paths.map((p, i) => (
          <polyline
            key={i}
            points={p.map((v, k) => `${((k / Math.max(p.length - 1, 1)) * W2).toFixed(1)},${(H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12)).toFixed(1)}`).join(" ")}
            fill="none" stroke="#ffa028" strokeWidth="1" opacity="0.22"
          />
        ))}
      </svg>
    </div>
  );
}
