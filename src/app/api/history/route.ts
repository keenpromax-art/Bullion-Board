import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const range = sp.get("range") || "6mo";
  const interval = sp.get("interval") || "1d";
  try {
    const bars = await fetchHistory(symbol, range, interval);
    return NextResponse.json({ symbol, range, interval, count: bars.length, bars });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "history failed";
    return NextResponse.json({ error: msg, symbol }, { status: 502 });
  }
}
