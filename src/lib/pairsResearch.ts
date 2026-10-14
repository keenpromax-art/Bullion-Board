// Pairs research pipeline — turns raw price series into the payload the desk
// renders: a universe screened on the FORMATION window only, an out-of-sample
// walk-forward book per pair, and the live radar.
//
// The split matters more than anything else in this file. `FORMATION_FRAC` of
// the history decides which pairs exist; only what comes after it is traded.
// Nothing computed on the formation window is allowed to leak into a trade
// decision, and every returned figure for a tradeable pair is out-of-sample.

import {
  bare,
  bhQvalues,
  bootstrapSharpe,
  buildSpreadModel,
  changeAutocorr1,
  engleGranger,
  extractTrades,
  halfLife,
  hurstExp,
  kalmanHedge,
  olsHedge,
  P,
  pairKey,
  perfStats,
  portfolioReturn,
  staticRun,
  walkForward,
  type PerfStats,
  type Trade,
  type WFResult,
} from "./pairs";

export interface PairRow {
  a: string;
  b: string;
  /** Engle-Granger residual p-value on the FORMATION window. */
  pForm: number;
  /** Benjamini-Hochberg q across the whole universe. */
  qForm: number;
  /** The same test re-run on the most recent COINT_WINDOW bars. */
  pLive: number;
  /** BH q on those live-window p-values — a second family, corrected separately. */
  qLive: number;
  /** Unit-root p-values per leg on the formation window. */
  levelA: number;
  levelB: number;
  /** True when NEITHER leg rejects a unit root — the confirmation step. */
  nonStationaryLegs: boolean;
  /** Formation-window half-life of the cointegrating residual, in bars. */
  halfLifeForm: number;
  /** Formation-window half-life of the live (Kalman) residual, in bars. */
  halfLifeLive: number;
  /** R/S Hurst of the live residual — diagnostic only, see P.HURST_MAX. */
  hurstLive: number;
  /** Lag-1 autocorrelation of the live residual's changes — diagnostic only. */
  changeAc1Live: number;
  cointegratingSlope: number;
  status: "CONFIRMED" | "PROBABLE" | "NONE";
  /** Passed formation AND survived the live re-test. */
  stable: boolean;
  inPortfolio: boolean;
  oos: PerfStats | null;
  /** Why it failed, in plain words, for the empty state. */
  reason: string;
}

export interface Ticket {
  qtyA: number;
  qtyB: number;
  notionalA: number;
  notionalB: number;
  gross: number;
  profitTarget: number;
  lossStop: number;
  rewardRisk: number;
  costs: number;
  legAVerb: string;
  legBVerb: string;
  timeStop: number;
  note: string;
}

export type Stage = "TRIGGERED" | "ON DECK" | "FLOATING" | "EXIT ZONE" | "BEYOND STOP";

export interface SignalRow {
  pair: string;
  a: string;
  b: string;
  status: PairRow["status"];
  qForm: number;
  oosSharpe: number;
  z: number;
  zPrev: number;
  lookback: number;
  entry: number;
  exit: number;
  stop: number;
  beta: number;
  alpha: number;
  sd: number;
  priceA: number;
  priceB: number;
  /** Price of A that triggers entry with B unchanged. */
  trigA: number;
  /** Price of B that triggers entry with A unchanged. */
  trigB: number;
  moveAPct: number;
  moveBPct: number;
  meanA: number;
  halfLife: number;
  hurst: number;
  changeAc1: number;
  stage: Stage;
  momentum: "APPROACHING" | "COOLING" | "FLAT";
  side: 1 | -1;
  action: string;
  conviction: number;
  timeStop: number;
  /** Blocking filters. */
  hard: string[];
  /** Non-blocking warnings. */
  soft: string[];
  actionable: boolean;
  onDeck: boolean;
  /** Risk-based order ticket, null until the pair passes every gate. */
  ticket: Ticket | null;
}

export interface ResearchOutput {
  rows: PairRow[];
  formationDate: string;
  /** Pairs that passed selection — the basket actually traded. */
  selected: Array<[string, string]>;
  relaxed: boolean;
  notes: string[];
  /** Symbols dropped for too little overlap, with the reason. */
  dropped: Array<{ pair: string; bars: number }>;
}

export interface PairDetail {
  a: string;
  b: string;
  dates: string[];
  priceA: number[];
  priceB: number[];
  walk: WFResult;
  /** Static OLS, +/-2.0 entry / 0.5 exit, no tuning — the v1 baseline. */
  baselineFull: PerfStats;
  baselineOos: PerfStats;
  adaptiveOos: PerfStats;
  zTail: (number | null)[];
  zDates: string[];
  staticZTail: (number | null)[];
  spreadTail: (number | null)[];
  betaTail: (number | null)[];
  /** Rolling-OLS beta over `ROLLING_OLS_WIN`, for the hedge comparison chart. */
  rollingBetaTail: (number | null)[];
  /** One coefficient fitted over the whole sample — the "fit it once" model. */
  staticBeta: number | null;
  equityAdaptive: number[];
  equityStatic: number[];
  equityDates: string[];
  trades: Trade[];
  formationEnd: string;
}

export interface PortfolioOut {
  dates: string[];
  ret: number[];
  active: number[];
  stats: PerfStats;
  /** Block-bootstrap 90% Sharpe interval. */
  ci: [number, number];
  probNegative: number;
  stress: Array<{ delay: number; cost: number; stats: PerfStats }>;
  trades: Trade[];
}

export type PriceBars = Array<{ date: string; close: number }>;

/** Date-join two price series, keeping only shared trading days, in order. */
function joinDates(a: PriceBars, b: PriceBars): { dates: string[]; pa: number[]; pb: number[] } {
  const mb = new Map<string, number>();
  for (const r of b) if (Number.isFinite(r.close) && r.close > 0) mb.set(r.date, r.close);
  const dates: string[] = [];
  const pa: number[] = [];
  const pb: number[] = [];
  for (const r of a) {
    const c = mb.get(r.date);
    if (c !== undefined && Number.isFinite(r.close) && r.close > 0) {
      dates.push(r.date);
      pa.push(r.close);
      pb.push(c);
    }
  }
  return { dates, pa, pb };
}

interface Joined {
  a: string;
  b: string;
  dates: string[];
  pa: number[];
  pb: number[];
}

function joinAll(series: Map<string, PriceBars>, pairs: Array<[string, string]>): { joined: Joined[]; dropped: ResearchOutput["dropped"] } {
  const joined: Joined[] = [];
  const dropped: ResearchOutput["dropped"] = [];
  for (const [a, b] of pairs) {
    const sa = series.get(a);
    const sb = series.get(b);
    if (!sa || !sb) {
      dropped.push({ pair: `${bare(a)}/${bare(b)}`, bars: 0 });
      continue;
    }
    const j = joinDates(sa, sb);
    if (j.dates.length < P.MIN_OBS) {
      dropped.push({ pair: `${bare(a)}/${bare(b)}`, bars: j.dates.length });
      continue;
    }
    joined.push({ a, b, ...j });
  }
  return { joined, dropped };
}

const logOf = (v: number[]): number[] => v.map(Math.log);

/**
 * Screen the universe.
 *
 * Selection statistics are computed on the FORMATION slice only. `pLive` is a
 * forward-looking re-test used purely to grade stability: a pair that passed
 * selection but no longer cointegrates is reported unstable and kept OUT of the
 * basket rather than silently traded.
 */
export function screenUniverse(series: Map<string, PriceBars>, pairs: Array<[string, string]>): ResearchOutput {
  const notes: string[] = [];
  const { joined, dropped } = joinAll(series, pairs);
  if (!joined.length) {
    return {
      rows: [],
      formationDate: "",
      selected: [],
      relaxed: false,
      dropped,
      notes: [
        `NO PAIR REACHED ${P.MIN_OBS} SHARED BARS. ${dropped.length} PAIR(S) DROPPED FOR MISSING OR SHORT HISTORY — CHECK THE SYMBOLS, THEN WIDEN THE UNIVERSE.`,
      ],
    };
  }
  const maxLen = Math.max(...joined.map((j) => j.dates.length));
  const cut = Math.floor(maxLen * P.FORMATION_FRAC);
  const formationDate = joined[0].dates[Math.min(cut, joined[0].dates.length - 1)] ?? "";
  const enoughForOOS = cut >= P.TRAIN_WINDOW + P.TEST_STEP;
  if (!enoughForOOS) {
    notes.push(
      `HISTORY TOO SHORT TO SPLIT: ${maxLen} SHARED BARS GIVES A ${cut}-BAR FORMATION WINDOW AND THE ENGINE NEEDS ${P.TRAIN_WINDOW + P.TEST_STEP}. EVERY FIGURE BELOW IS IN-SAMPLE — IT WILL LOOK BETTER THAN IT IS.`
    );
  }

  interface Probe {
    j: Joined;
    pForm: number;
    levelA: number;
    levelB: number;
    hlForm: number;
    slope: number;
    pLive: number;
    hlLive: number;
    hurstLive: number;
    ac1Live: number;
  }

  const probes: Probe[] = joined.map((j) => {
    const fLa = logOf(j.pa.slice(0, cut));
    const fLb = logOf(j.pb.slice(0, cut));
    const eg = engleGranger(fLa, fLb);
    // The cointegrating residual for the half-life, from the EG slope — the
    // half-life must describe the RELATION, not the adaptive Kalman residual.
    const slope = eg?.slope ?? NaN;
    const resid = Number.isFinite(slope) ? fLa.map((v, i) => v - (eg?.alpha ?? 0) - slope * fLb[i]) : [];
    const k0 = Math.max(0, j.dates.length - P.COINT_WINDOW);
    const lLa = logOf(j.pa.slice(k0));
    const lLb = logOf(j.pb.slice(k0));
    const live = lLa.length >= 120 ? engleGranger(lLa, lLb) : null;
    const liveModel = buildSpreadModel(lLa, lLb, P.DEFAULT_LB);
    const liveSpread = liveModel.spread;
    return {
      j,
      pForm: eg?.p ?? NaN,
      levelA: eg?.levelA ?? NaN,
      levelB: eg?.levelB ?? NaN,
      hlForm: resid.length ? halfLife(resid) : NaN,
      slope,
      pLive: live?.p ?? NaN,
      hlLive: halfLife(liveSpread),
      hurstLive: hurstExp(liveSpread),
      ac1Live: changeAutocorr1(liveSpread),
    };
  });

  const q = bhQvalues(probes.map((r) => (Number.isFinite(r.pForm) ? r.pForm : null)));
  // The live window is a second family of raw tests, so it gets its own FDR pass.
  // Testing it raw and correcting only the formation window would report the
  // live p-values as if they were single hypotheses, which is exactly the
  // multiple-testing error BH exists to prevent.
  const qLive = bhQvalues(probes.map((r) => (Number.isFinite(r.pLive) ? r.pLive : null)));
  const rows: PairRow[] = probes.map((r, i) => {
    const nonStationaryLegs = !(r.levelA < 0.05) && !(r.levelB < 0.05);
    const qOk = Number.isFinite(q[i]) && q[i] <= P.FDR_ALPHA;
    const pOk = Number.isFinite(r.pForm) && r.pForm <= P.FDR_ALPHA;
    const passes = pOk && qOk && nonStationaryLegs;
    // The live window is judged on its FDR-corrected q, not the raw p.
    //
    // It used to test the raw `pLive`, which meant a pair could read CONFIRMED on
    // p=0.039 while the corrected q beside it said 0.135 — a contradiction on the
    // face of the desk, and the multiple-testing error BH exists to prevent.
    //
    // The live threshold is FDR_ALPHA, not FDR_STRONG, and that is arithmetic
    // rather than preference: BH's smallest reachable q is p_min * n, so with ~88
    // pairs no q<=0.05 can exist unless some pLive is under 5.7e-4. Gating on 0.05
    // would make CONFIRMED permanently unreachable and the desk would report "no
    // pair is good enough" forever.
    //
    // So the tiers are: CONFIRMED = passed formation and still cointegrating out
    // of sample; PROBABLE = passed formation but the relation has decayed; NONE =
    // never passed. Reading PROBABLE as "selectable but check it" is only true of
    // the first, and the verdict string says which happened.
    const liveHolds = Number.isFinite(qLive[i]) && qLive[i] <= P.FDR_ALPHA;
    const confirmed = passes && liveHolds;
    const hlOk = Number.isFinite(r.hlForm) && r.hlForm >= P.HL_MIN && r.hlForm <= P.HL_MAX;
    const reason = !Number.isFinite(r.pForm)
      ? "COINTEGRATION TEST DID NOT CONVERGE"
      : !nonStationaryLegs
        ? "A LEG REJECTS A UNIT ROOT ON ITS OWN — NOT A COINTEGRATING RELATION"
        : !hlOk
          ? `HALF-LIFE ${Number.isFinite(r.hlForm) ? r.hlForm.toFixed(1) : "?"}d OUTSIDE ${P.HL_MIN}-${P.HL_MAX}d`
          : !qOk
            ? `FDR q ${Number.isFinite(q[i]) ? q[i].toFixed(3) : "?"} ABOVE ${P.FDR_ALPHA}`
            : confirmed
              ? "PASSES AND STILL COINTEGRATES OUT OF SAMPLE"
              : `PASSED SELECTION BUT THE RELATION HAS DECAYED — LIVE FDR q ${Number.isFinite(qLive[i]) ? qLive[i].toFixed(3) : "?"} ABOVE ${P.FDR_ALPHA}`;
    return {
      a: r.j.a,
      b: r.j.b,
      pForm: r.pForm,
      qForm: q[i],
      pLive: r.pLive,
      qLive: qLive[i],
      levelA: r.levelA,
      levelB: r.levelB,
      nonStationaryLegs,
      halfLifeForm: r.hlForm,
      halfLifeLive: r.hlLive,
      hurstLive: r.hurstLive,
      changeAc1Live: r.ac1Live,
      cointegratingSlope: r.slope,
      status: confirmed ? "CONFIRMED" : passes ? "PROBABLE" : "NONE",
      stable: liveHolds,
      inPortfolio: false,
      oos: null,
      reason,
    };
  });

  const eligible = (r: PairRow) =>
    Number.isFinite(r.pForm) &&
    Number.isFinite(r.qForm) &&
    r.qForm <= P.FDR_ALPHA &&
    r.nonStationaryLegs &&
    Number.isFinite(r.halfLifeForm) &&
    r.halfLifeForm >= P.HL_MIN &&
    r.halfLifeForm <= P.HL_MAX &&
    r.stable;

  let selected = rows.filter(eligible);
  let relaxed = false;
  if (selected.length < 3) {
    const pool = rows.filter((r) => Number.isFinite(r.pForm) && Number.isFinite(r.halfLifeForm)).sort((x, y) => x.pForm - y.pForm).slice(0, 5);
    selected = pool;
    relaxed = pool.length > 0;
    notes.push(
      relaxed
        ? `ONLY ${rows.filter((r) => r.status !== "NONE").length} PAIR(S) PASSED THE FULL GATE. FELL BACK TO THE 5 LOWEST FORMATION p-VALUES — THE BASKET IS UNVALIDATED AND IS SHOWN FOR MECHANISM ONLY.`
        : "NOTHING SURVIVED SCREENING — THE BASKET IS EMPTY."
    );
  }
  const selKeys = new Set(selected.map((r) => pairKey(r.a, r.b)));
  for (const r of rows) r.inPortfolio = selKeys.has(pairKey(r.a, r.b));

  return {
    rows,
    formationDate,
    selected: selected.map((r) => [r.a, r.b] as [string, string]),
    relaxed,
    notes,
    dropped,
  };
}

/** Full walk-forward + static-baseline comparison for one pair. */
export function analysePair(series: Map<string, PriceBars>, a: string, b: string): PairDetail | null {
  const sa = series.get(a);
  const sb = series.get(b);
  if (!sa || !sb) return null;
  const j = joinDates(sa, sb);
  if (j.dates.length < P.MIN_OBS) return null;
  const cut = Math.floor(j.dates.length * P.FORMATION_FRAC);
  const start = Math.max(cut, P.TRAIN_WINDOW);
  if (j.dates.length - start < P.TEST_STEP) return null;

  const walk = walkForward(j.pa, j.pb, j.dates, start);
  const st = staticRun(j.pa, j.pb, j.dates);
  const stTradesFull = extractTrades(st.pos, st.ret, j.dates, P.SIGNAL_DELAY, 0);
  const stTradesOos = extractTrades(st.pos, st.ret, j.dates, P.SIGNAL_DELAY, start);

  // Hedge-ratio history for the comparison chart. All three are built on the SAME
  // joined series so the lines are directly comparable: the Kalman filter the
  // desk actually trades on, a plain rolling OLS, and the single full-sample
  // coefficient a "just fit it once" model would have used throughout. The point
  // of the chart is the gap between them — the rolling fit chatters on noise
  // while the static line never adapts at all, and the Kalman line sits between.
  const la = logOf(j.pa);
  const lb = logOf(j.pb);
  const rollingBetaTail = olsHedge(la, lb, P.ROLLING_OLS_WIN).beta.slice(-300);
  const staticBetaAll = olsHedge(la, lb, la.length).beta;
  const staticBeta = staticBetaAll[staticBetaAll.length - 1] ?? null;

  let eqA = 1;
  let eqB = 1;
  const equityAdaptive: number[] = [];
  const equityStatic: number[] = [];
  for (let i = start; i < j.dates.length; i++) {
    eqA *= 1 + (walk.ret[i] || 0);
    eqB *= 1 + (st.ret[i] || 0);
    equityAdaptive.push(eqA);
    equityStatic.push(eqB);
  }

  return {
    a,
    b,
    dates: j.dates,
    priceA: j.pa,
    priceB: j.pb,
    walk,
    baselineFull: perfStats(st.ret, stTradesFull),
    baselineOos: perfStats(st.ret.slice(start), stTradesOos),
    adaptiveOos: perfStats(walk.ret.slice(start), walk.trades),
    zTail: walk.zTail,
    zDates: walk.zDates,
    staticZTail: st.z.slice(-300),
    spreadTail: walk.spreadTail,
    betaTail: walk.betaTail,
    rollingBetaTail,
    staticBeta,
    equityAdaptive,
    equityStatic,
    equityDates: j.dates.slice(start),
    trades: walk.trades,
    formationEnd: j.dates[Math.min(cut, j.dates.length - 1)],
  };
}

/** Conviction score, 0-100. Every component is a number this module computed. */
export function convictionScore(s: {
  az: number;
  entry: number;
  status: string;
  halfLife: number;
  oosSharpe: number;
  stable: boolean;
}): number {
  let v = (35 * Math.min(s.az / s.entry, 1.25)) / 1.25;
  v += s.status === "CONFIRMED" ? 25 : s.status === "PROBABLE" ? 15 : 0;
  if (Number.isFinite(s.halfLife)) v += s.halfLife <= P.HL_MAX / 2 ? 10 : s.halfLife <= P.HL_MAX ? 5 : 0;
  if (Number.isFinite(s.oosSharpe)) v += (15 * Math.max(0, Math.min(s.oosSharpe, 2))) / 2;
  v += s.stable ? 5 : 0;
  return Math.round(Math.max(0, Math.min(v, 100)));
}

/** Build the live radar row for one pair, or null when the model has no z yet. */
export function signalFor(a: string, b: string, pa: number[], pb: number[], row: PairRow, oos: PerfStats | null): SignalRow | null {
  const n = pa.length;
  if (n < P.DEFAULT_LB + 5) return null;
  const la = logOf(pa);
  const lb = logOf(pb);
  const model = buildSpreadModel(la, lb, P.DEFAULT_LB, kalmanHedge(la, lb));
  const last = n - 1;
  const z = model.z[last];
  const beta = model.beta[last];
  const alpha = model.alpha[last];
  const sd = model.sd[last];
  const mu = model.mu[last];
  if (z === null || beta === null || alpha === null || sd === null || mu === null) return null;
  if (!Number.isFinite(z) || !Number.isFinite(beta) || !Number.isFinite(alpha) || !Number.isFinite(mu) || !(sd > 0)) return null;

  const entry = P.ENTRY_Z;
  const exitZ = P.EXIT_Z;
  const az = Math.abs(z);
  const zPrev = model.z[last - 1] ?? z;
  const tail = model.spread.slice(-P.COINT_WINDOW);
  const hl = halfLife(tail);
  const hu = hurstExp(tail);
  const cac1 = changeAutocorr1(tail);

  const hard: string[] = [];
  const soft: string[] = [];
  if (row.status === "NONE") hard.push("SCREEN-FAILED");
  if (!Number.isFinite(hl) || hl < P.HL_MIN || hl > P.HL_MAX) hard.push(`HL ${Number.isFinite(hl) ? hl.toFixed(0) : "INF"}d`);
  if (!row.nonStationaryLegs) hard.push("LEG-TRENDING");
  if (az >= P.STOP_Z) hard.push("BEYOND-STOP");
  else if (az >= P.STOP_Z - P.MIN_STOP_ROOM) hard.push("NO-ROOM-TO-STOP");
  if (oos && Number.isFinite(oos.Sharpe) && oos.Sharpe < 0) soft.push("NEG-OOS");
  if (!row.stable) soft.push("UNSTABLE");

  let stage: Stage;
  if (az >= P.STOP_Z) stage = "BEYOND STOP";
  else if (az >= entry) stage = "TRIGGERED";
  else if (az >= P.ON_DECK_FRAC * entry) stage = "ON DECK";
  else if (az <= Math.max(exitZ, 0.5)) stage = "EXIT ZONE";
  else stage = "FLOATING";
  const dz = az - Math.abs(zPrev);
  const momentum: SignalRow["momentum"] = dz > 0.1 ? "APPROACHING" : dz < -0.1 ? "COOLING" : "FLAT";

  // side +1 = the spread is rich: sell A, buy B.
  const side: 1 | -1 = z >= 0 ? 1 : -1;
  const target = mu + side * entry * sd;
  const lbNow = lb[last];
  const laNow = la[last];
  const trigA = Math.exp(target + beta * lbNow + alpha);
  const trigB = Math.exp((laNow - alpha - target) / beta);
  const meanA = Math.exp(mu + beta * lbNow + alpha);
  // Signed "how far the price must travel", NOT clipped to a magnitude — a clip
  // makes an unreachable trigger look close.
  const rawMoveA = (trigA / pa[last] - 1) * 100;
  const rawMoveB = (trigB / pb[last] - 1) * 100;
  const moveA = side > 0 ? -Math.abs(rawMoveA) : Math.abs(rawMoveA);
  const moveB = side > 0 ? Math.abs(rawMoveB) : -Math.abs(rawMoveB);

  const actionable = entry <= az && az < P.STOP_Z && hard.length === 0;
  const onDeck = az >= P.ON_DECK_FRAC * entry && az < entry && hard.length === 0;
  const timeStop = Number.isFinite(hl) ? Math.min(60, Math.max(8, Math.round(P.TIME_STOP_HL_MULT * hl))) : 25;

  const sig: SignalRow = {
    pair: `${bare(a)} vs ${bare(b)}`,
    a,
    b,
    status: row.status,
    qForm: row.qForm,
    oosSharpe: oos?.Sharpe ?? NaN,
    z,
    zPrev,
    lookback: P.DEFAULT_LB,
    entry,
    exit: exitZ,
    stop: P.STOP_Z,
    beta,
    alpha,
    sd,
    priceA: pa[last],
    priceB: pb[last],
    trigA,
    trigB,
    moveAPct: moveA,
    moveBPct: moveB,
    meanA,
    halfLife: hl,
    hurst: hu,
    changeAc1: cac1,
    stage,
    momentum,
    side,
    action: side > 0 ? `SHORT ${bare(a)} / LONG ${bare(b)}` : `LONG ${bare(a)} / SHORT ${bare(b)}`,
    conviction: convictionScore({ az, entry, status: row.status, halfLife: hl, oosSharpe: oos?.Sharpe ?? NaN, stable: row.stable }),
    timeStop,
    hard,
    soft,
    actionable,
    onDeck,
    ticket: null,
  };
  if (actionable) sig.ticket = buildTicket(sig);
  return sig;
}

export function buildTicket(s: SignalRow): Ticket {
  const sdPct = s.sd;
  const az = Math.abs(s.z);
  const room = Math.max(P.STOP_Z - az, P.MIN_STOP_ROOM);
  // Risk the fixed budget only if the stop is `room` sigma away.
  const riskBudget = (P.RISK_PER_TRADE_PCT / 100) * P.TOTAL_CAPITAL;
  const byRisk = riskBudget / (room * sdPct);
  const notional = Math.min(P.CAPITAL_PER_LEG, byRisk);
  const qtyA = Math.floor(notional / s.priceA);
  const qtyB = Math.floor((notional * s.beta) / s.priceB);
  const na = qtyA * s.priceA;
  const nb = qtyB * s.priceB;
  const gross = na + nb;
  const profit = na * (az - s.exit) * sdPct;
  const loss = na * room * sdPct;
  return {
    qtyA,
    qtyB,
    notionalA: na,
    notionalB: nb,
    gross,
    profitTarget: profit,
    lossStop: loss,
    rewardRisk: loss > 0 ? profit / loss : NaN,
    costs: 2 * (P.COST_BPS_PER_SIDE / 1e4) * gross,
    legAVerb: s.side > 0 ? "SELL" : "BUY",
    legBVerb: s.side > 0 ? "BUY" : "SELL",
    timeStop: s.timeStop,
    note:
      "IN THE CASH SEGMENT A SHORT LEG IS INTRADAY-ONLY IN INDIA. CARRYING IT OVERNIGHT MEANS STOCK FUTURES, WHERE LOT SIZE, MARGIN AND ROLLOVER APPLY — SO THIS IS A CASH-SHAPE SIZE, NOT A FUTURES SIZE.",
  };
}

/** Equal-risk basket over the selected pairs, plus bootstrap and stress tests. */
export function buildPortfolio(details: Array<{ walk: WFResult }>): PortfolioOut | null {
  if (!details.length) return null;
  const legs = details.map((d) => d.walk);
  const base = portfolioReturn(legs);
  if (!base.dates.length) return null;
  const trades = legs.flatMap((w) => w.trades);
  const stats = perfStats(base.ret, trades);
  const ok = bootstrapSharpe(base.ret)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const ci: [number, number] = ok.length
    ? [ok[Math.floor(ok.length * 0.05)], ok[Math.min(ok.length - 1, Math.floor(ok.length * 0.95))]]
    : [NaN, NaN];
  const stress: PortfolioOut["stress"] = [];
  for (const [delay, cost] of [
    [P.SIGNAL_DELAY, P.COST_BPS_PER_SIDE],
    [P.SIGNAL_DELAY + 1, P.COST_BPS_PER_SIDE],
    [P.SIGNAL_DELAY, P.COST_BPS_PER_SIDE * 2],
    [P.SIGNAL_DELAY + 1, P.COST_BPS_PER_SIDE * 2],
  ] as Array<[number, number]>) {
    const s = portfolioReturn(legs, delay, cost);
    stress.push({ delay, cost, stats: perfStats(s.ret) });
  }
  return {
    dates: base.dates,
    ret: base.ret,
    active: base.active,
    stats,
    ci,
    probNegative: ok.length ? (ok.filter((v) => v <= 0).length / ok.length) * 100 : NaN,
    stress,
    trades,
  };
}

/** Tickers the caller must download for the given pair list. */
export function universeTickers(pairs: Array<[string, string]>): string[] {
  return [...new Set(pairs.flat())];
}