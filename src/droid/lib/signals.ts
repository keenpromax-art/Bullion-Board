// Bullion Droid — technical/risk signals computed from the 1Y DAILY tape.
// Pure math, framework-free. Nothing is guessed: a metric with no data is
// null and renders as "—" with a caveat (data-honesty rule).

import type { OHLCBar } from "@/lib/types";
import { adx, bollinger, last, macd, pctReturns, rsi, sma, stochastic } from "@/lib/indicators";
import { maxDrawdown } from "@/lib/risk";

export interface TechSnapshot {
  price: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  pctB: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  adx14: number | null;
  pdi: number | null;
  mdi: number | null;
  stochK: number | null;
  stochD: number | null;
  sma50: number | null;
  sma200: number | null;
  ret1M: number | null;
  ret1Y: number | null;
  vol1Y: number | null; // annualised %, daily σ × √252
  maxDD: number | null; // % over the window
  atrPct: number | null;
  bars: number;
}

export type VerdictTone = "up" | "down" | "flat" | "none";

export interface Verdict {
  label: string;
  value: string;
  tone: VerdictTone;
  detail: string;
}

const ok = (v: number | null | undefined): v is number => typeof v === "number" && isFinite(v);

export function techSnapshot(bars: OHLCBar[]): TechSnapshot {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const price = n ? close[n - 1] : null;

  const rsiV = n >= 15 ? last(rsi(close, 14)) : null;
  const m = n >= 35 ? macd(close) : null;
  const bb = n >= 21 ? bollinger(close) : null;
  const a = n >= 20 ? adx(high, low, close) : null;
  const st = n >= 17 ? stochastic(high, low, close) : null;
  const s50 = n >= 50 ? last(sma(close, 50)) : null;
  const s200 = n >= 200 ? last(sma(close, 200)) : null;

  // returns over the window
  const rets = pctReturns(close);
  let vol: number | null = null;
  if (rets.length >= 20) {
    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const varr = rets.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (rets.length - 1);
    vol = Math.sqrt(varr) * Math.sqrt(252) * 100;
  }

  const ret1M = n > 21 && close[n - 22] ? ((close[n - 1] - close[n - 22]) / close[n - 22]) * 100 : null;
  const ret1Y = n > 1 && close[0] ? ((close[n - 1] - close[0]) / close[0]) * 100 : null;
  const dd = n >= 20 ? maxDrawdown(close).pct : null;

  // ATR % from the last 14 true ranges
  let atrPct: number | null = null;
  if (n >= 15 && price) {
    let sum = 0;
    for (let i = n - 14; i < n; i++) {
      const tr = Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1])
      );
      sum += tr;
    }
    const atr = sum / 14;
    atrPct = price ? (atr / price) * 100 : null;
  }

  return {
    price,
    rsi14: rsiV,
    macdLine: m ? last(m.line) : null,
    macdSignal: m ? last(m.signal) : null,
    macdHist: m ? last(m.hist) : null,
    pctB: bb ? last(bb.pctB) : null,
    bbUpper: bb ? last(bb.upper) : null,
    bbLower: bb ? last(bb.lower) : null,
    adx14: a ? last(a.adx) : null,
    pdi: a ? last(a.pdi) : null,
    mdi: a ? last(a.mdi) : null,
    stochK: st ? last(st.pctK) : null,
    stochD: st ? last(st.pctD) : null,
    sma50: s50,
    sma200: s200,
    ret1M,
    ret1Y,
    vol1Y: vol,
    maxDD: dd,
    atrPct,
    bars: n,
  };
}

/** Trend: price vs SMA50 vs SMA200. */
export function trendVerdict(t: TechSnapshot): Verdict {
  const { price, sma50, sma200 } = t;
  if (!ok(price) || !ok(sma50)) return { label: "TREND", value: "—", tone: "none", detail: "NOT ENOUGH BARS FOR A 50-DAY AVERAGE" };
  if (!ok(sma200))
    return {
      label: "TREND",
      value: price >= sma50 ? "UP" : "DOWN",
      tone: price >= sma50 ? "up" : "down",
      detail: "PRICE VS 50-DAY ONLY — 200-DAY NEEDS 200 BARS OF TAPE",
    };
  if (price > sma50 && sma50 > sma200) return { label: "TREND", value: "BULLISH", tone: "up", detail: "PRICE > 50-DAY > 200-DAY" };
  if (price < sma50 && sma50 < sma200) return { label: "TREND", value: "BEARISH", tone: "down", detail: "PRICE < 50-DAY < 200-DAY" };
  return { label: "TREND", value: "MIXED", tone: "flat", detail: "50-DAY AND 200-DAY ARE NOT ALIGNED" };
}

export function rsiVerdict(t: TechSnapshot): Verdict {
  const v = t.rsi14;
  if (!ok(v)) return { label: "RSI(14)", value: "—", tone: "none", detail: "NEED 15+ DAILY BARS" };
  if (v >= 70) return { label: "RSI(14)", value: v.toFixed(1), tone: "down", detail: "OVERBOUGHT ZONE (≥70)" };
  if (v <= 30) return { label: "RSI(14)", value: v.toFixed(1), tone: "up", detail: "OVERSOLD ZONE (≤30)" };
  return { label: "RSI(14)", value: v.toFixed(1), tone: "flat", detail: "NEUTRAL BAND (30–70)" };
}

export function macdVerdict(t: TechSnapshot): Verdict {
  const h = t.macdHist;
  if (!ok(h)) return { label: "MACD(12,26,9)", value: "—", tone: "none", detail: "NEED 35+ DAILY BARS" };
  if (h > 0) return { label: "MACD(12,26,9)", value: "+", tone: "up", detail: `HISTOGRAM POSITIVE (${h.toFixed(2)})` };
  if (h < 0) return { label: "MACD(12,26,9)", value: "−", tone: "down", detail: `HISTOGRAM NEGATIVE (${h.toFixed(2)})` };
  return { label: "MACD(12,26,9)", value: "0", tone: "flat", detail: "FLAT — NO MOMENTUM EDGE" };
}

export function momentumVerdict(t: TechSnapshot): Verdict {
  const m = t.ret1M;
  if (!ok(m)) return { label: "MOMENTUM 1M", value: "—", tone: "none", detail: "NEED 22+ DAILY BARS" };
  const s = `${m >= 0 ? "+" : ""}${m.toFixed(1)}%`;
  if (m >= 5) return { label: "MOMENTUM 1M", value: s, tone: "up", detail: "STRONG POSITIVE MOVE OVER 1 MONTH" };
  if (m <= -5) return { label: "MOMENTUM 1M", value: s, tone: "down", detail: "STRONG NEGATIVE MOVE OVER 1 MONTH" };
  return { label: "MOMENTUM 1M", value: s, tone: "flat", detail: "RANGE-BOUND OVER 1 MONTH" };
}

export function riskVerdict(t: TechSnapshot, beta?: number | null): Verdict {
  const v = t.vol1Y;
  if (!ok(v)) return { label: "RISK", value: "—", tone: "none", detail: "NEED 20+ DAILY BARS" };
  const b = ok(beta) ? ` · BETA ${beta.toFixed(2)}` : "";
  if (v >= 45) return { label: "RISK", value: "HIGH", tone: "down", detail: `ANNUALISED VOL ${v.toFixed(0)}%${b}` };
  if (v >= 22) return { label: "RISK", value: "MODERATE", tone: "flat", detail: `ANNUALISED VOL ${v.toFixed(0)}%${b}` };
  return { label: "RISK", value: "LOW", tone: "up", detail: `ANNUALISED VOL ${v.toFixed(0)}%${b}` };
}

/** Fundamentals verdict from the company profile — no data → honest gap. */
export function fundamentalVerdict(p: {
  margins?: { net?: number | null; roe?: number | null };
  financials?: { revGrowth?: number | null };
} | null): Verdict {
  const net = p?.margins?.net ?? null;
  const roe = p?.margins?.roe ?? null;
  const g = p?.financials?.revGrowth ?? null;
  if (!ok(net) && !ok(roe) && !ok(g))
    return { label: "FUNDAMENTALS", value: "—", tone: "none", detail: "PROFILE REPORTED NO MARGIN, ROE OR GROWTH — NOTHING INVENTED" };
  const parts: string[] = [];
  if (ok(net)) parts.push(`NET MARGIN ${net.toFixed(1)}%`);
  if (ok(roe)) parts.push(`ROE ${roe.toFixed(1)}%`);
  if (ok(g)) parts.push(`REV GROWTH ${g >= 0 ? "+" : ""}${g.toFixed(1)}%`);
  const strong = ok(net) && net > 10 && ok(roe) && roe > 12 && (!ok(g) || g > 0);
  const weak = (ok(net) && net < 3) || (ok(roe) && roe < 6) || (ok(g) && g < -5);
  return {
    label: "FUNDAMENTALS",
    value: strong ? "STRONG" : weak ? "WEAK" : "MIXED",
    tone: strong ? "up" : weak ? "down" : "flat",
    detail: parts.join(" · "),
  };
}
