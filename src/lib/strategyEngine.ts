// Advanced options strategy engine — TypeScript port of StrategyEngine /
// MarketBiasDetector / StrategyLeg / StrategyResult from special.py
// (OptionsChainOracle 15-strategy payoff engine, top-3 + scoring).
//
// Uses Black-Scholes theoretical premiums (no live chain for single-name
// equities) so every strategy is priced consistently from current HV/IV.

import { blackScholes } from "./options";
import type { Greeks, OptionSide } from "./types";

export type LegAction = "buy" | "sell";

export interface StrategyLeg {
  optionType: OptionSide;
  strike: number;
  action: LegAction;
  qty: number;
  premium: number;
  delta: number;
  greeks: Greeks | null;
}

export interface PayoffAnalysis {
  maxProfit: number;
  maxLoss: number;
  maxProfitUnlimited: boolean;
  maxLossUnlimited: boolean;
  breakevens: number[];
  probProfit: number;
  riskReward: number;
  xs: number[];
  pnls: number[];
}

export interface MarketBias {
  biasScore: number; // -100..100
  ivPct: number;
  ivRegime: "Low" | "Normal" | "Elevated" | "Extreme";
  momentum5dPct: number;
  priceVsMA20Pct: number;
  priceVsMA50Pct: number;
  volExpanding: boolean;
  trendLabel: string;
  approach: string;
  trendBias01: number; // -1..1 EMA9/21+SMA50 score
  rsi: number | null;
  macdHist: number | null;
  adx: number | null;
  hurst: number | null;
}

export interface StrategyResult {
  name: string;
  category: "Debit" | "Credit" | "Volatility" | "Neutral";
  description: string;
  legs: StrategyLeg[];
  biasSuitedFor: string;
  maxProfit: number;
  maxLoss: number;
  maxProfitUnlimited: boolean;
  maxLossUnlimited: boolean;
  breakevens: number[];
  netPremium: number; // +debit / -credit per share
  probProfit: number;
  riskReward: number;
  score: number;
  scoreReasons: string[];
  scoreWarnings: string[];
  xs: number[];
  pnls: number[];
}

export const RISK_FREE = 0.065;
const SCAN_WIDTH = 0.3;
const SCAN_POINTS = 200;

export function stepForSpot(spot: number): number {
  if (spot > 1000) return 10;
  if (spot > 200) return 5;
  return 1;
}

export function roundToStep(v: number, step: number): number {
  return Math.round(v / step) * step;
}

function legPayoff(leg: StrategyLeg, spotT: number): number {
  const intrinsic =
    leg.optionType === "CALL" ? Math.max(spotT - leg.strike, 0) : Math.max(leg.strike - spotT, 0);
  const perUnit = leg.action === "buy" ? intrinsic - leg.premium : leg.premium - intrinsic;
  return perUnit * leg.qty;
}

export function analysePayoff(legs: StrategyLeg[], spot: number): PayoffAnalysis {
  const lo = spot * (1 - SCAN_WIDTH);
  const hi = spot * (1 + SCAN_WIDTH);
  const xs: number[] = [];
  const pnls: number[] = [];
  for (let i = 0; i < SCAN_POINTS; i++) {
    const s = lo + ((hi - lo) * i) / (SCAN_POINTS - 1);
    xs.push(s);
    let p = 0;
    for (const leg of legs) p += legPayoff(leg, s);
    pnls.push(p);
  }
  let maxP = Math.max(...pnls);
  let maxL = Math.min(...pnls);
  // Detect unlimited tails: payoff still rising at scan edge
  const edgeN = 8;
  const headSlope = pnls[edgeN] - pnls[0];
  const tailSlope = pnls[pnls.length - 1] - pnls[pnls.length - 1 - edgeN];
  const maxProfitUnlimited = tailSlope > Math.abs(maxP - Math.min(...pnls)) * 0.02 && tailSlope > 0 && maxP === pnls[pnls.length - 1];
  const headSlopeNeg = headSlope < -Math.abs(maxP - Math.min(...pnls)) * 0.02 && headSlope < 0 && maxL === pnls[0];
  const maxLossUnlimited = headSlopeNeg || (headSlope < 0 && pnls[0] <= maxL + 1e-9 && Math.abs(headSlope) > Math.abs(maxP - maxL) * 0.02);
  const bes: number[] = [];
  for (let i = 0; i < pnls.length - 1; i++) {
    if (pnls[i] * pnls[i + 1] <= 0 && pnls[i] !== pnls[i + 1]) {
      const frac = -pnls[i] / (pnls[i + 1] - pnls[i]);
      const be = xs[i] + frac * (xs[i + 1] - xs[i]);
      if (be > lo && be < hi) bes.push(Math.round(be * 100) / 100);
    }
  }
  const merged: number[] = [];
  for (const be of bes.sort((a, b) => a - b)) {
    if (!merged.length || Math.abs(be - merged[merged.length - 1]) > spot * 0.002) merged.push(be);
  }
  const pop = pnls.filter((p) => p > 0).length / pnls.length;
  const rr = maxL < 0 ? Math.abs(maxP) / Math.max(Math.abs(maxL), 0.01) : Infinity;
  return {
    maxProfit: maxP,
    maxLoss: maxL,
    maxProfitUnlimited,
    maxLossUnlimited,
    breakevens: merged,
    probProfit: pop,
    riskReward: rr,
    xs,
    pnls,
  };
}

export function detectBias(args: {
  closes: number[];
  hv10: number;
  hv30: number;
  hv252: number;
  trendBias01: number;
  rsi: number | null;
  macdHist: number | null;
  adx: number | null;
  hurst: number | null;
  ivOverridePct?: number | null;
}): MarketBias {
  const { closes, hv10, hv30, hv252, trendBias01, rsi, macdHist, adx, hurst, ivOverridePct } = args;
  const spot = closes[closes.length - 1];
  const sma = (n: number) =>
    closes.length >= n ? closes.slice(-n).reduce((a, b) => a + b, 0) / n : NaN;
  const ma20 = sma(20);
  const ma50 = sma(50);
  const pctMA20 = isFinite(ma20) && ma20 ? ((spot - ma20) / ma20) * 100 : 0;
  const pctMA50 = isFinite(ma50) && ma50 ? ((spot - ma50) / ma50) * 100 : 0;
  const mom5d =
    closes.length >= 6 ? ((spot - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : 0;
  // vol expanding: recent 10d realised vs prior 20d
  let volExpanding = hv10 > hv30 * 1.15;
  try {
    if (closes.length >= 31) {
      const lr = (a: number[]) => {
        const out: number[] = [];
        for (let i = 1; i < a.length; i++) out.push(Math.log(a[i] / a[i - 1]));
        return out;
      };
      const sd = (x: number[]) => {
        const m = x.reduce((s, v) => s + v, 0) / Math.max(x.length, 1);
        return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(x.length - 1, 1));
      };
      const rvRec = sd(lr(closes.slice(-11))) * Math.sqrt(252) * 100;
      const rvOld = sd(lr(closes.slice(-31, -11))) * Math.sqrt(252) * 100;
      volExpanding = rvRec > rvOld * 1.15;
    }
  } catch {
    /* keep hv proxy */
  }
  const ivPct =
    ivOverridePct && ivOverridePct > 0 ? ivOverridePct : Math.max(hv30 * 100, hv252 * 100 * 0.9, 5);
  const ivRegime: MarketBias["ivRegime"] =
    ivPct < 20 ? "Low" : ivPct < 35 ? "Normal" : ivPct < 50 ? "Elevated" : "Extreme";

  // Composite bias: MA distance + momentum + trend score + RSI/MACD tilt (mirrors python raw)
  let raw = pctMA20 * 2.5 + pctMA50 * 1.5 + mom5d * 4.0 + trendBias01 * 25;
  if (rsi !== null && isFinite(rsi)) {
    if (rsi > 60) raw += (rsi - 60) * 1.2;
    else if (rsi < 40) raw -= (40 - rsi) * 1.2;
  }
  if (macdHist !== null && isFinite(macdHist) && spot) {
    const mh = (macdHist / spot) * 1000;
    raw += Math.max(-15, Math.min(15, mh * 8));
  }
  const bias = Math.max(-100, Math.min(100, raw));
  let label =
    bias > 55 ? "Strong Bullish" : bias > 20 ? "Mild Bullish" : bias > -20 ? "Neutral / Range-bound" : bias > -55 ? "Mild Bearish" : "Strong Bearish";
  if (volExpanding && ivPct > 25) label += " (Volatility Expanding)";
  const approach =
    ivRegime === "Low"
      ? "Buy Premium — options are cheap; directional buyers favoured"
      : ivRegime === "Normal"
        ? "Spreads — balanced premium environment; limit directional cost"
        : "Sell Premium / Spreads — high IV makes buying expensive";
  void hv252;
  void adx;
  void hurst;
  return {
    biasScore: Math.round(bias * 10) / 10,
    ivPct: Math.round(ivPct * 100) / 100,
    ivRegime,
    momentum5dPct: Math.round(mom5d * 100) / 100,
    priceVsMA20Pct: Math.round(pctMA20 * 100) / 100,
    priceVsMA50Pct: Math.round(pctMA50 * 100) / 100,
    volExpanding,
    trendLabel: label,
    approach,
    trendBias01,
    rsi,
    macdHist,
    adx,
    hurst,
  };
}

// ---- strike pickers (delta-based, like python _by_delta / _atm / _nearest) ----

interface Candle {
  strike: number;
  greeks: Greeks;
}

function buildChain(spot: number, T: number, r: number, sigma: number, side: OptionSide): Candle[] {
  const step = stepForSpot(spot);
  const out: Candle[] = [];
  for (let K = spot * 0.7; K <= spot * 1.3; K += step) {
    const k = roundToStep(K, step);
    const g = blackScholes(spot, k, T, r, sigma, side);
    if (g) out.push({ strike: k, greeks: g });
  }
  // de-dupe strikes
  const seen = new Map<number, Candle>();
  for (const c of out) if (!seen.has(c.strike)) seen.set(c.strike, c);
  return [...seen.values()].sort((a, b) => a.strike - b.strike);
}

function byDelta(pool: Candle[], targetAbs: number): Candle | null {
  if (!pool.length) return null;
  let best = pool[0];
  let bd = Infinity;
  for (const c of pool) {
    const d = Math.abs(Math.abs(c.greeks.delta) - targetAbs);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function nearest(pool: Candle[], target: number): Candle | null {
  if (!pool.length) return null;
  return pool.reduce((a, b) => (Math.abs(b.strike - target) < Math.abs(a.strike - target) ? b : a));
}

// ---- scoring (port of StrategyEngine._score) ----

function scoreStrategy(
  base: number,
  bias: MarketBias,
  pa: PayoffAnalysis,
  netPremium: number,
  spot: number,
  dte: number,
  ivGoodLow: boolean,
  ivGoodHigh: boolean
): { score: number; reasons: string[]; warnings: string[] } {
  let score = base;
  const rsns: string[] = [];
  const warns: string[] = [];
  if (ivGoodLow && bias.ivRegime === "Low") {
    score += 15;
    rsns.push(`IV ${bias.ivPct.toFixed(1)}% (Low) — cheap premium suits buying`);
  } else if (ivGoodHigh && (bias.ivRegime === "Elevated" || bias.ivRegime === "Extreme")) {
    score += 15;
    rsns.push(`IV ${bias.ivPct.toFixed(1)}% (${bias.ivRegime}) — rich premium suits selling`);
  } else if (ivGoodLow && (bias.ivRegime === "Elevated" || bias.ivRegime === "Extreme")) {
    score -= 20;
    warns.push(`IV ${bias.ivPct.toFixed(1)}% (${bias.ivRegime}) — expensive for buyers, prefer spreads`);
  } else if (ivGoodHigh && bias.ivRegime === "Low") {
    score -= 15;
    warns.push(`IV ${bias.ivPct.toFixed(1)}% (Low) — thin premium for sellers`);
  }
  const rr = pa.riskReward;
  if (rr !== Infinity && rr > 2) {
    score += 10;
    rsns.push(`Favourable R/R ${rr.toFixed(1)}:1`);
  } else if (rr < 0.5) {
    score -= 10;
    warns.push(`Poor R/R ${rr.toFixed(1)}:1`);
  }
  if (pa.probProfit >= 0.65) {
    score += 10;
    rsns.push(`High P(profit) ≈ ${(pa.probProfit * 100).toFixed(0)}% of price range`);
  } else if (pa.probProfit < 0.4) {
    score -= 10;
    warns.push(`Low P(profit) ≈ ${(pa.probProfit * 100).toFixed(0)}% of price range`);
  }
  if (dte < 7) {
    score -= 20;
    warns.push(`< 7 DTE — gamma trap; theta decimates premium daily`);
  } else if (dte < 14) {
    score -= 10;
    warns.push(`${dte.toFixed(0)} DTE — accelerating decay, need quick move`);
  } else if (dte >= 30) {
    score += 5;
    rsns.push(`${dte.toFixed(0)} DTE — adequate time for thesis`);
  }
  if (pa.breakevens.length) {
    const nb = Math.min(...pa.breakevens.map((be) => (Math.abs(be - spot) / spot) * 100));
    if (nb > 10) {
      score -= 15;
      warns.push(`Breakeven needs ${nb.toFixed(1)}% spot move`);
    } else if (nb < 3) {
      score += 8;
      rsns.push(`Tight breakeven only ${nb.toFixed(1)}% from spot`);
    }
  }
  const pctOfSpot = (Math.abs(netPremium) / spot) * 100;
  if (pctOfSpot > 5) {
    score -= 10;
    warns.push(`High premium cost ${pctOfSpot.toFixed(1)}% of spot`);
  } else if (pctOfSpot < 1.5 && netPremium > 0) {
    score += 5;
    rsns.push(`Low debit ${pctOfSpot.toFixed(1)}% of spot`);
  }
  return { score: Math.max(0, Math.min(100, score)), reasons: rsns, warnings: warns };
}

function mkLeg(c: Candle, side: OptionSide, action: LegAction, qty = 1): StrategyLeg {
  return {
    optionType: side,
    strike: c.strike,
    action,
    qty,
    premium: c.greeks.price,
    delta: c.greeks.delta,
    greeks: c.greeks,
  };
}

function toResult(args: {
  name: string;
  category: StrategyResult["category"];
  description: string;
  biasSuitedFor: string;
  legs: StrategyLeg[];
  netPremium: number;
  base: number;
  bias: MarketBias;
  spot: number;
  dte: number;
  ivGoodLow: boolean;
  ivGoodHigh: boolean;
  leadReason: string;
  unlimitedProfit?: boolean;
  unlimitedLoss?: boolean;
}): StrategyResult {
  const pa = analysePayoff(args.legs, args.spot);
  const s = scoreStrategy(args.base, args.bias, pa, args.netPremium, args.spot, args.dte, args.ivGoodLow, args.ivGoodHigh);
  return {
    name: args.name,
    category: args.category,
    description: args.description,
    legs: args.legs,
    biasSuitedFor: args.biasSuitedFor,
    maxProfit: pa.maxProfit,
    maxLoss: pa.maxLoss,
    maxProfitUnlimited: !!args.unlimitedProfit || pa.maxProfitUnlimited,
    maxLossUnlimited: !!args.unlimitedLoss,
    breakevens: pa.breakevens,
    netPremium: args.netPremium,
    probProfit: pa.probProfit,
    riskReward: pa.riskReward,
    score: s.score,
    scoreReasons: [args.leadReason, ...s.reasons],
    scoreWarnings: s.warnings,
    xs: pa.xs,
    pnls: pa.pnls,
  };
}

export function buildAllStrategies(args: {
  spot: number;
  sigma: number;
  dte: number;
  bias: MarketBias;
  r?: number;
}): StrategyResult[] {
  const { spot, sigma, dte, bias } = args;
  const r = args.r ?? RISK_FREE;
  const T = Math.max(dte, 1) / 365;
  const calls = buildChain(spot, T, r, sigma, "CALL");
  const puts = buildChain(spot, T, r, sigma, "PUT");
  const out: StrategyResult[] = [];
  const push = (x: StrategyResult | null) => {
    if (x) out.push(x);
  };

  // Long Call (Δ~0.45)
  {
    const c = byDelta(calls, 0.45);
    if (c) {
      const legs = [mkLeg(c, "CALL", "buy")];
      const base = bias.trendLabel.includes("Bullish") ? 75 : bias.trendLabel.includes("Bear") ? 45 : 55;
      push(
        toResult({
          name: "Long Call", category: "Debit", biasSuitedFor: "Bullish",
          description: `Buy ${fmtK(c.strike)} CE. Profit if spot rallies past breakeven. Loss capped at premium.`,
          legs, netPremium: c.greeks.price, base, bias, spot, dte,
          ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Simple directional bet — max loss capped at premium paid",
          unlimitedProfit: true,
        })
      );
    }
  }
  // Long Put
  {
    const p = byDelta(puts, 0.45);
    if (p) {
      const legs = [mkLeg(p, "PUT", "buy")];
      const base = bias.trendLabel.includes("Bear") ? 75 : bias.trendLabel.includes("Bull") ? 45 : 55;
      push(
        toResult({
          name: "Long Put", category: "Debit", biasSuitedFor: "Bearish",
          description: `Buy ${fmtK(p.strike)} PE. Profit if spot falls past breakeven. Loss capped at premium.`,
          legs, netPremium: p.greeks.price, base, bias, spot, dte,
          ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Simple directional hedge — profits if stock falls sharply",
        })
      );
    }
  }
  // Bull Call Spread (Δ0.50 / Δ0.25)
  {
    const lo = byDelta(calls, 0.5);
    const hi = byDelta(calls, 0.25);
    if (lo && hi && lo.strike < hi.strike) {
      const net = lo.greeks.price - hi.greeks.price;
      push(
        toResult({
          name: "Bull Call Spread", category: "Debit", biasSuitedFor: "Mild Bullish",
          description: `Buy ${fmtK(lo.strike)} CE, Sell ${fmtK(hi.strike)} CE. Profit between strikes, capped upside.`,
          legs: [mkLeg(lo, "CALL", "buy"), mkLeg(hi, "CALL", "sell")],
          netPremium: net,
          base: bias.trendLabel.includes("Bullish") ? 80 : bias.trendLabel.includes("Bear") ? 40 : 55,
          bias, spot, dte, ivGoodLow: true, ivGoodHigh: false,
          leadReason: `Capped upside but ~${Math.max(hi.strike - lo.strike - net, 0).toFixed(0)} lower breakeven cost vs outright call`,
        })
      );
    }
  }
  // Bear Put Spread
  {
    const hi = byDelta(puts, 0.5);
    const lo = byDelta(puts, 0.25);
    if (hi && lo && hi.strike > lo.strike) {
      const net = hi.greeks.price - lo.greeks.price;
      push(
        toResult({
          name: "Bear Put Spread", category: "Debit", biasSuitedFor: "Mild Bearish",
          description: `Buy ${fmtK(hi.strike)} PE, Sell ${fmtK(lo.strike)} PE. Profit on controlled downside.`,
          legs: [mkLeg(hi, "PUT", "buy"), mkLeg(lo, "PUT", "sell")],
          netPremium: net,
          base: bias.trendLabel.includes("Bear") ? 80 : bias.trendLabel.includes("Bull") ? 40 : 55,
          bias, spot, dte, ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Defined-risk bearish — cheaper than outright put, capped payoff",
        })
      );
    }
  }
  // Bull Put Spread (credit)
  {
    const sh = byDelta(puts, 0.4);
    const lg = byDelta(puts, 0.2);
    if (sh && lg && sh.strike > lg.strike) {
      const credit = sh.greeks.price - lg.greeks.price;
      if (credit > 0)
        push(
          toResult({
            name: "Bull Put Spread", category: "Credit", biasSuitedFor: "Mild Bullish (Income)",
            description: `Sell ${fmtK(sh.strike)} PE, Buy ${fmtK(lg.strike)} PE. Keep credit if spot holds above short strike.`,
            legs: [mkLeg(sh, "PUT", "sell"), mkLeg(lg, "PUT", "buy")],
            netPremium: -credit,
            base: bias.trendLabel.includes("Bullish") ? 75 : bias.trendLabel.includes("Bear") ? 40 : 60,
            bias, spot, dte, ivGoodLow: false, ivGoodHigh: true,
            leadReason: `Collect credit upfront — keep if spot stays above ${fmtK(sh.strike)}`,
          })
        );
    }
  }
  // Bear Call Spread (credit)
  {
    const sh = byDelta(calls, 0.4);
    const lg = byDelta(calls, 0.2);
    if (sh && lg && sh.strike < lg.strike) {
      const credit = sh.greeks.price - lg.greeks.price;
      if (credit > 0)
        push(
          toResult({
            name: "Bear Call Spread", category: "Credit", biasSuitedFor: "Mild Bearish (Income)",
            description: `Sell ${fmtK(sh.strike)} CE, Buy ${fmtK(lg.strike)} CE. Profit if market stays flat/down.`,
            legs: [mkLeg(sh, "CALL", "sell"), mkLeg(lg, "CALL", "buy")],
            netPremium: -credit,
            base: bias.trendLabel.includes("Bear") ? 75 : bias.trendLabel.includes("Bull") ? 40 : 55,
            bias, spot, dte, ivGoodLow: false, ivGoodHigh: true,
            leadReason: `Collect credit — keep if spot stays below ${fmtK(sh.strike)}`,
          })
        );
    }
  }
  // Long Straddle (ATM)
  {
    const c = nearest(calls, spot);
    const p = nearest(puts, spot);
    if (c && p) {
      const net = c.greeks.price + p.greeks.price;
      const base =
        bias.volExpanding || bias.ivRegime === "Low" ? 80 : bias.trendLabel.includes("Neutral") && !bias.volExpanding ? 35 : 45;
      const res = toResult({
        name: "Long Straddle", category: "Volatility", biasSuitedFor: "Volatile / Breakout",
        description: `Buy ${fmtK(c.strike)} CE + PE. Profits on big move either direction.`,
        legs: [mkLeg(c, "CALL", "buy"), mkLeg(p, "PUT", "buy")],
        netPremium: net, base, bias, spot, dte,
        ivGoodLow: true, ivGoodHigh: false,
        leadReason: "Direction-agnostic — profits from BIG move either way",
        unlimitedProfit: true,
      });
      if (bias.ivRegime === "Elevated" || bias.ivRegime === "Extreme")
        res.scoreWarnings.unshift(`HIGH IV ${bias.ivPct.toFixed(1)}% — crush risk can erode both legs`);
      push(res);
    }
  }
  // Long Strangle (Δ0.30)
  {
    const c = byDelta(calls, 0.3);
    const p = byDelta(puts, 0.3);
    if (c && p) {
      const net = c.greeks.price + p.greeks.price;
      const base = bias.volExpanding ? 70 : bias.ivRegime === "Low" ? 55 : 35;
      push(
        toResult({
          name: "Long Strangle", category: "Volatility", biasSuitedFor: "High Volatility Expected",
          description: `Buy OTM ${fmtK(c.strike)} CE + ${fmtK(p.strike)} PE. Cheaper than straddle, needs bigger move.`,
          legs: [mkLeg(c, "CALL", "buy"), mkLeg(p, "PUT", "buy")],
          netPremium: net, base, bias, spot, dte,
          ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Lower cost than straddle — max loss smaller, needs larger move",
          unlimitedProfit: true,
        })
      );
    }
  }
  // Short Straddle
  {
    const c = nearest(calls, spot);
    const p = nearest(puts, spot);
    if (c && p) {
      const credit = c.greeks.price + p.greeks.price;
      const base = bias.trendLabel.includes("Neutral") && (bias.ivRegime === "Elevated" || bias.ivRegime === "Extreme") ? 75 : 30;
      const res = toResult({
        name: "Short Straddle", category: "Credit", biasSuitedFor: "Range-bound / High IV",
        description: `Sell ${fmtK(c.strike)} CE + PE. Profit from decay if spot pins. UNLIMITED RISK.`,
        legs: [mkLeg(c, "CALL", "sell"), mkLeg(p, "PUT", "sell")],
        netPremium: -credit, base, bias, spot, dte,
        ivGoodLow: false, ivGoodHigh: true,
        leadReason: `Collect premium — keep all if spot pins at ${fmtK(c.strike)}`,
        unlimitedLoss: true,
      });
      res.scoreWarnings.push("UNLIMITED LOSS on large move — hedge or avoid");
      push(res);
    }
  }
  // Short Strangle
  {
    const c = byDelta(calls, 0.25);
    const p = byDelta(puts, 0.25);
    if (c && p) {
      const credit = c.greeks.price + p.greeks.price;
      const base = bias.trendLabel.includes("Neutral") && (bias.ivRegime === "Elevated" || bias.ivRegime === "Extreme") ? 72 : 30;
      const res = toResult({
        name: "Short Strangle", category: "Credit", biasSuitedFor: "Range-bound / Extreme IV",
        description: `Sell OTM ${fmtK(c.strike)} CE + ${fmtK(p.strike)} PE. Wider profit zone than short straddle.`,
        legs: [mkLeg(c, "CALL", "sell"), mkLeg(p, "PUT", "sell")],
        netPremium: -credit, base, bias, spot, dte,
        ivGoodLow: false, ivGoodHigh: true,
        leadReason: "Wider profit zone — profit if spot stays between shorts",
        unlimitedLoss: true,
      });
      res.scoreWarnings.push("UNLIMITED LOSS beyond shorts — use only hedged");
      push(res);
    }
  }
  // Long Butterfly (Δ0.35 / ATM / Δ0.20 calls)
  {
    const lo = byDelta(calls, 0.35);
    const mid = nearest(calls, spot);
    const hi = byDelta(calls, 0.2);
    if (lo && mid && hi && lo.strike < mid.strike && mid.strike < hi.strike) {
      const net = lo.greeks.price + hi.greeks.price - 2 * mid.greeks.price;
      if (net > 0)
        push(
          toResult({
            name: "Long Butterfly", category: "Neutral", biasSuitedFor: "Pin at ATM",
            description: `Buy ${fmtK(lo.strike)} + ${fmtK(hi.strike)} CE, Sell 2× ${fmtK(mid.strike)} CE. Max profit at middle.`,
            legs: [mkLeg(lo, "CALL", "buy"), mkLeg(mid, "CALL", "sell", 2), mkLeg(hi, "CALL", "buy")],
            netPremium: net,
            base: bias.trendLabel.includes("Neutral") ? 82 : 40,
            bias, spot, dte, ivGoodLow: false, ivGoodHigh: true,
            leadReason: `Best pin strategy — defined risk, max profit if pins at ${fmtK(mid.strike)}`,
          })
        );
    }
  }
  // Iron Condor (Δ0.25 shorts / Δ0.15 longs)
  {
    const sc = byDelta(calls, 0.25);
    const lc = byDelta(calls, 0.15);
    const sp = byDelta(puts, 0.25);
    const lp = byDelta(puts, 0.15);
    if (sc && lc && sp && lp && sc.strike < lc.strike && sp.strike > lp.strike) {
      const credit = sc.greeks.price - lc.greeks.price + (sp.greeks.price - lp.greeks.price);
      if (credit > 0)
        push(
          toResult({
            name: "Iron Condor", category: "Credit", biasSuitedFor: "Neutral / Income",
            description: `Sell ${fmtK(sp.strike)}P + ${fmtK(sc.strike)}C, Buy ${fmtK(lp.strike)}P + ${fmtK(lc.strike)}C. Profit in range.`,
            legs: [mkLeg(lc, "CALL", "buy"), mkLeg(sc, "CALL", "sell"), mkLeg(sp, "PUT", "sell"), mkLeg(lp, "PUT", "buy")],
            netPremium: -credit,
            base: bias.trendLabel.includes("Neutral") && bias.ivRegime !== "Low" ? 85 : 40,
            bias, spot, dte, ivGoodLow: false, ivGoodHigh: true,
            leadReason: `4-leg income — profit while spot stays ${fmtK(sp.strike)}–${fmtK(sc.strike)}`,
          })
        );
    }
  }
  // Jade Lizard (short put spread + short call): bullish income, no upside risk
  {
    const shP = byDelta(puts, 0.35);
    const lgP = byDelta(puts, 0.2);
    const shC = byDelta(calls, 0.2);
    if (shP && lgP && shC && shP.strike > lgP.strike && shC.strike > spot) {
      const credit = shP.greeks.price - lgP.greeks.price + shC.greeks.price;
      if (credit > 0)
        push(
          toResult({
            name: "Jade Lizard", category: "Credit", biasSuitedFor: "Mild Bullish (Income)",
            description: `Sell ${fmtK(shP.strike)}P + ${fmtK(shC.strike)}C, Buy ${fmtK(lgP.strike)}P. No upside risk, cushioned downside.`,
            legs: [mkLeg(shP, "PUT", "sell"), mkLeg(lgP, "PUT", "buy"), mkLeg(shC, "CALL", "sell")],
            netPremium: -credit,
            base: bias.trendLabel.includes("Bullish") ? 78 : bias.trendLabel.includes("Neutral") ? 62 : 42,
            bias, spot, dte, ivGoodLow: false, ivGoodHigh: true,
            leadReason: "Skew-harvest income — no risk above short call",
          })
        );
    }
  }
  // Call Backspread (sell Δ0.55 ×1, buy Δ0.30 ×2)
  {
    const sh = byDelta(calls, 0.55);
    const lg = byDelta(calls, 0.3);
    if (sh && lg && sh.strike < lg.strike) {
      const net = 2 * lg.greeks.price - sh.greeks.price;
      push(
        toResult({
          name: "Call Backspread", category: "Volatility", biasSuitedFor: "Strong Bullish / Explosion",
          description: `Sell 1× ${fmtK(sh.strike)} CE, Buy 2× ${fmtK(lg.strike)} CE. Accelerating upside.`,
          legs: [mkLeg(sh, "CALL", "sell"), mkLeg(lg, "CALL", "buy", 2)],
          netPremium: net,
          base: bias.trendLabel.includes("Bullish") && (bias.ivRegime === "Low" || bias.ivRegime === "Normal") ? 70 : 40,
          bias, spot, dte, ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Explosive upside — gains accelerate beyond long strike",
          unlimitedProfit: true,
        })
      );
    }
  }
  // Put Backspread
  {
    const sh = byDelta(puts, 0.55);
    const lg = byDelta(puts, 0.3);
    if (sh && lg && sh.strike > lg.strike) {
      const net = 2 * lg.greeks.price - sh.greeks.price;
      push(
        toResult({
          name: "Put Backspread", category: "Volatility", biasSuitedFor: "Strong Bearish / Crash",
          description: `Sell 1× ${fmtK(sh.strike)} PE, Buy 2× ${fmtK(lg.strike)} PE. Crash profits, defined near-risk.`,
          legs: [mkLeg(sh, "PUT", "sell"), mkLeg(lg, "PUT", "buy", 2)],
          netPremium: net,
          base: bias.trendLabel.includes("Bear") && (bias.ivRegime === "Low" || bias.ivRegime === "Normal") ? 70 : 40,
          bias, spot, dte, ivGoodLow: true, ivGoodHigh: false,
          leadReason: "Explosive downside — gains accelerate on crash",
          unlimitedProfit: true,
        })
      );
    }
  }

  out.sort((a, b) => b.score - a.score);
  out.slice(0, 3).forEach((r) => r.scoreReasons.unshift("★ TOP-3 FOR CURRENT REGIME"));
  return out;
}

function fmtK(v: number): string {
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

export function pnlAt(result: StrategyResult, spotT: number): number {
  let p = 0;
  for (const leg of result.legs) {
    const intrinsic =
      leg.optionType === "CALL" ? Math.max(spotT - leg.strike, 0) : Math.max(leg.strike - spotT, 0);
    p += (leg.action === "buy" ? intrinsic - leg.premium : leg.premium - intrinsic) * leg.qty;
  }
  return p;
}
