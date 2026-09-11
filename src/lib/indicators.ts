// Technical indicators — faithful TypeScript port of _m1_calc_* in special.py
// Conventions:
// - EMA uses Wilder-style adjust=false (k = 2/(span+1)), matching pandas ewm(span=..).
// - RSI uses ewm(com=period-1) i.e. alpha = 1/period, matching _m1_calc_rsi.
// - ATR uses Wilder smoothing of True Range.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], span: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length === 0) return out;
  const k = 2 / (span + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (!isFinite(v)) { out[i] = prev; continue; }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder EMA with com = period-1  =>  alpha = 1/period
function wilderEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const alpha = 1 / period;
  let prev: number | null = null;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!isFinite(v)) { out[i] = prev; continue; }
    if (prev === null) {
      // seed with SMA once we have `period` values (min_periods=period)
      count++;
      if (count < period) { out[i] = null; continue; }
      if (count === period) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += values[j];
        prev = s / period;
        out[i] = prev;
        continue;
      }
    }
    prev = v * alpha + (prev as number) * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

export function rsi(close: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  if (close.length < period + 1) return out;
  const gains: number[] = new Array(close.length).fill(NaN);
  const losses: number[] = new Array(close.length).fill(NaN);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gains[i] = Math.max(d, 0);
    losses[i] = Math.max(-d, 0);
  }
  const avgGain = wilderEma(gains.map((v) => (isNaN(v) ? 0 : v)), period);
  const avgLoss = wilderEma(losses.map((v) => (isNaN(v) ? 0 : v)), period);
  for (let i = 0; i < close.length; i++) {
    const ag = avgGain[i]; const al = avgLoss[i];
    if (ag === null || al === null) { out[i] = null; continue; }
    if (al === 0) { out[i] = 100; continue; }
    const rs = (ag as number) / (al as number);
    out[i] = 100 - 100 / (1 + rs);
  }
  return out;
}

export function trueRange(high: number[], low: number[], close: number[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) tr.push(high[0] - low[0]);
    else tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  return tr;
}

export function atr(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  return wilderEma(trueRange(high, low, close), period);
}

export function stochastic(high: number[], low: number[], close: number[], k = 14, d = 3) {
  const pctK: (number | null)[] = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    if (i < k - 1) continue;
    let ll = Infinity, hh = -Infinity;
    for (let j = i - k + 1; j <= i; j++) { ll = Math.min(ll, low[j]); hh = Math.max(hh, high[j]); }
    pctK[i] = hh === ll ? null : (100 * (close[i] - ll)) / (hh - ll);
  }
  const kVals = pctK.map((v) => (v === null ? NaN : v));
  const pctD = sma(kVals.map((v) => (isNaN(v) ? 0 : v)), d).map((v, i) =>
    i < k - 1 + d - 1 ? null : v
  );
  return { pctK, pctD };
}

export function stochRsi(rsiVals: (number | null)[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(rsiVals.length).fill(null);
  for (let i = 0; i < rsiVals.length; i++) {
    if (i < period - 1) continue;
    const win: number[] = [];
    for (let j = i - period + 1; j <= i; j++) {
      const v = rsiVals[j];
      if (v === null || !isFinite(v)) break;
      win.push(v);
    }
    if (win.length < period) continue;
    const mn = Math.min(...win), mx = Math.max(...win);
    const cur = rsiVals[i] as number;
    out[i] = mx === mn ? null : (100 * (cur - mn)) / (mx - mn);
  }
  return out;
}

export function macd(close: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(close, fast).map((v) => v ?? NaN);
  const es = ema(close, slow).map((v) => v ?? NaN);
  const line = ef.map((v, i) => v - (es[i] as number));
  const sig = ema(line.map((v) => (isFinite(v) ? v : 0)), signal);
  const hist = line.map((v, i) => (sig[i] === null ? null : v - (sig[i] as number)));
  return { line, signal: sig, hist };
}

export function adx(high: number[], low: number[], close: number[], period = 14) {
  const n = close.length;
  const pdm = new Array(n).fill(0);
  const mdm = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
  }
  const atrV = atr(high, low, close, period).map((v) => v ?? NaN);
  const pdmE = wilderEma(pdm, period).map((v) => v ?? NaN);
  const mdmE = wilderEma(mdm, period).map((v) => v ?? NaN);
  const pdi: (number | null)[] = new Array(n).fill(null);
  const mdi: (number | null)[] = new Array(n).fill(null);
  const dx: number[] = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!isFinite(atrV[i]) || atrV[i] === 0) continue;
    pdi[i] = (100 * pdmE[i]) / atrV[i];
    mdi[i] = (100 * mdmE[i]) / atrV[i];
    const s = (pdi[i] as number) + (mdi[i] as number);
    dx[i] = s === 0 ? NaN : (100 * Math.abs((pdi[i] as number) - (mdi[i] as number))) / s;
  }
  const adxV = wilderEma(dx.map((v) => (isNaN(v) ? 0 : v)), period);
  return { adx: adxV, pdi, mdi };
}

export function roc(close: number[], period = 12): (number | null)[] {
  return close.map((c, i) => {
    if (i < period) return null;
    const prev = close[i - period];
    if (!prev) return null;
    return ((c - prev) / prev) * 100;
  });
}

export function williamsR(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  for (let i = period - 1; i < close.length; i++) {
    let hn = -Infinity, ln = Infinity;
    for (let j = i - period + 1; j <= i; j++) { hn = Math.max(hn, high[j]); ln = Math.min(ln, low[j]); }
    out[i] = hn === ln ? null : ((hn - close[i]) / (hn - ln)) * -100;
  }
  return out;
}

export function mfi(high: number[], low: number[], close: number[], volume: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(close.length).fill(null);
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const mf = tp.map((t, i) => t * (volume[i] || 0));
  for (let i = period; i < close.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) pos += mf[j];
      else if (tp[j] < tp[j - 1]) neg += mf[j];
    }
    if (neg === 0) { out[i] = 100; continue; }
    const mfr = pos / neg;
    out[i] = 100 - 100 / (1 + mfr);
  }
  return out;
}

export function bollinger(close: number[], period = 20, mult = 2) {
  const mid = sma(close, period);
  const upper: (number | null)[] = new Array(close.length).fill(null);
  const lower: (number | null)[] = new Array(close.length).fill(null);
  const width: (number | null)[] = new Array(close.length).fill(null);
  const pctB: (number | null)[] = new Array(close.length).fill(null);
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1 || mid[i] === null) continue;
    const win = close.slice(i - period + 1, i + 1);
    const m = mid[i] as number;
    const variance = win.reduce((s, v) => s + (v - m) ** 2, 0) / (period - 1);
    const sd = Math.sqrt(variance);
    const u = m + mult * sd, l = m - mult * sd;
    upper[i] = u; lower[i] = l;
    width[i] = m !== 0 ? ((u - l) / m) * 100 : null;
    pctB[i] = u === l ? null : ((close[i] - l) / (u - l)) * 100;
  }
  return { upper, mid, lower, width, pctB };
}

export function obv(close: number[], volume: number[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < close.length; i++) {
    const v = volume[i] || 0;
    out.push(out[i - 1] + (close[i] > close[i - 1] ? v : close[i] < close[i - 1] ? -v : 0));
  }
  return out;
}

export function donchian(high: number[], low: number[], period = 20) {
  const upper: (number | null)[] = new Array(high.length).fill(null);
  const lower: (number | null)[] = new Array(low.length).fill(null);
  for (let i = period - 1; i < high.length; i++) {
    upper[i] = Math.max(...high.slice(i - period + 1, i + 1));
    lower[i] = Math.min(...low.slice(i - period + 1, i + 1));
  }
  return { upper, lower };
}

export function rollingStd(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const win = values.slice(i - period + 1, i + 1);
    const m = win.reduce((a, b) => a + b, 0) / period;
    out[i] = Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / (period - 1 || 1));
  }
  return out;
}

export function zscore(values: (number | null)[], window = 20): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const nums = values.map((v) => (v === null ? NaN : v));
  for (let i = window - 1; i < values.length; i++) {
    const win = nums.slice(i - window + 1, i + 1);
    if (win.some((v) => !isFinite(v))) continue;
    const m = win.reduce((a, b) => a + b, 0) / window;
    const sd = Math.sqrt(win.reduce((s, v) => s + (v - m) ** 2, 0) / (window - 1 || 1));
    out[i] = sd === 0 ? null : (nums[i] - m) / sd;
  }
  return out;
}

export function percentRank(values: (number | null)[], window = 20): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const nums = values.map((v) => (v === null ? NaN : v));
  for (let i = window - 1; i < values.length; i++) {
    const win = nums.slice(i - window + 1, i + 1);
    if (win.some((v) => !isFinite(v))) continue;
    const cur = win[win.length - 1];
    const less = win.slice(0, -1).filter((v) => v < cur).length;
    out[i] = (less / (win.length - 1)) * 100;
  }
  return out;
}

// OLS slope / std velocity — port of _m1_indicator_velocity
export function velocity(series: (number | null)[], window = 5): (number | null)[] {
  const out: (number | null)[] = new Array(series.length).fill(null);
  const t = Array.from({ length: window }, (_, i) => i);
  const tMean = t.reduce((a, b) => a + b, 0) / window;
  const tVar = t.reduce((s, v) => s + (v - tMean) ** 2, 0);
  const nums = series.map((v) => (v === null ? NaN : v));
  const stdLong = rollingStd(nums.map((v) => (isFinite(v) ? v : 0)), window * 2);
  for (let i = window - 1; i < series.length; i++) {
    const chunk = nums.slice(i - window + 1, i + 1);
    if (chunk.some((v) => !isFinite(v))) continue;
    const m = chunk.reduce((a, b) => a + b, 0) / window;
    const slope = chunk.reduce((s, v, k) => s + (v - m) * (t[k] - tMean), 0) / tVar;
    const stdV = stdLong[i] ?? 1;
    out[i] = slope / Math.max(stdV === null || stdV === 0 ? 1e-10 : (stdV as number), 1e-10);
  }
  return out;
}

export function last<T>(arr: (T | null | undefined)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v !== null && v !== undefined && !(typeof v === "number" && !isFinite(v))) return v as T;
  }
  return null;
}

export function logReturns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) {
    out.push(close[i] > 0 && close[i - 1] > 0 ? Math.log(close[i] / close[i - 1]) : 0);
  }
  return out;
}

export function pctReturns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) {
    out.push(close[i - 1] !== 0 ? (close[i] - close[i - 1]) / close[i - 1] : 0);
  }
  return out;
}

// Hurst exponent (R/S simplified, max_lag=50 like _m3_compute_hurst)
export function hurst(series: number[], maxLag = 50): number {
  const n = series.length;
  if (n < 100) return 0.5;
  const lags: number[] = [];
  const rs: number[] = [];
  for (let lag = 2; lag <= Math.min(maxLag, Math.floor(n / 2)); lag++) {
    const chunks = Math.floor(n / lag);
    let sum = 0, cnt = 0;
    for (let c = 0; c < chunks; c++) {
      const seg = series.slice(c * lag, (c + 1) * lag);
      const m = seg.reduce((a, b) => a + b, 0) / lag;
      const dev = seg.map((v) => v - m);
      let cum = 0, mx = -Infinity, mn = Infinity;
      for (const d of dev) { cum += d; mx = Math.max(mx, cum); mn = Math.min(mn, cum); }
      const sd = Math.sqrt(seg.reduce((s, v) => s + (v - m) ** 2, 0) / lag);
      if (sd > 0) { sum += (mx - mn) / sd; cnt++; }
    }
    if (cnt > 0) { lags.push(Math.log(lag)); rs.push(Math.log(sum / cnt)); }
  }
  if (lags.length < 3) return 0.5;
  const mx = lags.reduce((a, b) => a + b, 0) / lags.length;
  const my = rs.reduce((a, b) => a + b, 0) / rs.length;
  const num = lags.reduce((s, x, i) => s + (x - mx) * (rs[i] - my), 0);
  const den = lags.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den === 0 ? 0.5 : num / den;
}

// Half-life of mean reversion from AR(1) on spread
export function halfLife(spread: number[]): number {
  if (spread.length < 20) return NaN;
  const y: number[] = [], x: number[] = [];
  for (let i = 1; i < spread.length; i++) { y.push(spread[i] - spread[i - 1]); x.push(spread[i - 1]); }
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  const num = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  const den = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  const beta = den === 0 ? 0 : num / den;
  if (beta >= 0) return Infinity;
  return Math.log(2) / Math.abs(beta);
}
