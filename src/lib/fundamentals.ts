// Fundamental models — exact ports of _calc_piotroski, _calc_altman_z,
// _calc_beneish, _calc_monte_carlo_dcf, _calc_reverse_dcf from special.py

import type { AltmanResult, BeneishResult, MonteCarloDCF, PiotroskiResult, ReverseDCF } from "./types";
import { clamp, mulberry32, percentile, randnFactory, safeDiv } from "./utils";

export function calcPiotroski(args: {
  niC: number; niP: number; cfoC: number;
  assetsC: number; assetsP: number;
  caC: number; caP: number; clC: number; clP: number;
  ltdC: number; ltdP: number;
  revC: number; revP: number; gpC: number; gpP: number;
  sharesC: number; sharesP: number;
}): PiotroskiResult {
  const { niC, niP, cfoC, assetsC, assetsP, caC, caP, clC, clP, ltdC, ltdP, revC, revP, gpC, gpP, sharesC, sharesP } = args;
  const roaC = safeDiv(niC, assetsC);
  const roaP = safeDiv(niP, assetsP);
  const crC = safeDiv(caC, clC);
  const crP = safeDiv(caP, clP);
  const levC = safeDiv(ltdC, assetsC);
  const levP = safeDiv(ltdP, assetsP);
  const gmC = safeDiv(gpC, revC);
  const gmP = safeDiv(gpP, revP);
  const atC = safeDiv(revC, assetsC);
  const atP = safeDiv(revP, assetsP);
  const checks = [
    { label: "ROA Positive", detail: `ROA = ${(roaC * 100).toFixed(2)}%`, pass: roaC > 0 },
    { label: "CFO Positive", detail: `CFO = ${cfoC.toLocaleString("en-IN")}`, pass: cfoC > 0 },
    { label: "ROA Improving", detail: `Δ ROA = ${((roaC - roaP) * 100 >= 0 ? "+" : "") + ((roaC - roaP) * 100).toFixed(2)}pp`, pass: roaC > roaP },
    { label: "Earnings Quality (CFO>NI)", detail: niC ? `CFO/NI = ${safeDiv(cfoC, niC).toFixed(2)}x` : "NI=0", pass: cfoC > niC },
    { label: "Leverage Falling", detail: `D/A: ${(levP * 100).toFixed(1)}% → ${(levC * 100).toFixed(1)}%`, pass: levC < levP },
    { label: "Liquidity Improving", detail: `CR: ${crP.toFixed(2)} → ${crC.toFixed(2)}`, pass: crC > crP },
    { label: "No Share Dilution", detail: `Shares: ${(sharesP / 1e7).toFixed(1)}Cr → ${(sharesC / 1e7).toFixed(1)}Cr`, pass: sharesC <= sharesP },
    { label: "Gross Margin Improving", detail: `GM: ${(gmP * 100).toFixed(1)}% → ${(gmC * 100).toFixed(1)}%`, pass: gmC > gmP },
    { label: "Asset Turnover Improving", detail: `AT: ${atP.toFixed(2)} → ${atC.toFixed(2)}`, pass: atC > atP },
  ];
  const score = checks.filter((c) => c.pass).length;
  return {
    score,
    interpretation: score >= 8 ? "Exceptional" : score >= 7 ? "Strong" : score >= 4 ? "Average" : "Weak",
    cssClass: score >= 7 ? "pos" : score < 4 ? "neg" : "neutral",
    checks,
  };
}

export function calcAltmanZ(args: {
  niC: number; retainedC: number; ebitC: number;
  workingCapital: number; totalAssets: number; totalLiab: number;
  revenueC: number; marketCap: number;
}): AltmanResult {
  const { retainedC, ebitC, workingCapital, totalAssets, totalLiab, revenueC, marketCap } = args;
  const X1 = safeDiv(workingCapital, totalAssets);
  const X2 = safeDiv(retainedC, totalAssets);
  const X3 = safeDiv(ebitC, totalAssets);
  const X4 = safeDiv(marketCap, totalLiab);
  const X5 = safeDiv(revenueC, totalAssets);
  const z = 1.2 * X1 + 1.4 * X2 + 3.3 * X3 + 0.6 * X4 + 1.0 * X5;
  return {
    zScore: z, X1, X2, X3, X4, X5,
    zone: z >= 2.99 ? "SAFE ZONE" : z >= 1.81 ? "GREY ZONE" : "DISTRESS ZONE",
    cssClass: z >= 2.99 ? "pos" : z >= 1.81 ? "neutral" : "neg",
  };
}

export function calcBeneish(inputs: {
  dsri: number; gmi: number; aqi: number; sgi: number;
  depi: number; sgai: number; tata: number; lvgi: number;
}): BeneishResult {
  const { dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi } = inputs;
  const m = -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi
    + 0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;
  return {
    mScore: m,
    risk: m > -1.78 ? "HIGH MANIPULATION RISK" : m > -2.22 ? "GREY ZONE" : "LOW RISK",
    cssClass: m > -1.78 ? "neg" : m > -2.22 ? "neutral" : "pos",
    inputs,
  };
}

function dcfPrice(fcfBase: number, shares: number, g: number, wacc: number, termG: number, nYears = 5): number {
  const years = Array.from({ length: nYears }, (_, i) => i + 1);
  const proj = years.map((y) => fcfBase * Math.pow(1 + g, y));
  const pvFcf = proj.reduce((s, f, i) => s + f / Math.pow(1 + wacc, i + 1), 0);
  if (wacc <= termG) return 0;
  const tv = (proj[proj.length - 1] * (1 + termG)) / (wacc - termG);
  const pvTv = tv / Math.pow(1 + wacc, nYears);
  return (pvFcf + pvTv) / shares;
}

export function calcMonteCarloDCF(
  fcfBase: number, shares: number,
  wacc = 0.12, terminalG = 0.04,
  gMeans: number[] = [0.05, 0.1, 0.15],
  nSims = 2000, nYears = 5, seed = 42
): MonteCarloDCF {
  if (fcfBase <= 0 || shares <= 0) {
    return { p10: NaN, p25: NaN, p50: NaN, p75: NaN, p90: NaN, mean: NaN, std: NaN, histCounts: [], histEdges: [], nPaths: 0, params: { wacc, termG: terminalG, gMeans }, error: "Negative or zero FCF — DCF not meaningful" };
  }
  const uniform = mulberry32(seed);
  const randn = randnFactory(uniform);
  const all: number[] = [];
  const years = Array.from({ length: nYears }, (_, i) => i + 1);
  for (const gMean of gMeans) {
    for (let s = 0; s < nSims; s++) {
      const w = clamp(wacc + randn() * 0.02, 0.05, 0.3);
      const g = clamp(gMean + randn() * 0.03, -0.1, 0.5);
      const tg = clamp(terminalG + randn() * 0.01, Math.max(0.01, terminalG - 0.03), Math.min(0.12, terminalG + 0.03));
      const proj = years.map((y) => fcfBase * Math.pow(1 + g, y));
      const pvFcf = proj.reduce((sum, f, i) => sum + f / Math.pow(1 + w, i + 1), 0);
      if (w <= tg) continue;
      const tv = (proj[proj.length - 1] * (1 + tg)) / (w - tg);
      const pvTv = tv / Math.pow(1 + w, nYears);
      const vps = (pvFcf + pvTv) / shares;
      if (vps > 0 && isFinite(vps)) all.push(vps);
    }
  }
  if (all.length === 0) {
    return { p10: NaN, p25: NaN, p50: NaN, p75: NaN, p90: NaN, mean: NaN, std: NaN, histCounts: [], histEdges: [], nPaths: 0, params: { wacc, termG: terminalG, gMeans }, error: "All simulated paths produced negative values" };
  }
  const sorted = [...all].sort((a, b) => a - b);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const std = Math.sqrt(all.reduce((s, v) => s + (v - mean) ** 2, 0) / all.length);
  // 20-bin histogram like np.histogram(combined, bins=20)
  const mn = sorted[0], mx = sorted[sorted.length - 1];
  const bins = 20;
  const edges = Array.from({ length: bins + 1 }, (_, i) => mn + ((mx - mn) * i) / bins);
  const counts = new Array(bins).fill(0);
  for (const v of all) {
    let b = Math.floor(((v - mn) / (mx - mn || 1)) * bins);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  return {
    p10: percentile(sorted, 10), p25: percentile(sorted, 25), p50: percentile(sorted, 50),
    p75: percentile(sorted, 75), p90: percentile(sorted, 90),
    mean, std, histCounts: counts, histEdges: edges.map((e) => Math.round(e * 100) / 100),
    nPaths: all.length, params: { wacc, termG: terminalG, gMeans },
  };
}

export function calcReverseDCF(price: number, fcfBase: number, shares: number, wacc = 0.12, terminalG = 0.04, nYears = 5): ReverseDCF {
  if (price <= 0 || fcfBase <= 0 || shares <= 0) {
    return { impliedGrowthPct: NaN, verdict: "Cannot compute", cssClass: "neg", waccUsed: wacc, terminalGUsed: terminalG, error: "Cannot compute reverse DCF with zero/negative inputs" };
  }
  let lo = -0.05, hi = 0.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (dcfPrice(fcfBase, shares, mid, wacc, terminalG, nYears) < price) lo = mid;
    else hi = mid;
  }
  const g = (lo + hi) / 2;
  let verdict = "", cls = "";
  if (g > 0.2) { verdict = "Expensive (market prices high growth)"; cls = "neg"; }
  else if (g > 0.1) { verdict = "Fairly valued"; cls = "neutral"; }
  else if (g >= 0) { verdict = "Inexpensive (low implied growth)"; cls = "pos"; }
  else { verdict = "Market implies shrinkage"; cls = "neg"; }
  return { impliedGrowthPct: Math.round(g * 10000) / 100, verdict, cssClass: cls, waccUsed: wacc, terminalGUsed: terminalG };
}
