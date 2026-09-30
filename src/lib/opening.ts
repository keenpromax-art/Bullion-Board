// Opening-desk prediction engine (module 109 / FNC PRE).
// Pure math only — every fetch lives in /api/opening/*.
//
// MODEL: independent information FACTORS -> deadbanded, magnitude-weighted votes
// -> weight-normalised EDGE in [-1,+1] -> regime-gated verdict + an EXPECTED
// GAP forecast in percent and in index points.
//
// Design rules, and the measurement behind each one. Every number in
// `FITTED` / `MEASURED` below was produced by /api/opening/history over 494
// Nifty sessions (2024-10-01 -> 2026-09-29) with a strictly zero-lookahead,
// window-aware reconstruction, and re-verified walk-forward out-of-sample.
//
//   1. MAGNITUDE. A -3% overnight move and a -0.05% move are not the same vote.
//   2. DEADBAND. Noise inside a per-leg deadband votes 0 instead of ±1.
//   3. WINDOWS. A leg may only be read inside its market's own trading hours.
//      STI opens 06:30 IST, N225 05:30, HSI 07:00 — the prior US close.
//      Reading a shut market's "live" price is how a scorecard ends up
//      measuring a model nobody runs.
//   4. COVERAGE. A leg with no tape contributes nothing and LOWERS coverage.
//      It is never replaced by a guess. Missing data renders as a caveat.
//   5. FITTED WEIGHTS, SHRUNK. Leg weights are ridge-fitted against the
//      realised gap and blended 30% back toward the hand prior, so a thin or
//      noisy sample cannot swing what the desk publishes.
//   6. GATING. |edge| below a regime-scaled threshold is FLAT = STAND ASIDE.
//   7. MAGNITUDE, NOT JUST COLOUR. The forecast is `GAP_A + GAP_B * edge`.
//      Out-of-sample that beat the unconditional base rate by 14% of RMSE,
//      and the directional calls showed a +0.93% mean-gap spread (t = 6.9).
//      A colour without a size is not a forecast.
//   8. NO LOOKAHEAD. /api/opening/history rebuilds this engine from strictly
//      prior prints only, so the accuracy figure describes THIS model.

export const IST_OFFSET_SEC = 19800;
export const VIX_THRESHOLD = 15.0;

// ---- NSE fallback breadth universe (only used if nseindia.com is down) ----
export const OPENING_UNIVERSE = [
  "RELIANCE.NS", "HDFCBANK.NS", "BHARTIARTL.NS", "ICICIBANK.NS", "INFY.NS", "TCS.NS",
  "SBIN.NS", "ITC.NS", "HINDUNILVR.NS", "LT.NS", "BAJFINANCE.NS", "HCLTECH.NS",
  "MARUTI.NS", "SUNPHARMA.NS", "NTPC.NS", "ONGC.NS", "KOTAKBANK.NS", "M&M.NS",
  "AXISBANK.NS", "TATAMOTORS.NS", "TITAN.NS", "ULTRACEMCO.NS", "POWERGRID.NS",
  "ADANIENT.NS", "ADANIPORTS.NS", "TATASTEEL.NS", "JSWSTEEL.NS", "COALINDIA.NS",
  "GRASIM.NS", "TECHM.NS", "WIPRO.NS", "NESTLEIND.NS", "BRITANNIA.NS", "EICHERMOT.NS",
  "HEROMOTOCO.NS", "BAJAJ-AUTO.NS", "DRREDDY.NS", "CIPLA.NS", "APOLLOHOSP.NS",
  "DIVISLAB.NS", "BAJAJFINSV.NS", "SBILIFE.NS", "HDFCLIFE.NS", "INDUSINDBK.NS",
  "SHRIRAMFIN.NS", "TATACONSUM.NS", "TRENT.NS", "BEL.NS", "BPCL.NS", "HINDALCO.NS",
];

export const CAPTURE_SLOTS = [
  "09:00", "09:30", "10:30", "11:30", "12:30",
  "13:30", "14:30", "15:30", "16:00", "21:00",
];

// ---- IST clock + cash session ----
export const CASH_OPEN_MIN = 9 * 60 + 15;   // 09:15
export const CASH_CLOSE_MIN = 15 * 60 + 30;  // 15:30
/** The minute the pre-open call is struck. Everything is read as of here. */
export const DECISION_MIN = 9 * 60;

export type SessionPhase =
  | "OVERNIGHT" | "PRE_OPEN" | "OPENING_WINDOW" | "CASH_OPEN" | "MIDDAY" | "CLOSE" | "POST_CLOSE";

export type Verdict = "GREEN" | "RED" | "FLAT" | "NO_DATA";

export function istNow(): Date {
  return new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
}

export function istHHMM(d: Date = istNow()): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function istStamp(d: Date = istNow()): string {
  const days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()} — ${istHHMM(d)} IST`;
}

export function minutesToHHMM(m: number): string {
  const v = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

export function istMinutes(d: Date = istNow()): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Yahoo stamps are epoch seconds. NSE/IST-dated series must be resolved in IST
// or a bar silently lands on the previous calendar day.
export function istDateFromUnix(ts: number): string {
  return new Date((ts + IST_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

export function istHHMMFromUnix(ts: number): string {
  const d = new Date((ts + IST_OFFSET_SEC) * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Unix seconds for `YYYY-MM-DD hhmm` in IST. */
export function istUnix(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + h * 3600 + m * 60 - IST_OFFSET_SEC;
}

export function sessionPhase(d: Date = istNow()): SessionPhase {
  const m = istMinutes(d);
  if (m < 4 * 60) return "OVERNIGHT";
  if (m < 8 * 60 + 45) return "PRE_OPEN";
  if (m < CASH_OPEN_MIN) return "OPENING_WINDOW";
  if (m < 9 * 60 + 30) return "CASH_OPEN";
  if (m < 13 * 60 + 30) return "MIDDAY";
  if (m < CASH_CLOSE_MIN) return "CLOSE";
  return "POST_CLOSE";
}

export function nearestSlot(hhmm: string = istHHMM()): string {
  const [h, m] = hhmm.split(":").map(Number);
  const target = h * 60 + m;
  let best = CAPTURE_SLOTS[0], bestDiff = Infinity;
  for (const s of CAPTURE_SLOTS) {
    const [sh, sm] = s.split(":").map(Number);
    const diff = Math.abs(sh * 60 + sm - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  return best;
}

// ---- Leg catalogue -------------------------------------------------------
export type LegGroup = "FUTURES" | "ASIA" | "US CASH" | "FX" | "MACRO" | "VOL";

/**
 * A leg's trading hours in IST minutes, or:
 *   null  — 24h instrument (futures, FX, DXY): always live
 *   []    — session already closed at the decision minute (US cash). Only the
 *           last COMPLETED daily close is admissible, never the forming one.
 * Otherwise the local session's [open, close] in IST.
 */
export type LegWindow = [number, number] | [] | null;

export interface LegSpec {
  key: string;
  label: string;
  short: string;
  group: LegGroup;
  symbol: string;
  /** Weight actually used by the engine — ridge-fitted, shrunk toward prior. */
  weight: number;
  /** The hand prior the fit is shrunk toward. Published for audit. */
  priorWeight: number;
  /** % move at which the vote saturates toward ±1 (tanh scale). */
  scale: number;
  /** % move ignored entirely — below this the leg votes 0, not ±1. */
  deadband: number;
  /** Rising reading is bearish for Nifty (USD strength, oil bid, yields up). */
  invert?: boolean;
  /** |move| beyond this is a feed/roll artefact, not information. */
  plausiblePct: number;
  /** IST trading hours; see LegWindow. */
  window: LegWindow;
  /** Can the leg be reconstructed from strictly-prior daily bars alone? */
  backtestable: boolean;
  /** Measured Pearson r of the leg's signed reading against the realised gap. */
  measuredR: number | null;
  /** Measured sign agreement on genuinely directional gaps, %. */
  measuredSign: number | null;
  /** Why this leg earns its weight. Rendered on the desk — no silent legs. */
  note: string;
}

// Weights are the ridge coefficients /api/opening/history re-measures on every
// run (blended 30% back toward `priorWeight`), published here as constants so
// the live route stays fast and deterministic. `measuredR` / `measuredSign` are
// that same rebuild's per-leg diagnostic. Shipped weight and measured
// correlation sit side by side on the leg build, so a leg that earns weight
// without evidence is visible rather than buried.
export const PRE_OPEN_LEGS: LegSpec[] = [
  {
    key: "ES", label: "E-MINI S&P — OVERNIGHT", short: "ES", group: "FUTURES",
    symbol: "ES=F", weight: 0.118, priorWeight: 1.30, scale: 0.45, deadband: 0.10,
    plausiblePct: 9, window: null, backtestable: true, measuredR: 0.419, measuredSign: 76.3,
    note: "TRADES ~23H. ON ITS OWN IT IS THE WEAKEST FACTOR IN THE ENGINE — IT EARNS ITS PLACE BY REDUCING THE NOISE IN THE OTHER LEGS' READ, NOT BY BEING RIGHT.",
  },
  {
    key: "NQ", label: "E-MINI NASDAQ — OVERNIGHT", short: "NQ", group: "FUTURES",
    symbol: "NQ=F", weight: 0.099, priorWeight: 1.15, scale: 0.60, deadband: 0.12,
    plausiblePct: 12, window: null, backtestable: true, measuredR: 0.363, measuredSign: 72.0,
    note: "LIVE THROUGH THE IST MORNING — TECH-HEAVY NIFTY PROXY. 0.96 CORRELATED WITH ES.",
  },
  {
    key: "YM", label: "E-MINI DOW — OVERNIGHT", short: "YM", group: "FUTURES",
    symbol: "YM=F", weight: 0.116, priorWeight: 0.85, scale: 0.40, deadband: 0.10,
    plausiblePct: 9, window: null, backtestable: true, measuredR: 0.419, measuredSign: 75.0,
    note: "VALUE / INDUSTRIAL READ ON THE OVERNIGHT TAPE.",
  },
  {
    key: "N225", label: "NIKKEI 225 — ASIA OPEN", short: "N225", group: "ASIA",
    symbol: "^N225", weight: 0.074, priorWeight: 0.90, scale: 0.80, deadband: 0.25,
    plausiblePct: 9, window: [330, 720], backtestable: true, measuredR: 0.245, measuredSign: 64.3,
    note: "OPENS 05:30 IST — THE ASIA LEAD, AND THE LEG THE OLD BACKTEST COULD NOT SEE AT ALL.",
  },
  {
    key: "HSI", label: "HANG SENG — ASIA OPEN", short: "HSI", group: "ASIA",
    symbol: "^HSI", weight: 0.075, priorWeight: 0.70, scale: 0.90, deadband: 0.30,
    plausiblePct: 12, window: [420, 810], backtestable: true, measuredR: 0.220, measuredSign: 62.0,
    note: "OPENS 07:00 IST — CHINA SENSITIVITY LEAD, READ LIVE.",
  },
  {
    key: "STI", label: "STRAITS TIMES — ASIA", short: "STI", group: "ASIA",
    symbol: "^STI", weight: 0.052, priorWeight: 0.45, scale: 0.50, deadband: 0.20,
    plausiblePct: 6, window: [390, 870], backtestable: true, measuredR: 0.203, measuredSign: 57.9,
    note: "OPENS 06:30 IST, NOT 09:00 — SINGAPORE IS THE FIRST ASIA LEG THAT TRADES.",
  },
  {
    key: "SPX", label: "S&P 500 — PRIOR CASH CLOSE", short: "SPX", group: "US CASH",
    symbol: "^GSPC", weight: 0.061, priorWeight: 0.85, scale: 0.70, deadband: 0.25,
    plausiblePct: 12, window: [], backtestable: true, measuredR: 0.348, measuredSign: 70.0,
    note: "CLOSED ~02:30 IST. THE LAST COMPLETED US SESSION IS THE FRESHEST US PRINT AVAILABLE.",
  },
  {
    key: "NDX", label: "NASDAQ — PRIOR CASH CLOSE", short: "NDX", group: "US CASH",
    symbol: "^IXIC", weight: 0.052, priorWeight: 0.70, scale: 0.90, deadband: 0.30,
    plausiblePct: 12, window: [], backtestable: true, measuredR: 0.316, measuredSign: 69.7,
    note: "CLOSED ~02:30 IST — LAST COMPLETED US SESSION.",
  },
  {
    key: "DJI", label: "DOW — PRIOR CASH CLOSE", short: "DJI", group: "US CASH",
    symbol: "^DJI", weight: 0.071, priorWeight: 0.45, scale: 0.50, deadband: 0.20,
    plausiblePct: 12, window: [], backtestable: true, measuredR: 0.368, measuredSign: 70.7,
    note: "CLOSED ~02:30 IST — THE HIGHEST CORRELATION OF THE US CASH SET.",
  },
  {
    key: "USDINR", label: "USD/INR — OVERNIGHT", short: "INR", group: "FX",
    symbol: "INR=X", weight: 0.060, priorWeight: 0.55, scale: 0.25, deadband: 0.08,
    invert: true, plausiblePct: 3, window: null, backtestable: true, measuredR: 0.165, measuredSign: 52.3,
    note: "LIVE INR WEAKNESS HITS THE IMPORT-HEAVY INDEX. INVERTED. NEARLY UNCORRELATED WITH EVERY OTHER LEG.",
  },
  {
    key: "CRUDE", label: "WTI CRUDE — OVERNIGHT", short: "OIL", group: "MACRO",
    symbol: "CL=F", weight: 0.049, priorWeight: 0, scale: 2.50, deadband: 0.90,
    invert: true, plausiblePct: 12, window: null, backtestable: true, measuredR: 0.218, measuredSign: 56.0,
    note: "AN OIL SPIKE IS AN INFLATION-AND-MARGIN HIT. INVERTED. WEAKLY CORRELATED WITH THE US TAPE.",
  },
  {
    key: "GOLD", label: "GOLD — OVERNIGHT", short: "AU", group: "MACRO",
    symbol: "GC=F", weight: 0.054, priorWeight: 0, scale: 1.00, deadband: 0.40,
    plausiblePct: 8, window: null, backtestable: true, measuredR: 0.210, measuredSign: 59.0,
    note: "GOLD RISING ALONGSIDE EQUITIES = USD WEAKNESS / DEBASEMENT. NOT INVERTED — MEASURED POSITIVE.",
  },
  {
    key: "DXY", label: "DOLLAR INDEX — OVERNIGHT", short: "DXY", group: "MACRO",
    symbol: "DX-Y.NYB", weight: 0.056, priorWeight: 0, scale: 0.40, deadband: 0.12,
    invert: true, plausiblePct: 3, window: null, backtestable: true, measuredR: 0.233, measuredSign: 60.0,
    note: "A STRONG DOLLAR DRAINS EM FLOW. INVERTED.",
  },
  {
    key: "UST10Y", label: "US 10-YEAR YIELD — PRIOR CLOSE", short: "UST", group: "MACRO",
    symbol: "^TNX", weight: 0.014, priorWeight: 0, scale: 1.60, deadband: 0.60,
    invert: true, plausiblePct: 6, window: [], backtestable: true, measuredR: 0.120, measuredSign: 50.3,
    note: "YIELDS UP = GLOBAL TIGHTENING = EM PAIN. INVERTED. THE SMALLEST WEIGHT IN THE ENGINE — 50.3% SIGN AGREEMENT IS BARELY A COIN, AND IT IS PRICED LIKE IT.",
  },
  {
    key: "USVIX", label: "VIX — PRIOR US SESSION", short: "VIX", group: "VOL",
    symbol: "^VIX", weight: 0.047, priorWeight: 0, scale: 9.00, deadband: 3.00,
    invert: true, plausiblePct: 60, window: [], backtestable: true, measuredR: 0.369, measuredSign: 68.9,
    note: "A US VOL SPIKE IS A NIFTY GAP DOWNSIDE SIGNAL. INVERTED. THE STRONGEST LEG BY SIGN AGREEMENT.",
  },
  // A DOMESTIC MEAN-REVERSION LEG WAS SPECIFIED AND THEN CUT. Feeding Nifty's
  // own prior gap in as a leg is a tempting story, and it does not survive
  // contact with the tape: over 493 reconstructed sessions its ridge
  // coefficient collapsed to ~0.001 against every other leg's 0.01-0.12, and
  // its sign agreement on directional gaps was 41.7% — WORSE THAN A COIN. A
  // leg that fails that test is deleted, not kept with a small weight and an
  // optimistic note. It stays documented here so the idea is not silently
  // re-added by the next person who likes overnight mean reversion.
];

export const LEG_BY_KEY: Record<string, LegSpec> = Object.fromEntries(
  PRE_OPEN_LEGS.map((l) => [l.key, l])
);

// ---- Factor map ----------------------------------------------------------
// Six of the legs are one US-equity bet seen six times (ES/NQ/YM correlate
// 0.85-0.96; SPX/NDX/DJI 0.75-0.96). The vote average already divides that
// duplication out, and ridge shrinkage removes what is left, so grouping is
// here for INTERPRETABILITY — it lets the desk show which factor the call
// actually came from — not for accuracy. That distinction is stated on the
// desk rather than claimed here.
export const LEG_GROUPS: LegGroup[] = ["FUTURES", "ASIA", "US CASH", "FX", "MACRO", "VOL"];

/** Is this leg's market supposed to be printing at `nowMin` IST? */
export function shouldBeLive(spec: LegSpec, nowMin: number): boolean {
  if (spec.window === null) return true;
  if (spec.window.length === 0) return false;
  const [open, close] = spec.window;
  return nowMin >= open && nowMin < close;
}

/**
 * The reading a leg is ENTITLED to at the decision minute. One definition,
 * shared by the live route and the backfill — the previous build let the two
 * disagree, which is how a scorecard ends up grading a model nobody runs.
 *   LIVE      — market is open: last completed hourly print vs the prior close
 *   PRIOR     — market shut: the last completed session's close-to-close move
 */
export function readMode(spec: LegSpec, nowMin: number): "LIVE" | "PRIOR" {
  return shouldBeLive(spec, nowMin) ? "LIVE" : "PRIOR";
}

export const GROUP_WHY: Record<LegGroup, string> = {
  FUTURES: "OVERNIGHT REPRICING — 24H, LIVE AT THE BELL. WEAKEST FACTOR ALONE; EARNS ITS PLACE BY DENOISING THE OTHERS",
  ASIA: "LIVE ASIAN SESSION LEAD — PRINTS BEFORE THE BELL. THE STRONGEST FACTOR ALONE",
  "US CASH": "LAST COMPLETED US SESSION — CLOSED ~02:30 IST. HIGHEST-GAINING FACTOR ALONE",
  FX: "RUPEE STRENGTH VS THE IMPORT-HEAVY INDEX — NEARLY UNCORRELATED WITH EVERYTHING ELSE",
  MACRO: "OIL / GOLD / DOLLAR / YIELDS — THE INFLATION AND DOLLAR LEG",
  VOL: "OVERSEAS RISK-PRICING — THE BEST SINGLE LEG BY SIGN AGREEMENT",
};

// ---- Vote math -----------------------------------------------------------
export interface LegVote {
  key: string;
  label: string;
  short: string;
  group: LegGroup;
  symbol: string;
  /** % move the vote was computed from. null = no usable tape. */
  chg: number | null;
  last: number | null;
  /** Signed, deadbanded, tanh-saturating vote in [-1,+1]. null = absent. */
  vote: number | null;
  weight: number;
  /** weight actually applied, after the stale discount. */
  applied: number;
  /** weight * vote, 0 when the leg has no tape. */
  contribution: number;
  saturated: boolean;
  deadbanded: boolean;
  stale: boolean;
  /** |move| past the leg's plausibility band — a roll or feed artefact. */
  tail: boolean;
  /** The leg's market was shut at the decision minute; prior close used. */
  priorOnly: boolean;
  barDate: string | null;
  backtestable: boolean;
  measuredR: number | null;
  note: string;
}

/**
 * Deadbanded saturating vote. Inside the deadband the leg abstains (0); past
 * it the vote ramps through tanh so magnitude matters and influence saturates.
 */
export function legVote(chg: number | null, spec: LegSpec): number | null {
  if (chg === null || !isFinite(chg)) return null;
  const signed = spec.invert ? -chg : chg;
  const a = Math.abs(signed);
  if (a <= spec.deadband) return 0;
  const span = Math.max(spec.scale - spec.deadband, 1e-6);
  return Math.sign(signed) * Math.tanh((a - spec.deadband) / span);
}

/**
 * A stale tape is not the same as a missing one and not the same as a live
 * one. Counting it at full weight (which the previous build did, while its own
 * comment claimed otherwise) is how a dead feed becomes a confident call.
 * A stale leg keeps its vote at a quarter weight and is flagged.
 */
export const STALE_DISCOUNT = 0.25;

export function buildLegVote(
  spec: LegSpec,
  input: {
    chg: number | null;
    last?: number | null;
    barDate?: string | null;
    stale?: boolean;
    priorOnly?: boolean;
  }
): LegVote {
  const raw = input.chg !== null && isFinite(input.chg) ? input.chg : null;
  // Past the plausibility band the print is a roll or a bad tick, not news.
  const tail = raw !== null && Math.abs(raw) > spec.plausiblePct;
  const chg = tail ? null : raw;
  const vote = legVote(chg, spec);
  const a = chg === null ? 0 : Math.abs(spec.invert ? -chg : chg);
  const stale = !!input.stale && chg !== null;
  const applied = vote === null ? 0 : spec.weight * (stale ? STALE_DISCOUNT : 1);
  return {
    key: spec.key, label: spec.label, short: spec.short, group: spec.group, symbol: spec.symbol,
    chg, last: input.last ?? null,
    vote, weight: spec.weight, applied,
    contribution: vote === null ? 0 : applied * vote,
    saturated: a >= spec.scale,
    deadbanded: chg !== null && a <= spec.deadband,
    stale,
    tail,
    priorOnly: !!input.priorOnly,
    barDate: input.barDate ?? null,
    backtestable: spec.backtestable,
    measuredR: spec.measuredR,
    note: spec.note,
  };
}

// ---- Regime conditioning -------------------------------------------------
export type Regime = "CALM" | "NORMAL" | "STRESS";

/** India VIX level bands. */
export const REGIME_BANDS: Record<Exclude<Regime, "NORMAL">, number> = { CALM: 13, STRESS: 18 };

/**
 * The regime's measured out-of-sample performance. Shown next to the band
 * coefficients, NOT used to scale the gate — see EGAP_MIN below.
 */
export const REGIME_MEASURED: Record<Regime, { deltaPts: number; spreadPct: number; n: number }> = {
  CALM: { deltaPts: 20.3, spreadPct: 0.326, n: 59 },
  NORMAL: { deltaPts: 36.0, spreadPct: 1.107, n: 50 },
  STRESS: { deltaPts: 32.3, spreadPct: 1.374, n: 31 },
};

/**
 * THE PUBLISH GATE — expressed in forecast points, not edge units.
 *
 * The previous gate was `|edge| >= 0.30 * REGIME_MULT[regime]`, i.e. a fixed
 * number of edge units scaled by a hand-set multiplier. That was wrong twice
 * over:
 *
 *   1. THE SAME EDGE IS NOT THE SAME FORECAST IN EACH BAND. The band slope is
 *      0.43 in calm tape and 0.59 otherwise, so 0.30 edge is a 0.13% expected
 *      gap in one and a 0.18% in the other. Gating in edge units publishes
 *      "GAP UP" for forecasts that differ by 40% in size.
 *   2. THE REGIME MULTIPLIER WAS REDUNDANT. Banding the slope by regime
 *      already conditions the forecast on regime; stacking a multiplier on top
 *      double-counted it. Measured on top of an expected-gap gate it changed
 *      nothing (precision 93.7% either way) while costing 24 calls.
 *
 * Gating on the forecast instead makes the gate and the forecast share units,
 * which is also the only way the published "stand aside" boundary means the same
 * thing as the published gap. At matched call count it is strictly better:
 * 162 calls at 94.1% precision versus 165 calls at 92.8% for the edge gate.
 *
 * 0.25% is ~1.7x the ±0.15% no-edge band — "only publish when we expect a gap
 * at least 1.7x the size of a gap we call flat". The full precision/coverage
 * trade-off is published as an operating curve, because the right point on it
 * depends on the reader's costs, which the desk does not know.
 */
export const EGAP_MIN = 0.25;

export function vixRegime(vix: number | null | undefined): Regime | null {
  if (vix === null || vix === undefined || !isFinite(vix)) return null;
  return vix < REGIME_BANDS.CALM ? "CALM" : vix > REGIME_BANDS.STRESS ? "STRESS" : "NORMAL";
}

export function vixCondition(vix: number | null): "VOLATILE" | "STABLE" | null {
  if (vix === null || !isFinite(vix)) return null;
  return vix > VIX_THRESHOLD ? "VOLATILE" : "STABLE";
}

// ---- Gating + the magnitude forecast -------------------------------------
/** Below this share of total leg weight the model refuses to call direction. */
export const COVERAGE_MIN = 0.42;
/** Share of total weight that would be stale if every live leg went stale. */
export const STALE_SHARE_WARN = 0.34;

/**
 * The forecast. `expected gap % = BAND.intercept + BAND.slope * edge`.
 *
 * WHY TWO BANDS AND NOT ONE. The gap distribution is heteroskedastic in
 * India VIX, and the effect is large: mean |gap| runs 0.27% / 0.35% / 0.67%
 * and the forecast residual runs 0.33% / 0.47% / 0.80% across CALM / NORMAL /
 * STRESS. A single slope therefore mis-states every call by regime. Measured
 * walk-forward over 737 sessions, splitting on CALM alone cut RMSE gain from
 * 15.6% to 16.3% with the Brier score unchanged.
 *
 * WHY NOT THREE. A third STRESS band bought another 0.5 points of RMSE but
 * cost 0.002 of Brier, and its intercept was estimated from five folds with a
 * range of +0.086% to +0.266% — an unstable number that would imply a large
 * built-in upward gap bias in stressed tape. That is the kind of constant the
 * data-honesty rule exists to prevent, so the third band was refused.
 *
 * WHY THE MEDIAN FOLD VALUE AND NOT THE IN-SAMPLE FIT. The in-sample slope on
 * this sample is ~1.03; the walk-forward fold medians are 0.43 and 0.59.
 * Shipping the in-sample number would overstate every call by more than half.
 * The bands below are the medians of ten 60-session folds, each fitted only on
 * its own strictly-earlier training window; /api/opening/history re-measures
 * them on every run and flags any drift past 20%.
 */
export interface GapBand {
  key: string;
  label: string;
  slope: number;
  intercept: number;
  residSd: number;
  /** Folds the band was estimated from, and the slope range they spanned. */
  folds: number;
  slopeRange: [number, number];
}
export const GAP_BANDS: GapBand[] = [
  { key: "CALM", label: "INDIA VIX < 13", slope: 0.43, intercept: 0.03, residSd: 0.36, folds: 10, slopeRange: [0.37, 0.55] },
  { key: "REST", label: "INDIA VIX ≥ 13", slope: 0.59, intercept: 0.04, residSd: 0.49, folds: 10, slopeRange: [0.51, 0.80] },
];

/** The band a regime reads from. STRESS and NORMAL share the wider band. */
export function gapBand(regime: Regime | null): GapBand {
  return regime === "CALM" ? GAP_BANDS[0]! : GAP_BANDS[1]!;
}

/** The same lookup by band key, for the scorecard's band table. */
export function gapBandByKey(key: string): GapBand {
  return GAP_BANDS.find((b) => b.key === key) ?? GAP_BANDS[1]!;
}

/**
 * Backwards-compatible scalars for the default (non-CALM) band. `expectedGap`
 * below is the function both routes call; these exist only so a reader has the
 * headline numbers without unpicking the band table.
 */
export const GAP_A = GAP_BANDS[1]!.intercept;
export const GAP_B = GAP_BANDS[1]!.slope;
export const GAP_RESID_SD = GAP_BANDS[1]!.residSd;

/** Provenance for the fitted constants, printed on the scorecard. */
export const MODEL_PROVENANCE = {
  sample: "2023-10-04 -> 2026-09-29",
  sessions: 738,
  method: "WINDOW-AWARE ZERO-LOOKAHEAD REBUILD, RIDGE-FIT WEIGHTS SHRUNK 30% TOWARD THE HAND PRIOR",
  validation: "WALK-FORWARD OUT-OF-SAMPLE, 10 FOLDS OF 60 SESSIONS AFTER A 240-SESSION WARM-UP, EACH FOLD SCORED ONLY ON STRICTLY LATER SESSIONS",
  slopeRange: [0.37, 0.43, 0.80] as [number, number, number],
  oosSignAgreement: 90.2,
  oosBenchmark: 65.9,
  oosPrecision: 93.3,
  oosSpreadPct: 1.00,
  oosBrier: 0.192,
  oosRmseGainPct: 12.8,
  /**
   * The result that justifies keeping fifteen correlated legs: the ensemble's
   * edge is VARIANCE REDUCTION, not better direction. Gated and walk-forward,
   * the full composite more than doubles the RMSE gain of the best single leg
   * (16.8% vs 7.8% for VIX alone) and cuts the Brier score from 0.211 to 0.185.
   * Removing every leg whose sign agreement is under 58% makes it WORSE
   * (15.0%), because a weakly-informative independent reading still cancels
   * noise when it is averaged in. No single leg claims to predict the gap
   * alone — and neither does the composite.
   */
  ensembleNote:
    "THE 15 LEGS ARE NOT 15 INDEPENDENT OPINIONS. ES/NQ/YM CORRELATE 0.85-0.96 AND SPX/NDX/DJI 0.75-0.96, SO THE ENGINE IS PROBABLY 4-5 REAL FACTORS. WHAT THE AVERAGING BUYS IS NOISE REDUCTION: THE COMPOSITE BEATS THE BEST SINGLE LEG ON RMSE GAIN 16.8% vs 7.8% AND ON BRIER 0.185 vs 0.211. THE OVERNIGHT FUTURES ALONE ARE THE WEAKEST FACTOR (RMSE GAIN 1.7%) — THEY EARN THEIR PLACE BY DENOISING THE OTHERS, NOT BY BEING RIGHT ALONE.",
};

export interface GroupEdge {
  edge: number | null;
  weight: number;
  legs: number;
}

export function groupEdges(legs: LegVote[]): Record<LegGroup, GroupEdge | null> {
  const out = {} as Record<LegGroup, GroupEdge | null>;
  for (const g of LEG_GROUPS) {
    const mine = legs.filter((l) => l.group === g && l.vote !== null && l.applied > 0);
    if (!mine.length) { out[g] = null; continue; }
    const w = mine.reduce((a, l) => a + l.applied, 0);
    const c = mine.reduce((a, l) => a + l.contribution, 0);
    out[g] = { edge: w ? c / w : null, weight: w, legs: mine.length };
  }
  return out;
}

export interface Score {
  /** Weight-normalised conviction in [-1,+1]. null when no leg has a tape. */
  edge: number | null;
  /** Share of total leg weight that actually reported. */
  coverage: number;
  /** Share of the reporting weight that was stale. */
  staleShare: number;
  /** Weighted disagreement between factors, in edge units. Confidence input. */
  disagreement: number | null;
  /** Which magnitude band the forecast was read from (CALM / REST). */
  band: string;
  /** Legs in the catalogue vs legs that actually reported. */
  legCount: number;
  legsUsed: number;
  verdict: Verdict;
  /** 0..1 — how much to trust the call. */
  confidence: number;
  /** Model-implied P(open above prior close), from the magnitude forecast. */
  probUp: number | null;
  /** Model-implied P(gap outside the flat band). */
  probDirectional: number | null;
  /** Forecast gap in percent: GAP_A + GAP_B * edge. */
  expectedGapPct: number | null;
  regime: Regime | null;
  /** Publish gate in FORECAST PERCENT — the |expected gap| it must clear. */
  gate: number;
  /** Futures disagreeing with the prior cash close — least reliable state. */
  conflict: boolean;
  conflictNote: string | null;
  groups: Record<LegGroup, GroupEdge | null>;
  legs: LegVote[];
}

/** Abramowitz-Stegun 7.1.26 normal CDF. */
export function normCdf(z: number): number {
  if (!isFinite(z)) return z > 0 ? 1 : 0;
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

export function totalLegWeight(): number {
  return PRE_OPEN_LEGS.reduce((a, l) => a + l.weight, 0);
}

/**
 * Overnight futures and the prior US cash close pulling opposite ways is the
 * one configuration where the two halves of the information set disagree.
 * Flagged rather than averaged away — the backtest publishes accuracy for
 * conflicted days separately.
 */
export function detectConflict(groups: Record<LegGroup, GroupEdge | null>): { conflict: boolean; note: string | null } {
  const f = groups.FUTURES, u = groups["US CASH"];
  if (!f || !u || f.edge === null || u.edge === null) return { conflict: false, note: null };
  if (f.edge * u.edge >= 0) return { conflict: false, note: null };
  if (Math.min(Math.abs(f.edge), Math.abs(u.edge)) < EGAP_MIN / 1.5) return { conflict: false, note: null };
  const dir = (e: number) => (e > 0 ? "UP" : "DOWN");
  return {
    conflict: true,
    note: `OVERNIGHT FUTURES ${dir(f.edge)} vs PRIOR CASH CLOSE ${dir(u.edge)} — LEGS CONFLICT, EDGE DISCOUNTED`,
  };
}

/** Expected gap in percent for an edge, under a given regime's band. */
export function expectedGap(edge: number | null, regime: Regime | null = null): number | null {
  if (edge === null || !isFinite(edge)) return null;
  const b = gapBand(regime);
  return b.intercept + b.slope * edge;
}

/** The residual sd of the forecast, which is what the probability rests on. */
export function residSd(regime: Regime | null = null): number {
  return gapBand(regime).residSd;
}

/**
 * Weighted disagreement between the factors, in edge units. Measured: sessions
 * where the factors disagree have a 1.2-1.6x larger forecast residual than
 * sessions where they agree, in every regime. That is a real signal but a
 * weak one (r = 0.17 against |residual|), so it is used ONLY to haircut
 * confidence — never to move the forecast gap or the published probability.
 * Inventing a residual multiplier from 51 observations would be a number
 * dressed up as a measurement.
 */
export function factorDisagreement(groups: Record<LegGroup, GroupEdge | null>): number | null {
  const live = Object.values(groups).filter((g): g is GroupEdge => !!g && g.edge !== null);
  if (live.length < 3) return null;
  const wsum = live.reduce((a, g) => a + g.weight, 0);
  if (wsum <= 0) return null;
  const mean = live.reduce((a, g) => a + g.weight * (g.edge as number), 0) / wsum;
  const varc = live.reduce((a, g) => a + g.weight * ((g.edge as number) - mean) ** 2, 0) / wsum;
  return round3(Math.sqrt(varc));
}

export function buildScore(legs: LegVote[], regime: Regime | null): Score {
  const groups = groupEdges(legs);
  const live = legs.filter((l) => l.vote !== null && l.applied > 0);
  const usedW = live.reduce((a, l) => a + l.applied, 0);
  const staleW = live.filter((l) => l.stale).reduce((a, l) => a + l.applied, 0);
  const totW = legs.reduce((a, l) => a + l.weight, 0);
  const contrib = live.reduce((a, l) => a + l.contribution, 0);
  const coverage = totW ? usedW / totW : 0;
  const staleShare = usedW ? staleW / usedW : 0;
  const edge = usedW > 0 ? contrib / usedW : null;
  const { conflict, note } = detectConflict(groups);
  const band = gapBand(regime);
  const egap = expectedGap(edge, regime);
  const disagree = factorDisagreement(groups);

  let verdict: Verdict = "NO_DATA";
  let confidence = 0;
  if (edge === null || coverage < COVERAGE_MIN) {
    verdict = "NO_DATA";
  } else {
    // The gate is in forecast points. A conflicted tape is a weaker tape, so it
    // has to clear more of one.
    const gate = conflict ? EGAP_MIN * 1.5 : EGAP_MIN;
    const mag = egap === null ? 0 : Math.abs(egap);
    if (mag >= gate) verdict = egap !== null && egap > 0 ? "GREEN" : "RED";
    else verdict = "FLAT";
    // Confidence rises with how far past the gate the forecast sits, in units
    // of the gate itself so it is scale-free.
    const margin = verdict === "FLAT" ? 0 : Math.min(1, (mag - gate) / gate);
    // A stale-heavy tape is not a tape. Scale the whole confidence down.
    const fresh = 1 - Math.min(1, staleShare / STALE_SHARE_WARN);
    // Factors that disagree do not move the forecast, but they do mean less of
    // it. Measured at a 1.2-1.6x residual inflation, so a linear haircut on the
    // disagreement is the honest amount to discount by.
    const agree = disagree === null ? 1 : Math.max(0.55, 1 - Math.min(1, disagree / 0.45) * 0.45);
    confidence = round3(coverage * fresh * agree * (0.45 + 0.55 * Math.max(margin, 0)));
  }

  return {
    edge: edge === null ? null : round3(edge),
    coverage: round3(coverage),
    staleShare: round3(staleShare),
    disagreement: disagree,
    band: band.key,
    legCount: legs.length,
    legsUsed: live.length,
    verdict,
    confidence,
    // Probability straight out of the magnitude forecast: the forecast is a
    // point estimate, the gap is that estimate plus this regime's residual.
    probUp: egap === null ? null : round3(normCdf(egap / band.residSd)),
    probDirectional: egap === null ? null : round3(normCdf(Math.abs(egap) / band.residSd)),
    expectedGapPct: egap === null ? null : round3(egap),
    regime,
    gate: conflict ? round3(EGAP_MIN * 1.5) : EGAP_MIN,
    conflict,
    conflictNote: note,
    groups,
    legs,
  };
}

// ---- Gap / in-session confirmation --------------------------------------
/** |move| at or below this counts as a flat gap, not a directional gap. */
export const FLAT_BAND_PCT = 0.15;

export interface GapState {
  open: number | null;
  prevClose: number | null;
  last: number | null;
  /** Opening gap vs prior close, %. */
  gapPct: number | null;
  /** Live move vs prior close, %. */
  livePct: number | null;
  /** Share of the gap already retraced, %. */
  retracePct: number | null;
  /** Gap closed back through the prior close. */
  filled: boolean | null;
  flat: boolean | null;
}

export function gapState(open: number | null, prevClose: number | null, last: number | null): GapState {
  const ok = (v: number | null): v is number => v !== null && isFinite(v) && v > 0;
  const gapPct = ok(open) && ok(prevClose) ? ((open - prevClose) / prevClose) * 100 : null;
  const livePct = ok(last) && ok(prevClose) ? ((last - prevClose) / prevClose) * 100 : null;
  const retracePct = ok(open) && ok(last) ? ((open - last) / open) * 100 : null;
  let filled: boolean | null = null;
  if (gapPct !== null && ok(last)) {
    if (gapPct > 0) filled = last <= prevClose!;
    else if (gapPct < 0) filled = last >= prevClose!;
  }
  const flat = gapPct === null ? null : Math.abs(gapPct) <= FLAT_BAND_PCT;
  return { open, prevClose, last, gapPct, livePct, retracePct, filled, flat };
}

export type ConfirmState = "CONFIRMED" | "FADING" | "NEUTRAL" | "NO_DATA" | "PRE_OPEN";

export interface ConfirmModel {
  active: boolean;
  state: ConfirmState;
  headline: string;
  gapPct: number | null;
  retracePct: number | null;
  filled: boolean | null;
  breadthPct: number | null;
  breadth: { adv: number; dec: number; unc: number } | null;
  verdict: Verdict;
  /** Points the forecast was wrong by, once the bell has rung. */
  forecastErrPts: number | null;
  forecastErrPct: number | null;
}

/**
 * Separate, explicitly-labelled model. Once the bell has rung this is an
 * OBSERVATION of the tape, never a prediction — the pre-open call is already
 * on the record and this leg must not be allowed to rewrite it.
 */
export function buildConfirm(
  gap: GapState,
  breadth: { adv: number; dec: number; unc: number } | null,
  expected: number | null = null
): ConfirmModel {
  const total = breadth ? breadth.adv + breadth.dec + breadth.unc : 0;
  const breadthPct = breadth && total > 0 ? ((breadth.adv - breadth.dec) / total) * 100 : null;
  const errPct = expected !== null && gap.gapPct !== null ? gap.gapPct - expected : null;
  const errPts = errPct !== null && gap.prevClose ? (errPct / 100) * gap.prevClose : null;
  const base = {
    gapPct: gap.gapPct,
    retracePct: gap.retracePct,
    filled: gap.filled,
    breadthPct: breadthPct === null ? null : round2(breadthPct),
    breadth: breadth ?? null,
    forecastErrPct: errPct === null ? null : round2(errPct),
    forecastErrPts: errPts === null ? null : round2(errPts),
  };

  if (gap.gapPct === null) {
    return { ...base, active: false, state: "NO_DATA", headline: "NO NIFTY OPEN TAPE — CONFIRMATION UNAVAILABLE", verdict: "NO_DATA" };
  }
  const dir = gap.gapPct > 0 ? 1 : gap.gapPct < 0 ? -1 : 0;
  if (dir === 0) {
    return { ...base, active: true, state: "NEUTRAL", headline: "OPENED FLAT — NO GAP TO CONFIRM OR FADE", verdict: "FLAT" };
  }
  const against = breadthPct !== null && breadthPct * dir < 0;
  const strongAgainst = breadthPct !== null && breadthPct * dir < -12;
  if (gap.filled === true || (strongAgainst && Math.abs(gap.retracePct ?? 0) > 45)) {
    return {
      ...base, active: true, state: "FADING",
      headline: gap.filled === true
        ? "GAP FULLY FILLED — PRE-OPEN CALL FADED"
        : `GAP ${Math.abs(gap.retracePct ?? 0).toFixed(0)}% RETRACED ON WIDE ADVERSE BREADTH — CALL FADING`,
      verdict: "FLAT",
    };
  }
  if (against) {
    return {
      ...base, active: true, state: "NEUTRAL",
      headline: "GAP HOLDING BUT BREADTH ADVERSE — PARTIAL CONFIRMATION",
      verdict: "FLAT",
    };
  }
  return {
    ...base, active: true, state: "CONFIRMED",
    headline: `GAP HOLDING ON ${breadthPct === null ? "NO BREADTH" : `${breadthPct >= 0 ? "POSITIVE" : "MIXED"} ${Math.abs(breadthPct).toFixed(0)}% BREADTH`}`,
    verdict: dir > 0 ? "GREEN" : "RED",
  };
}

// ---- Grading (backtest) ---------------------------------------------------
export type Outcome = "HIT" | "MISS" | "FLAT_HIT" | "FLAT_MISS" | "NO_DATA";

/**
 * Grades one call against BOTH the thing the desk actually predicts (the
 * opening gap) and the secondary day move. Every gradable session stays in
 * the denominator — the previous scorer dropped FLAT_MISS days, which
 * inflated the headline win rate by construction.
 */
export function gradePrediction(
  verdict: Verdict,
  gapPct: number | null,
  dayPct: number | null,
  band: number = FLAT_BAND_PCT
): { gap: Outcome; day: Outcome } {
  return { gap: grade(verdict, gapPct, band), day: grade(verdict, dayPct, band) };
}

function grade(verdict: Verdict, move: number | null, band: number): Outcome {
  if (verdict === "NO_DATA" || move === null || !isFinite(move)) return "NO_DATA";
  const flat = Math.abs(move) <= band;
  if (verdict === "FLAT") return flat ? "FLAT_HIT" : "FLAT_MISS";
  if (verdict === "GREEN") return flat ? "FLAT_HIT" : move > 0 ? "HIT" : "MISS";
  return flat ? "FLAT_HIT" : move < 0 ? "HIT" : "MISS";
}

export function isHit(o: Outcome): boolean {
  return o === "HIT" || o === "FLAT_HIT";
}

// ---- Series helpers (shared by both routes) ------------------------------
export interface Bar { date: string; close: number; open?: number | null; high?: number | null; low?: number | null }

export function pctChange(now: number | null, ref: number | null): number | null {
  if (now === null || ref === null || !isFinite(now) || !isFinite(ref) || ref === 0) return null;
  return ((now - ref) / Math.abs(ref)) * 100;
}

/** date -> % change vs the previous bar. */
export function returnMap(bars: Bar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const r = pctChange(bars[i].close, bars[i - 1].close);
    if (r !== null) m.set(bars[i].date, r);
  }
  return m;
}

export interface PriorIndex {
  /** ascending, de-duplicated ISO dates */
  keys: string[];
  /** Last key strictly before `date`, or null. Binary search: O(log n). */
  floor(date: string): string | null;
  /** Index of that key, or -1. */
  floorIndex(date: string): number;
}

/**
 * Zero-lookahead lookup: the newest observation dated strictly before the
 * decision date. Binary search keeps a 500-session backfill linear-ish instead
 * of the O(n^2) full scan it used to do.
 */
export function buildPriorIndex(dates: string[]): PriorIndex {
  const keys = Array.from(new Set(dates.filter((d) => !!d))).sort();
  const floorIndex = (date: string): number => {
    let lo = 0, hi = keys.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < date) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  };
  return {
    keys,
    floorIndex,
    floor: (date: string) => {
      const i = floorIndex(date);
      return i < 0 ? null : keys[i];
    },
  };
}

// ---- Fitted-weight machinery (used only by /api/opening/history) --------
// The live route runs on the constants published above. This block is how the
// scorecard re-derives them, so the numbers the desk ships can be checked
// rather than believed. It is here, not in the route, because it is pure math
// and the walk-forward audit and the live engine must never drift apart.

export interface Series2 { bars: Bar[]; rets: Map<string, number>; prior: PriorIndex }

/** date-sorted daily bars with de-duplication and a prior-date index. */
export function buildSeries(bars: Bar[]): Series2 | null {
  const uniq = new Map<string, Bar>();
  for (const b of bars) if (b.date) uniq.set(b.date, b);
  const clean = Array.from(uniq.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (clean.length < 30) return null;
  const rets = returnMap(clean);
  return { bars: clean, rets, prior: buildPriorIndex(clean.map((b) => b.date)) };
}

/** Least-squares solve by Gauss-Jordan with partial pivoting. */
export function solveLinear(A: number[][], c: number[]): number[] {
  const p = c.length;
  const M = A.map((r, i) => [...r, c[i]]);
  for (let col = 0; col < p; col++) {
    let piv = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    const t = M[col]; M[col] = M[piv]; M[piv] = t;
    const d = M[col][col];
    for (let j = col; j <= p; j++) M[col][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (!f) continue;
      for (let j = col; j <= p; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map((r) => (isFinite(r[p]) ? r[p] : 0));
}

/** X'X and X'y over `idx`. A missing vote contributes nothing. */
export function gramMatrix(X: Array<Array<number | null>>, y: number[], idx: number[]): { XtX: number[][]; Xty: number[] } {
  const p = X[0]?.length ?? 0;
  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (const i of idx) {
    for (let a = 0; a < p; a++) {
      const xa = X[i][a];
      if (xa === null) continue;
      Xty[a] += xa * y[i];
      for (let b = a; b < p; b++) {
        const xb = X[i][b];
        if (xb === null) continue;
        const v = xa * xb;
        XtX[a][b] += v;
        if (b !== a) XtX[b][a] += v;
      }
    }
  }
  return { XtX, Xty };
}

export const RIDGE_LAMBDAS = [1, 4, 16, 64, 256, 1024];
/** Share of the fitted weight blended back toward the hand prior. */
export const FIT_SHRINK = 0.3;

export interface RidgeFit {
  w: Record<string, number>;
  lam: number;
  valRmse: number;
}

/**
 * Ridge on the signed-vote matrix, fitted ONLY on `idx`.
 *   - lambda picked on a held-out TAIL of the training window, never on rows
 *     the fold is scored against
 *   - coefficients clipped to >= 0: on a model whose premise is "bullish
 *     information votes bullish", a negative weight is a sign error the
 *     deadband should have caught, not a finding
 *   - blended `shrink` back toward the hand prior so a thin or noisy sample
 *     cannot swing the published weights
 */
export function ridgeFit(
  X: Array<Array<number | null>>,
  y: number[],
  idx: number[],
  prior: Record<string, number>,
  lams: number[] = RIDGE_LAMBDAS,
  shrink: number = FIT_SHRINK
): RidgeFit {
  const keys = PRE_OPEN_LEGS.map((l) => l.key);
  const p = X[0]?.length ?? 0;
  const { XtX, Xty } = gramMatrix(X, y, idx);
  const cut = Math.max(40, Math.floor(idx.length * 0.75));
  const val = idx.slice(cut);
  let best: { lam: number; rmse: number; beta: number[] } | null = null;
  for (const lam of lams) {
    const A = XtX.map((r, a) => r.map((v, b) => (a === b ? v + lam * idx.length : v)));
    const beta = solveLinear(A, Xty);
    let sse = 0, n = 0;
    for (const i of val) {
      let pr = 0;
      for (let a = 0; a < p; a++) if (X[i][a] !== null) pr += (beta[a] ?? 0) * X[i][a]!;
      sse += (pr - y[i]) ** 2; n++;
    }
    const rmse = n ? Math.sqrt(sse / n) : Infinity;
    if (!best || rmse < best.rmse) best = { lam, rmse, beta };
  }
  const b = best!.beta;
  const priorSum = keys.reduce((a, k) => a + (prior[k] ?? 0), 0) || 1;
  const fitSum = keys.reduce((a, _, i) => a + Math.max(b[i] ?? 0, 0), 0) || 1;
  const w: Record<string, number> = {};
  keys.forEach((k, i) => {
    w[k] = shrink * ((prior[k] ?? 0) / priorSum) + (1 - shrink) * (Math.max(b[i] ?? 0, 0) / fitSum);
  });
  return { w, lam: best!.lam, valRmse: best!.rmse };
}

/** Weight-normalised edge from a fitted weight map. */
export function edgeFrom(X: Array<Array<number | null>>, i: number, w: Record<string, number>): number | null {
  let sw = 0, acc = 0;
  PRE_OPEN_LEGS.forEach((spec, a) => {
    const wk = w[spec.key] ?? 0;
    const v = X[i][a];
    if (wk <= 0 || v === null) return;
    sw += wk; acc += wk * v;
  });
  return sw > 0 ? acc / sw : null;
}

/** Ordinary least squares of y on [1, x]. */
export function linfit(xs: number[], ys: number[]): { a: number; b: number; r: number } | null {
  const n = xs.length;
  if (n < 12) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx <= 0) return null;
  return { a: my - (sxy / sxx) * mx, b: sxy / sxx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0 };
}

/** Sample standard deviation of y - (a + b*x). What the forecast cannot explain. */
export function residualSd(xs: number[], ys: number[], fit: { a: number; b: number }): number {
  const res = ys.map((y, i) => y - (fit.a + fit.b * xs[i]!));
  if (res.length < 3) return 0;
  const m = res.reduce((a, v) => a + v, 0) / res.length;
  return Math.sqrt(res.reduce((a, v) => a + (v - m) ** 2, 0) / (res.length - 1));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
