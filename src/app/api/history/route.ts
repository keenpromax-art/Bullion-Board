import { NextRequest, NextResponse } from "next/server";
import { fetchHistory, pickReplacement, UnknownSymbolError } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const range = sp.get("range") || "6mo";
  const interval = sp.get("interval") || "1d";
  let resolvedFrom: string | undefined;
  try {
    try {
      const bars = await fetchHistory(symbol, range, interval);
      return NextResponse.json({
        symbol, range, interval, count: bars.length, bars,
        ...(resolvedFrom ? { resolvedFrom } : {}),
      });
    } catch (e: unknown) {
      // Typo (APPL) or company name (APPLE) → resolve via Yahoo search.
      if (!(e instanceof UnknownSymbolError)) throw e;
      const { resolved, suggestions } = await pickReplacement(symbol);
      if (!resolved || resolved === symbol) {
        return NextResponse.json(
          { error: `UNKNOWN TICKER ${symbol} — NO YAHOO TAPE`, code: "UNKNOWN_SYMBOL", symbol, suggestions },
          { status: 404 }
        );
      }
      resolvedFrom = symbol;
      symbol = resolved;
      const bars = await fetchHistory(symbol, range, interval);
      return NextResponse.json({ symbol, range, interval, count: bars.length, bars, resolvedFrom });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "history failed";
    return NextResponse.json({ error: msg, symbol }, { status: 502 });
  }
}
