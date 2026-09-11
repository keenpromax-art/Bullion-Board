// NSE option-chain analytics — TypeScript port of nse_core.py engine:
// Newton IV solver, chain analyse(), suggestion engine, S/R finder,
// payoff + theta-decay builders, suggestion accuracy. Pure math, no fetch.

import { blackScholes, normPdf } from "./options";

export const OC_RISK_FREE = 0.065;

export interface ChainRow {
  strike: number;
  ceOI: number; ceChgOI: number; ceVol: number; ceIV: number; ceLTP: number; ceNetChg: number;
  ceBidQty: number; ceBidPx: number; ceAskPx: number; ceAskQty: number;
  peOI: number; peChgOI: number; peVol: number; peIV: number; peLTP: number; peNetChg: number;
  peBidQty: number; peBidPx: number; peAskPx: number; peAskQty: number;
}

export interface ChainMetrics {
  cs: number; ps: number; diff: number; cb: number; pb: number;
  citm: number; pitm: number;
  mc: number; mcStrike: number; mc2: number; mc2Strike: number;
  mp: number; mpStrike: number; mp2: number; mp2Strike: number;
  pcr: number; sentiment: "Bullish" | "Bearish";
  callItm: string; putItm: string; ceExits: string; peExits: string;
  ceIV: number; peIV: number; ivSkew: number;
  totC: number; totP: number; totCV: number; totPV: number;
  vr: number; ceWIV: number; peWIV: number;
  maxPain: number; maxPainConf: number; gammaWall: number;
  ivRankCE: number; ivRankPE: number;
}

export interface Suggestion {
  action: string;
  side: "CE" | "PE" | "ATM";
  score: number;
  confidence: string;
  confPct: number;
  reasons: Array<{ dir: string; side: string; text: string }>;
}

// Newton-Raphson IV solver with bisection fallback (mirrors implied_vol_newton).
export function solveIV(price: number, S: number, K: number, T: number, r: number, isCall: boolean): number {
  if (price <= 0 || T <= 0 || S <= 0 || K <= 0) return 0;
  const model = (sigma: number) => blackScholes(S, K, Math.max(T, 1 / 365), r, sigma, isCall ? "CALL" : "PUT")?.price ?? 0;
  let sigma = 0.3;
  for (let i = 0; i < 40; i++) {
    const diff = model(sigma) - price;
    if (Math.abs(diff) < 1e-5) return Math.max(sigma, 1e-4);
    const vega = (model(sigma + 0.005) - model(sigma - 0.005)) / 0.01;
    if (vega < 1e-8) break;
    sigma = Math.min(Math.max(sigma - diff / vega, 1e-4), 5);
  }
  let lo = 1e-4, hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (model(mid) > price) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-5) break;
  }
  return (lo + hi) / 2;
}

export function expiryToDays(expiry: string): number {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const m = expiry.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return 7;
  const dt = new Date(Number(m[3]), months[m[2].toUpperCase()] ?? 0, Number(m[1]), 15, 30);
  return Math.max(1, Math.ceil((dt.getTime() - Date.now()) / 86400000));
}

export function analyseChain(rows: ChainRow[], spotStrike: number, rf: number, underlying?: number): ChainMetrics {
  if (!rows.length) throw new Error("Option chain is empty.");
  const idx = rows.findIndex((r) => r.strike === spotStrike);
  if (idx < 0) throw new Error(`Strike ${spotStrike} not found in chain.`);
  const strikes = rows.map((r) => r.strike);
  const cOI = rows.map((r) => r.ceOI);
  const pOI = rows.map((r) => r.peOI);
  const spot = underlying ?? strikes[idx];

  const argmax = (a: number[]) => a.indexOf(Math.max(...a));
  const ci = argmax(cOI), pi = argmax(pOI);
  const mcStrike = strikes[ci], mpStrike = strikes[pi];
  const mc = Math.round((cOI[ci] / rf) * 10) / 10;
  const mp = Math.round((pOI[pi] / rf) * 10) / 10;

  let mc2 = mc, mc2Strike = mcStrike, mp2 = mp, mp2Strike = mpStrike;
  if (mcStrike !== mpStrike) {
    if (Math.abs(ci - pi) === 1) {
      const ceAtMp = rows.find((r) => r.strike === mpStrike)?.ceOI ?? 0;
      const peAtMc = rows.find((r) => r.strike === mcStrike)?.peOI ?? 0;
      mc2 = Math.round((ceAtMp / rf) * 10) / 10; mc2Strike = mpStrike;
      mp2 = Math.round((peAtMc / rf) * 10) / 10; mp2Strike = mcStrike;
    } else {
      const lo = Math.min(pi, ci), hi = Math.max(pi, ci);
      const ic = cOI.slice(lo, hi), ip = pOI.slice(lo + 1, hi + 1);
      if (ic.length) { mc2 = Math.round((Math.max(...ic) / rf) * 10) / 10; mc2Strike = strikes[lo + ic.indexOf(Math.max(...ic))]; }
      if (ip.length) { mp2 = Math.round((Math.max(...ip) / rf) * 10) / 10; mp2Strike = strikes[lo + 1 + ip.indexOf(Math.max(...ip))]; }
    }
  }

  const totC = cOI.reduce((a, b) => a + b, 0);
  const totP = pOI.reduce((a, b) => a + b, 0);
  const pcr = totC ? Math.round((totP / totC) * 100) / 100 : 0;

  const at = (arr: number[], i: number) => (i < 0 || i >= arr.length ? 0 : Math.trunc(arr[i]) || 0);
  const cc = rows.map((r) => r.ceChgOI), pc = rows.map((r) => r.peChgOI);
  const c1 = at(cc, idx), c2 = at(cc, idx + 1), c3 = at(cc, idx + 2);
  const p1 = at(pc, idx), p2 = at(pc, idx + 1), p3 = at(pc, idx + 2);
  const p4 = at(pc, idx + 4), p5 = at(cc, idx + 4);
  const p6 = at(cc, idx - 2), p7 = at(pc, idx - 2);

  const cs = Math.round(((c1 + c2 + c3) / rf) * 10) / 10;
  const cb = Math.round((c3 / rf) * 10) / 10;
  const ps = Math.round(((p1 + p2 + p3) / rf) * 10) / 10;
  const pb = Math.round((p1 / rf) * 10) / 10;
  const diff = Math.round((cs - ps) * 10) / 10;
  const citm = p5 === 0 ? 0 : Math.round((p4 / p5) * 10) / 10;
  const pitm = p7 === 0 ? 0 : Math.round((p6 / p7) * 10) / 10;

  const itmLbl = (ca: number, pa: number): string => {
    let lbl = "No";
    if (pa > ca) {
      if (pa >= 0) { if (ca <= 0 || pa / (ca || 1) > 1.5) lbl = "Yes"; }
      else if (pa / (ca || 1) < 0.5) lbl = "Yes";
    }
    if (ca <= 0) lbl = "Yes";
    return lbl;
  };

  const cleanIV = (v: number) => (isFinite(v) && v > 0 ? v : 0);
  const ceIV = cleanIV(rows[idx].ceIV);
  const peIV = cleanIV(rows[idx].peIV);

  const totCV = rows.reduce((s, r) => s + r.ceVol, 0);
  const totPV = rows.reduce((s, r) => s + r.peVol, 0);
  const vr = totCV ? Math.round((totPV / totCV) * 100) / 100 : 0;

  const ceArr = rows.map((r) => (isFinite(r.ceIV) && r.ceIV > 0 ? r.ceIV : 0));
  const peArr = rows.map((r) => (isFinite(r.peIV) && r.peIV > 0 ? r.peIV : 0));
  const ceWIV = Math.round(((ceArr.reduce((s, v, i) => s + v * cOI[i], 0)) / Math.max(totC, 1)) * 100) / 100;
  const peWIV = Math.round(((peArr.reduce((s, v, i) => s + v * pOI[i], 0)) / Math.max(totP, 1)) * 100) / 100;

  // Max pain: strike minimizing total option-holder payout
  const n = strikes.length;
  let pain = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let callLoss = 0, putLoss = 0;
    for (let j = 0; j < n; j++) {
      if (strikes[i] > strikes[j]) callLoss += (strikes[i] - strikes[j]) * cOI[j];
      if (strikes[j] > strikes[i]) putLoss += (strikes[j] - strikes[i]) * pOI[j];
    }
    pain[i] = callLoss + putLoss;
  }
  const maxPainI = pain.indexOf(Math.min(...pain));
  const maxPain = strikes[maxPainI];
  const painRange = Math.max(...pain) - Math.min(...pain);
  let maxPainConf = 0;
  if (painRange > 0 && pain.length > 1) {
    const second = [...pain].sort((a, b) => a - b)[1];
    maxPainConf = Math.round(((second - pain[maxPainI]) / painRange) * 1000) / 1000;
  }

  // Gamma wall: strike with max gamma × OI (7-day vol proxy, like upstream)
  const sigmaAvg = Math.max((ceWIV + peWIV) / 2, 1) / 100;
  const T = 7 / 365;
  let gammaWall = maxPain;
  if (spot > 0) {
    let best = -Infinity;
    for (let i = 0; i < n; i++) {
      const d1 = (Math.log(spot / strikes[i]) + (OC_RISK_FREE + 0.5 * sigmaAvg ** 2) * T) / (sigmaAvg * Math.sqrt(T));
      const gamma = normPdf(d1) / (spot * sigmaAvg * Math.sqrt(T));
      const expo = gamma * (cOI[i] + pOI[i]);
      if (expo > best) { best = expo; gammaWall = strikes[i]; }
    }
  }

  const allIV = [...ceArr.filter((v) => v > 0), ...peArr.filter((v) => v > 0)];
  let ivRankCE = 0, ivRankPE = 0;
  if (allIV.length > 1) {
    const lo = Math.min(...allIV), hi = Math.max(...allIV);
    const span = Math.max(hi - lo, 1e-6);
    ivRankCE = Math.round(Math.min(Math.max((ceIV - lo) / span, 0), 1) * 1000) / 10;
    ivRankPE = Math.round(Math.min(Math.max((peIV - lo) / span, 0), 1) * 1000) / 10;
  }

  return {
    cs, ps, diff, cb, pb, citm, pitm,
    mc, mcStrike, mc2, mc2Strike, mp, mpStrike, mp2, mp2Strike,
    pcr, sentiment: cs >= ps ? "Bearish" : "Bullish",
    callItm: itmLbl(p5, p4), putItm: itmLbl(p7, p6),
    ceExits: cb <= 0 || cs <= 0 ? "Yes" : "No",
    peExits: pb <= 0 || ps <= 0 ? "Yes" : "No",
    ceIV, peIV, ivSkew: Math.round((peIV - ceIV) * 100) / 100,
    totC, totP, totCV, totPV, vr, ceWIV, peWIV,
    maxPain, maxPainConf, gammaWall, ivRankCE, ivRankPE,
  };
}

export function calcSuggestion(m: ChainMetrics, spot: number): Suggestion {
  let score = 0;
  const reasons: Suggestion["reasons"] = [];
  const R = (dir: string, side: string, text: string) => reasons.push({ dir, side, text });

  const pcr = m.pcr;
  if (pcr >= 1.3) { score += 3; R("BULLISH", "PE", `PCR ${pcr} ≥ 1.3 — heavy put writing signals floor support`); }
  else if (pcr >= 1.1) { score += 2; R("BULLISH", "PE", `PCR ${pcr} in [1.1,1.3) — put OI dominance, mild bullish tilt`); }
  else if (pcr >= 0.9) { R("NEUTRAL", "ATM", `PCR ${pcr} in [0.9,1.1) — balanced OI, no strong signal`); }
  else if (pcr >= 0.7) { score -= 2; R("BEARISH", "CE", `PCR ${pcr} in [0.7,0.9) — call OI dominance, mild bearish tilt`); }
  else { score -= 3; R("BEARISH", "CE", `PCR ${pcr} < 0.7 — aggressive call writing, strong ceiling`); }

  if (m.sentiment === "Bullish") { score += 2; R("BULLISH", "PE", `OI Diff ${m.diff >= 0 ? "+" : ""}${m.diff} — PE writers dominant (bullish)`); }
  else { score -= 2; R("BEARISH", "CE", `OI Diff ${m.diff >= 0 ? "+" : ""}${m.diff} — CE writers dominant (bearish)`); }

  const painDiff = m.maxPain - spot;
  const confNote = m.maxPainConf ? ` [confidence ${(m.maxPainConf * 100).toFixed(0)}%]` : "";
  if (Math.abs(painDiff) < 50) R("NEUTRAL", "ATM", `Price ≈ Max Pain (${Math.round(m.maxPain)})${confNote} — expiry magnet near`);
  else if (painDiff > 200) { score += 2; R("BULLISH", "PE", `Max Pain ${Math.round(m.maxPain)} is ${painDiff >= 0 ? "+" : ""}${Math.round(painDiff)} pts above CMP${confNote}`); }
  else if (painDiff > 0) { score += 1; R("BULLISH", "PE", `Max Pain ${Math.round(m.maxPain)} is +${Math.round(painDiff)} pts above CMP${confNote}`); }
  else if (painDiff < -200) { score -= 2; R("BEARISH", "CE", `Max Pain ${Math.round(m.maxPain)} is ${Math.round(painDiff)} pts below CMP${confNote}`); }
  else { score -= 1; R("BEARISH", "CE", `Max Pain ${Math.round(m.maxPain)} is ${Math.round(painDiff)} pts below CMP${confNote}`); }

  const sk = m.ivSkew;
  if (sk > 4) { score -= 3; R("BEARISH", "CE", `IV Skew +${sk}% — extreme put premium; fear pricing`); }
  else if (sk > 2) { score -= 2; R("BEARISH", "CE", `IV Skew +${sk}% — elevated put premium`); }
  else if (sk > 0.5) { score -= 1; R("MILD BEAR", "CE", `IV Skew +${sk}% — slight put IV bias`); }
  else if (sk < -4) { score += 3; R("BULLISH", "PE", `IV Skew ${sk}% — extreme call premium; breakout demand`); }
  else if (sk < -2) { score += 2; R("BULLISH", "PE", `IV Skew ${sk}% — elevated call premium`); }
  else if (sk < -0.5) { score += 1; R("MILD BULL", "PE", `IV Skew ${sk}% — slight call IV bias`); }
  else R("NEUTRAL", "ATM", `IV Skew ${sk}% — near-zero; fairly priced`);

  const vr = m.vr;
  if (vr > 1.5) { score += 2; R("BULLISH", "PE", `Vol Ratio ${vr} — strong PE volume`); }
  else if (vr > 1.2) { score += 1; R("BULLISH", "PE", `Vol Ratio ${vr} — PE volume slightly dominant`); }
  else if (vr < 0.6) { score -= 2; R("BEARISH", "CE", `Vol Ratio ${vr} — heavy CE volume`); }
  else if (vr < 0.8) { score -= 1; R("BEARISH", "CE", `Vol Ratio ${vr} — CE volume slightly dominant`); }
  else R("NEUTRAL", "ATM", `Vol Ratio ${vr} — CE/PE volume balanced`);

  if (m.ceExits === "Yes" && m.peExits === "Yes") R("CAUTION", "ATM", "Both CE & PE OI unwinding — avoid new entries");
  else if (m.ceExits === "Yes") { score += 1; R("MILD BULL", "PE", "CE OI unwinding — call shorts covering"); }
  else if (m.peExits === "Yes") { score -= 1; R("MILD BEAR", "CE", "PE OI unwinding — put shorts covering"); }

  const atmRatio = m.ps / Math.max(m.cs, 0.01);
  if (atmRatio > 1.5) { score += 1; R("BULLISH", "PE", `ATM PE OI (${m.ps}) >> CE OI (${m.cs}) — support`); }
  else if (atmRatio < 0.67) { score -= 1; R("BEARISH", "CE", `ATM CE OI (${m.cs}) >> PE OI (${m.ps}) — resistance`); }

  const gw = m.gammaWall;
  if (gw && Math.abs(gw - spot) < 50) R("CAUTION", "ATM", `Price near gamma wall (${Math.round(gw)}) — expect pinning/chop`);

  let action = "NEUTRAL / WAIT", side: Suggestion["side"] = "ATM", confidence = "Low", confPct = 50;
  if (score >= 7) { action = "STRONG BUY CE"; side = "PE"; confidence = "Very High"; confPct = 90; }
  else if (score >= 4) { action = "BUY CE"; side = "PE"; confidence = "High"; confPct = 75; }
  else if (score >= 2) { action = "MILD CE BIAS"; side = "PE"; confidence = "Moderate"; confPct = 60; }
  else if (score >= 1) { action = "SLIGHT CE LEAN"; side = "PE"; confidence = "Low"; confPct = 52; }
  else if (score <= -7) { action = "STRONG BUY PE"; side = "CE"; confidence = "Very High"; confPct = 90; }
  else if (score <= -4) { action = "BUY PE"; side = "CE"; confidence = "High"; confPct = 75; }
  else if (score <= -2) { action = "MILD PE BIAS"; side = "CE"; confidence = "Moderate"; confPct = 60; }
  else if (score <= -1) { action = "SLIGHT PE LEAN"; side = "CE"; confidence = "Low"; confPct = 52; }
  return { action, side, score, confidence, confPct, reasons };
}

export function supportResistance(
  strikes: number[], ceOI: number[], peOI: number[], spot: number, n = 3
): { support: number[]; resistance: number[] } {
  const below = strikes.map((s, i) => ({ s, v: peOI[i] })).filter((x) => x.s < spot).sort((a, b) => b.v - a.v).slice(0, n).map((x) => x.s).sort((a, b) => b - a);
  const above = strikes.map((s, i) => ({ s, v: ceOI[i] })).filter((x) => x.s > spot).sort((a, b) => b.v - a.v).slice(0, n).map((x) => x.s).sort((a, b) => a - b);
  return { support: below, resistance: above };
}

export function payoffData(spot: number, strike: number, premium: number, isCall: boolean, rangePct = 0.06, points = 60) {
  const lo = spot * (1 - rangePct), hi = spot * (1 + rangePct);
  const xs: number[] = [], pnls: number[] = [];
  for (let i = 0; i < points; i++) {
    const s = lo + ((hi - lo) * i) / (points - 1);
    xs.push(s);
    pnls.push(isCall ? Math.max(s - strike, 0) - premium : Math.max(strike - s, 0) - premium);
  }
  return { xs, pnls, breakeven: isCall ? strike + premium : strike - premium };
}

export function thetaDecay(S: number, K: number, ivPct: number, isCall: boolean, r = OC_RISK_FREE, maxDays = 30) {
  const sigma = Math.max(ivPct, 0.01) / 100;
  const days: number[] = [], prices: number[] = [];
  for (let d = maxDays; d >= 1; d--) {
    const T = d / 365;
    const p = blackScholes(S, K, T, r, sigma, isCall ? "CALL" : "PUT")?.price ?? 0;
    days.push(d);
    prices.push(p);
  }
  return { days, prices };
}

export function suggestionAccuracy(
  history: Array<{ score: number | null; value: number; time?: string }>, lookforward = 3, threshold = 1
): { hitRate: number; n: number; records: Array<{ time?: string; score: number; predicted: string; actual: string; correct: boolean | null; move: number }> } {
  const records: Array<{ time?: string; score: number; predicted: string; actual: string; correct: boolean | null; move: number }> = [];
  for (let i = 0; i < history.length - lookforward; i++) {
    const score = history[i].score;
    if (score === null || Math.abs(score) < threshold) continue;
    const v0 = history[i].value, v1 = history[i + lookforward].value;
    const actual = v1 > v0 ? "up" : v1 < v0 ? "down" : "flat";
    const predicted = score > 0 ? "up" : "down";
    records.push({
      time: history[i].time, score, predicted, actual,
      correct: actual === "flat" ? null : predicted === actual,
      move: Math.round((v1 - v0) * 10) / 10,
    });
  }
  const scored = records.filter((r) => r.correct !== null);
  return {
    hitRate: scored.length ? scored.filter((r) => r.correct).length / scored.length : 0,
    n: scored.length,
    records,
  };
}
