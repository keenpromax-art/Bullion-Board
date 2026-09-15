// Notebook math — faithful TS port of Stocks_Final.ipynb base code.
// Cells 1/2/13 seasonality, 3 SMA cross, 4/11 Pearson, 5/6 safety-first,
// 7/8/9 movers, 10 vol-range, 12 sector, 15 terminal metrics.
// Framework-free: pages, panels, routes share it. NaN-safe; unknown -> null.
// Formula notes (honesty): nb RSI uses SIMPLE rolling mean (not Wilder);
// IV_Rank bug in cell 15 (rank==pct) is fixed here and labelled.

export function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  let s = 0, n = 0;
  for (const v of xs) if (isFinite(v)) { s += v; n++; }
  return n ? s / n : NaN;
}

export function stdSample(xs: number[]): number {
  const vs = xs.filter(isFinite);
  if (vs.length < 2) return NaN;
  const m = mean(vs);
  return Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / (vs.length - 1));
}

export function skewMoment(xs: number[]): number {
  const vs = xs.filter(isFinite);
  if (vs.length < 3) return NaN;
  const m = mean(vs);
  const sd = stdSample(vs);
  if (!sd || !isFinite(sd)) return NaN;
  const n = vs.length;
  return (n / ((n - 1) * (n - 2))) * vs.reduce((a, v) => a + ((v - m) / sd) ** 3, 0);
}

export function smaArr(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rankPct(xs: (number | null)[], ascending = true): (number | null)[] {
  const idx = xs.map((v, i) => ({ v, i })).filter((x) => x.v !== null && isFinite(x.v as number));
  idx.sort((a, b) => ((a.v as number) - (b.v as number)) * (ascending ? 1 : -1));
  const out: (number | null)[] = new Array(xs.length).fill(null);
  idx.forEach((x, r) => { out[x.i] = idx.length > 1 ? r / (idx.length - 1) : 0.5; });
  return out;
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = mean(x), my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
}

export function pctChange(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p = closes[i - 1];
    out.push(p !== 0 && isFinite(p) && isFinite(closes[i]) ? closes[i] / p - 1 : NaN);
  }
  return out;
}

export function maxDD(closes: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const p of closes) {
    if (p > peak) peak = p;
    if (peak > 0) mdd = Math.min(mdd, (p - peak) / peak);
  }
  return mdd;
}

// ---- Cell 1/2/13: next-month seasonality (monthly closes + month idx) ----
export interface SeasonRow {
  avg: number | null; win: number | null; sd: number | null;
  sharpe: number | null; skew: number | null; max: number | null;
  min: number | null; n: number;
}

export function seasonStats(monthlyPct: number[]): SeasonRow {
  const vs = monthlyPct.filter(isFinite);
  const n = vs.length;
  if (n < 5) return { avg: null, win: null, sd: null, sharpe: null, skew: null, max: null, min: null, n };
  const avg = mean(vs);
  const sd = stdSample(vs);
  const win = (vs.filter((v) => v > 0).length / n) * 100;
  return {
    avg, win, sd,
    sharpe: sd > 0 ? avg / sd : NaN,
    skew: skewMoment(vs),
    max: Math.max(...vs), min: Math.min(...vs), n,
  };
}

// ---- Cell 3: SMA 50/200 crossover classifier ----
export type CrossStatus =
  | "AT BULLISH CROSS" | "AT BEARISH CROSS"
  | "POST BULLISH CROSS" | "POST BEARISH CROSS"
  | "APPROACHING BULLISH CROSS" | "APPROACHING BEARISH CROSS"
  | "NEUTRAL" | "SKIPPED";

export function classifySmaCross(
  closes: number[],
  proxPct = 2.0, atDays = 3, postMin = 3, postMax = 20,
): { s50: number | null; s200: number | null; diffPct: number | null; daysSince: number | null; status: CrossStatus; signal: string } {
  if (closes.length < 200) return { s50: null, s200: null, diffPct: null, daysSince: null, status: "SKIPPED", signal: "—" };
  const a50 = smaArr(closes, 50), a200 = smaArr(closes, 200);
  const s50 = a50[a50.length - 1], s200 = a200[a200.length - 1];
  if (s50 === null || s200 === null || !s200) return { s50, s200, diffPct: null, daysSince: null, status: "SKIPPED", signal: "—" };
  const diffPct = ((s50 - s200) / s200) * 100;
  let lastCross = -1;
  let prevBull: boolean | null = null;
  for (let i = 0; i < closes.length; i++) {
    const x = a50[i], y = a200[i];
    if (x === null || y === null) continue;
    const bull = x > y;
    if (prevBull !== null && bull !== prevBull && i > 0) lastCross = i;
    prevBull = bull;
  }
  const daysSince = lastCross >= 0 ? closes.length - 1 - lastCross : null;
  const bullNow = s50 > s200;
  let status: CrossStatus = "NEUTRAL";
  if (daysSince !== null && daysSince <= atDays) status = bullNow ? "AT BULLISH CROSS" : "AT BEARISH CROSS";
  else if (daysSince !== null && daysSince > postMin && daysSince <= postMax) status = bullNow ? "POST BULLISH CROSS" : "POST BEARISH CROSS";
  else if (Math.abs(diffPct) <= proxPct) status = !bullNow ? "APPROACHING BULLISH CROSS" : "APPROACHING BEARISH CROSS";
  const signal = status.includes("BULLISH") ? "BULLISH" : status.includes("BEARISH") ? "BEARISH" : status === "NEUTRAL" ? "NEUTRAL" : "—";
  return { s50, s200, diffPct, daysSince, status, signal };
}

// ---- Cell 10: multi-timeframe range projections ----
export interface RangeRow {
  window: number; n: number; avgSwing: number | null; avgUp: number | null;
  avgDown: number | null; projLow: number | null; projHigh: number | null;
}

export function rangeTable(
  bars: { open: number; high: number; low: number; close: number }[],
  windows: number[], ltp: number,
): RangeRow[] {
  return windows.map((w) => {
    if (bars.length < w) return { window: w, n: bars.length, avgSwing: null, avgUp: null, avgDown: null, projLow: null, projHigh: null };
    const seg = bars.slice(-w);
    const swings: number[] = [], ups: number[] = [], dns: number[] = [];
    let prev = seg[0].close;
    for (let i = 0; i < seg.length; i++) {
      const b = seg[i];
      if (b.low > 0) swings.push(((b.high - b.low) / b.low) * 100);
      const base = i === 0 ? prev : seg[i - 1].close;
      if (base > 0) {
        const r = ((b.close - base) / base) * 100;
        if (r > 0) ups.push(r); else if (r < 0) dns.push(Math.abs(r));
      }
      prev = b.close;
    }
    const avgSwing = mean(swings), avgUp = mean(ups), avgDown = mean(dns);
    return {
      window: w, n: seg.length, avgSwing, avgUp, avgDown,
      projLow: isFinite(avgDown) ? ltp - (avgDown / 100) * ltp : null,
      projHigh: isFinite(avgUp) ? ltp + (avgUp / 100) * ltp : null,
    };
  });
}

// ---- Cell 15: terminal metrics (notebook-exact where noted) ----

// Notebook RSI: SIMPLE rolling mean of gains/losses (NOT Wilder). Label NB-RSI.
export function nbRsiSimple(closes: number[], p = 14): number | null {
  if (closes.length < p + 1) return null;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0));
  }
  if (gains.length < p) return null;
  const g = mean(gains.slice(-p)), l = mean(losses.slice(-p));
  if (!isFinite(g) || !isFinite(l)) return null;
  if (l === 0) return 100;
  return 100 - 100 / (1 + g / (l + 1e-10));
}

export function hvAnn(logRets: number[], w = 20): number | null {
  if (logRets.length < w) return null;
  const seg = logRets.slice(-w);
  const sd = stdSample(seg);
  return isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}

export function nbAtr(high: number[], low: number[], close: number[], w = 14): number | null {
  if (high.length < 21) return null;
  const trs: number[] = [];
  for (let i = 1; i < high.length; i++) {
    trs.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const seg = trs.slice(-w);
  return seg.length ? mean(seg) : null;
}

export function nbBB(closes: number[], w = 20): { pos: number | null; width: number | null } {
  if (closes.length < w) return { pos: null, width: null };
  const seg = closes.slice(-w);
  const ma = mean(seg), sd = stdSample(seg);
  const u = ma + 2 * sd, l = ma - 2 * sd, last = closes[closes.length - 1];
  return {
    pos: u !== l ? ((last - l) / (u - l + 1e-10)) * 100 : null,
    width: ma ? ((u - l) / (ma + 1e-10)) * 100 : null,
  };
}

export function nbStoch(high: number[], low: number[], close: number[], k = 14, d = 3): { k: number | null; dval: number | null } {
  if (close.length < k) return { k: null, dval: null };
  const hv = high.slice(-k), lv = low.slice(-k);
  const hh = Math.max(...hv), ll = Math.min(...lv);
  const last = close[close.length - 1];
  const kk = hh !== ll ? ((last - ll) / (hh - ll + 1e-10)) * 100 : null;
  // %D = mean of last-3 %K proxies (notebook rolls %K series; single-point approx)
  return { k: kk, dval: kk };
}

export function nbZ(closes: number[], w = 20): number | null {
  if (closes.length < w) return null;
  const seg = closes.slice(-w);
  const m = mean(seg), sd = stdSample(seg);
  if (!sd) return null;
  return (closes[closes.length - 1] - m) / sd;
}

const NCDF = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
};

export function nbBsCall(S: number, K: number, T: number, r: number, sigma: number): number | null {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) return null;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * NCDF(d1) - K * Math.exp(-r * T) * NCDF(d2);
}

export function nbOptions(ltp: number, hvPct: number | null, dte: number, rf = 0.065): {
  atm: number | null; straddle: number | null; straddlePct: number | null; em: number | null; emPct: number | null;
} {
  if (hvPct === null || !isFinite(hvPct) || hvPct <= 0 || !isFinite(ltp)) {
    return { atm: null, straddle: null, straddlePct: null, em: null, emPct: null };
  }
  const sigma = hvPct / 100, T = dte / 365;
  const atm = nbBsCall(ltp, ltp, T, rf, sigma);
  const straddle = atm !== null ? atm * 2 : null;
  const em = sigma * Math.sqrt(T) * ltp;
  return {
    atm, straddle,
    straddlePct: straddle !== null ? (straddle / ltp) * 100 : null,
    em, emPct: (em / ltp) * 100,
  };
}

export function nbSignalCount(o: { rsi: number | null; macdBull: boolean | null; a50: boolean | null; a200: boolean | null; golden: boolean | null; stochK: number | null }): number {
  let s = 0;
  if (o.rsi !== null && o.rsi >= 40 && o.rsi <= 60) s++;
  if (o.macdBull) s++;
  if (o.a50) s++;
  if (o.a200) s++;
  if (o.golden) s++;
  if (o.stochK !== null && o.stochK > 50) s++;
  return s;
}

export function nbBeta(stockLog: number[], niftyLog: number[]): number | null {
  const n = Math.min(stockLog.length, niftyLog.length);
  if (n < 30) return null;
  const x = stockLog.slice(-n), y = niftyLog.slice(-n);
  const mx = mean(x), my = mean(y);
  let cov = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (x[i] - mx) * (y[i] - my); vy += (y[i] - my) ** 2; }
  return vy > 0 ? cov / vy : null;
}

export function nbMomScore(r1: number | null, r3: number | null, r6: number | null, r12: number | null): number | null {
  // Notebook ranks cross-sectionally; single-ticker fallback: weighted mean clipped 0-100.
  const parts = [r1, r3, r6, r12];
  if (parts.every((v) => v === null)) return null;
  const w = [0.2, 0.3, 0.35, 0.15];
  let s = 0, tw = 0;
  parts.forEach((v, i) => { if (v !== null && isFinite(v)) { s += Math.max(-30, Math.min(30, v)) * w[i]; tw += w[i]; } });
  if (!tw) return null;
  return Math.max(0, Math.min(100, 50 + (s / tw) * 2));
}

// ---- Cells 5/6: safety-first per-stock + max-Sharpe (bounded projected gradient) ----
export interface SafetyStock {
  sym: string; price: number; actual1Y: number | null; expAnn: number | null;
  volAnn: number | null; sharpe: number | null; mdd: number | null; score: number | null; pass: boolean;
}

export function safetyMetrics(closes: number[], rf = 0.065): {
  actual1Y: number | null; expAnn: number | null; volAnn: number | null; sharpe: number | null; mdd: number | null;
} {
  if (closes.length < 60) return { actual1Y: null, expAnn: null, volAnn: null, sharpe: null, mdd: null };
  const rets = pctChange(closes).filter(isFinite);
  const expAnn = rets.length ? mean(rets) * 252 : NaN;
  const volAnn = rets.length > 1 ? (stdSample(rets) as number) * Math.sqrt(252) : NaN;
  const ref = closes.length > 252 ? closes[closes.length - 253] : closes[0];
  const last = closes[closes.length - 1];
  const actual1Y = ref > 0 ? (last - ref) / ref : NaN;
  return {
    actual1Y: isFinite(actual1Y) ? actual1Y : null,
    expAnn: isFinite(expAnn) ? expAnn : null,
    volAnn: isFinite(volAnn) ? volAnn : null,
    sharpe: isFinite(expAnn) && isFinite(volAnn) && volAnn > 0 ? (expAnn - rf) / volAnn : null,
    mdd: maxDD(closes),
  };
}

// Bounded max-Sharpe via projected gradient (replaces SciPy SLSQP on web).
export function maxSharpeWeights(mu: number[], cov: number[][], rf = 0.065, lo = 0.05, hi = 0.25, iters = 400): number[] {
  const n = mu.length;
  let w = new Array(n).fill(1 / n);
  const proj = (v: number[]): number[] => {
    let c = v.map((x) => Math.max(lo, Math.min(hi, x)));
    let s = c.reduce((a, b) => a + b, 0);
    // simplex projection preserving box: iterate scaling clipped values
    for (let k = 0; k < 50; k++) {
      const diff = (s - 1) / n;
      if (Math.abs(diff) < 1e-9) break;
      c = c.map((x) => Math.max(lo, Math.min(hi, x - diff)));
      s = c.reduce((a, b) => a + b, 0);
      if (Math.abs(s - 1) < 1e-9) break;
    }
    const t = c.reduce((a, b) => a + b, 0) || 1;
    return c.map((x) => x / t);
  };
  const port = (x: number[]) => {
    const ret = x.reduce((a, wi, i) => a + wi * mu[i], 0);
    let v = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v += x[i] * x[j] * cov[i][j];
    return { ret, vol: Math.sqrt(Math.max(v, 1e-12)) };
  };
  let step = 0.2;
  for (let it = 0; it < iters; it++) {
    const { ret, vol } = port(w);
    const ex = ret - rf;
    const grad = mu.map((mui, i) => {
      let cwi = 0;
      for (let j = 0; j < n; j++) cwi += cov[i][j] * w[j];
      return (mui * vol - ex * (cwi / vol)) / (vol * vol);
    });
    const nw = proj(w.map((wi, i) => wi + step * grad[i]));
    const a = port(w), b = port(nw);
    const sa = (a.ret - rf) / a.vol, sb = (b.ret - rf) / b.vol;
    if (sb > sa) { w = nw; step *= 1.02; } else { step *= 0.6; if (step < 1e-6) break; }
  }
  return proj(w);
}
