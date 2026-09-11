import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";
import { sma, rsi, pctReturns } from "@/lib/indicators";
import { sharpe, sortino, maxDrawdown, profitFactor, cagrFromEquity } from "@/lib/risk";

// Real backtests on downloaded history: MA-cross trend + RSI-2 mean reversion.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const strat = (sp.get("strat") || "ma").toLowerCase();
  const fast = Math.max(2, parseInt(sp.get("fast") || "20", 10));
  const slow = Math.max(fast + 1, parseInt(sp.get("slow") || "50", 10));
  try {
    const bars = await fetchHistory(symbol, sp.get("range") || "2y", "1d");
    if (bars.length < slow + 10) return NextResponse.json({ error: "Insufficient history", symbol }, { status: 502 });
    const closes = bars.map((b) => b.close);
    const dates = bars.map((b) => b.date);
    const rets = pctReturns(closes);

    let pos: (0 | 1)[];
    if (strat === "mr") {
      const r = rsi(closes, 2);
      pos = closes.map(() => 0 as 0 | 1);
      let p: 0 | 1 = 0;
      for (let i = 0; i < closes.length; i++) {
        const v = r[i];
        if (v !== null && v < 10) p = 1;
        else if (v !== null && v > 70) p = 0;
        pos[i] = p;
      }
    } else {
      const f = sma(closes, fast).map((v) => v ?? NaN);
      const s = sma(closes, slow).map((v) => v ?? NaN);
      pos = closes.map((_, i) => (isFinite(f[i]) && isFinite(s[i]) && (f[i] as number) > (s[i] as number) ? 1 : 0));
    }

    const stratRets: number[] = rets.map((r, i) => (pos[i] === 1 ? r : 0));
    const eq = [1];
    for (const r of stratRets) eq.push(eq[eq.length - 1] * (1 + r));
    const first = closes[0], plast = closes[closes.length - 1];
    const buyHold = ((plast - first) / first) * 100;

    const trades: Array<{ entryDate: string; exitDate: string; entry: number; exit: number; retPct: number }> = [];
    let open: number | null = null;
    for (let i = 1; i < pos.length; i++) {
      if (pos[i] === 1 && pos[i - 1] === 0) open = i;
      if (pos[i] === 0 && pos[i - 1] === 1 && open !== null) {
        trades.push({
          entryDate: dates[open], exitDate: dates[i],
          entry: Math.round(closes[open] * 100) / 100, exit: Math.round(closes[i] * 100) / 100,
          retPct: Math.round(((closes[i] - closes[open]) / closes[open]) * 10000) / 100,
        });
        open = null;
      }
    }
    if (open !== null) {
      trades.push({
        entryDate: dates[open], exitDate: dates[dates.length - 1] + " (OPEN)",
        entry: Math.round(closes[open] * 100) / 100, exit: Math.round(plast * 100) / 100,
        retPct: Math.round(((plast - closes[open]) / closes[open]) * 10000) / 100,
      });
    }
    const trets = trades.map((t) => t.retPct / 100);
    const wins = trets.filter((t) => t > 0).length;

    return NextResponse.json({
      symbol, strat, fast: strat === "ma" ? fast : undefined, slow: strat === "ma" ? slow : undefined,
      bars: bars.length,
      metrics: {
        totalRetPct: Math.round((eq[eq.length - 1] - 1) * 10000) / 100,
        buyHoldPct: Math.round(buyHold * 100) / 100,
        cagrPct: cagrFromEquity(1, eq[eq.length - 1], stratRets.length) !== null ? Math.round((cagrFromEquity(1, eq[eq.length - 1], stratRets.length) as number) * 10000) / 100 : null,
        sharpe: Math.round(sharpe(stratRets) * 100) / 100,
        sortino: Math.round(sortino(stratRets) * 100) / 100,
        maxDDPct: Math.round(maxDrawdown(eq).pct * 100) / 100,
        winRatePct: trets.length ? Math.round((wins / trets.length) * 10000) / 100 : 0,
        numTrades: trades.length,
        profitFactor: Math.round(profitFactor(stratRets) * 100) / 100,
      },
      equity: eq.filter((_, i) => i % 5 === 0),
      trades: trades.slice(-40).reverse(),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "backtest failed", symbol }, { status: 502 });
  }
}
