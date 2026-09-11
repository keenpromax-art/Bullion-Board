import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { SECTORS, sectorOf } from "@/lib/sectors";
import { normalizeTicker } from "@/lib/utils";

const PERIODS: Record<string, { label: string; range: string; n: number }> = {
  "1M": { label: "1 Month", range: "3mo", n: 21 },
  "3M": { label: "3 Months", range: "6mo", n: 63 },
  "6M": { label: "6 Months", range: "1y", n: 126 },
  "1Y": { label: "1 Year", range: "2y", n: 252 },
};

async function mapPool<T, R>(arr: T[], n: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(arr.length).fill(null);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      try { out[k] = await fn(arr[k]); } catch { out[k] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, w));
  return out.filter((x): x is R => x !== null);
}

const lr = (closes: number[]): number[] => {
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    r.push(closes[i] > 0 && closes[i - 1] > 0 ? Math.log(closes[i] / closes[i - 1]) : 0);
  }
  return r;
};
const cumPct = (rets: number[], p: number): number | null => {
  if (rets.length < Math.min(p, 5)) return null;
  const s = rets.slice(-p).reduce((a, b) => a + b, 0);
  return Math.round((Math.exp(s) - 1) * 10000) / 100;
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const std = (xs: number[]): number => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
// JdK-lite: RS-Ratio = z-scored 10-span EWM of excess log-returns, centred 100;
// RS-Momentum = z-scored 10-bar ROC of RS-Ratio, centred 100.
function rsPair(secR: number[], bmR: number[]): { rsr: number | null; rsm: number | null } {
  const n = Math.min(secR.length, bmR.length);
  if (n < 30) return { rsr: null, rsm: null };
  const s = secR.slice(-n), b = bmR.slice(-n);
  const k = 2 / (10 + 1);
  const rel: number[] = [];
  let e = s[0] - b[0];
  for (let i = 0; i < n; i++) { e = (s[i] - b[i]) * k + e * (1 - k); rel.push(e); }
  const mu = mean(rel), sd = std(rel) || 1e-9;
  const rsrArr = rel.map((v) => ((v - mu) / sd) * 10 + 100);
  const roc: number[] = [];
  for (let i = 10; i < rsrArr.length; i++) roc.push(rsrArr[i] - rsrArr[i - 10]);
  if (roc.length < 5) return { rsr: Math.round(rsrArr[rsrArr.length - 1] * 100) / 100, rsm: null };
  const mu2 = mean(roc), sd2 = std(roc) || 1e-9;
  const rsm = ((roc[roc.length - 1] - mu2) / sd2) * 10 + 100;
  return { rsr: Math.round(rsrArr[rsrArr.length - 1] * 100) / 100, rsm: Math.round(rsm * 100) / 100 };
}

// Sector rotation intelligence: peer momentum windows, breadth,
// Nifty-relative RS quadrant, 60D beta — mirrors special.py module 35.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const periodKey = (sp.get("period") || "1Y").toUpperCase();
  const period = PERIODS[periodKey] ?? PERIODS["1Y"];
  let key = (sp.get("sector") || "").trim();
  const symParam = normalizeTicker(sp.get("symbol") || "");
  if (!SECTORS[key]) key = (symParam && sectorOf(symParam)) || "6";
  const sector = SECTORS[key];
  try {
    const syms = [...sector.tickers, "^NSEI"];
    const series = await mapPool(syms, 6, async (s) => {
      try {
        const bars = await fetchHistory(s, period.range, "1d");
        if (bars.length < 30) return null;
        return { s, closes: bars.map((b) => b.close), dates: bars.map((b) => b.date) };
      } catch { return null; }
    });
    const bm = series.find((x) => x.s === "^NSEI");
    if (!bm) return NextResponse.json({ error: "nifty benchmark failed", sector: key }, { status: 502 });
    const bmR = lr(bm.closes);
    const rows = series
      .filter((x) => x.s !== "^NSEI")
      .map((x) => {
        const c = x.closes, r = lr(c);
        const price = c[c.length - 1];
        const day = c.length > 1 ? Math.round(((c[c.length - 1] - c[c.length - 2]) / c[c.length - 2]) * 10000) / 100 : null;
        const ma = (n: number) => (c.length >= n ? mean(c.slice(-n)) : NaN);
        const m50 = ma(50), m200 = ma(Math.min(200, c.length));
        const v = std(r) * Math.sqrt(252) * 100;
        let peak = c[0], dd = 0;
        for (const px of c) { if (px > peak) peak = px; dd = Math.min(dd, (px - peak) / peak); }
        const w = Math.min(60, r.length, bmR.length);
        const sr = r.slice(-w), br = bmR.slice(-w);
        const cov = mean(sr.map((v, i) => (v - mean(sr)) * (br[i] - mean(br))));
        const beta = cov / ((std(br) ** 2) || 1e-12);
        const { rsr, rsm } = rsPair(r, bmR);
        return {
          sym: x.s, price: Math.round(price * 100) / 100, day,
          m21: cumPct(r, 21), m63: cumPct(r, 63), m126: cumPct(r, 126), m252: cumPct(r, period.n),
          vol: isFinite(v) ? Math.round(v * 10) / 10 : null,
          dd: Math.round(dd * 10000) / 100,
          beta: isFinite(beta) ? Math.round(beta * 100) / 100 : null,
          above50: isFinite(m50) ? price > m50 : null,
          above200: isFinite(m200) ? price > m200 : null,
          rsr, rsm,
        };
      });
    const b50 = rows.filter((r) => r.above50 === true).length;
    const b200 = rows.filter((r) => r.above200 === true).length;
    const betas = rows.map((r) => r.beta).filter((b): b is number => typeof b === "number");
    // Equal-weight sector cumulative vs Nifty over the period window.
    const tail = Math.min(period.n + 1, ...series.map((x) => x.closes.length));
    const secCum: number[] = [], nifCum: number[] = [];
    const peers = series.filter((x) => x.s !== "^NSEI");
    for (let i = 1; i < tail; i++) {
      let s = 0, c = 0;
      for (const p of peers) {
        const a = p.closes[p.closes.length - tail + i - 1], b = p.closes[p.closes.length - tail + i];
        if (a > 0 && b > 0) { s += Math.log(b / a); c++; }
      }
      secCum.push(c ? (Math.exp(s / c) - 1) * 100 : 0);
      const ba = bm.closes[bm.closes.length - tail + i - 1], bb = bm.closes[bm.closes.length - tail + i];
      nifCum.push(ba > 0 && bb > 0 ? (Math.exp(Math.log(bb / ba)) - 1) * 100 : 0);
    }
    // Rebase to cumulative-from-start for the chart.
    let acc = 0;
    const secCurve = secCum.map((d) => (acc = (1 + acc / 100) * (1 + d / 100) * 100 - 100));
    acc = 0;
    const nifCurve = nifCum.map((d) => (acc = (1 + acc / 100) * (1 + d / 100) * 100 - 100));
    const secTot = secCurve.length ? Math.round(secCurve[secCurve.length - 1] * 100) / 100 : null;
    const nifTot = nifCurve.length ? Math.round(nifCurve[nifCurve.length - 1] * 100) / 100 : null;
    return NextResponse.json({
      sector: key, sectorName: sector.name, period: periodKey, periodLabel: period.label,
      universe: sector.tickers.length, count: rows.length,
      forSymbol: symParam || null,
      breadth: {
        b50: rows.length ? Math.round((b50 / rows.length) * 1000) / 10 : null,
        b200: rows.length ? Math.round((b200 / rows.length) * 1000) / 10 : null,
      },
      avgBeta: betas.length ? Math.round((mean(betas)) * 100) / 100 : null,
      secTotal: secTot, nifTotal: nifTot,
      excess: secTot !== null && nifTot !== null ? Math.round((secTot - nifTot) * 100) / 100 : null,
      rows,
      curve: { sector: secCurve.map((v) => Math.round(v * 100) / 100), nifty: nifCurve.map((v) => Math.round(v * 100) / 100), dates: bm.dates.slice(-tail + 1) },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "sector failed", sector: key }, { status: 502 });
  }
}
