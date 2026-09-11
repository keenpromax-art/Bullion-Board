import { NextRequest, NextResponse } from "next/server";
import { yahooFetch } from "@/lib/yahoo";
import { evaluatePrediction } from "@/lib/opening";

// Zero-lookahead backfill port of backfill_history.py:
// 09:00 score uses ONLY strictly-prior closes (US/SGX/VIX from D-1),
// evaluated against day-D Nifty return. Breadth unavailable historically
// → 3 signals (Nasdaq, Dow, SGX), exactly like the Python engine.

async function dailyCloses(symbol: string, years = 1): Promise<Array<{ date: string; close: number }>> {
  const r = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=${years}y&interval=1d`, { next: { revalidate: 3600 } });
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp ?? [];
  const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c !== null && isFinite(c)) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const days = Math.max(30, Math.min(500, parseInt(req.nextUrl.searchParams.get("days") || "250", 10)));
  try {
    const [nifty, ndq, dow, sgx, vix] = await Promise.all([
      dailyCloses("^NSEI"), dailyCloses("^IXIC"), dailyCloses("^DJI"), dailyCloses("^STI"), dailyCloses("^INDIAVIX"),
    ]);
    if (nifty.length < 10) throw new Error("no nifty history");

    const rets = (bars: Array<{ date: string; close: number }>) => {
      const m = new Map<string, number>();
      for (let i = 1; i < bars.length; i++) m.set(bars[i].date, ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100);
      return m;
    };
    const rNifty = rets(nifty), rNdq = rets(ndq), rDow = rets(dow), rSgx = rets(sgx);
    const byDate = (bars: Array<{ date: string; close: number }>) => new Map(bars.map((b) => [b.date, b.close]));
    const vixByDate = byDate(vix);
    const niftyByDate = byDate(nifty);

    const strictlyPrior = (m: Map<string, number>, date: string): number | null => {
      let best: string | null = null;
      for (const d of m.keys()) if (d < date && (best === null || d > best)) best = d;
      return best === null ? null : (m.get(best) ?? null);
    };

    const dates = nifty.map((b) => b.date).slice(-days);
    const rows: Array<{
      date: string; score: number | null; verdict: string;
      dayRet: number | null; outcome: string;
    }> = [];
    for (const d of dates) {
      const nq = strictlyPrior(rNdq, d);
      const dw = strictlyPrior(rDow, d);
      const sx = strictlyPrior(rSgx, d);
      const votes: Array<1 | -1> = [];
      if (nq !== null) votes.push(nq >= 0 ? 1 : -1);
      if (dw !== null) votes.push(dw >= 0 ? 1 : -1);
      if (sx !== null) votes.push(sx >= 0 ? 1 : -1);
      let score: number | null = null, verdict = "NO_DATA";
      if (votes.length) {
        score = votes.reduce((a, b) => a + b, 0);
        verdict = score > 0 ? "GREEN" : score < 0 ? "RED" : "FLAT";
      }
      const dayRet = rNifty.get(d) ?? null;
      rows.push({ date: d, score, verdict, dayRet: dayRet !== null ? Math.round(dayRet * 100) / 100 : null, outcome: evaluatePrediction(verdict, dayRet) });
    }

    const valid = rows.filter((r) => !r.outcome.startsWith("No Nifty") && r.outcome !== "⚪ Flat/Mixed");
    const hits = valid.filter((r) => r.outcome.startsWith("✅")).length;
    const green = rows.filter((r) => r.verdict === "GREEN" && r.dayRet !== null);
    const red = rows.filter((r) => r.verdict === "RED" && r.dayRet !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

    // Overnight agreement: prior day return direction vs today's 09:00 verdict
    let agree = 0, agreeN = 0;
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].dayRet, v = rows[i].verdict;
      if (prev === null || v === "NO_DATA") continue;
      agreeN++;
      if ((v === "GREEN" && prev > 0) || (v === "RED" && prev < 0) || (v === "FLAT" && Math.abs(prev) < 0.25)) agree++;
    }

    return NextResponse.json({
      days: rows.length,
      evaluated: valid.length,
      hits,
      winRate: valid.length ? Math.round((hits / valid.length) * 1000) / 10 : 0,
      avgGreen: avg(green.map((r) => r.dayRet as number)),
      avgRed: avg(red.map((r) => r.dayRet as number)),
      agreePct: agreeN ? Math.round((agree / agreeN) * 1000) / 10 : 0,
      agreeN,
      vixNote: vix.length ? `VIX ${vix[vix.length - 1].close.toFixed(2)}` : null,
      rows: rows.reverse(),
      _meta: { signals: "NASDAQ+DOW+SGX (breadth unavailable historically)", niftyDates: nifty.length },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "history failed" }, { status: 502 });
  }
}
