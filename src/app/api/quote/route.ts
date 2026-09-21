import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, pickReplacement, UnknownSymbolError } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";

export async function GET(req: NextRequest) {
  let symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  try {
    try {
      const q = await fetchQuote(symbol);
      return NextResponse.json(q);
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
      const q = await fetchQuote(resolved);
      return NextResponse.json({ ...q, resolvedFrom: symbol });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "quote failed";
    return NextResponse.json({ error: msg, symbol }, { status: 502 });
  }
}
