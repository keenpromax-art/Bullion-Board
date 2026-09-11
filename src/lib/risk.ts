// Risk / backtest math — ports of MetricsCalculator, RiskMetrics,
// _trade_statistics, _kelly_stats, _atr_position_sizing, VaR/CVaR, GARCH-EWMA.

import { mulberry32, randnFactory, safeDiv } from "./utils";

export function sharpe(dailyReturns: number[], rfAnnual = 0.06, tradingDays = 252): number {
  if (dailyReturns.length < 2) return 0;
  const rfD = rfAnnual / tradingDays;
  const ex = dailyReturns.map((r) => r - rfD);
  const m = ex.reduce((a, b) => a + b, 0) / ex.length;
  const sd = Math.sqrt(ex.reduce((s, v) => s + (v - m) ** 2, 0) / (ex.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(tradingDays) : 0;
}

export function sortino(dailyReturns: number[], rfAnnual = 0.06, tradingDays = 252): number {
  if (dailyReturns.length < 2) return 0;
  const rfD = rfAnnual / tradingDays;
  const ex = dailyReturns.map((r) => r - rfD);
  const m = ex.reduce((a, b) => a + b, 0) / ex.length;
  const neg = dailyReturns.filter((r) => r < 0);
  const allSd = Math.sqrt(ex.reduce((s, v) => s + (v - m) ** 2, 0) / (ex.length - 1));
  const ds = neg.length > 1
    ? Math.sqrt(neg.reduce((s, v) => s + (v - m) ** 2, 0) / (neg.length - 1))
    : allSd;
  return ds > 0 ? (m / ds) * Math.sqrt(tradingDays) : 0;
}

export function maxDrawdown(equity: number[]): { pct: number; peak: number; trough: number } {
  let peak = equity[0] ?? 1, maxDd = 0, pk = peak, tr = peak;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDd) { maxDd = dd; pk = peak; tr = v; }
  }
  return { pct: maxDd * 100, peak: pk, trough: tr };
}

export function varCvar(returns: number[], conf = 0.95): { VaR: number; CVaR: number } {
  if (returns.length === 0) return { VaR: 0, CVaR: 0 };
  const s = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - conf) * s.length);
  const v = s[Math.max(0, Math.min(idx, s.length - 1))];
  const tail = s.filter((r) => r <= v);
  return { VaR: v, CVaR: tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : v };
}

export function profitFactor(returns: number[]): number {
  const gross = returns.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const loss = Math.abs(returns.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  if (loss === 0) return gross > 0 ? Infinity : 0;
  return gross / loss;
}

export function kelly(winRate: number, avgWin: number, avgLoss: number): number {
  // f* = p - q/b  where b = avgWin/|avgLoss|
  if (avgLoss === 0 || !isFinite(avgWin) || !isFinite(avgLoss)) return 0;
  const b = Math.abs(avgWin / avgLoss);
  if (b === 0) return 0;
  const p = winRate, q = 1 - p;
  return p - q / b;
}

export function streaks(pnls: number[]): { maxWin: number; maxLoss: number } {
  let mw = 0, ml = 0, cw = 0, cl = 0;
  for (const p of pnls) {
    if (p > 0) { cw++; cl = 0; mw = Math.max(mw, cw); }
    else if (p < 0) { cl++; cw = 0; ml = Math.max(ml, cl); }
    else { cw = 0; cl = 0; }
  }
  return { maxWin: mw, maxLoss: ml };
}

// EWMA volatility (RiskMetrics, lambda=0.94) — used by _m3_ewma_vol / GARCH-lite
export function ewmaVol(returns: number[], lambda = 0.94): number[] {
  const out: number[] = [];
  let v = returns.length ? returns[0] ** 2 : 0;
  for (const r of returns) {
    v = lambda * v + (1 - lambda) * r * r;
    out.push(Math.sqrt(Math.max(v, 0)));
  }
  return out;
}

export function atrPositionSize(equity: number, riskPct: number, atr: number, entry: number, stopMult = 2): { shares: number; riskRs: number } {
  const riskRs = equity * riskPct;
  const stopDist = atr * stopMult;
  if (stopDist <= 0 || entry <= 0) return { shares: 0, riskRs };
  return { shares: Math.floor(riskRs / stopDist), riskRs };
}

// GBM Monte-Carlo fan — port of _m3_run_monte_carlo / QuantRiskSimulator
export function monteCarloGBM(S0: number, mu: number, sigma: number, days: number, sims: number, seed = 42): number[][] {
  const uniform = mulberry32(seed);
  const randn = randnFactory(uniform);
  const dt = 1 / 252;
  const paths: number[][] = [];
  for (let s = 0; s < sims; s++) {
    const path = [S0];
    for (let d = 0; d < days; d++) {
      const z = randn();
      const prev = path[path.length - 1];
      path.push(prev * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z));
    }
    paths.push(path);
  }
  return paths;
}

export function cagrFromEquity(start: number, end: number, bars: number, barsPerYear = 252): number | null {
  if (start <= 0 || end <= 0 || bars <= 0) return null;
  const years = bars / barsPerYear;
  return Math.pow(end / start, 1 / years) - 1;
}

export function calmar(totalReturnPct: number, maxDdPct: number, bars: number, barsPerYear = 252): number | null {
  if (!maxDdPct || maxDdPct === 0) return null;
  const years = bars / barsPerYear;
  if (years <= 0) return null;
  const ann = Math.pow(1 + totalReturnPct / 100, 1 / years) - 1;
  return ann / (Math.abs(maxDdPct) / 100);
}

export function tradeStats(returns: number[]) {
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = returns.length ? wins.length / returns.length : 0;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  return { winRate, avgWin, avgLoss, kellyF: kelly(winRate, avgWin, Math.abs(avgLoss)), profitFactor: profitFactor(returns) };
}

export { safeDiv };
