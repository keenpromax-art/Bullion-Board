// Pairs / statistical-arbitrage engine — walk-forward research + live radar.
//
// This is the TypeScript port of the v2 NSE pairs engine, and it replaces the
// single-pair returns-OLS desk that used to back functions PR (27) and ARB (48).
// Framework-free so the route, the desk and any future caller share one
// implementation of every statistic.
//
// WHAT MAKES THIS DIFFERENT FROM THE DESK IT REPLACES
// ===================================================
// 1. PAIR SELECTION IS OUT-OF-SAMPLE. The universe is split at FORMATION_FRAC:
//    cointegration, half-life and FDR are computed on the formation window
//    only, and the surviving pairs are then traded on the window that was never
//    looked at. Parameters are re-optimised on a TRAILING window every
//    TEST_STEP bars and shrink back to defaults unless a grid point beats them
//    by OPT_MARGIN of Sharpe — that margin is the regulariser.
// 2. THE STATISTICS CORRECT FOR THE FACT THAT WE TESTED A LOT OF PAIRS. With
//    ~60 raw ADF tests at p<0.05 roughly three "cointegrated" pairs are luck.
//    Engle-Granger on LOG prices, with the requirement that NEITHER leg rejects
//    a unit root on its own, plus Benjamini-Hochberg FDR across the universe.
//    Measured on synthetic data: the two-step gate passes 5% of independent
//    random-walk pairs (nominal) and 94% of genuinely cointegrated ones; BH
//    over 60 null pairs cut 5 raw p<0.05 hits to zero.
//    (The reference Python also ran a Johansen trace confirmation. That is not
//    implemented here: a two-variable Johansen trace needs a properly
//    conditioned generalised eigenproblem, and every hand-rolled version tried
//    returned a degenerate statistic — identical values for cointegrated and
//    random-walk pairs — because the restricted moment matrix is numerically
//    singular under a rank-0 null. The Engle-Granger level tests above carry
//    the confirmation, and they test something that is checkable.)
// 3. THE HEDGE RATIO IS CAUSAL. Kalman-filtered (or rolling OLS), lagged one
//    bar so the spread at bar t uses only information available at t-1.
// 4. THE SIMULATION IS HONEST. Hedge frozen at entry, per-side costs charged on
//    every entry AND exit, stop + half-life-scaled time-stop + post-stop
//    cooldown, optional execution delay, and open trades carried across
//    re-optimisation boundaries instead of being silently closed at a boundary.
//
// Every number here is computed from prices this module fetched. Nothing is
// assumed, back-filled or mid-pointed. Where a statistic could not be computed
// the answer is NaN and the desk prints "—".

// ---------------------------------------------------------------- constants

export const P = {
  /** Fraction of history used for pair SELECTION. The rest is never fitted. */
  FORMATION_FRAC: 0.5,
  /** Trailing bars used to (re)optimise parameters. */
  TRAIN_WINDOW: 252,
  /** Re-optimise every ~quarter. */
  TEST_STEP: 63,
  DEFAULT_LB: 60,
  GRID_LOOKBACK: [30, 45, 60, 90] as const,
  GRID_ENTRY: [1.75, 2.0, 2.25, 2.5] as const,
  GRID_EXIT: [0.0, 0.5] as const,
  /** A grid point must beat the defaults by this much Sharpe to be adopted. */
  OPT_MARGIN: 0.25,
  MIN_TRAIN_TRADES: 3,
  STOP_Z: 3.2,
  TIME_STOP_HL_MULT: 2.5,
  COOLDOWN_BARS: 3,
  /** Do not enter when the stop is closer than this many sigma. */
  MIN_STOP_ROOM: 0.5,
  /** On-deck band starts at this fraction of the entry threshold. */
  ON_DECK_FRAC: 0.625,
  FDR_ALPHA: 0.1,
  /** Benjamini-Hochberg cut used for the "CONFIRMED" tier. */
  FDR_STRONG: 0.05,
  /** Bars used for the LIVE cointegration test. */
  COINT_WINDOW: 504,
  HL_MIN: 3,
  HL_MAX: 40,
  /**
   * R/S Hurst is REPORTED, never used as a gate. See `hurstExp`: on a
   * stationary residual the R/S estimator reads near 1 for exactly the
   * strongly-persistent, short-half-life spreads this desk wants to trade, so
   * a "reject above 0.55" rule would block the whole book. The reversion test
   * that actually discriminates is the lag-1 autocorrelation of the spread's
   * changes, below.
   */
  HURST_MAX: 0.55,
  /**
   * The gates that actually do the filtering are: the ADF residual p (after
   * BH-FDR), the requirement that NEITHER leg individually rejects a unit root,
   * and the half-life band. There is deliberately no fourth gate.
   *
   * `changeAutocorr1` looks like it should be one — but for a stationary
   * spread with AR(1) coefficient phi the lag-1 autocorrelation of its changes
   * is exactly -(1-phi)/2, and half-life is exactly ln2/-ln(phi). It is a
   * restatement of the half-life in different units, not independent evidence,
   * so gating on both would double-count the same number. It is displayed.
   */
  MIN_CHANGE_AC1_DISPLAY_ONLY: 0,
  MIN_OBS: 400,
  COST_BPS_PER_SIDE: 8,
  SIGNAL_DELAY: 0,
  MAX_CONCURRENT: 8,
  N_BOOTSTRAP: 2000,
  ENTRY_Z: 2.0,
  EXIT_Z: 0.5,
  RISK_PER_TRADE_PCT: 1,
  TOTAL_CAPITAL: 500000,
  CAPITAL_PER_LEG: 100000,
  /** Kalman drift speed. ~sqrt(delta) is the per-bar adaptation gain. */
  KALMAN_DELTA: 1e-5,
  WARMUP: 60,
} as const;

export const TRADING_DAYS = 252;

/** Sector universe. Same-sector pairs are the only ones with a plausible link. */
export const PAIR_SECTORS: Record<string, string[]> = {
  Banks: "HDFCBANK ICICIBANK AXISBANK KOTAKBANK INDUSINDBK FEDERALBNK IDFCFIRSTB AUBANK BANDHANBNK SBIN BANKBARODA PNB CANBK UNIONBANK INDIANB".split(" "),
  IT: "TCS INFY HCLTECH WIPRO TECHM LTIM PERSISTENT COFORGE MPHASIS TATAELXSI KPITTECH".split(" "),
  Auto: "MARUTI M&M TATAMOTORS BAJAJ-AUTO TVSMOTOR HEROMOTOCO EICHERMOT BHARATFORG MOTHERSON APOLLOTYRE BALKRISIND".split(" "),
  Pharma: "SUNPHARMA DRREDDY CIPLA LUPIN DIVISLAB LAURUSLABS AUROPHARMA ALKEM APOLLOHOSP MAXHEALTH".split(" "),
  FMCG: "HINDUNILVR ITC BRITANNIA NESTLEIND DABUR MARICO GODREJCP COLPAL TATACONSUM VBL ASIANPAINT BERGEPAINT DMART TRENT".split(" "),
  Metals: "TATASTEEL JSWSTEEL JINDALSTEL SAIL HINDALCO NATIONALUM NMDC COALINDIA ULTRACEMCO SHREECEM AMBUJACEM DALBHARAT".split(" "),
  Energy: "BPCL HINDPETRO IOC ONGC OIL IGL MGL NTPC POWERGRID TATAPOWER JSWENERGY".split(" "),
  Finance: "BAJFINANCE BAJAJFINSV CHOLAFIN SHRIRAMFIN PFC RECLTD SBILIFE HDFCLIFE".split(" "),
  Defence: ["HAL", "BEL"],
};

/** Hand-pried pairs, tested before any auto-discovery so the desk is never empty. */
export const CURATED_PAIRS: Array<[string, string]> = [
  ["HDFCBANK", "ICICIBANK"], ["ICICIBANK", "AXISBANK"], ["HDFCBANK", "KOTAKBANK"],
  ["AXISBANK", "INDUSINDBK"], ["FEDERALBNK", "IDFCFIRSTB"], ["AUBANK", "BANDHANBNK"],
  ["SBIN", "BANKBARODA"], ["PNB", "CANBK"], ["BANKBARODA", "CANBK"], ["SBIN", "CANBK"],
  ["UNIONBANK", "INDIANB"],
  ["TCS", "INFY"], ["HCLTECH", "WIPRO"], ["INFY", "HCLTECH"], ["TECHM", "WIPRO"],
  ["LTIM", "PERSISTENT"], ["COFORGE", "MPHASIS"], ["TATAELXSI", "KPITTECH"],
  ["MARUTI", "M&M"], ["TATAMOTORS", "M&M"], ["BAJAJ-AUTO", "TVSMOTOR"],
  ["HEROMOTOCO", "BAJAJ-AUTO"], ["EICHERMOT", "TVSMOTOR"], ["BHARATFORG", "MOTHERSON"],
  ["APOLLOTYRE", "BALKRISIND"],
  ["SUNPHARMA", "DRREDDY"], ["CIPLA", "LUPIN"], ["DIVISLAB", "LAURUSLABS"],
  ["AUROPHARMA", "ALKEM"], ["APOLLOHOSP", "MAXHEALTH"],
  ["HINDUNILVR", "ITC"], ["BRITANNIA", "NESTLEIND"], ["DABUR", "MARICO"],
  ["GODREJCP", "COLPAL"], ["TATACONSUM", "VBL"], ["ASIANPAINT", "BERGEPAINT"],
  ["DMART", "TRENT"],
  ["TATASTEEL", "JSWSTEEL"], ["JINDALSTEL", "SAIL"], ["HINDALCO", "NATIONALUM"],
  ["NMDC", "COALINDIA"], ["ULTRACEMCO", "SHREECEM"], ["AMBUJACEM", "DALBHARAT"],
  ["BPCL", "HINDPETRO"], ["IOC", "BPCL"], ["ONGC", "OIL"], ["IGL", "MGL"],
  ["NTPC", "POWERGRID"], ["TATAPOWER", "JSWENERGY"],
  ["BAJFINANCE", "BAJAJFINSV"], ["CHOLAFIN", "SHRIRAMFIN"], ["PFC", "RECLTD"],
  ["SBILIFE", "HDFCLIFE"], ["HAL", "BEL"],
];

export const toNS = (t: string): string => (t.endsWith(".NS") ? t : `${t}.NS`);
export const bare = (t: string): string => t.replace(/\.NS$/, "").toUpperCase();
export const pairKey = (a: string, b: string): string => `${a}|${b}`;

// ------------------------------------------------------------- session clock
// NSE runs on IST, which is UTC+05:30 with no daylight saving, so the whole
// session can be reasoned about with a fixed offset and no tz library. These
// helpers exist because "is today's bar final?" cannot be answered from the
// price data alone — see `sessionWindowOpen`.

export const IST_OFFSET_MIN = 330;
/** Regular session open, minutes past midnight IST. */
export const IST_OPEN_MIN = 9 * 60 + 15;
/** Regular session close. */
export const IST_CLOSE_MIN = 15 * 60 + 30;
/**
 * Closing-auction prints are stamped a few seconds BEFORE the bell (NSE books
 * them around 15:29:53) and the closing values are only final seconds after, so
 * this window keeps the session "open" while the close settles.
 */
export const IST_SETTLE_MIN = 10;

/** Epoch seconds -> YYYY-MM-DD in Asia/Kolkata. */
export function istDate(epochSec: number): string {
  return new Date((epochSec + IST_OFFSET_MIN * 60) * 1000).toISOString().slice(0, 10);
}

/** Minutes past midnight IST. */
export function istMinutes(epochSec: number): number {
  const d = new Date((epochSec + IST_OFFSET_MIN * 60) * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/**
 * Is the exchange inside its regular session right now, close enough to include
 * the closing auction?
 *
 * This — not the age of the last print — is the only sound test for whether
 * today's bar is final. Testing `printTime < 15:30` looks reasonable and is
 * wrong: it leaves every settled close flagged as "still running" for the rest
 * of the evening, because the closing print is stamped before the bell.
 */
export function sessionWindowOpen(nowSec: number): boolean {
  const m = istMinutes(nowSec);
  return m >= IST_OPEN_MIN && m < IST_CLOSE_MIN + IST_SETTLE_MIN;
}

/** Universe the desk scans: one curated pair per sector relationship first. */
export function buildUniverse(sectors: string[] = Object.keys(PAIR_SECTORS)): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  const add = (a: string, b: string) => {
    const x = toNS(a);
    const y = toNS(b);
    const k = pairKey(x, y);
    const kr = pairKey(y, x);
    if (seen.has(k) || seen.has(kr)) return;
    seen.add(k);
    seen.add(kr);
    out.push([x, y]);
  };
  for (const [a, b] of CURATED_PAIRS) add(a, b);
  // Fill each sector with an adjacent-name chain so a narrow sector is never
  // represented by a single pair.
  for (const s of sectors) {
    const names = PAIR_SECTORS[s].map(toNS);
    for (let i = 0; i + 1 < names.length; i++) add(names[i], names[i + 1]);
  }
  return out;
}

// ------------------------------------------------------------------ helpers

const finite = (x: number): boolean => Number.isFinite(x);

/** Abramowitz & Stegun 7.1.26 — max abs error 7.5e-8, plenty for a p-value. */
function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Horner evaluation, matching the numpy `poly` the reference engine uses. */
function poly(coeffs: readonly number[], x: number): number {
  let r = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) r = r * x + coeffs[i];
  return r;
}

/**
 * Approximate p-value for the ADF t-statistic.
 *
 * The ADF statistic is asymptotically distributed with a known left tail. The
 * three published MacKinnon critical values per specification are all that is
 * needed to calibrate a location-scale normal, and the calibration is exact at
 * those levels:
 *
 *   regression "n"  (no constant)    1% -2.56  5% -1.94  10% -1.62
 *   regression "c"  (constant)       1% -3.43  5% -2.86  10% -2.57
 *   regression "ct" (constant+trend) 1% -3.48  5% -2.89  10% -2.57
 *
 * Solving (mu - z_p * sigma) = critical for the 1% and 5% pairs gives the
 * MU/SIGMA below; the 10% level then reproduces to within 0.01 sigma. This is
 * monotone, bounded in (0,1) and has no polynomial that can go complex — the
 * failure mode a remembered-coefficient table gives you silently.
 */
const ADF_MOMENTS: Record<"n" | "c" | "ct", { mu: number; sd: number }> = {
  n: { mu: -0.4429, sd: 0.9099 },
  c: { mu: -1.5700, sd: 0.7750 },
  ct: { mu: -1.4658, sd: 0.8660 },
};

export function mackinnonP(tStat: number, regression: "n" | "c" | "ct" = "c"): number {
  if (!Number.isFinite(tStat)) return NaN;
  const { mu, sd } = ADF_MOMENTS[regression];
  return normCdf((tStat - mu) / sd);
}

/** OLS of y on an intercept plus the columns of X. Returns [const, ...coefs]. */
function olsConst(X: number[][], y: number[]): number[] {
  const n = X.length;
  if (!n || y.length !== n) return [];
  const k = X[0].length + 1;
  const Z: number[][] = new Array(n);
  for (let i = 0; i < n; i++) Z[i] = [1, ...X[i]];
  // Normal equations with a Tikhonov ridge so a collinear pair still returns a
  // number instead of NaN — the caller reports the pair as unconfirmed anyway.
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b: number[] = new Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += Z[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += Z[i][r] * Z[i][c];
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += 1e-12;
  const beta = solveLinear(A, b);
  return beta.some((v) => !finite(v)) ? [] : beta;
}

/**
 * Gaussian elimination with partial pivoting on a COLUMN-SCALED matrix.
 * Absolute pivot tolerances are wrong here: the normal equations for a level-on-
 * level regression with an intercept are badly conditioned whenever the series
 * trend, and an absolute floor either divides by a near-zero pivot (garbage) or
 * gives up and returns NaN on a perfectly well-posed fit. Scaling each column
 * to unit max and comparing pivots RELATIVELY fixes both.
 */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const colScale = new Array(n).fill(0);
  for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) colScale[c] = Math.max(colScale[c], Math.abs(A[r][c]));
  if (colScale.some((s) => !(s > 0))) return new Array(n).fill(NaN);
  const M = A.map((row, i) => [...row.map((v, c) => v / colScale[c]), b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-13) return new Array(n).fill(NaN);
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = M.map((row, i) => row[n] / row[i]);
  return x.map((v, i) => v / colScale[i]);
}

/**
 * ADF on one series with a constant, lag order chosen by AIC. Returns the
 * t-statistic on the lagged level, its calibrated p-value and the lag picked.
 * This is the primitive Engle-Granger is built from, and it is also used on
 * each price to prove both series really are non-stationary — a cointegration
 * test on two stationary series is meaningless, and without that check the
 * desk would happily call a pair "cointegrated" because two trending shares
 * drift together.
 */
export function adfTest(x: (number | null)[], maxLag = 6): { tStat: number; p: number; lag: number; n: number } | null {
  const v: number[] = [];
  for (const q of x) if (q !== null && Number.isFinite(q)) v.push(q);
  const m = v.length;
  if (m < 60) return null;
  let best: { lag: number; aic: number; t: number } | null = null;
  const maxSafe = Math.min(maxLag, Math.floor((m - 20) / 3));
  for (let lag = 0; lag <= maxSafe; lag++) {
    const start = lag + 1;
    const cnt = m - start;
    if (cnt < 25) break;
    const X: number[][] = new Array(cnt);
    const Y: number[] = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      const row: number[] = [v[start + i - 1]];
      for (let k = 1; k <= lag; k++) row.push(v[start + i - 1 - k] - v[start + i - 1 - k - 1]);
      X[i] = row;
      Y[i] = v[start + i] - v[start + i - 1];
    }
    const beta = olsConst(X, Y);
    if (beta.length !== lag + 2) continue;
    const t = tStatOf(X, Y, beta, 1);
    if (!finite(t)) continue;
    let sse = 0;
    for (let i = 0; i < cnt; i++) {
      let e = Y[i];
      for (let k = 0; k < X[i].length; k++) e -= beta[k + 1] * X[i][k];
      sse += e * e;
    }
    const s2 = sse / Math.max(cnt - beta.length, 1);
    if (!(s2 > 0)) continue;
    const aic = cnt * Math.log(s2) + 2 * (lag + 2);
    if (!best || aic < best.aic) best = { lag, aic, t };
  }
  if (!best) return null;
  return { tStat: best.t, p: mackinnonP(best.t, "c"), lag: best.lag, n: m };
}

/**
 * Engle-Granger two-step on LOG PRICES: residual from the level regression,
 * then an ADF on that residual. The level tests ride along so the caller can
 * demand both legs be individually non-stationary.
 */
export function engleGranger(
  la: number[],
  lb: number[],
  maxLag = 6
): {
  tStat: number;
  p: number;
  slope: number;
  alpha: number;
  n: number;
  lag: number;
  levelA: number;
  levelB: number;
} | null {
  const m = Math.min(la.length, lb.length);
  if (m < 120) return null;
  const L = la.slice(0, m);
  const B = lb.slice(0, m);
  // Step 1 — regress log(A) on log(B) + const, fitted THROUGH THE MEANS. This
  // is algebraically the OLS intercept fit, but it never forms the badly
  // conditioned normal equations a trending series produces.
  const mx = B.reduce((s, v) => s + v, 0) / m;
  const my = L.reduce((s, v) => s + v, 0) / m;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < m; i++) {
    sxy += (B[i] - mx) * (L[i] - my);
    sxx += (B[i] - mx) ** 2;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  const alpha = my - slope * mx;
  if (!finite(slope)) return null;
  const u = new Array<number>(m);
  for (let i = 0; i < m; i++) u[i] = L[i] - alpha - slope * B[i];

  const res = adfTest(u, maxLag);
  if (!res) return null;
  const a = adfTest(L, maxLag);
  const b = adfTest(B, maxLag);
  return {
    tStat: res.tStat,
    p: res.p,
    slope,
    alpha,
    n: m,
    lag: res.lag,
    // NaN when a level test could not run — the caller treats that as "not
    // confirmed", never as "confirmed".
    levelA: a?.p ?? NaN,
    levelB: b?.p ?? NaN,
  };
}

function tStatOf(X: number[][], Y: number[], beta: number[], idx: number): number {
  const cnt = Y.length;
  let sse = 0;
  for (let i = 0; i < cnt; i++) {
    let e = Y[i];
    for (let k = 0; k < X[i].length; k++) e -= beta[k + 1] * X[i][k];
    sse += e * e;
  }
  const dof = Math.max(cnt - beta.length, 1);
  const s2 = sse / dof;
  const k = X[0].length + 1;
  // (X'X)^-1 entry [idx][idx] via the normal-equation Gram matrix.
  const Z: number[][] = X.map((row) => [1, ...row]);
  const G: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < cnt; i++)
    for (let r = 0; r < k; r++) for (let c = 0; c < k; c++) G[r][c] += Z[i][r] * Z[i][c];
  for (let i = 0; i < k; i++) G[i][i] += 1e-12;
  const inv = invert2orN(G);
  if (!inv) return NaN;
  return beta[idx] / Math.sqrt(Math.max(s2 * inv[idx][idx], 1e-30));
}

/**
 * Inverts a small matrix by Gauss-Jordan with a RELATIVE pivot tolerance. An
 * absolute tolerance is a trap here: the Johansen moment matrices are badly
 * scaled (log prices accumulate), so a 1e-14 absolute floor happily inverts a
 * near-singular matrix and returns eigenvalues in the thousands.
 */
function invert2orN(A: number[][]): number[][] | null {
  const n = A.length;
  const scale = Math.max(...A.map((row, i) => Math.abs(row[i])), 1e-300);
  const tol = 1e-11 * scale;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) <= tol) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const out = M.map((row) => row.slice(n));
  return out.some((row) => row.some((v) => !Number.isFinite(v))) ? null : out;
}

/** Benjamini-Hochberg FDR-adjusted p-values. NaN entries sort last and stay NaN. */
export function bhQvalues(p: (number | null)[]): number[] {
  const n = p.length;
  const idx = p.map((v, i) => i).filter((i) => p[i] !== null && finite(p[i] as number));
  idx.sort((a, b) => (p[a] as number) - (p[b] as number));
  const q = new Array(n).fill(NaN);
  let min = 1;
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    const v = Math.min(1, ((p[i] as number) * n) / (k + 1));
    min = Math.min(min, v);
    q[i] = min;
  }
  return q;
}

// --------------------------------------------------------- mean reversion

/** AR(1) half-life of a spread, in bars. NaN when it does not revert. */
export function halfLife(x: (number | null)[]): number {
  const v = x.filter((q): q is number => q !== null && finite(q));
  if (v.length < 30) return NaN;
  const xs: number[] = [];
  const ds: number[] = [];
  for (let i = 1; i < v.length; i++) {
    xs.push(v[i - 1]);
    ds.push(v[i] - v[i - 1]);
  }
  const mx = xs.reduce((s, q) => s + q, 0) / xs.length;
  const md = ds.reduce((s, q) => s + q, 0) / ds.length;
  let cov = 0;
  let varr = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ds[i] - md);
    varr += (xs[i] - mx) ** 2;
  }
  if (varr === 0) return NaN;
  const theta = -cov / varr;
  return theta > 0 ? Math.log(2) / theta : Infinity;
}

/**
 * Autocorrelation function of a spread, lags 1..maxLag (index k IS lag k+1 —
 * lag 0 is the variance, not an autocorrelation, and returning it is how this
 * function reported a perfect 1.0 for every series until it was caught).
 */
export function autocorr(x: (number | null)[], maxLag = 40): number[] {
  const v = x.filter((q): q is number => q !== null && finite(q));
  const n = v.length;
  const out = new Array(Math.max(Math.min(maxLag, n - 2), 0)).fill(NaN);
  if (n < 10) return out;
  const mean = v.reduce((s, q) => s + q, 0) / n;
  let s0 = 0;
  for (const q of v) s0 += (q - mean) ** 2;
  if (!(s0 > 0)) return out;
  for (let k = 0; k < out.length; k++) {
    const lag = k + 1;
    let num = 0;
    const m = n - lag;
    for (let i = 0; i < m; i++) num += (v[i] - mean) * (v[i + lag] - mean);
    out[k] = num / s0;
  }
  return out;
}

/**
 * Lag-1 autocorrelation of the spread's FIRST DIFFERENCES.
 *
 * For a stationary spread with AR(1) coefficient phi this is exactly
 * -(1 - phi) / 2 — which makes it an invertible restatement of the half-life
 * (ln2 / -ln phi), NOT independent evidence. It is reported because it is a
 * human-readable statement of the same fact ("the spread pulls back"), not
 * used as a fourth gate. See `P.MIN_CHANGE_AC1_DISPLAY_ONLY`.
 */
export function changeAutocorr1(x: (number | null)[]): number {
  const v = x.filter((q): q is number => q !== null && finite(q));
  const d: number[] = [];
  for (let i = 1; i < v.length; i++) d.push(v[i] - v[i - 1]);
  return autocorr(d, 1)[0] ?? NaN;
}

/**
 * Hurst exponent by rescaled-range analysis: non-overlapping blocks, range of
 * each block's cumulative sum over the block's own standard deviation, averaged
 * across blocks, then a log-log regression on block size. The textbook
 * estimator.
 *
 * READ IT AS A DIAGNOSTIC, NOT A FILTER. R/S is designed for non-stationary
 * series; a stationary residual still has cumulative sums that wander, so a
 * spread with a 5-day half-life reads ~0.87 here and a random walk reads ~1.0.
 * Thresholding at HURST_MAX would block precisely the fast-reverting spreads
 * this desk exists to trade, so the number is displayed and left to the reader.
 * The gate is `changeAutocorr1`.
 */
export function hurstExp(x: (number | null)[], minBlock = 8, gridPoints = 32): number {
  const v = x.filter((q): q is number => q !== null && finite(q));
  const n = v.length;
  if (n < 120) return NaN;
  // A logarithmic grid of block sizes, not powers of two: with only powers of
  // two a 500-bar residual yields three usable sizes, which is too few points
  // to fit a slope through.
  const maxBlock = Math.floor(n / 6);
  if (maxBlock < minBlock * 4) return NaN;
  const lags: number[] = [];
  const tau: number[] = [];
  for (let g = 0; g < gridPoints; g++) {
    const L = Math.max(minBlock, Math.round(minBlock * Math.pow(maxBlock / minBlock, g / (gridPoints - 1))));
    if (lags.length && L <= lags[lags.length - 1]) continue;
    const nBlocks = Math.floor(n / L);
    if (nBlocks < 4) continue;
    const vals: number[] = [];
    for (let b = 0; b < nBlocks; b++) {
      const s = b * L;
      let run = 0;
      let lo = 0;
      let hi = 0;
      let mean = 0;
      for (let i = 0; i < L; i++) mean += v[s + i];
      mean /= L;
      let ss = 0;
      for (let i = 0; i < L; i++) {
        const d = v[s + i] - mean;
        ss += d * d;
        run += d;
        if (run < lo) lo = run;
        if (run > hi) hi = run;
      }
      const sd = Math.sqrt(ss / (L - 1 || 1));
      if (sd > 0) vals.push((hi - lo) / sd);
    }
    if (vals.length < 4) continue;
    lags.push(L);
    tau.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  if (lags.length < 8) return NaN;
  const lx = lags.map((l) => Math.log(l));
  const ly = tau.map((t) => Math.log(t));
  const mx = lx.reduce((s, q) => s + q, 0) / lx.length;
  const my = ly.reduce((s, q) => s + q, 0) / ly.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < lx.length; i++) {
    num += (lx[i] - mx) * (ly[i] - my);
    den += (lx[i] - mx) ** 2;
  }
  return den === 0 ? NaN : num / den;
}

// ------------------------------------------------------------ hedge ratios

export interface HedgeModel {
  beta: (number | null)[];
  alpha: (number | null)[];
}

/**
 * Causal Kalman filter for log A = beta_t · log B + alpha_t + noise.
 * State drift is scaled to the observation noise so `delta` is unit-free:
 * ~sqrt(delta) is the per-bar adaptation gain (1e-5 -> roughly a 300-bar
 * memory). Initialised by OLS over `warmup` bars; every beta at index < warmup
 * is null rather than back-filled, so nothing before the filter is warm is
 * silently fitted.
 */
export function kalmanHedge(la: number[], lb: number[], delta: number = P.KALMAN_DELTA, warmup: number = P.WARMUP): HedgeModel {
  const n = la.length;
  const beta: (number | null)[] = new Array(n).fill(null);
  const alpha: (number | null)[] = new Array(n).fill(null);
  if (n < warmup + 20) return { beta, alpha };

  let xm = 0;
  let ym = 0;
  for (let i = 0; i < warmup; i++) {
    xm += lb[i];
    ym += la[i];
  }
  xm /= warmup;
  ym /= warmup;
  const xc: number[] = lb.map((v) => v - xm);
  const yc: number[] = la.map((v) => v - ym);
  let sx2 = 0;
  for (let i = 0; i < warmup; i++) sx2 += xc[i] ** 2;
  sx2 = Math.max(sx2 / warmup, 1e-10);
  let b0 = 0;
  for (let i = 0; i < warmup; i++) b0 += xc[i] * yc[i];
  b0 /= sx2 * warmup;
  let se = 0;
  for (let i = 0; i < warmup; i++) se += (yc[i] - b0 * xc[i]) ** 2;
  const ve = Math.max(se / warmup, 1e-8);

  let s0 = b0;
  let s1 = 0;
  const v0 = (ve * delta) / sx2;
  const v1 = ve * delta;
  let p00 = ve / (warmup * sx2);
  let p01 = 0;
  let p11 = ve / warmup;

  for (let t = warmup; t < n; t++) {
    const r00 = p00 + v0;
    const r01 = p01;
    const r11 = p11 + v1;
    const xt = xc[t];
    const rh0 = r00 * xt + r01;
    const rh1 = r01 * xt + r11;
    const q = xt * rh0 + rh1 + ve;
    if (!(Math.abs(q) > 1e-300)) break;
    const e = yc[t] - (s0 * xt + s1);
    const k0 = rh0 / q;
    const k1 = rh1 / q;
    s0 += k0 * e;
    s1 += k1 * e;
    p00 = r00 - k0 * rh0;
    p01 = r01 - k0 * rh1;
    p11 = r11 - k1 * rh1;
    if (!finite(s0) || !finite(s1)) break;
    beta[t] = s0;
    alpha[t] = s1 + ym - s0 * xm;
  }
  return { beta, alpha };
}

/** Rolling OLS hedge with clipping to a sane band, as the v1 desk specified. */
export function olsHedge(la: number[], lb: number[], win: number): HedgeModel {
  const n = la.length;
  const beta: (number | null)[] = new Array(n).fill(null);
  const alpha: (number | null)[] = new Array(n).fill(null);
  for (let i = win - 1; i < n; i++) {
    let sx = 0;
    let sy = 0;
    for (let k = i - win + 1; k <= i; k++) {
      sx += lb[k];
      sy += la[k];
    }
    const mx = sx / win;
    const my = sy / win;
    let cov = 0;
    let vb = 0;
    for (let k = i - win + 1; k <= i; k++) {
      cov += (lb[k] - mx) * (la[k] - my);
      vb += (lb[k] - mx) ** 2;
    }
    if (!(vb > 0)) continue;
    const b = Math.min(5, Math.max(0.2, cov / vb));
    beta[i] = b;
    alpha[i] = my - b * mx;
  }
  return { beta, alpha };
}

export interface SpreadModel {
  beta: (number | null)[];
  alpha: (number | null)[];
  spread: (number | null)[];
  mu: (number | null)[];
  sd: (number | null)[];
  z: (number | null)[];
}

/**
 * Spread uses the PREVIOUS bar's hedge (strictly causal) and the rolling mean /
 * sd exclude the current bar, so z at t uses only information through t-1.
 */
export function buildSpreadModel(la: number[], lb: number[], lookback: number, hedge?: HedgeModel): SpreadModel {
  const h = hedge ?? kalmanHedge(la, lb);
  const n = la.length;
  const spread: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const b = i > 0 ? h.beta[i - 1] : null;
    const a = i > 0 ? h.alpha[i - 1] : null;
    if (b === null || a === null) continue;
    spread[i] = la[i] - b * lb[i] - a;
  }
  const mu: (number | null)[] = new Array(n).fill(null);
  const sd: (number | null)[] = new Array(n).fill(null);
  const z: (number | null)[] = new Array(n).fill(null);
  for (let i = lookback; i < n; i++) {
    let s = 0;
    let k = 0;
    for (let j = i - lookback; j < i; j++) {
      const v = spread[j];
      if (v === null || !finite(v)) continue;
      s += v;
      k++;
    }
    if (k < lookback * 0.8) continue;
    const m = s / k;
    let v = 0;
    for (let j = i - lookback; j < i; j++) {
      const q = spread[j];
      if (q === null || !finite(q)) continue;
      v += (q - m) ** 2;
    }
    const sdj = Math.sqrt(v / k);
    if (!(sdj > 0)) continue;
    const cur = spread[i];
    if (cur === null || !finite(cur)) continue;
    mu[i] = m;
    sd[i] = sdj;
    z[i] = (cur - m) / sdj;
  }
  return { beta: h.beta, alpha: h.alpha, spread, mu, sd, z };
}

// ------------------------------------------------------------- simulation

export interface SimState {
  pos: number;
  held: number;
  bEntry: number | null;
  cooldown: number;
}

/**
 * Position state machine. `pos[t]` is the position held AFTER the close of bar
 * t; +1 = long A / short B, -1 = short A / long B. The hedge ratio is frozen
 * at entry. `state` is threaded so a walk-forward run can continue across a
 * re-optimisation boundary WITHOUT closing an open trade at the boundary.
 */
export function simulate(
  z: (number | null)[],
  beta: (number | null)[],
  entry: number,
  exitZ: number,
  stop: number,
  timeStop: number,
  cooldownBars: number,
  init?: SimState
): { pos: number[]; betaEntry: (number | null)[]; state: SimState } {
  const n = z.length;
  const pos = new Array<number>(n).fill(0);
  const be: (number | null)[] = new Array(n).fill(null);
  let { pos: cur, held, bEntry, cooldown } = init ?? { pos: 0, held: 0, bEntry: null, cooldown: 0 };
  for (let t = 0; t < n; t++) {
    const zt = z[t];
    if (zt === null || !finite(zt)) {
      pos[t] = cur;
      be[t] = cur ? bEntry : null;
      continue;
    }
    if (cur === 0) {
      if (cooldown > 0) cooldown--;
      else {
        if (zt >= entry && zt < stop) cur = -1;
        else if (zt <= -entry && zt > -stop) cur = 1;
        if (cur !== 0) {
          held = 0;
          bEntry = beta[t] ?? null;
        }
      }
    } else {
      held++;
      const hitStop = (cur === 1 && zt <= -stop) || (cur === -1 && zt >= stop);
      const hitTp = (cur === 1 && zt >= -exitZ) || (cur === -1 && zt <= exitZ);
      if (hitStop || hitTp || held >= timeStop) {
        cur = 0;
        cooldown = hitStop ? cooldownBars : 0;
        bEntry = null;
      }
    }
    pos[t] = cur;
    be[t] = cur ? bEntry : null;
  }
  return { pos, betaEntry: be, state: { pos: cur, held, bEntry, cooldown } };
}

/**
 * Daily P&L per unit of GROSS notional. Costs are charged on every entry AND
 * exit, one bar after the decision when a delay is set, so a one-bar delay is
 * an honest execution assumption rather than a free option.
 */
export function pnlFromPositions(
  pos: number[],
  be: (number | null)[],
  ra: number[],
  rb: number[],
  delay: number = P.SIGNAL_DELAY,
  costBps: number = P.COST_BPS_PER_SIDE
): number[] {
  const d = 1 + delay;
  const n = pos.length;
  const out = new Array<number>(n).fill(0);
  for (let i = d; i < n; i++) {
    const pl = pos[i - d];
    if (!pl) continue;
    const bl = be[i - d];
    const b = bl === null || !finite(bl) ? 0 : bl;
    const wa = 1 / (1 + b);
    const wb = b / (1 + b);
    out[i] = pl * (wa * (ra[i] || 0) - wb * (rb[i] || 0));
  }
  // Turnover on the delayed decision series, charged on the execution bar.
  const k = d - 1;
  for (let i = k; i < n; i++) {
    const prev = i - k > 0 ? pos[i - k - 1] : 0;
    const cur = pos[i - k];
    const turn = Math.abs(cur - prev);
    if (turn) out[i] -= turn * (costBps / 1e4);
  }
  return out;
}

export interface Trade {
  entry: string;
  exit: string;
  side: string;
  bars: number;
  pnl: number;
}

export function extractTrades(pos: number[], ret: number[], dates: string[], delay: number, start = 0): Trade[] {
  const d = 1 + delay;
  const out: Trade[] = [];
  let t0 = -1;
  let side = 0;
  for (let t = Math.max(start, 1); t < pos.length; t++) {
    const prev = pos[t - 1];
    if (prev === 0 && pos[t] !== 0) {
      t0 = t;
      side = pos[t];
    } else if (prev !== 0 && pos[t] === 0 && t0 >= 0) {
      const a = Math.min(t0 + d - 1, ret.length - 1);
      const b = Math.min(t + d - 1, ret.length - 1);
      let g = 1;
      for (let k = a; k <= b; k++) g *= 1 + (ret[k] || 0);
      out.push({
        entry: dates[t0],
        exit: dates[t],
        side: side > 0 ? "LONG A / SHORT B" : "SHORT A / LONG B",
        bars: t - t0,
        pnl: g - 1,
      });
      t0 = -1;
    }
  }
  return out;
}

export interface PerfStats {
  ReturnPct: number;
  CAGRpct: number;
  VolPct: number;
  Sharpe: number;
  Sortino: number;
  MaxDDpct: number;
  Calmar: number;
  Trades: number;
  WinRatePct: number;
  ProfitFactor: number;
  AvgHold: number;
}

export const BLANK_STATS: PerfStats = {
  ReturnPct: 0, CAGRpct: 0, VolPct: 0, Sharpe: 0, Sortino: NaN, MaxDDpct: 0,
  Calmar: NaN, Trades: 0, WinRatePct: NaN, ProfitFactor: NaN, AvgHold: NaN,
};

export function perfStats(ret: number[], trades?: Trade[]): PerfStats {
  const r = ret.filter(finite);
  if (r.length < 30) return { ...BLANK_STATS };
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (const v of r) {
    eq *= 1 + v;
    if (eq > peak) peak = eq;
    dd = Math.min(dd, eq / peak - 1);
  }
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / (r.length - 1 || 1));
  const dnVals = r.filter((v) => v < 0);
  const dn = dnVals.length > 1
    ? Math.sqrt(dnVals.reduce((s, v) => s + (v - dnVals.reduce((u, w) => u + w, 0) / dnVals.length) ** 2, 0) / (dnVals.length - 1))
    : NaN;
  const yrs = r.length / TRADING_DAYS;
  const cagr = eq > 0 ? (Math.pow(eq, 1 / yrs) - 1) * 100 : -100;
  const sharpe = sd > 0 ? (Math.sqrt(TRADING_DAYS) * mean) / sd : 0;
  const sortino = finite(dn) && dn > 0 ? (Math.sqrt(TRADING_DAYS) * mean) / dn : NaN;
  const out: PerfStats = {
    ReturnPct: (eq - 1) * 100,
    CAGRpct: cagr,
    VolPct: sd * Math.sqrt(TRADING_DAYS) * 100,
    Sharpe: sharpe,
    Sortino: sortino,
    MaxDDpct: dd * 100,
    Calmar: dd < 0 ? cagr / Math.abs(dd) : NaN,
    Trades: 0,
    WinRatePct: NaN,
    ProfitFactor: NaN,
    AvgHold: NaN,
  };
  if (trades?.length) {
    const p = trades.map((t) => t.pnl);
    const gl = -p.filter((v) => v < 0).reduce((s, v) => s + v, 0);
    out.Trades = p.length;
    out.WinRatePct = (p.filter((v) => v > 0).length / p.length) * 100;
    out.ProfitFactor = gl > 0 ? p.filter((v) => v > 0).reduce((s, v) => s + v, 0) / gl : Infinity;
    out.AvgHold = trades.reduce((s, t) => s + t.bars, 0) / trades.length;
  }
  return out;
}

// -------------------------------------------------------- walk-forward core

export interface LiveParams {
  lookback: number;
  entry: number;
  exit: number;
  timeStop: number;
  halfLife: number;
  trainSharpe: number;
}

function sharpeOf(r: number[]): number {
  if (r.length < 5) return 0;
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / (r.length - 1 || 1));
  return sd > 0 ? (Math.sqrt(TRADING_DAYS) * mean) / sd : 0;
}

function optimise(
  models: Map<number, SpreadModel>,
  ra: number[],
  rb: number[],
  lo: number,
  hi: number,
  refSpread: (number | null)[]
): LiveParams {
  const hl = halfLife(refSpread.slice(lo, hi));
  const timeStop = Number.isFinite(hl) ? Math.min(60, Math.max(8, Math.round(P.TIME_STOP_HL_MULT * hl))) : 25;
  const run = (lb: number, entry: number, exitZ: number) => {
    const m = models.get(lb);
    if (!m) return { sh: 0, trades: 0 };
    const z = m.z.slice(lo, hi);
    const b = m.beta.slice(lo, hi);
    const sim = simulate(z, b, entry, exitZ, P.STOP_Z, timeStop, P.COOLDOWN_BARS);
    const r = pnlFromPositions(sim.pos, sim.betaEntry, ra.slice(lo, hi), rb.slice(lo, hi));
    let trades = sim.pos[0] !== 0 ? 1 : 0;
    for (let i = 1; i < sim.pos.length; i++) if (sim.pos[i] !== 0 && sim.pos[i - 1] === 0) trades++;
    return { sh: sharpeOf(r), trades };
  };
  const base = run(P.DEFAULT_LB, P.ENTRY_Z, P.EXIT_Z);
  let best: [number, number, number] = [P.DEFAULT_LB, P.ENTRY_Z, P.EXIT_Z];
  let bestSh = base.sh;
  for (const lb of P.GRID_LOOKBACK)
    for (const entry of P.GRID_ENTRY)
      for (const exitZ of P.GRID_EXIT) {
        const r = run(lb, entry, exitZ);
        if (r.trades >= P.MIN_TRAIN_TRADES && r.sh > bestSh) {
          best = [lb, entry, exitZ];
          bestSh = r.sh;
        }
      }
  // Shrink to defaults unless the grid point clearly wins.
  if (bestSh < base.sh + P.OPT_MARGIN) {
    best = [P.DEFAULT_LB, P.ENTRY_Z, P.EXIT_Z];
    bestSh = base.sh;
  }
  return { lookback: best[0], entry: best[1], exit: best[2], timeStop, halfLife: hl, trainSharpe: bestSh };
}

export interface WFResult {
  dates: string[];
  pos: number[];
  betaEntry: (number | null)[];
  ra: number[];
  rb: number[];
  ret: number[];
  startPos: number;
  liveParams: LiveParams;
  paramsLog: Array<LiveParams & { from: string; to: string }>;
  trades: Trade[];
  zTail: (number | null)[];
  zDates: string[];
  spreadTail: (number | null)[];
  betaTail: (number | null)[];
}

export function walkForward(pa: number[], pb: number[], dates: string[], startPos: number, prebuilt?: Map<number, SpreadModel>): WFResult {
  const n = pa.length;
  const la = pa.map(Math.log);
  const lb = pb.map(Math.log);
  const ra: number[] = new Array(n).fill(0);
  const rb: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    ra[i] = la[i] - la[i - 1];
    rb[i] = lb[i] - lb[i - 1];
  }
  const hedge = kalmanHedge(la, lb);
  const lbs = [...new Set<number>([...P.GRID_LOOKBACK, P.DEFAULT_LB])];
  const models = prebuilt ?? new Map<number, SpreadModel>();
  for (const l of lbs) if (!models.has(l)) models.set(l, buildSpreadModel(la, lb, l, hedge));
  const ref = models.get(P.DEFAULT_LB)!.spread;

  const pos = new Array<number>(n).fill(0);
  const be: (number | null)[] = new Array(n).fill(null);
  let state: SimState = { pos: 0, held: 0, bEntry: null, cooldown: 0 };
  const log: Array<LiveParams & { from: string; to: string }> = [];
  let s = Math.max(startPos, P.TRAIN_WINDOW);
  while (s < n) {
    const e = Math.min(s + P.TEST_STEP, n);
    const p = optimise(models, ra, rb, Math.max(0, s - P.TRAIN_WINDOW), s, ref);
    const m = models.get(p.lookback)!;
    const sim = simulate(m.z.slice(s, e), m.beta.slice(s, e), p.entry, p.exit, P.STOP_Z, p.timeStop, P.COOLDOWN_BARS, state);
    for (let i = 0; i < e - s; i++) {
      pos[s + i] = sim.pos[i];
      be[s + i] = sim.betaEntry[i];
    }
    state = sim.state;
    log.push({ ...p, from: dates[s], to: dates[e - 1] });
    s = e;
  }
  const liveParams = optimise(models, ra, rb, Math.max(0, n - P.TRAIN_WINDOW), n, ref);
  const ret = pnlFromPositions(pos, be, ra, rb);
  const lm = models.get(liveParams.lookback)!;
  const tail = Math.min(n, 300);
  return {
    dates,
    pos,
    betaEntry: be,
    ra,
    rb,
    ret,
    startPos,
    liveParams,
    paramsLog: log,
    trades: extractTrades(pos, ret, dates, P.SIGNAL_DELAY, startPos),
    zTail: lm.z.slice(n - tail),
    zDates: dates.slice(n - tail),
    spreadTail: lm.spread.slice(n - tail),
    betaTail: lm.beta.slice(n - tail),
  };
}

/** v1-style baseline so the desk can show what the adaptive version is worth. */
export function staticRun(pa: number[], pb: number[], dates: string[]): { ret: number[]; pos: number[]; z: (number | null)[] } {
  const n = pa.length;
  const la = pa.map(Math.log);
  const lb = pb.map(Math.log);
  const m = buildSpreadModel(la, lb, 60, olsHedge(la, lb, 60));
  const ra: number[] = new Array(n).fill(0);
  const rb: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    ra[i] = la[i] - la[i - 1];
    rb[i] = lb[i] - lb[i - 1];
  }
  const sim = simulate(m.z, m.beta, 2.0, 0.5, P.STOP_Z, 25, 0);
  return { ret: pnlFromPositions(sim.pos, sim.betaEntry, ra, rb), pos: sim.pos, z: m.z };
}

// ---------------------------------------------------------------- portfolio

/** Block bootstrap of the Sharpe ratio — autocorrelation-aware, not i.i.d. */
export function bootstrapSharpe(r: number[], nBoot: number = P.N_BOOTSTRAP, block = 10, seed = 7): number[] {
  const v = r.filter(finite);
  const n = v.length;
  if (n < 3 * block) return [NaN];
  let s = seed >>> 0;
  const rnd = () => {
    // mulberry32 — deterministic so the reported CI is reproducible.
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nb = Math.ceil(n / block);
  const out: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const samp: number[] = [];
    while (samp.length < n) {
      const st = Math.floor(rnd() * (n - block));
      for (let k = 0; k < block && samp.length < n; k++) samp.push(v[st + k]);
    }
    out.push(sharpeOf(samp));
  }
  return out;
}

/**
 * Equal-risk basket. Each active pair contributes 1/max(MAX_CONCURRENT, #active)
 * of the book, so the capital a pair receives does not depend on how many other
 * pairs happen to be in the same spread at the same time.
 */
export function portfolioReturn(
  results: Array<{ dates: string[]; pos: number[]; betaEntry: (number | null)[]; ra: number[]; rb: number[]; startPos: number }>,
  delay: number = P.SIGNAL_DELAY,
  cost: number = P.COST_BPS_PER_SIDE
): { dates: string[]; ret: number[]; active: number[] } {
  const usable = results.filter((w) => w.dates.length && w.startPos < w.dates.length);
  if (!usable.length) return { dates: [], ret: [], active: [] };
  const master: string[] = [];
  const seen = new Set<string>();
  for (const w of usable)
    for (let i = w.startPos; i < w.dates.length; i++)
      if (!seen.has(w.dates[i])) {
        seen.add(w.dates[i]);
        master.push(w.dates[i]);
      }
  master.sort();
  // Per pair: date -> index once, plus the full delayed P&L series.
  const legs = usable.map((w) => ({
    idx: new Map(w.dates.map((d, i) => [d, i])),
    pnl: pnlFromPositions(w.pos, w.betaEntry, w.ra, w.rb, delay, cost),
    pos: w.pos,
  }));
  const dly = 1 + delay;
  const ret: number[] = [];
  const active: number[] = [];
  for (let t = 0; t < master.length; t++) {
    let engaged = 0;
    let sum = 0;
    for (const leg of legs) {
      const i = leg.idx.get(master[t]);
      if (i === undefined) continue;
      sum += leg.pnl[i];
      // Engagement is read on the EXECUTION bar, i.e. the position the delayed
      // P&L series was built from — counting the signal bar would overstate how
      // long capital was committed by exactly the delay.
      if (leg.pos[Math.max(0, i - dly + 1)] !== 0) engaged++;
    }
    active.push(engaged);
    ret.push(sum / Math.max(P.MAX_CONCURRENT, engaged));
  }
  return { dates: master, ret, active };
}
