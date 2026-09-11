import { NextRequest, NextResponse } from "next/server";
import { yahooHeaders } from "@/lib/yahoo";
import { WATCHLIST } from "@/lib/watchlist";

export interface LookupRow {
  symbol: string;
  name: string;
  exch: string;
  type: string;
  local?: boolean;
}

// Yahoo search omits some resolvable symbols (notably INR crosses) —
// keep them directly addressable.
const ALIASES: LookupRow[] = [
  { symbol: "USDINR=X", name: "USD / INR", exch: "CCY", type: "CURRENCY", local: true },
  { symbol: "EURINR=X", name: "EURO / INR", exch: "CCY", type: "CURRENCY", local: true },
  { symbol: "GBPINR=X", name: "GBP / INR", exch: "CCY", type: "CURRENCY", local: true },
  { symbol: "JPYINR=X", name: "JPY / INR", exch: "CCY", type: "CURRENCY", local: true },
  { symbol: "^NSEI", name: "NIFTY 50", exch: "NSE", type: "INDEX", local: true },
  { symbol: "^NSEBANK", name: "NIFTY BANK", exch: "NSE", type: "INDEX", local: true },
  { symbol: "^BSESN", name: "SENSEX", exch: "BSE", type: "INDEX", local: true },
  { symbol: "^INDIAVIX", name: "INDIA VIX", exch: "NSE", type: "INDEX", local: true },
  { symbol: "^CNXIT", name: "NIFTY IT", exch: "NSE", type: "INDEX", local: true },
  { symbol: "GC=F", name: "GOLD FUTURE", exch: "COMEX", type: "FUTURE", local: true },
  { symbol: "SI=F", name: "SILVER FUTURE", exch: "COMEX", type: "FUTURE", local: true },
  { symbol: "CL=F", name: "CRUDE OIL FUTURE", exch: "NYMEX", type: "FUTURE", local: true },
  { symbol: "NG=F", name: "NAT GAS FUTURE", exch: "NYMEX", type: "FUTURE", local: true },
  { symbol: "BTC-USD", name: "BITCOIN USD", exch: "CCC", type: "CRYPTO", local: true },
  { symbol: "ETH-USD", name: "ETHEREUM USD", exch: "CCC", type: "CRYPTO", local: true },
];

// Bloomberg-style security lookup: live Yahoo search first,
// local 2,260-symbol watchlist as fallback/merge.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toUpperCase();
  if (!q) return NextResponse.json({ q, rows: [] });
  const rows: LookupRow[] = [];
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`;
    const r = await fetch(url, { headers: yahooHeaders(), next: { revalidate: 120 } });
    if (r.ok) {
      const j = await r.json();
      const quotes = (j?.quotes ?? []) as any[];
      const mapped = quotes
        .filter((x) => x.symbol)
        .map((x) => ({
          symbol: String(x.symbol).toUpperCase(),
          name: String(x.shortname ?? x.longname ?? x.symbol).toUpperCase().slice(0, 44),
          exch: String(x.exchDisp ?? x.exchange ?? "").toUpperCase().slice(0, 12),
          type: String(x.quoteType ?? "").toUpperCase().slice(0, 10),
        }));
      mapped.sort((a, b) => {
        // Exact symbol match always wins (GC=F, BTC-USD, ^NSEI…).
        const ae = a.symbol === q ? 0 : 1;
        const be = b.symbol === q ? 0 : 1;
        if (ae !== be) return ae - be;
        const ai = /NSI|NSE|BSE|\.NS$|\.BO$/.test(a.exch + " " + a.symbol) ? 0 : 1;
        const bi = /NSI|NSE|BSE|\.NS$|\.BO$/.test(b.exch + " " + b.symbol) ? 0 : 1;
        return ai - bi;
      });
      rows.push(...mapped);
    }
  } catch { /* fall through to local */ }
  const seen = new Set(rows.map((r) => r.symbol));
  for (const a of ALIASES) {
    if (rows.length >= 8) break;
    if (!seen.has(a.symbol) && (a.symbol.includes(q) || a.name.includes(q))) {
      seen.add(a.symbol);
      // Exact alias hits jump the queue — right after any exact Yahoo hit.
      const at = rows.findIndex((r) => r.symbol !== q);
      rows.splice(at < 0 ? rows.length : at, 0, a);
    }
  }
  for (const w of WATCHLIST) {
    if (rows.length >= 8) break;
    if (w.includes(q) && !seen.has(w)) {
      seen.add(w);
      rows.push({ symbol: w, name: w.replace(/\.NS$|\.BO$/, ""), exch: w.endsWith(".BO") ? "BSE" : "NSE", type: "EQ", local: true });
    }
  }
  return NextResponse.json({ q, rows: rows.slice(0, 8) });
}
