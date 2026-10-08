import { NextRequest, NextResponse } from "next/server";
import { currencySymbol, isIndianTicker, normalizeTicker, stripYahooSuffix, tickerCurrency } from "@/lib/utils";
import { fetchQuote, fetchYahooTable } from "@/lib/yahoo";
import { buildRatios } from "@/lib/ratios";
import { resolveXbrl } from "@/lib/filingsSource";
import type { StatementSet } from "@/lib/types";

// Statements, filings-first.
//
// Yahoo's fundamentals-timeseries remains as a fail-open leg and as the thing
// the filings are compared against, but the PRIMARY source is now the
// registrant's own filings (SEC EDGAR XBRL, or NSE integrated-filing XBRL) —
// see lib/filings.ts for the canonical line map, whose labels deliberately
// reproduce Yahoo's vocabulary so the consuming desks need no fork.
//
// Yahoo keeps three jobs here: it is the fallback when a filing block is
// absent (an NSE Q1 filing carries no balance sheet, and blanking a working
// vendor table for that would be a regression), it supplies the quote, and it
// supplies the comparison that makes the disagreement visible.

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

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** 2025-09-27 -> "SEP-25", so a filings column reads like a vendor column. */
function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return iso ?? "";
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]}-${m[1].slice(2)}`;
}

const nn = (s: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Project a filings StatementSet onto the STable shape this route already
 * returns. Labels come from the canonical map, which deliberately reproduces
 * Yahoo's `prettyLabel()` vocabulary so the consuming regexes in
 * StatementsTerminal / FundaDesks match either source without a fork.
 *
 * Values are scaled into the SAME unit the Yahoo tables already use — millions
 * of currency, or ₹ crore for Indian listings — because every consumer reads
 * `unit` off the payload to format. Emitting raw dollars next to a "USD
 * MILLIONS" label made every number read as a 100-million-% discrepancy and
 * rendered as trillions on screen.
 *
 * Yahoo's annual table carries at most 4 periods and quarterly at most 5;
 * filings carry more, so the projection is trimmed to keep the two comparable.
 *
 * The ORDER matters as much as the unit: EDGAR facts are bucketed newest-first
 * (so a restatement sits at the left edge), while every Yahoo table in this app
 * runs oldest-first. Projecting filings in EDGAR's order reversed the columns
 * of every statement on the desk, and — because the disagreement check then
 * compared filing column 0 against vendor column 0 — made two sources that
 * agree to the rupee look 5-14% apart. So the projection reverses to the house
 * order. The filings desk keeps newest-first because it reads the other way.
 */
function toSTable(set: StatementSet, block: "is" | "bs" | "cf", limit: number): STable | null {
  const periods = set.periods.slice(0, limit);
  if (!periods.length) return null;
  const rows = set[block].lines
    .filter((l) => l.unit === "money")
    .map((l) => ({
      label: l.label,
      values: [...l.values].slice(0, limit).map((v) => (v === null ? null : v / (set.divisor || 1))).reverse(),
      raw: [] as string[],
    }))
    .filter((r) => r.values.some((v) => v !== null));
  if (!rows.length) return null;
  return { periods: periods.map((p) => shortDay(p.end)).reverse(), rows };
}

/**
 * "SEP-25" and "Sep 2025" are the same period. Comparing the two feeds by
 * column index is what made identical numbers look 12% apart, so the period is
 * normalised to YYYY-MM and matched on that.
 */
function periodKey(label: string): string {
  const s = (label ?? "").trim();
  // Accepts "SEP-25", "Sep 2025", "SEP 2025" and "2025-09-27".
  const a = /^([A-Za-z]{3,})[-\s](\d{2}|\d{4})$/.exec(s);
  if (a) {
    const m = MONTHS.findIndex((x) => x === a[1].toUpperCase());
    if (m >= 0) return `${a[2].length === 2 ? `20${a[2]}` : a[2]}-${String(m + 1).padStart(2, "0")}`;
  }
  const b = /^(\d{4})-(\d{2})/.exec(s);
  return b ? `${b[1]}-${b[2]}` : s;
}

/**
 * How far the two sources disagree on a headline line, in percent. This is the
 * single most useful honesty signal on the desk: where filings and a vendor
 * feed differ materially, the filing is the primary source and the reader
 * should be told rather than left to assume they agree.
 */
function disagreement(
  filings: STable | null,
  yahoo: STable | null,
  labels: string[]
): Array<{ label: string; filings: number | null; yahoo: number | null; diffPct: number | null }> {
  // The most recent period both feeds carry, matched by name.
  const shared = new Map<string, string>();
  for (const p of filings?.periods ?? []) shared.set(periodKey(p), p);
  let key: string | null = null;
  for (const p of yahoo?.periods ?? []) {
    if (shared.has(periodKey(p))) {
      key = periodKey(p);
      break;
    }
  }
  const read = (t: STable | null, label: string): number | null => {
    if (!t || !key) return null;
    const i = t.periods.findIndex((p) => periodKey(p) === key);
    if (i < 0) return null;
    const v = t.rows.find((r) => nn(r.label) === nn(label))?.values[i];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const out: Array<{ label: string; filings: number | null; yahoo: number | null; diffPct: number | null }> = [];
  for (const label of labels) {
    const f = read(filings, label);
    const y = read(yahoo, label);
    const diffPct = f !== null && y !== null && y !== 0 ? ((f - y) / Math.abs(y)) * 100 : null;
    out.push({ label, filings: f, yahoo: y, diffPct });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  // filings (default) | yahoo | auto. `filings` is the primary source but is
  // allowed to be absent; `auto` additionally falls back, so a broker outage
  // degrades the panel instead of emptying it.
  const wantSource = (sp.get("source") || "auto").toLowerCase();
  const base = stripYahooSuffix(symbol);
  const indian = isIndianTicker(symbol);
  const indBasis = (sp.get("basis") === "Standalone" ? "Standalone" : "Consolidated") as "Consolidated" | "Standalone";
  // screener.in only covers Indian listings — skip for global tickers.
  const holdingsPromise = indian ? fetchScreenerHoldings(base) : Promise.resolve(null);

  const filingsLeg = async () => {
    if (wantSource === "yahoo") return null;
    // In-process, never over HTTP: a self-request would need a resolvable
    // origin, and would silently degrade to Yahoo on any deployment without one.
    const r = await resolveXbrl(symbol, { ua: sp.get("secua"), basis: indBasis });
    return r;
  };

  try {
    const [pl, bs, cf, qtr, qtrCF, quote, sh, fil] = await Promise.all([
      fetchYahooTable(symbol, "income", "annual"),
      fetchYahooTable(symbol, "balance-sheet", "annual").catch(() => null),
      fetchYahooTable(symbol, "cash-flow", "annual").catch(() => null),
      fetchYahooTable(symbol, "income", "quarterly").catch(() => null),
      fetchYahooTable(symbol, "cash-flow", "quarterly").catch(() => null),
      fetchQuote(symbol).catch(() => null),
      holdingsPromise,
      wantSource === "yahoo" ? Promise.resolve(null) : filingsLeg(),
    ]);

    const filingsUsable = !!(fil && fil.ok && fil.annual);
    // Filings are primary. Yahoo still runs and still answers, so the two can be
    // compared and so a filings outage degrades to a labelled vendor feed.
    const sourceName = !wantSource || wantSource === "yahoo" ? "yahoo" : filingsUsable ? "filings" : "yahoo-fallback";
    if (sourceName === "yahoo" && !pl) throw new Error(`No income statement for ${symbol}`);

    const currency = quote?.currency ?? tickerCurrency(symbol);
    const curSym = currencySymbol(currency);
    const divisor = indian ? 1e7 : 1e6;
    const marketCapCr =
      typeof quote?.marketCap === "number" && isFinite(quote.marketCap) ? Math.round((quote.marketCap / divisor) * 100) / 100 : null;
    const rat = buildRatios(pl, bs, cf);

    const f: any = filingsUsable ? fil : null;
    const fAnnual = f ? toSTable(f.annual, "is", 4) : null;
    const fBs = f ? toSTable(f.annual, "bs", 4) : null;
    const fCf = f ? toSTable(f.annual, "cf", 4) : null;
    const fQtr = f ? toSTable(f.quarterly, "is", 5) : null;
    const fQtrCf = f ? toSTable(f.quarterly, "cf", 5) : null;

    // Only substitute a block the filings leg actually produced. A missing
    // balance sheet (Q1/Q3 NSE filings) must not blank a working Yahoo one.
    const outPl = sourceName === "filings" && fAnnual ? fAnnual : pl;
    const outBs = sourceName === "filings" && fBs ? fBs : bs;
    const outCf = sourceName === "filings" && fCf ? fCf : cf;
    const outQtr = sourceName === "filings" && fQtr ? fQtr : qtr;
    const outQtrCf = sourceName === "filings" && fQtrCf ? fQtrCf : qtrCF;
    const fromYahoo = [
      sourceName === "filings" && !fAnnual ? "income" : null,
      sourceName === "filings" && !fBs ? "balance sheet" : null,
      sourceName === "filings" && !fCf ? "cash flow" : null,
      sourceName === "filings" && !fQtr ? "quarterly income" : null,
    ].filter(Boolean) as string[];

    return NextResponse.json({
      symbol,
      name: (f?.annual?.entity as string) || quote?.longName || quote?.shortName || base,
      // The unit label always describes the vendor's convention, because that is
      // the shape the whole terminal formats against.
      unit: indian ? "₹ CRORES" : `${currency.toUpperCase()} MILLIONS`,
      filingsUnit: f?.annual?.unit ?? null,
      currency,
      currencySymbol: curSym,
      indian,
      source: sourceName,
      sourceDetail:
        sourceName === "filings"
          ? `${f.annual.region === "IN" ? "NSE integrated-filing XBRL" : "SEC EDGAR XBRL"} / ${f.annual.taxonomy}`
          : sourceName === "yahoo-fallback"
            ? `yahoo-fundamentals-timeseries — FILINGS LEG FAILED: ${f?.error ?? "unavailable"}`
            : indian
              ? "yahoo-fundamentals-timeseries (yfinance) + screener.in holdings"
              : "yahoo-fundamentals-timeseries (yfinance)",
      filingsTaxonomy: f?.annual?.taxonomy ?? null,
      filingsAsOf: f?.annual?.asOf ?? null,
      filingsDocuments: f?.documents ?? null,
      // Per-leg provenance, so a partial substitution is visible rather than
      // presented as a single clean source.
      partial: fromYahoo.length > 0,
      errors: { filings: filingsUsable ? null : fil?.error ?? "filings leg unavailable", yahoo: pl ? null : "income statement unavailable" },
      blocksFromYahoo: fromYahoo,
      disagreement: disagreement(fAnnual ?? pl, pl, ["Total Revenue", "Operating Income", "Net Income", "Gross Profit"]),
      // The two feeds are only comparable when they carry the same labelled
      // period; otherwise the numbers are on different bases and a percentage
      // between them would be a fiction.
      disagreementComparable: !!(fAnnual ?? pl) && pl && !!(() => {
        const a = (fAnnual ?? pl) as STable;
        return a.periods.some((p) => (pl as STable).periods.some((q) => periodKey(p) === periodKey(q)));
      })(),
      ratios: {},
      marketCapCr,
      marketCap: quote?.marketCap ?? null,
      pl: outPl,
      bs: outBs,
      cf: outCf,
      sh,
      qtr: outQtr,
      qtrCF: outQtrCf,
      rat,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "statements failed", symbol }, { status: 502 });
  }
}
