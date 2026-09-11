import { NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";

// Market breadth: advances/declines, % above 20D, movers, volume shockers, gaps.
// Same Nifty-50 running set as the screener.
const UNIVERSE = [
  "RELIANCE.NS","HDFCBANK.NS","BHARTIARTL.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "SBIN.NS","ITC.NS","HINDUNILVR.NS","LT.NS","BAJFINANCE.NS","HCLTECH.NS",
  "MARUTI.NS","SUNPHARMA.NS","NTPC.NS","ONGC.NS","KOTAKBANK.NS","M&M.NS",
  "AXISBANK.NS","TATAMOTORS.NS","TITAN.NS","ULTRACEMCO.NS","POWERGRID.NS",
  "ADANIENT.NS","ADANIPORTS.NS","TATASTEEL.NS","JSWSTEEL.NS","COALINDIA.NS",
  "GRASIM.NS","TECHM.NS","WIPRO.NS","NESTLEIND.NS","BRITANNIA.NS","EICHERMOT.NS",
  "HEROMOTOCO.NS","BAJAJ-AUTO.NS","DRREDDY.NS","CIPLA.NS","APOLLOHOSP.NS",
  "DIVISLAB.NS","BAJAJFINSV.NS","SBILIFE.NS","HDFCLIFE.NS","INDUSINDBK.NS",
  "SHRIRAMFIN.NS","TATACONSUM.NS","TRENT.NS","BEL.NS","BPCL.NS","HINDALCO.NS",
];

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

export async function GET() {
  try {
    const rows = await mapPool(UNIVERSE, 12, async (sym) => {
      const bars = await fetchHistory(sym, "3mo", "1d");
      if (bars.length < 30) return null;
      const closes = bars.map((b) => b.close);
      const price = closes[closes.length - 1];
      const prev = closes[closes.length - 2];
      const dayChg = ((price - prev) / prev) * 100;
      const win = closes.slice(-20);
      const sma20 = win.reduce((a, b) => a + b, 0) / win.length;
      const vols = bars.map((b) => b.volume || 0);
      const avgV = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const lastV = vols[vols.length - 1];
      const gap = ((bars[bars.length - 1].open - prev) / prev) * 100;
      return {
        symbol: sym, price: Math.round(price * 100) / 100,
        dayChgPct: Math.round(dayChg * 100) / 100,
        above20: price > sma20,
        volRatio: avgV ? Math.round((lastV / avgV) * 100) / 100 : 0,
        gapPct: Math.round(gap * 100) / 100,
      };
    });
    const adv = rows.filter((r) => r.dayChgPct > 0).length;
    const dec = rows.filter((r) => r.dayChgPct < 0).length;
    const byChg = [...rows].sort((a, b) => b.dayChgPct - a.dayChgPct);
    return NextResponse.json({
      universe: UNIVERSE.length, count: rows.length,
      adv, dec, unch: rows.length - adv - dec,
      pctAbove20: rows.length ? Math.round((rows.filter((r) => r.above20).length / rows.length) * 1000) / 10 : 0,
      dist: rows.map((r) => r.dayChgPct),
      top: byChg.slice(0, 8), bottom: byChg.slice(-8).reverse(),
      shockers: [...rows].sort((a, b) => b.volRatio - a.volRatio).slice(0, 8),
      gaps: rows.filter((r) => Math.abs(r.gapPct) >= 1.5).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, 8),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "breadth failed" }, { status: 502 });
  }
}
