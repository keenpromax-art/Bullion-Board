// Black-Scholes + Greeks — port of QuantSyntheticOptions._black_scholes_and_greeks
// and BSMEngine.compute from special.py (uses pure-TS normal cdf/pdf, no scipy).

import type { Greeks, OptionSide } from "./types";

// Abramowitz & Stegun approximation for standard normal CDF
export function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function blackScholes(
  S: number, K: number, T: number, r: number, sigma: number, side: OptionSide
): Greeks | null {
  const T_MIN = 1 / 365;
  if (S <= 0 || K <= 0 || sigma <= 0 || T <= 0) return null;
  const Tc = Math.max(T, T_MIN);
  const sqrtT = Math.sqrt(Tc);
  const sigSqrtT = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * Tc) / sigSqrtT;
  const d2 = d1 - sigSqrtT;
  const Nd1 = normCdf(d1), Nd2 = normCdf(d2);
  const Nd1n = normCdf(-d1), Nd2n = normCdf(-d2);
  const nd1 = normPdf(d1);
  const disc = Math.exp(-r * Tc);
  let price: number, delta: number, theta: number, rho: number, charm: number;
  if (side === "CALL") {
    price = S * Nd1 - K * disc * Nd2;
    delta = Nd1;
    theta = (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * disc * Nd2) / 365;
    rho = (K * Tc * disc * Nd2) / 100;
    charm = -((nd1 * (2 * r * Tc - d2 * sigSqrtT)) / (2 * Tc * sigSqrtT)) / 365;
  } else {
    price = K * disc * Nd2n - S * Nd1n;
    delta = Nd1 - 1;
    theta = (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * disc * Nd2n) / 365;
    rho = (-K * Tc * disc * Nd2n) / 100;
    charm = ((nd1 * (2 * r * Tc - d2 * sigSqrtT)) / (2 * Tc * sigSqrtT)) / 365;
  }
  price = Math.max(price, 0);
  const gamma = nd1 / (S * sigSqrtT);
  const vega = (S * nd1 * sqrtT) / 100;
  const vanna = (-nd1 * d2) / sigma;
  const vomma = ((vega * d1 * d2) / sigma / 100);
  const speed = (-gamma * (d1 / sigSqrtT + 1)) / S;
  const moneyness = S / K;
  const intrinsic = side === "CALL" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const extrinsic = Math.max(price - intrinsic, 0);
  const breakeven = side === "CALL" ? K + price : K - price;
  const probITM = side === "CALL" ? Nd2 : Nd2n;
  return { price, delta, gamma, theta, vega, rho, vanna, vomma, charm, speed, probITM, intrinsic, extrinsic, breakeven, moneyness };
}

// Expected-move + trend-bias strategy picker — mirrors _fetch_and_analyze/_generate_strategy
export function historicalVol(logReturns: number[], window?: number): number {
  const r = window ? logReturns.slice(-window) : logReturns;
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  return sd * Math.sqrt(252);
}

export function volRegime(hv10: number, hv252: number): string {
  if (hv10 > hv252 * 1.3) return "EXPANDING (HIGH)";
  if (hv10 < hv252 * 0.7) return "COMPRESSING (LOW)";
  return "NORMAL (MEAN REVERTING)";
}

export function trendBias(close: number[]): number {
  if (close.length < 50) return 0;
  const emaN = (span: number) => {
    const k = 2 / (span + 1);
    let e = close[0];
    for (let i = 1; i < close.length; i++) e = close[i] * k + e * (1 - k);
    return e;
  };
  const ema9 = emaN(9), ema21 = emaN(21);
  const sma50 = close.slice(-50).reduce((a, b) => a + b, 0) / 50;
  const S0 = close[close.length - 1];
  let score = 0;
  score += S0 > ema9 ? 0.3 : -0.3;
  score += ema9 > ema21 ? 0.4 : -0.4;
  score += S0 > sma50 ? 0.3 : -0.3;
  return score;
}

export function recommendStrike(S0: number, T: number, r: number, sigma: number, side: OptionSide): { strike: number; greeks: Greeks | null } {
  const step = S0 > 1000 ? 10 : S0 > 200 ? 5 : 1;
  let best = S0, bestG: Greeks | null = null, bestDiff = Infinity;
  for (let K = S0 * 0.8; K <= S0 * 1.2; K += step) {
    const g = blackScholes(S0, K, T, r, sigma, side);
    if (!g) continue;
    const diff = Math.abs(Math.abs(g.delta) - 0.4);
    const okSide = side === "CALL" ? K >= S0 : K <= S0;
    if (okSide && diff < bestDiff) { bestDiff = diff; best = K; bestG = g; }
  }
  return { strike: Math.round(best / step) * step, greeks: bestG };
}

// ---------- Stock Greeks: how the STOCK moves ----------
// Greek-letter sensitivities of the equity itself (vs Nifty + India VIX),
// for desk 33. No option contracts involved: Δ = market sensitivity,
// drift = trend carry, Γ = change in pace, Θ = volatility bleed,
// V = reaction to fear spikes. All NaN-safe — missing inputs stay NaN so
// renderers print their standard data-gap dash.

export interface StockGreeks {
  bench: string;
  vixSym: string;
  nPaired: number;
  beta60: number;
  beta120: number;
  r2: number;
  corr: number;
  alpha60ann: number;
  upCapture: number;
  downCapture: number;
  drift20: number;
  drift60: number;
  accel: number;
  volDragAnn: number;
  volBeta: number;
  volBetaCorr: number;
  expMove1d: number;
  expMove1dPct: number;
  expMove1w: number;
  expMove1wPct: number;
  hv10: number;
  hv30: number;
  hv252: number;
  regime: string;
}

interface DayBar { date: string; high: number; low: number; close: number }

// Pair daily % returns of two tapes by calendar date (drops NSE/index
// holiday mismatches instead of misaligning the regression).
export function alignPctReturns(
  stock: Array<{ date: string; close: number }>,
  other: Array<{ date: string; close: number }>
): Array<{ s: number; b: number }> {
  const om = new Map<string, number>();
  for (const b of other) {
    if (isFinite(b.close) && b.close > 0) om.set(b.date, b.close);
  }
  const out: Array<{ s: number; b: number }> = [];
  for (let i = 1; i < stock.length; i++) {
    const p = stock[i - 1], c = stock[i];
    if (!isFinite(p.close) || !isFinite(c.close) || p.close <= 0 || c.close <= 0) continue;
    const pb = om.get(p.date), cb = om.get(c.date);
    if (pb === undefined || cb === undefined || pb <= 0 || cb <= 0) continue;
    out.push({ s: c.close / p.close - 1, b: cb / pb - 1 });
  }
  return out;
}

export function olsSlope(x: number[], y: number[], minObs = 10): { slope: number; r2: number; corr: number } {
  const n = Math.min(x.length, y.length);
  if (n < minObs) return { slope: NaN, r2: NaN, corr: NaN };
  const xs = x.slice(-n), ys = y.slice(-n);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(sxx > 0) || !(syy > 0)) return { slope: NaN, r2: NaN, corr: NaN };
  const corr = sxy / Math.sqrt(sxx * syy);
  return { slope: sxy / sxx, r2: corr * corr, corr };
}

function driftPct(close: number[], n: number, endOff = 0): number {
  const end = close.length - 1 - endOff;
  const start = end - n;
  if (start < 0 || end >= close.length) return NaN;
  const a = close[start], b = close[end];
  return a > 0 && isFinite(a) && isFinite(b) ? (b / a - 1) * 100 : NaN;
}

function wilderAtr14(high: number[], low: number[], close: number[]): number {
  if (close.length < 15) return NaN;
  let atr = 0;
  for (let i = 1; i < close.length; i++) {
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (!isFinite(tr)) return NaN;
    atr = i <= 14 ? atr + tr / 14 : (atr * 13 + tr) / 14;
  }
  return atr;
}

export function stockGreeks(
  stock: DayBar[],
  bench: Array<{ date: string; close: number }> | null,
  vix: Array<{ date: string; close: number }> | null
): StockGreeks {
  const close = stock.map((b) => b.close);
  const price = close.length ? close[close.length - 1] : NaN;
  const lrets: number[] = [];
  for (let i = 1; i < close.length; i++) {
    if (close[i] > 0 && close[i - 1] > 0) lrets.push(Math.log(close[i] / close[i - 1]));
  }
  const hv10 = historicalVol(lrets, 10);
  const hv30 = historicalVol(lrets, 30);
  const hv252 = historicalVol(lrets);

  const paired = bench ? alignPctReturns(stock, bench).slice(-130) : [];
  const w60 = paired.slice(-60);
  const b60 = olsSlope(w60.map((p) => p.b), w60.map((p) => p.s), 20);
  const b120 = olsSlope(paired.map((p) => p.b), paired.map((p) => p.s), 60);
  let alpha60ann = NaN;
  if (w60.length >= 20 && isFinite(b60.slope)) {
    const ms = w60.reduce((a, p) => a + p.s, 0) / w60.length;
    const mb = w60.reduce((a, p) => a + p.b, 0) / w60.length;
    alpha60ann = (ms - b60.slope * mb) * 252 * 100;
  }
  let upCapture = NaN, downCapture = NaN;
  if (w60.length >= 20) {
    const up = w60.filter((p) => p.b > 0), dn = w60.filter((p) => p.b < 0);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const muS = avg(up.map((p) => p.s)), muB = avg(up.map((p) => p.b));
    const mdS = avg(dn.map((p) => p.s)), mdB = avg(dn.map((p) => p.b));
    upCapture = muB ? (muS / muB) * 100 : NaN;
    downCapture = mdB ? (mdS / mdB) * 100 : NaN;
  }

  const vpaired = vix ? alignPctReturns(stock, vix).slice(-60) : [];
  const vb = olsSlope(vpaired.map((p) => p.b), vpaired.map((p) => p.s), 20);

  const atr14 = wilderAtr14(stock.map((b) => b.high), stock.map((b) => b.low), close);
  const expMove1d = atr14;
  const expMove1w = isFinite(atr14) ? atr14 * Math.sqrt(5) : NaN;

  return {
    bench: bench ? "^NSEI" : "—",
    vixSym: vix ? "^INDIAVIX" : "—",
    nPaired: paired.length,
    beta60: b60.slope,
    beta120: b120.slope,
    r2: b60.r2,
    corr: b60.corr,
    alpha60ann,
    upCapture,
    downCapture,
    drift20: driftPct(close, 20),
    drift60: driftPct(close, 60),
    accel: driftPct(close, 20) - driftPct(close, 20, 20),
    volDragAnn: isFinite(hv30) && hv30 > 0 ? -(hv30 * hv30) / 2 * 100 : NaN,
    volBeta: vb.slope,
    volBetaCorr: vb.corr,
    expMove1d,
    expMove1dPct: isFinite(atr14) && price > 0 ? (atr14 / price) * 100 : NaN,
    expMove1w,
    expMove1wPct: isFinite(expMove1w) && price > 0 ? (expMove1w / price) * 100 : NaN,
    hv10,
    hv30,
    hv252,
    regime: volRegime(hv10, hv252),
  };
}
