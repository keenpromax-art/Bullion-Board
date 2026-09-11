import { NextRequest, NextResponse } from "next/server";
import { nseGet } from "@/lib/nse";

const cache = new Map<string, { ts: number; expiries: string[] }>();

// Expiry dates for an underlying (mirrors NseCore.get_expiry_dates).
export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get("symbol") || "NIFTY").toUpperCase();
  const key = symbol;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 600_000) {
    return NextResponse.json({ symbol, expiries: hit.expiries });
  }
  try {
    const r = await nseGet(
      `https://www.nseindia.com/api/option-chain-contract-info?symbol=${encodeURIComponent(symbol)}`
    );
    if (!r.ok) throw new Error(`expiry ${r.status}`);
    const j = await r.json();
    const expiries: string[] =
      j?.expiryDates ?? j?.records?.expiryDates ?? [];
    cache.set(key, { ts: Date.now(), expiries });
    return NextResponse.json({ symbol, expiries });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "expiry failed", symbol, expiries: [] },
      { status: 502 }
    );
  }
}
