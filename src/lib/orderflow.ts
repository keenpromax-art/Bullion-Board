// Intraday trade plan for the Order Flow desk (module 8).
//
// WHAT THIS IS: a mechanical reading of one session's structure that names the
// levels a trader would act on — where to enter, where to take profit, where the
// idea is wrong. Every number below is derived from the desk's own primitives, so
// every line can be checked against the tape rather than taken on faith.
//
// WHAT THIS IS NOT, and the desk says so on screen:
//
//   - It is NOT a validated signal system. No rule here has been backtested,
//     because the inputs cannot be: the levels are computed from TODAY's range,
//     so they move as the day moves, and there is no history of "what the desk
//     would have said this morning" to score against. Treat it as a decision
//     checklist, not an edge.
//   - The delta it reads is a CLV proxy derived from 5-minute OHLCV, not
//     exchange aggressor-side flow. Absorption and divergence built on it are
//     suggestive, never proof.
//   - It is intraday only. Nothing survives past the close.
//
// The design rule throughout: prefer a level the tape actually printed to a
// number invented by a formula. POC, the value-area edges, VWAP and the opening
// range are all prices the market traded. A "target" that no print made is a
// guess wearing a decimal point.

/** Everything the plan needs, all already computed by the desk. */
export interface SessionRead {
  last: number;
  open: number;
  hi: number;
  lo: number;
  /** Session VWAP at the last print. */
  vwap: number;
  /** Rolling per-print dispersion used for the ±1σ bands. */
  sigma: number;
  /** Point of control — heaviest traded level. */
  poc: number;
  /** 70% value-area edges. */
  val: number;
  vah: number;
  /** Initial balance (first hour) high/low. */
  ibHigh: number;
  ibLow: number;
  /** Mean range of the recent prints — the session's own volatility unit. */
  atrPrint: number;
  /** 0-100, where last sits inside the day range. */
  rangePos: number;
  /** Cumulative signed flow (CLV proxy) at the last print. */
  cumDelta: number;
  /** Cumulative signed flow at the print that made the session extreme. */
  cumDeltaAtExtreme: number;
  /** True when the extreme is a session HIGH (false = session low). */
  extremeIsHigh: boolean;
  /** last-3 minus prior-3 flow: acceleration, positive = building. */
  deltaVel: number;
  absCount: number;
  swpCount: number;
  /** POC migration, H1 to H2, in percent. */
  pocMigPct: number;
  /** (buyVol - sellVol) / totalVol, -1..1. */
  netFlowRatio: number;
}

export type Regime =
  | "EXTENDED"
  | "TREND-UP"
  | "TREND-DOWN"
  | "REVERSION-UP"
  | "REVERSION-DOWN"
  | "BALANCE";

export interface PlanLevel {
  px: number;
  /** Reward:risk from the reference entry. Negative once past the stop. */
  rr: number | null;
  note: string;
}

export interface TradePlan {
  regime: Regime;
  /** +1 long, -1 short, 0 no trade. */
  side: 0 | 1 | -1;
  /** One line, terminal voice. */
  headline: string;
  /** The price or condition that starts the position. */
  entry: PlanLevel | null;
  entryText: string;
  /** Profit-taking ladder, nearest first. */
  targets: PlanLevel[];
  stop: PlanLevel | null;
  /** Explicit statement of what proves the idea wrong. */
  invalidation: string;
  /** When to bank, in conditions rather than adjectives. */
  profitRules: string[];
  /** Tape evidence for the read. */
  confluence: string[];
  /** Tape evidence against it. */
  against: string[];
  /**
   * True when price is at a session extreme but cumulative flow is not — the
   * single most actionable condition on this desk, because it is the one that
   * says "the move is being absorbed" rather than "the move is happening".
   */
  flowDivergence: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Reward:risk per unit risk. Guards the degenerate zero-range case. */
function rr(entry: number, level: number, stop: number, side: 1 | -1): number | null {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const reward = side === 1 ? level - entry : entry - level;
  return round2(reward / risk);
}

/**
 * Classify the session and build the plan.
 *
 * Order matters: the most dangerous condition is checked first. A spread already
 * stretched beyond the stop is not a trend to join, whatever the flow says, so
 * EXTENDED outranks TREND.
 */
export function buildPlan(r: SessionRead): TradePlan {
  const { last, vwap, sigma, atrPrint } = r;
  const upVwap = last >= vwap;
  const devSd = sigma > 0 ? (last - vwap) / sigma : 0;
  const stopLine = vwap + 3 * sigma;

  // Price at an extreme while flow is not = absorption, not continuation.
  //
  // Both sides of this comparison are cumulative delta. An earlier version
  // subtracted `last` (a price, ~100) from `cumDeltaAtExtreme` (a signed volume,
  // ~1e6), which is true for every session that has ever traded — it flagged
  // divergence unconditionally.
  const atHigh = r.extremeIsHigh ? last >= r.hi - 1e-9 : last <= r.lo + 1e-9;
  // At a new high, a LOWER cumulative delta than at the print that made the high
  // means the push happened on less flow. At a new low, a HIGHER delta than at
  // the low means the drop happened on less selling.
  const extDiv = atHigh
    ? r.cumDelta < r.cumDeltaAtExtreme
    : r.cumDelta > r.cumDeltaAtExtreme;
  const flowDivergence = atHigh && extDiv;

  const confluence: string[] = [];
  const against: string[] = [];

  if (upVwap) confluence.push(`LAST ${last >= r.poc ? "ABOVE" : "BELOW"} BOTH VWAP ${round2(vwap)} AND POC ${round2(r.poc)} — BUYERS OWN THE AVERAGE PRICE`);
  else against.push(`LAST IS BELOW VWAP ${round2(vwap)} — THE AVERAGE BUYER OF TODAY IS UNDER WATER`);
  if (r.rangePos >= 60) confluence.push(`PRICE HOLDS THE TOP ${(100 - r.rangePos).toFixed(0)}% OF THE DAY RANGE (${r.rangePos.toFixed(0)}%)`);
  if (r.rangePos <= 40) against.push(`PRICE SITS IN THE BOTTOM ${(100 - r.rangePos).toFixed(0)}% OF THE RANGE (${r.rangePos.toFixed(0)}%)`);
  if (r.netFlowRatio > 0.08) confluence.push(`NET BUYING IS ${(r.netFlowRatio * 100).toFixed(0)}% OF VOLUME`);
  if (r.netFlowRatio < -0.08) against.push(`NET SELLING IS ${(Math.abs(r.netFlowRatio) * 100).toFixed(0)}% OF VOLUME`);
  if (r.deltaVel > 0 && r.netFlowRatio > 0) confluence.push("FLOW IS ACCELERATING INTO THE CLOSE OF THE SESSION");
  if (r.deltaVel < 0 && r.netFlowRatio > 0) against.push("FLOW HAS STARTED TO COOL WHILE PRICE IS STILL UP — THE MOVE IS LOSING FUEL");
  if (Math.abs(r.pocMigPct) > 0.05) {
    const dir = r.pocMigPct > 0 ? "HIGHER" : "LOWER";
    confluence.push(`POC HAS MIGRATED ${dir} (${r.pocMigPct >= 0 ? "+" : ""}${r.pocMigPct.toFixed(2)}%) — CONTROL IS MOVING WITH PRICE`);
  }
  if (r.absCount >= 3) confluence.push(`${r.absCount} ABSORPTION PRINTS — HEAVY VOLUME, TINY RANGE, SIDE WONNING`);
  if (flowDivergence) against.push("FLOW DIVERGENCE: PRICE IS AT THE SESSION EXTREME BUT CUMULATIVE Δ IS NOT MAKING A NEW EXTREME — THE MOVE IS BEING SOLD INTO");
  if (r.swpCount >= 2) against.push(`${r.swpCount} SWEEP PRINTS — VIOLENT TWO-WAY EXPANSION USUALLY ENDS THE MOVE, NOT EXTENDS IT`);

  // ---------------------------------------------------------- regime choice
  const stretched = Math.abs(devSd) >= 2.5 && sigma > 0;
  if (stretched && devSd >= 0) {
    return {
      regime: "EXTENDED",
      side: -1,
      headline: "STRETCHED ABOVE VWAP — DO NOT BUY UP HERE",
      entry: null,
      entryText: `NO ENTRY UNTIL PRICE COMES BACK. ${Math.abs(devSd).toFixed(1)}σ ABOVE VWAP IS WHERE THE REVERT STARTS, NOT WHERE IT ENDS.`,
      targets: [
        { px: round2(vwap), rr: null, note: "FIRST OBJECTIVE — VWAP" },
        { px: round2(r.poc), rr: null, note: "SECOND — POC" },
      ],
      stop: { px: round2(stopLine), rr: null, note: `VWAP +3σ — BEYOND THIS IT IS A NEW SESSION, NOT A FADE` },
      invalidation: "THE FADE IS WRONG IF PRICE HOLDS ABOVE VWAP FOR MORE THAN 6 PRINTS WITH CUMULATIVE Δ STILL RISING — THAT IS ACCUMULATION, NOT EXHAUSTION.",
      profitRules: profitRules(-1, "the fade", vwap, r),
      confluence,
      against,
      flowDivergence,
    };
  }
  if (stretched && devSd < 0) {
    return {
      regime: "EXTENDED",
      side: 1,
      headline: "STRETCHED BELOW VWAP — DO NOT SELL DOWN HERE",
      entry: null,
      entryText: `NO ENTRY UNTIL PRICE RECOVERS. ${Math.abs(devSd).toFixed(1)}σ BELOW VWAP IS WHERE THE SQUEEZE STARTS, NOT WHERE IT ENDS.`,
      targets: [
        { px: round2(vwap), rr: null, note: "FIRST OBJECTIVE — VWAP" },
        { px: round2(r.poc), rr: null, note: "SECOND — POC" },
      ],
      stop: { px: round2(vwap - 3 * sigma), rr: null, note: `VWAP −3σ` },
      invalidation: "THE FADE IS WRONG IF PRICE STAYS BELOW VWAP FOR MORE THAN 6 PRINTS WHILE CUMULATIVE Δ KEEPS FALLING — THAT IS DISTRIBUTION.",
      profitRules: profitRules(1, "the fade", vwap, r),
      confluence,
      against,
      flowDivergence,
    };
  }

  // Flow confirmation, not distance, is what separates continuation from
  // exhaustion.
  //
  // Distance alone cannot do it. A quiet grind higher on low per-print
  // volatility produces a large |z from VWAP while being a perfectly healthy
  // trend, and a fade rule keyed on that would refuse to buy every strong day.
  // The question that actually separates them is whether the tape is being paid
  // to move: flow confirming the direction means continuation, flow absent while
  // price stretches means the move is running on nothing.
  const FLOW_CONFIRM = 0.15;
  const flowConfirmsUp = r.netFlowRatio >= FLOW_CONFIRM;
  const flowConfirmsDown = r.netFlowRatio <= -FLOW_CONFIRM;

  // Continuation: outside the opening range, past POC, with flow paying for it.
  // Reached only when the move is not already EXTENDED, which is checked above.
  const trendUp = upVwap && last >= r.poc && last > r.ibHigh && flowConfirmsUp && r.rangePos > 55;
  const trendDown = !upVwap && last <= r.poc && last < r.ibLow && flowConfirmsDown && r.rangePos < 45;

  if (trendUp) {
    // Buy the pullback, not the extension. Structural stop sits under the IB,
    // which is a price the market actually printed.
    const entryPx = round2(Math.max(r.vwap, r.poc));
    const stopPx = round2(Math.min(r.ibLow, r.poc - atrPrint));
    return {
      regime: "TREND-UP",
      side: 1,
      headline: "UPTREND INTACT — BUY THE PULLBACK, NOT THE PRINT",
      entry: { px: entryPx, rr: null, note: "PULLBACK ZONE — VWAP AND POC ARE BOTH ABOVE THE OPENING RANGE" },
      entryText: `ENTER ON A RETRACE INTO ${entryPx}–${round2(r.poc)} THAT HOLDS. CHASING ABOVE THE LAST PRINT PAYS THE WORST PRICE IN THE MOVE.`,
      targets: [
        { px: round2(r.vah), rr: rr(entryPx, r.vah, stopPx, 1), note: "SCALE 1 — VALUE-AREA HIGH, WHERE 70% OF THE DAY'S VOLUME TRADED" },
        { px: round2(r.hi + atrPrint), rr: rr(entryPx, r.hi + atrPrint, stopPx, 1), note: "SCALE 2 — ONE ATR BEYOND THE SESSION HIGH" },
        { px: round2(r.hi + 2 * atrPrint), rr: rr(entryPx, r.hi + 2 * atrPrint, stopPx, 1), note: "RUNNER — TRAIL, DO NOT PLACE A LIMIT" },
      ],
      stop: { px: stopPx, rr: null, note: `UNDER THE OPENING RANGE AND ONE ATR BELOW POC — BOTH ARE PRICES THE TAPE PRINTED` },
      invalidation: `A CLOSE BELOW VWAP ${round2(r.vwap)} BREAKS THE STRUCTURE. A CLOSE BELOW ${round2(r.poc)} SAYS CONTROL HAS CHANGED HANDS.`,
      profitRules: profitRules(1, "the long", r.vah, r),
      confluence,
      against,
      flowDivergence,
    };
  }

  if (trendDown) {
    const entryPx = round2(Math.min(r.vwap, r.poc));
    const stopPx = round2(Math.max(r.ibHigh, r.poc + atrPrint));
    return {
      regime: "TREND-DOWN",
      side: -1,
      headline: "DOWNTREND INTACT — SELL THE RALLY, NOT THE PRINT",
      entry: { px: entryPx, rr: null, note: "RALLY ZONE — VWAP AND POC ARE BOTH BELOW THE OPENING RANGE" },
      entryText: `ENTER ON A RETRACE INTO ${round2(r.poc)}–${entryPx} THAT FAILS. CHASING BELOW THE LAST PRINT PAYS THE WORST PRICE IN THE MOVE.`,
      targets: [
        { px: round2(r.val), rr: rr(entryPx, r.val, stopPx, -1), note: "SCALE 1 — VALUE-AREA LOW, WHERE 70% OF THE DAY'S VOLUME TRADED" },
        { px: round2(r.lo - atrPrint), rr: rr(entryPx, r.lo - atrPrint, stopPx, -1), note: "SCALE 2 — ONE ATR BELOW THE SESSION LOW" },
        { px: round2(r.lo - 2 * atrPrint), rr: rr(entryPx, r.lo - 2 * atrPrint, stopPx, -1), note: "RUNNER — TRAIL, DO NOT PLACE A LIMIT" },
      ],
      stop: { px: stopPx, rr: null, note: `OVER THE OPENING RANGE AND ONE ATR ABOVE POC` },
      invalidation: `A CLOSE ABOVE VWAP ${round2(r.vwap)} BREAKS THE STRUCTURE. A CLOSE ABOVE ${round2(r.poc)} SAYS CONTROL HAS CHANGED HANDS.`,
      profitRules: profitRules(-1, "the short", r.val, r),
      confluence,
      against,
      flowDivergence,
    };
  }

  // Stretched from VWAP with flow NOT paying for the move = fade the stretch back
  // to the average. The `!flowConfirms` clauses are what keep these disjoint from
  // the trend tests above: a move with confirming flow is continuation, and only
  // a move running on nothing is a fade.
  const fadeUp = devSd <= -1.5 && !flowConfirmsDown;
  const fadeDown = devSd >= 1.5 && !flowConfirmsUp;

  if (fadeUp || fadeDown) {
    const side: 1 | -1 = fadeUp ? 1 : -1;
    const entryPx = round2(last);
    const stopPx = round2(side === 1 ? last - atrPrint : last + atrPrint);
    const vwapRr = rr(entryPx, vwap, stopPx, side);
    return {
      regime: fadeUp ? "REVERSION-UP" : "REVERSION-DOWN",
      side,
      headline: fadeUp
        ? "PRICE BELOW VWAP WITH NO SELLING BEHIND IT — FADE THE STRETCH"
        : "PRICE ABOVE VWAP WITH NO BUYING BEHIND IT — FADE THE STRETCH",
      entry: { px: entryPx, rr: null, note: "AT MARKET ONCE THE SPREAD HOLDS — FADES ARE SMALL AND QUICK" },
      entryText: `BUY ${round2(last)} / SELL ${round2(last)} IS A FADE TO VWAP ${round2(vwap)}, NOT A TREND BET. SIZE IT AS A THIRD OF A TRADE.`,
      targets: [
        { px: round2(vwap), rr: vwapRr, note: "TAKE THE WHOLE POSITION HERE — VWAP IS THE WHOLE THESIS" },
        { px: round2(r.poc), rr: rr(entryPx, r.poc, stopPx, side), note: "ONLY IF IT REACHES POC WITH FLOW STILL FLAT" },
      ],
      stop: { px: stopPx, rr: null, note: `ONE ATR FROM ENTRY (${round2(atrPrint)}) — A FADE THAT NEEDS MORE ROOM THAN ONE ATR IS NOT A FADE` },
      invalidation: "INVALID IF CUMULATIVE Δ KEEPS MAKING NEW EXTREME IN THE DIRECTION OF THE MOVE. A FADE INTO REAL FLOW IS THE FASTEST WAY TO LOSE ON A QUIET DAY.",
      profitRules: profitRules(side, "the fade", vwap, r),
      confluence,
      against,
      flowDivergence,
    };
  }

  return {
    regime: "BALANCE",
    side: 0,
    headline: "NO TRADE — PRICE IS INSIDE THE NOISE AROUND VWAP",
    entry: null,
    entryText: `NOTHING HERE WORTH SIZING. PRICE IS ${Math.abs(devSd).toFixed(1)}σ FROM VWAP, INSIDE THE OPENING RANGE, AND FLOW IS ${Math.abs(r.netFlowRatio * 100).toFixed(0)}% NET ${r.netFlowRatio >= 0 ? "BUY" : "SELL"} — NO EDGE IN EITHER DIRECTION.`,
    targets: [
      { px: round2(r.vah), rr: null, note: "IF YOU MUST WATCH ONE LEVEL — VALUE-AREA HIGH, THE FIRST PRICE THAT PROVES CONTROL" },
      { px: round2(r.val), rr: null, note: "AND ITS MIRROR, VALUE-AREA LOW" },
    ],
    stop: null,
    invalidation: "THIS READ IS WRONG IF PRICE CLOSES OUTSIDE THE OPENING RANGE ON FLOW — THAT IS THE TRIGGER TO RE-READ THE DESK, NOT A REASON TO PRE-EMPT IT.",
    profitRules: [
      "NO POSITION, NO PROFIT RULE. THE PROFITABLE MOVE HERE IS THE ONE THAT DOES NOT HAPPEN.",
      "RE-READ THE DESK WHEN PRICE CLOSES OUTSIDE THE OPENING RANGE — THAT IS THE MOMENT THE PLAN BECOMES A TRADE.",
      `STANDING REFERENCE LEVELS: VA ${round2(r.val)}–${round2(r.vah)}, IB ${round2(r.ibLow)}–${round2(r.ibHigh)}.`,
    ],
    confluence,
    against,
    flowDivergence,
  };
}

/**
 * When to bank, in conditions rather than adjectives.
 *
 * Every rule names an observable trigger. "Take profit if it works" is not a
 * rule; "take half at the value-area edge, because 70% of the day's volume
 * traded there" is.
 */
function profitRules(side: 1 | -1, what: string, firstTarget: number, r: SessionRead): string[] {
  const dir = side === 1 ? "ABOVE" : "BELOW";
  const trail = side === 1 ? r.vwap : r.vwap;
  return [
    `SCALE HALF AT ${round2(firstTarget)} — ${side === 1 ? "THE VALUE-AREA HIGH" : "THE VALUE-AREA LOW"}, WHERE 70% OF TODAY'S VOLUME TRADED AND PRICE HISTORICALLY MEETS SUPPLY.`,
    `ON THE REMAINDER, TRAIL THE STOP TO VWAP ${round2(trail)} ONCE ${what} IS ${(0.5 * r.atrPrint).toFixed(2)} (HALF AN ATR) IN PROFIT. VWAP IS THE LINE BETWEEN BEING RIGHT AND BEING TRAPPED.`,
    `TAKE THE REST IF CUMULATIVE Δ STOPS MAKING NEW ${side === 1 ? "HIGHS" : "LOWS"} WHILE PRICE DOES. THAT IS THE DIVERGENCE THIS DESK CAN ACTUALLY SEE — IT MEANS THE MOVE IS BEING ${side === 1 ? "SOLD" : "BOUGHT"} INTO.`,
    `HARD EXIT ${(2 * r.atrPrint).toFixed(2)} (TWO ATR) ${dir} ENTRY, WHENEVER IT PRINTS. AFTER TWO ATR THE MOVE IS NO LONGER THE SETUP YOU ENTERED.`,
    "TIME STOP: IF IT HAS NOT MOVED 0.5 ATR IN YOUR DIRECTION WITHIN 12 PRINTS (ONE HOUR), CLOSE IT. UNEXPLAINED NON-MOVEMENT IS THE TAPE TELLING YOU THE LEVEL IS WRONG.",
    "FLATTEN BEFORE 15:20 IST. THE CLOSING AUCTION IS A DIFFERENT MARKET WITH ITS OWN PRICING, AND NO INTRADAY EDGE SURVIVES IT.",
  ];
}
