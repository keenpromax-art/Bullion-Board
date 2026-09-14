import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";
import { hurst } from "@/lib/indicators";

// Pairs engine: date-joined OLS hedge on RETURNS (stationary — price-level
// OLS on mismatched scales gives spurious negative betas), log-price
// residual spread in %, z-score tape, signal backtest.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symA = normalizeTicker(sp.get("symbolA") || sp.get("symbol") || "RELIANCE.NS");
  const symB = normalizeTicker(sp.get("symbolB") || "^NSEI");
  try {
    const [ba, bb] = await Promise.all([
      fetchHistory(symA, "1y", "1d"),
      fetchHistory(symB, "1y", "1d"),
    ]);
    // Date-join: only shared trading days, chronological.
    const mb = new Map<string, number>();
    for (const b of bb) {
      if (typeof b.close === "number" && isFinite(b.close) && b.close > 0) mb.set(b.date, b.close);
    }
    const jd: string[] = [];
    const A: number[] = [], B: number[] = [];
    for (const b of ba) {
      if (typeof b.close !== "number" || !isFinite(b.close) || b.close <= 0) continue;
      const c = mb.get(b.date);
      if (c !== undefined) { jd.push(b.date); A.push(b.close); B.push(c); }
    }
    const n = A.length;
    if (n < 70) throw new Error(`SHORT OVERLAP ${symA} × ${symB} (${n} SHARED BARS)`);
    const la = A.map((v) => Math.log(v));
    const lb = B.map((v) => Math.log(v));
    const ra: number[] = [], rb: number[] = [];
    for (let i = 1; i < n; i++) { ra.push(la[i] - la[i - 1]); rb.push(lb[i] - lb[i - 1]); }
    const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
    const mbm = rb.reduce((s, v) => s + v, 0) / rb.length;
    let cov = 0, vb = 0, va = 0;
    for (let i = 0; i < ra.length; i++) {
      cov += (ra[i] - ma) * (rb[i] - mbm);
      vb += (rb[i] - mbm) ** 2;
      va += (ra[i] - ma) ** 2;
    }
    const hedge = vb ? cov / vb : 0;
    const corr = va && vb ? cov / Math.sqrt(va * vb) : 0;
    // Log-price residual spread, demeaned, in percent.
    const raw = la.map((v, i) => v - hedge * lb[i]);
    const rm = raw.reduce((s, v) => s + v, 0) / n;
    const spread = raw.map((v) => (v - rm) * 100);
    // Half-life from AR(1) of spread changes on lagged spread.
    const ys: number[] = [], xs: number[] = [];
    for (let i = 1; i < n; i++) { ys.push(spread[i] - spread[i - 1]); xs.push(spread[i - 1]); }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const beta = den ? num / den : 0;
    const halfLife = beta < 0 ? Math.log(2) / Math.abs(beta) : null;
    // Rolling 60d z tape (last 120) + current z.
    const zTail: number[] = [];
    for (let i = Math.max(60, n - 120); i < n; i++) {
      const w = spread.slice(i - 60, i);
      const wm = w.reduce((s, v) => s + v, 0) / w.length;
      const wsd = Math.sqrt(w.reduce((s, v) => s + (v - wm) ** 2, 0) / w.length);
      zTail.push(wsd ? (spread[i] - wm) / wsd : 0);
    }
    const wLast = spread.slice(-60);
    const wmL = wLast.reduce((s, v) => s + v, 0) / wLast.length;
    const wsdL = Math.sqrt(wLast.reduce((s, v) => s + (v - wmL) ** 2, 0) / wLast.length);
    const z = wsdL ? (spread[n - 1] - wmL) / wsdL : 0;
    // Signal backtest: |z|>2 → 10d mean-reversion, in spread bps.
    let sig = 0, hit = 0, pnl = 0;
    for (let i = 60; i < n - 10; i += 5) {
      const w = spread.slice(i - 60, i);
      const wm = w.reduce((s, v) => s + v, 0) / w.length;
      const wsd = Math.sqrt(w.reduce((s, v) => s + (v - wm) ** 2, 0) / w.length);
      if (!wsd) continue;
      const zi = (spread[i] - wm) / wsd;
      if (Math.abs(zi) > 2) {
        sig++;
        const fwd = spread[i + 10] - spread[i]; // spread points
        const p = -Math.sign(zi) * fwd * 100; // bps of spread
        pnl += p;
        if (p > 0) hit++;
      }
    }
    // Rebased tails (first of window = 100) for the overlay.
    const T = 120, k0 = Math.max(0, n - T);
    const a0 = A[k0], b0 = B[k0];
    const tail = T;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return NextResponse.json({
      symA, symB, n,
      hedge: Math.round(hedge * 10000) / 10000,
      corr: Math.round(corr * 100) / 100,
      halfLifeDays: halfLife === null ? null : Math.round(halfLife * 10) / 10,
      z60: Math.round(z * 100) / 100,
      hurst: Math.round(hurst(A) * 100) / 100,
      signal: z > 2 ? "SHORT SPREAD" : z < -2 ? "LONG SPREAD" : "NO TRADE",
      spreadTail: spread.slice(-tail).map((v) => r2(v)),
      zTail: zTail.slice(-tail).map((v) => r2(v)),
      aTail: A.slice(-tail).map((v) => r2((v / a0) * 100)),
      bTail: B.slice(-tail).map((v) => r2((v / b0) * 100)),
      tailDates: jd.slice(-tail),
      lastA: A[n - 1], lastB: B[n - 1],
      per1L: {
        longA: 100000,
        shortB: Math.round(hedge * 100000),
        sharesA: Math.floor(100000 / A[n - 1]),
        sharesB: Math.floor((hedge * 100000) / B[n - 1]),
      },
      backtest: {
        n: sig,
        hitPct: sig ? Math.round((hit / sig) * 100) : null,
        avgBps: sig ? Math.round((pnl / sig) * 10) / 10 : null,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "pair failed", symA, symB }, { status: 502 });
  }
}
