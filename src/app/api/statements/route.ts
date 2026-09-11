import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";
import { fetchQuote, fetchYahooTable } from "@/lib/yahoo";
import { buildRatios } from "@/lib/ratios";

// Yahoo ledger (yfinance: income_stmt / balance_sheet / cash_flow) +
// screener.in shareholding split only. Everything else stays Yahoo.

const SCR_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function scrStrip(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

function scrNum(raw: string): number | null {
  const s = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!s || s === "—" || s === "-" || s === "–") return null;
  const v = Number(s);
  return isFinite(v) ? v : null;
}

interface SRow { label: string; values: (number | null)[]; raw: string[] }
interface STable { periods: string[]; rows: SRow[] }

function scrSection(html: string, id: string): STable | null {
  const start = html.indexOf(`<section id="${id}"`);
  if (start < 0) return null;
  const next = html.indexOf("<section", start + 10);
  const chunk = html.slice(start, next < 0 ? start + 200000 : next);
  const tm = chunk.match(/<table[\s\S]*?<\/table>/);
  if (!tm) return null;
  const rows: string[][] = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tm[0]))) {
    const cells: string[] = [];
    const cre = /<t[hd][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let c: RegExpExecArray | null;
    while ((c = cre.exec(m[1]))) cells.push(scrStrip(c[1]));
    if (cells.length > 1) rows.push(cells);
  }
  if (rows.length < 2) return null;
  return {
    periods: rows[0].slice(1),
    rows: rows.slice(1).map((r) => ({ label: r[0], raw: r.slice(1), values: r.slice(1).map(scrNum) })),
  };
}

async function fetchScreenerHoldings(base: string): Promise<STable | null> {
  try {
    const r = await fetch(`https://www.screener.in/company/${encodeURIComponent(base)}/`, {
      headers: { "User-Agent": SCR_UA, Accept: "text/html" },
      next: { revalidate: 21600 },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const html = await r.text();
    return scrSection(html, "shareholding");
  } catch {
    return null; // throttled/blocked → UI falls back to Yahoo holders proxy
  }
}

export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  const base = symbol.replace(/\.NS$|\.BO$/, "");
  try {
    const [pl, bs, cf, qtr, qtrCF, quote, sh] = await Promise.all([
      fetchYahooTable(symbol, "income", "annual"),
      fetchYahooTable(symbol, "balance-sheet", "annual").catch(() => null),
      fetchYahooTable(symbol, "cash-flow", "annual").catch(() => null),
      fetchYahooTable(symbol, "income", "quarterly").catch(() => null),
      fetchYahooTable(symbol, "cash-flow", "quarterly").catch(() => null),
      fetchQuote(symbol).catch(() => null),
      fetchScreenerHoldings(base),
    ]);
    if (!pl) throw new Error(`No income statement for ${symbol}`);
    const marketCapCr =
      typeof quote?.marketCap === "number" && isFinite(quote.marketCap) ? Math.round((quote.marketCap / 1e7) * 100) / 100 : null;
    const rat = buildRatios(pl, bs, cf);
    return NextResponse.json({
      symbol,
      name: quote?.longName || quote?.shortName || base,
      unit: "₹ CRORES",
      source: "yahoo-fundamentals-timeseries (yfinance) + screener.in holdings",
      ratios: {},
      marketCapCr,
      pl,
      bs,
      cf,
      sh,
      qtr,
      qtrCF,
      rat,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "statements failed", symbol }, { status: 502 });
  }
}
