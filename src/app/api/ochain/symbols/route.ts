import { NextResponse } from "next/server";
import { nseGet, nseRefresh } from "@/lib/nse";

let cache: { ts: number; data: { indices: string[]; stocks: string[] } } | null = null;

// F&O underlying lists (mirrors NseCore._load_symbols).
export async function GET() {
  if (cache && Date.now() - cache.ts < 3600_000) return NextResponse.json(cache.data);
  try {
    await nseRefresh();
    const r = await nseGet("https://www.nseindia.com/api/underlying-information");
    if (!r.ok) throw new Error(`symbols ${r.status}`);
    const j = await r.json();
    const data = {
      indices: ((j?.data?.IndexList ?? []) as any[]).map((x) => String(x.symbol)),
      stocks: ((j?.data?.UnderlyingList ?? []) as any[]).map((x) => String(x.symbol)),
    };
    if (!data.indices.length && !data.stocks.length) throw new Error("empty symbol list");
    cache = { ts: Date.now(), data };
    return NextResponse.json(data);
  } catch (e: unknown) {
    // Fallback list so the desk stays usable when NSE blocks the host.
    const fallback = {
      indices: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"],
      stocks: [
        "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "ITC",
        "TATAMOTORS", "SUNPHARMA", "TITAN", "LT", "AXISBANK", "BAJFINANCE",
      ],
      fallback: true,
      error: e instanceof Error ? e.message : "symbols failed",
    };
    return NextResponse.json(fallback);
  }
}
