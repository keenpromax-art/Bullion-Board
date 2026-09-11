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
