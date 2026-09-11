import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";
import { hurst } from "@/lib/indicators";

// Pairs engine: OLS hedge ratio, spread, half-life, z-score.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symA = normalizeTicker(sp.get("symbolA") || sp.get("symbol") || "RELIANCE.NS");
  const symB = normalizeTicker(sp.get("symbolB") || "^NSEI");
  try {
    const [ba, bb] = await Promise.all([
      fetchHistory(symA, "1y", "1d"),
      fetchHistory(symB, "1y", "1d"),
    ]);
    const ca = ba.map((b) => b.close);
    const cb = bb.map((b) => b.close);
    const n = Math.min(ca.length, cb.length);
    const A = ca.slice(-n), B = cb.slice(-n);
    const ma = A.reduce((s, v) => s + v, 0) / n;
    const mb = B.reduce((s, v) => s + v, 0) / n;
    let cov = 0, vb = 0, va = 0;
    for (let i = 0; i < n; i++) {
      cov += (A[i] - ma) * (B[i] - mb);
      vb += (B[i] - mb) ** 2;
      va += (A[i] - ma) ** 2;
    }
    const hedge = vb ? cov / vb : 0;
    const spread = A.map((a, i) => a - hedge * B[i]);
    // Half-life from AR(1) of spread changes on lagged spread
    const ys: number[] = [], xs: number[] = [];
    for (let i = 1; i < n; i++) { ys.push(spread[i] - spread[i - 1]); xs.push(spread[i - 1]); }
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const beta = den ? num / den : 0;
    const halfLife = beta < 0 ? Math.log(2) / Math.abs(beta) : null;
    const w = spread.slice(-60);
    const wm = w.reduce((s, v) => s + v, 0) / w.length;
    const wsd = Math.sqrt(w.reduce((s, v) => s + (v - wm) ** 2, 0) / w.length);
    const z = wsd ? (spread[n - 1] - wm) / wsd : 0;
    const corr = va && vb ? cov / Math.sqrt(va * vb) : 0;
    const tail = 120;
    return NextResponse.json({
      symA, symB, n,
      hedge: Math.round(hedge * 10000) / 10000,
      corr: Math.round(corr * 100) / 100,
      halfLifeDays: halfLife === null ? null : Math.round(halfLife * 10) / 10,
      z60: Math.round(z * 100) / 100,
      hurst: Math.round(hurst(A) * 100) / 100,
      signal: z > 2 ? "SHORT SPREAD" : z < -2 ? "LONG SPREAD" : "NO TRADE",
      spreadTail: spread.slice(-120),
      aTail: A.slice(-tail),
      bTail: B.slice(-tail),
      lastA: A[n - 1], lastB: B[n - 1],
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "pair failed", symA, symB }, { status: 502 });
  }
}
