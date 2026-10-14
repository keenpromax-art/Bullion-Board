// Shared trade-plan vocabulary for the terminal.
//
// WHY THIS FILE EXISTS: every desk that reads a price needs to answer the same
// four questions — what is the read, what are the levels, when do I bank it, and
// what proves it wrong. Written per desk, that becomes 100 near-identical
// components that drift apart. So the SHAPE lives here once, every desk produces
// one of these, and a single panel renders all of them.
//
// The house rule, inherited from the Order Flow desk where this started: prefer a
// level the market actually printed over a number a formula produced. Bollinger
// bands, the 50-SMA, the last swing high — those are prices somebody traded. A
// target that is only a projection is a guess wearing a decimal point, and the
// `note` field exists so every level has to say which it is.

export type PlanRole = "ENTRY" | "TARGET" | "STOP" | "WATCH";

export interface DeskPlanLevel {
  role: PlanRole;
  px: number;
  /** Reward:risk against the reference entry. Null when there is no position. */
  rr: number | null;
  /** Why this price, in words. Never leave it blank. */
  note: string;
}

export interface DeskPlan {
  /** Short verdict shown largest, e.g. LONG / SHORT / FLAT / OVERVALUED. */
  stance: string;
  /** "pos" | "neg" | "" — drives the stance colour. */
  stanceTone: "pos" | "neg" | "";
  /** Short regime/classification badge. */
  badge: string;
  /** Extra condition flags worth surfacing (e.g. FLOW DIVERGENCE). */
  flags: string[];
  headline: string;
  /** Prose for what starts a position — a condition, not just a price. */
  entryText: string;
  levels: DeskPlanLevel[];
  /** When to take profit, as observable triggers. */
  profitRules: string[];
  /** What proves the read wrong. */
  invalidation: string;
  /** Evidence for. */
  confluence: string[];
  /** Evidence against. Shown even when empty is fine, but never faked. */
  against: string[];
  /**
   * Non-skippable honesty statement. This is part of the plan, not a footnote
   * somebody can scroll past, because the most dangerous reading of this panel is
   * "backtested signal".
   */
  caveat: string;
}

export const PLAN_LEVEL_TONE: Record<PlanRole, string> = {
  ENTRY: "pos",
  TARGET: "pos",
  STOP: "neg",
  WATCH: "faint",
};

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Reward:risk per unit of risk, from a reference entry. Null if risk is zero. */
export function planRR(entry: number, level: number, stop: number, side: 1 | -1): number | null {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  return r2(((side === 1 ? level - entry : entry - level)) / risk);
}

// ===================================================================
// Daily-frequency plan, built from the indicators EVERY module carries
// ===================================================================

/**
 * The subset of the `/api/analysis` payload that exists on every module id, so
 * this builder works without an API change and without a per-module branch.
 */
export interface DailyInputs {
  price: number;
  /** Most recent bars, oldest first. */
  bars: Array<{ high: number; low: number; close: number; volume: number }>;
  indicators: {
    rsi?: number; adx?: number; atr?: number;
    ema9?: number; ema21?: number; sma50?: number;
    bbUpper?: number; bbMid?: number; bbLower?: number; bbPctB?: number;
    macdHist?: number; willr?: number; obv?: number;
  };
  risk: { sharpe?: number; maxDD?: { pct?: number }; hurst?: number; profitFactor?: number };
  /** The module's own verdict, when it has one, folded in as a confluence note. */
  deskSignal?: string;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Highest high / lowest low over the last `w` bars — a price that printed. */
function swing(bars: DailyInputs["bars"], w: number): { hi: number; lo: number } {
  const t = bars.slice(-w);
  if (!t.length) return { hi: NaN, lo: NaN };
  return {
    hi: Math.max(...t.map((b) => b.high)),
    lo: Math.min(...t.map((b) => b.low)),
  };
}

/**
 * Build a plan for any module that carries the standard indicator block.
 *
 * Same discipline as the intraday builder: exhaustion outranks continuation, a
 * move without trend strength is not a trend, and when the evidence does not
 * point anywhere the honest answer is FLAT with the levels marked WATCH.
 */
export function buildDailyPlan(d: DailyInputs): DeskPlan {
  const px = d.price;
  const ind = d.indicators ?? {};
  const bars = d.bars ?? [];

  const rsi = num(ind.rsi);
  const adx = num(ind.adx);
  const atr = num(ind.atr);
  const sma50 = num(ind.sma50);
  const ema9 = num(ind.ema9);
  const ema21 = num(ind.ema21);
  const bbU = num(ind.bbUpper);
  const bbM = num(ind.bbMid);
  const bbL = num(ind.bbLower);
  const macdH = num(ind.macdHist);
  const sharpe = num(d.risk?.sharpe);
  const maxDD = num(d.risk?.maxDD?.pct);

  // %B is recomputed here rather than read from the payload.
  //
  // The route's `bbPctB` is a PERCENTAGE, not a fraction: RELIANCE ships 16.89
  // where the band maths gives 0.169. Gating on the conventional fraction
  // thresholds against that field flagged 11 of 11 large caps as overextended —
  // a gate that always fires is not a gate, and the panel would have told every
  // user not to buy anything. Deriving it from the band edges is unambiguous and
  // cannot drift again if the route's scaling changes.
  const pctB =
    bbU !== null && bbL !== null && bbU > bbL ? (px - bbL) / (bbU - bbL) : null;

  const confluence: string[] = [];
  const against: string[] = [];

  if (!(px > 0) || bars.length < 30) {
    return {
      stance: "—", stanceTone: "", badge: "NO DATA", flags: [], headline: "NOT ENOUGH HISTORY TO PLAN",
      entryText: "THIS DESK HAS NOT FETCHED ENOUGH BARS TO PLACE A LEVEL. NOTHING HERE IS A CALL.",
      levels: [],
      profitRules: ["NO LEVELS MEANS NO TRADE. WAIT FOR THE DESK TO LOAD."],
      invalidation: "NOT APPLICABLE — THERE IS NO READ TO INVALIDATE.",
      confluence, against,
      caveat: "NO PLAN IS BUILT FROM AN INSUFFICIENT SAMPLE.",
    };
  }

  const { hi: hi60, lo: lo60 } = swing(bars, 60);
  const { hi: hi20, lo: lo20 } = swing(bars, 20);
  // Fall back to ATR when bands are absent, so a level always exists.
  const uBand = bbU ?? (atr ? px + 2 * atr : NaN);
  const lBand = bbL ?? (atr ? px - 2 * atr : NaN);
  const midBand = bbM ?? sma50 ?? px;

  // ---- evidence ---------------------------------------------------------
  const aboveMid = px >= midBand;
  const aboveSma = sma50 === null ? null : px > sma50;
  const trendStack = ema9 !== null && ema21 !== null ? ema9 > ema21 : null;
  const trending = adx !== null && adx >= 25;
  const weakTrend = adx !== null && adx < 20;

  if (aboveSma === true) confluence.push(`PRICE ${px.toFixed(2)} IS ABOVE THE 50-DAY AVERAGE ${r2(sma50!)} — THE AVERAGE HOLDER OF THE LAST MONTH IS IN PROFIT`);
  if (aboveSma === false) against.push(`PRICE IS BELOW THE 50-DAY AVERAGE ${r2(sma50!)} — THE LAST MONTH's BUYERS ARE UNDER WATER`);
  if (trendStack === true) confluence.push(`EMA9 IS ABOVE EMA21 — SHORT-TERM MOMENTUM IS WITH THE BULLS`);
  if (trendStack === false) against.push("EMA9 IS BELOW EMA21 — SHORT-TERM MOMENTUM IS WITH THE BEARS");
  if (trending) confluence.push(`ADX ${adx!.toFixed(1)} IS ABOVE 25 — THIS IS A TRENDING NAME, SO PULLBACKS TEND TO BE BOUGHT, NOT SOLD`);
  if (weakTrend) confluence.push(`ADX ${adx!.toFixed(1)} IS BELOW 20 — NO TREND, SO THE EDGE IS IN THE ENDS OF THE RANGE, NOT THE MIDDLE`);
  if (rsi !== null && rsi > 70) against.push(`RSI ${rsi.toFixed(1)} IS OVERBOUGHT — STRETCHED, AND THE MOVE THAT GOT IT THERE IS FADING`);
  if (rsi !== null && rsi < 30) against.push(`RSI ${rsi.toFixed(1)} IS OVERSOLD — STRETCHED THE OTHER WAY`);
  if (rsi !== null && rsi >= 45 && rsi <= 65) confluence.push(`RSI ${rsi.toFixed(1)} IS NEUTRAL — ROOM TO MOVE IN EITHER DIRECTION`);
  if (pctB !== null && pctB > 1) against.push(`PRICE IS ABOVE THE UPPER BAND (%B ${pctB.toFixed(2)}) — PRICE IS OUTSIDE ITS OWN TWO-MONTH DISTRIBUTION${trending ? ", WHICH IN A TRENDING NAME IS NORMAL AND NOT BY ITSELF A SELL" : ""}`);
  if (pctB !== null && pctB < 0) against.push(`PRICE IS BELOW THE LOWER BAND (%B ${pctB.toFixed(2)}) — SAME PROBLEM, MIRRORED${trending ? ", AND IN A TRENDING NAME IT IS A TRADE, NOT A WARNING" : ""}`);
  if (sharpe !== null && sharpe < 0) against.push(`HISTORICAL SHARPE ${sharpe.toFixed(2)} IS NEGATIVE — THIS NAME HAS NOT PAID FOR ITS VOLATILITY`);
  if (maxDD !== null && maxDD < -40) against.push(`MAX DRAWDOWN ${maxDD.toFixed(0)}% — POSITION SIZE HAS TO SURVIVE THAT`);
  if (d.deskSignal) confluence.push(`MODULE'S OWN READ: ${d.deskSignal}`);

  // ---- regimes ----------------------------------------------------------
  const stopAtr = atr ? atr * 2 : (hi60 - lo60) * 0.1;
  const up = aboveSma !== false && (aboveSma === true || aboveMid);
  const side: 1 | -1 | 0 = up ? 1 : -1;

  // 1. Outside the band with NO trend behind it.
  //
  // The trend guard is not optional. A strong name riding its upper band is the
  // normal condition of an uptrend — bands expand into price and %B pins above
  // 1 for weeks at a time. Calling that "overextended, fade it" is how a
  // checklist talks a trader out of the strongest names on the board. The same
  // discipline the intraday builder uses: flow/strength confirming the move means
  // continuation, and only an unconfirmed stretch is exhaustion.
  if (pctB !== null && (pctB > 1.02 || pctB < -0.02) && !trending) {
    const overUp = pctB > 1.02;
    return {
      stance: overUp ? "FADE UP" : "FADE DOWN",
      stanceTone: overUp ? "neg" : "pos",
      badge: "OVEREXTENDED", flags: [],
      headline: overUp
        ? "PRICE IS OUTSIDE ITS OWN BAND — DO NOT BUY UP HERE"
        : "PRICE IS OUTSIDE ITS OWN BAND — DO NOT SELL DOWN HERE",
      entryText: `NO ENTRY UNTIL PRICE RETURNS INSIDE. THE BAND EDGE IS ${r2(overUp ? bbU! : bbL!)}; TRADES TAKEN HERE ARE MEAN-REVERSION BETS AGAINST A TREND THAT MAY NOT BE FINISHED.`,
      levels: [
        { role: "TARGET", px: r2(overUp ? bbM! : bbM!), rr: null, note: "FIRST OBJECTIVE — THE BAND MIDLINE, WHERE PRICE MEAN-REVERTS ON AVERAGE" },
        { role: "TARGET", px: r2(overUp ? bbL! : bbU!), rr: null, note: "SECOND — THE OPPOSITE BAND" },
        { role: "STOP", px: r2(overUp ? bbU! + stopAtr : bbL! - stopAtr), rr: null, note: "ONE 2×ATR BEYOND THE BAND — BEYOND IT THIS IS A NEW REGIME, NOT A FADE" },
      ],
      profitRules: fadeProfitRules(midBand, atr, overUp ? 1 : -1),
      invalidation: "A FADE IS WRONG WHEN THE BAND KEEPS WIDENING AND PRICE HOLDS OUTSIDE IT FOR MORE THAN 3 CLOSING BARS — THAT IS A REGIME CHANGE, NOT AN EXTREME.",
      confluence, against,
      caveat: DAILY_CAVEAT,
    };
  }

  // 2. Trending with stack confirmation.
  if (trending && trendStack !== null && aboveSma !== null && aboveSma === (trendStack as boolean)) {
    const long = trendStack;
    // A continuation entry is a PULLBACK, so it sits at the band edge the move
    // came from: a long buys the dip toward the lower band, a short sells the
    // rally toward the upper band.
    //
    // This was previously `min(uBand, px)` for shorts, which collapsed to the
    // current price whenever price was already inside the band — producing an
    // entry at market under a headline telling you not to chase, and a first
    // target of 0.32R. The entry has to be a price you WAIT for, or the R:R it
    // produces is a fiction.
    const entry = long ? r2(lBand) : r2(uBand);
    const stop = long ? r2(entry - stopAtr) : r2(entry + stopAtr);
    const t1 = long ? r2(hi60) : r2(lo60);
    const t2 = long ? r2(hi60 + stopAtr) : r2(lo60 - stopAtr);
    return {
      stance: long ? "LONG" : "SHORT",
      stanceTone: long ? "pos" : "neg",
      badge: "TREND", flags: [],
      headline: long ? "TREND IS INTACT — BUY THE DIP, NOT THE BREAKOUT" : "TREND IS INTACT — SELL THE RALLY, NOT THE BREAKDOWN",
      entryText: `WAIT FOR A PULLBACK INTO ${entry}${long ? "" : " ON A RALLY"} — THAT IS A BAND EDGE THE MARKET HAS ALREADY TRADED. PRICE IS ${px.toFixed(2)} NOW; CHASING HERE PAYS THE WORST PRICE IN THE MOVE.`,
      levels: [
        { role: "ENTRY", px: entry, rr: null, note: long ? "PULLBACK ZONE — LOWER BAND, WHERE THE DIP MEANS THE BAND" : "RALLY ZONE — UPPER BAND, WHERE THE Bounce MEANS EXHAUSTION" },
        { role: "TARGET", px: t1, rr: planRR(entry, t1, stop, long ? 1 : -1), note: "SCALE 1 — THE 60-DAY HIGH/LOW, A PRICE THAT HAS ALREADY PRINTED" },
        { role: "TARGET", px: t2, rr: planRR(entry, t2, stop, long ? 1 : -1), note: "SCALE 2 — ONE 2×ATR BEYOND IT" },
        { role: "STOP", px: stop, rr: null, note: "TWO ATR FROM ENTRY — THE WIDEST THE DAILY NOISE RECENTLY ALLOWED" },
      ],
      profitRules: trendProfitRules(t1, atr, long ? 1 : -1),
      invalidation: long
        ? `A CLOSE BELOW THE LOWER BAND ${r2(lBand)} BREAKS THE STRUCTURE. A CLOSE BELOW THE 50-DAY AVERAGE ${r2(sma50!)} SAYS THE TREND HAS BROKEN, NOT PAUSED.`
        : `A CLOSE ABOVE THE UPPER BAND ${r2(bbU!)} BREAKS THE STRUCTURE. A CLOSE ABOVE THE 50-DAY AVERAGE ${r2(sma50!)} SAYS THE TREND HAS BROKEN, NOT PAUSED.`,
      confluence, against,
      caveat: DAILY_CAVEAT,
    };
  }

  // 3. No trend, RSI at an extreme — fade it back to the midline.
  if (weakTrend && rsi !== null && (rsi >= 72 || rsi <= 28)) {
    const fadeLong = rsi <= 28;
    const fside: 1 | -1 = fadeLong ? 1 : -1;
    const entry = r2(px);
    const stop = r2(fadeLong ? px - stopAtr : px + stopAtr);
    return {
      stance: fadeLong ? "BUY THE DIP" : "SELL THE RALLY",
      stanceTone: fadeLong ? "pos" : "neg",
      badge: "MEAN REVERSION", flags: [],
      headline: fadeLong
        ? `RSI ${rsi.toFixed(1)} AND NO TREND — THE SELLING IS EXHAUSTED, NOT THE STOCK`
        : `RSI ${rsi.toFixed(1)} AND NO TREND — THE BUYING IS EXHAUSTED, NOT THE STOCK`,
      entryText: `TAKE ${entry} AS A MEAN-REVERSION ENTRY TOWARD THE BAND MIDLINE ${r2(midBand)}. SIZE IT SMALLER THAN A TRADE — WITHOUT ADX SUPPORTING IT, THIS IS A COUNTER-TREND BET.`,
      levels: [
        { role: "ENTRY", px: entry, rr: null, note: "AT MARKET WHILE RSI IS STILL EXTREME" },
        { role: "TARGET", px: r2(midBand), rr: planRR(entry, midBand, stop, fside), note: "TAKE THE MAJORITY HERE — THE BAND MIDLINE IS THE WHOLE THESIS" },
        { role: "STOP", px: stop, rr: null, note: "TWO ATR — A FADE THAT NEEDS MORE ROOM THAN THE DAILY NOISE ALLOWS IS NOT A FADE" },
        { role: "WATCH", px: r2(fadeLong ? lo20 : hi20), rr: null, note: "IF IT BREAKS THE 20-DAY LOW/HIGH FIRST, THE FADE IS DEAD — DO NOT AVERAGE DOWN" },
      ],
      profitRules: fadeProfitRules(midBand, atr, fside),
      invalidation: "INVALID IF RSI MAKES A NEW EXTREME WHILE PRICE KEEPS FALLING/RISING, OR IF ADX CLIMBS ABOVE 25 — AT THAT POINT IT IS A TREND AND YOU ARE STANDING IN ITS WAY.",
      confluence, against,
      caveat: DAILY_CAVEAT,
    };
  }

  // 4. Nothing points anywhere. Say so.
  return {
    stance: "FLAT",
    stanceTone: "",
    badge: "NO EDGE", flags: [],
    headline: "NOTHING HERE WORTH SIZING — THE SIGNALS DISAGREE",
    entryText: `NO POSITION. RSI ${rsi?.toFixed(1) ?? "—"}, ADX ${adx?.toFixed(1) ?? "—"}, PRICE ${aboveMid ? "ABOVE" : "BELOW"} THE MIDLINE ${r2(midBand)} — TREND AND STRETCH ARE NOT AGREEING, WHICH IS THE DEFINITION OF A CHOP.`,
    levels: [
      { role: "WATCH", px: r2(uBand), rr: null, note: "UPPER BAND — A CLOSE ABOVE IT WITH ADX RISING IS WHAT TURNS THIS INTO A TRADE" },
      { role: "WATCH", px: r2(midBand), rr: null, note: "MIDLINE — THE PIVOT THE WHOLE RANGE IS MEASURED FROM" },
      { role: "WATCH", px: r2(lBand), rr: null, note: "LOWER BAND — A CLOSE BELOW IT WITH ADX RISING IS THE BEARISH VERSION" },
    ],
    profitRules: [
      "NO POSITION, NO PROFIT RULE. THE PROFITABLE MOVE HERE IS THE ONE THAT DOES NOT HAPPEN.",
      `RE-READ THIS DESK WHEN PRICE CLOSES OUTSIDE THE BAND WITH ADX ABOVE 25 — THAT IS THE MOMENT THE PLAN BECOMES A TRADE.`,
      "DO NOT FORCE A SETUP TO KEEP THE DESK BUSY. A READ THAT SAYS NOTHING IS information, not a failure.",
    ],
    invalidation: "THIS READ IS WRONG IF PRICE BREAKS THE BAND ON EXPANDING VOLUME — THAT IS THE TRIGGER TO RE-READ THE DESK, NOT A REASON TO PRE-EMPT IT.",
    confluence, against,
    caveat: DAILY_CAVEAT,
  };
}

const DAILY_CAVEAT =
  "THIS IS A DECISION CHECKLIST, NOT A BACKTESTED SIGNAL. NONE OF THESE RULES HAS BEEN SCORED ON HISTORY. THE INPUTS ARE " +
  "STANDARD TECHNICAL INDICATORS, WHICH ARE DESCRIPTIONS OF PAST PRICES — NOT FORECASTS. R:R IS SIMPLE DISTANCE FROM THE " +
  "REFERENCE ENTRY TO THE STOP, NOT AN EXPECTED VALUE OR A PROBABILITY. THE LEVELS ARE BAND AND SWING PRICES THE MARKET " +
  "HAS TRADED, SO THEY MOVE EVERY SESSION. NO POSITION SIZING IS IMPLIED. DO YOUR OWN WORK.";

function trendProfitRules(t1: number, atr: number | null, side: 1 | -1): string[] {
  const d = side === 1 ? "UP" : "DOWN";
  return [
    `SCALE HALF AT ${t1} — THE 60-DAY EXTREME, A LEVEL THAT HAS ALREADY BEEN TESTED AND HELD ${side === 1 ? "AS RESISTANCE BECOMES SUPPORT" : "TWICE"}.`,
    `TRAIL THE STOP TO BREAKEVEN ONCE THE POSITION IS ${(0.5 * (atr ?? 0)).toFixed(2)} (HALF AN ATR) IN PROFIT. A TREND THAT GIVES BACK A PROFITABLE MOVE WAS NOT THE TRADE YOU ENTERED.`,
    `ON THE REMAINDER, TRAIL BEHIND THE 20-DAY SWING. THE TRADE IS OVER WHEN THE STRUCTURE IS, NOT WHEN A NUMBER IS HIT.`,
    `HARD EXIT ${(2 * (atr ?? 0)).toFixed(2)} (TWO ATR) ${d} ENTRY. AFTER TWO ATR THE MOVE IS NO LONGER THE SETUP YOU TOOK.`,
    "TIME STOP: IF IT HAS NOT MOVED 0.5 ATR IN YOUR DIRECTION WITHIN 5 SESSIONS, CLOSE IT. UNEXPLAINED NON-MOVEMENT MEANS THE LEVEL IS WRONG, NOT THAT THE THESIS NEEDS MORE TIME.",
    "IF THE NEXT SESSION GAPS THROUGH YOUR STOP, EXIT AT THE OPEN. DO NOT AVERAGE DOWN INTO A GAP.",
  ];
}

function fadeProfitRules(mid: number, atr: number | null, side: 1 | -1): string[] {
  return [
    `TAKE THE MAJORITY AT ${mid} — THE BAND MIDLINE. THE WHOLE THESIS IS THAT PRICE RETURNS TO THE AVERAGE, SO THE AVERAGE IS WHERE THE TRADE IS OVER.`,
    `LEAVE A THIRD ONLY IF ${(1 * (atr ?? 0)).toFixed(2)} (ONE ATR) OF ROOM REMAINS, AND TRAIL IT BEHIND THE LAST 5-DAY LOW/HIGH.`,
    "DO NOT HOLD A FADE PAST THE MIDLINE EXPECTING THE NEXT BAND. THE SECOND LEG OF A FADE IS A DIFFERENT, WEAKER TRADE WITH WORSE ODDS.",
    `TIME STOP: 5 SESSIONS. A MEAN REVERSION THAT HAS NOT REVERTED IS no longer a reversion, it is a new trend, and you are on the wrong side of it.`,
    "SCALE OUT ONCE. IF IT WORKS, taking half still pays. If you are waiting for the full position to come home, you have converted a trade into a hope.",
  ];
}
