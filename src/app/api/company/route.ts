import { NextRequest, NextResponse } from "next/server";
import { fetchHistory, fetchQuote, yahooQuoteSummary } from "@/lib/yahoo";
import type { OHLCBar, Quote } from "@/lib/types";
import { normalizeTicker } from "@/lib/utils";

// Real per-security profile from live quote + history (no key needed).
// Partial responses: if one leg is throttled, serve the other with flags
// instead of failing the whole desk.
const R = (o: any, ...keys: string[]): number | null => {
  for (const k of keys) {
    const v = o?.[k];
    const n = v && typeof v === "object" ? (v as any).raw : v;
    if (typeof n === "number" && isFinite(n)) return n;
  }
  return null;
};
const S = (o: any, ...keys: string[]): string | null => {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
};
// Yahoo sometimes reports yields/holdings as percent units (0.46 = 0.46%)
// instead of ratios — normalize anything in (1, 100] down to a ratio.
const asRatio = (v: number | null): number | null =>
  v === null ? null : v > 1 && v <= 100 ? v / 100 : v;

const profCache = new Map<string, { ts: number; data: any }>();
const PROF_TTL = 10 * 60 * 1000;

async function fetchProfile(symbol: string, base: string, pxFall: number | null): Promise<any> {
  const hit = profCache.get(symbol);
  if (hit && Date.now() - hit.ts < PROF_TTL) return hit.data;
  const qs = await yahooQuoteSummary(
    symbol,
    "price,summaryDetail,defaultKeyStatistics,financialData,calendarEvents,assetProfile,quoteType"
  );
  const price = qs.price ?? {}, sd = qs.summaryDetail ?? {}, ks = qs.defaultKeyStatistics ?? {},
    fd = qs.financialData ?? {}, ce = qs.calendarEvents ?? {}, ap = qs.assetProfile ?? {}, qt = qs.quoteType ?? {};
  const pxRef = R(price, "regularMarketPrice") ?? pxFall;
  const divRate = R(sd, "dividendRate", "trailingAnnualDividendRate");
  let divYield = asRatio(R(sd, "dividendYield", "trailingAnnualDividendYield"));
  if ((divYield === null || divYield > 0.25) && divRate !== null && pxRef) divYield = divRate / pxRef;
  const officers = Array.isArray(ap.companyOfficers) ? ap.companyOfficers : [];
  const prof = {
    name: S(price, "longName", "shortName") ?? S(qt, "longName", "shortName") ?? S(ap, "longName") ?? base,
    exchange: S(qt, "exchange") ?? S(price, "exchangeName"),
    currency: S(price, "currency") ?? S(qt, "currency") ?? "INR",
    sector: S(ap, "sector"), industry: S(ap, "industry"),
    website: S(ap, "website"),
    city: S(ap, "city"), state: S(ap, "state"), country: S(ap, "country"),
    employees: R(ap, "fullTimeEmployees"),
    summary: S(ap, "longBusinessSummary"),
    price: {
      px: pxRef,
      prevClose: R(sd, "previousClose", "regularMarketPreviousClose") ?? R(price, "regularMarketPreviousClose"),
      open: R(sd, "open") ?? R(price, "regularMarketOpen"),
      high: R(sd, "dayHigh") ?? R(price, "regularMarketDayHigh"),
      low: R(sd, "dayLow") ?? R(price, "regularMarketDayLow"),
      hi52: R(sd, "fiftyTwoWeekHigh") ?? R(price, "fiftyTwoWeekHigh"),
      lo52: R(sd, "fiftyTwoWeekLow") ?? R(price, "fiftyTwoWeekLow"),
      ma50: R(price, "fiftyDayAverage"), ma200: R(price, "twoHundredDayAverage"),
      vol: R(price, "regularMarketVolume"),
      avgVol: R(price, "averageDailyVolume3Month", "averageVolume"),
      avgVol10: R(price, "averageDailyVolume10Day"),
      beta: R(ks, "beta") ?? R(sd, "beta"),
    },
    valuation: {
      mktCap: R(price, "marketCap"), ev: R(ks, "enterpriseValue"),
      trailPE: R(sd, "trailingPE") ?? R(ks, "trailingPE"), fwdPE: R(ks, "forwardPE"),
      peg: R(ks, "pegRatio"), pb: R(ks, "priceToBook"),
      ps: R(sd, "priceToSalesTrailing12Months"),
      evEbitda: R(ks, "enterpriseToEbitda"), evRev: R(ks, "enterpriseToRevenue"),
      trailEps: R(ks, "trailingEps") ?? R(sd, "trailingEps"), fwdEps: R(ks, "forwardEps"),
      book: R(ks, "bookValue"),
    },
    dividends: {
      rate: divRate, yield: divYield, payout: asRatio(R(sd, "payoutRatio")),
      exDiv: R(sd, "exDividendDate") ?? R(ce, "exDividendDate"),
    },
    events: {
      earnDate: (() => {
        const e = (ce as any)?.earnings;
        const arr = Array.isArray(e?.earningsDate) ? e.earningsDate : [];
        const t = arr.map((x: any) => (x && typeof x === "object" ? x.raw : x)).find((n: any) => typeof n === "number" && isFinite(n));
        return typeof t === "number" ? t : null;
      })(),
    },
    financials: {
      revenue: R(fd, "totalRevenue"), gross: R(fd, "grossProfits"), ebitda: R(fd, "ebitda"),
      net: R(ks, "netIncomeToCommon") ?? R(fd, "netIncomeToCommon"),
      ocf: R(fd, "operatingCashflow"), fcf: R(fd, "freeCashflow"),
      cash: R(fd, "totalCash"), debt: R(fd, "totalDebt"),
      revGrowth: asRatio(R(fd, "revenueGrowth")), earnGrowth: asRatio(R(fd, "earningsGrowth")),
      earnQGrowth: asRatio(R(ks, "earningsQuarterlyGrowth")),
    },
    margins: {
      gross: asRatio(R(fd, "grossMargins")), oper: asRatio(R(fd, "operatingMargins")),
      net: asRatio(R(fd, "profitMargins")), ebitda: asRatio(R(fd, "ebitdaMargins")),
      roe: asRatio(R(fd, "returnOnEquity")), roa: asRatio(R(fd, "returnOnAssets")),
    },
    holders: {
      sharesOut: R(ks, "sharesOutstanding"), float: R(ks, "floatShares"),
      shortRatio: R(ks, "shortRatio"), shortPct: asRatio(R(ks, "shortPercentOfFloat")),
      insider: asRatio(R(ks, "heldPercentInsiders")), instit: asRatio(R(ks, "heldPercentInstitutions")),
    },
    officers: officers.slice(0, 6).map((o: any) => ({ name: String(o.name ?? "—"), title: String(o.title ?? "") })),
  };
  profCache.set(symbol, { ts: Date.now(), data: prof });
  return prof;
}
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  const base = symbol.replace(/\.NS$|\.BO$/, "");
  let quote: Quote | null = null;
  let quoteErr = "";
  let bars: OHLCBar[] = [];
  let histErr = "";
  try {
    quote = await fetchQuote(symbol);
  } catch (e: unknown) {
    quoteErr = e instanceof Error ? e.message : "quote failed";
  }
  try {
    bars = await fetchHistory(symbol, "1y", "1d");
  } catch (e: unknown) {
    histErr = e instanceof Error ? e.message : "history failed";
  }
  if (!quote && bars.length === 0) {
    return NextResponse.json({ error: quoteErr || histErr || "profile failed", symbol }, { status: 502 });
  }
  const vols = bars.map((b) => b.volume || 0);
  const avgVol = vols.length ? vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length) : 0;
  const lastClose = bars.length ? bars[bars.length - 1].close : 0;
  const hi52 = quote?.fiftyTwoWeekHigh ?? (bars.length ? Math.max(...bars.map((b) => b.high)) : null);
  const lo52 = quote?.fiftyTwoWeekLow ?? (bars.length ? Math.min(...bars.map((b) => b.low)) : null);
  const px = quote?.regularMarketPrice ?? lastClose;
  let profile: any = null;
  let profileErr = "";
  try {
    profile = await fetchProfile(symbol, base, px || null);
  } catch (e: unknown) {
    profileErr = e instanceof Error ? e.message : "profile failed";
  }
  // Yahoo omits 50/200D averages for some NSE names — derive from our 1Y bars.
  if (profile?.price && bars.length >= 50) {
    const closes = bars.map((b) => b.close);
    const mean = (n: number) => {
      const s = closes.slice(-n);
      return Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 100) / 100;
    };
    if (profile.price.ma50 == null) profile.price.ma50 = mean(Math.min(50, closes.length));
    if (profile.price.ma200 == null) profile.price.ma200 = mean(Math.min(200, closes.length));
  }
  // quoteSummary legs win over the thin v7 quote where present.
  const mktCap = profile?.valuation?.mktCap ?? quote?.marketCap ?? null;
  const trailPE = profile?.valuation?.trailPE ?? quote?.trailingPE ?? null;
  const fwdPE = profile?.valuation?.fwdPE ?? quote?.forwardPE ?? null;
  const yld = profile?.dividends?.yield ?? (quote?.dividendYield != null ? asRatio(quote.dividendYield as number) : null);
  const pHi52 = profile?.price?.hi52 ?? hi52;
  const pLo52 = profile?.price?.lo52 ?? lo52;
  const pPx = profile?.price?.px ?? px;
  const pAvgVol = profile?.price?.avgVol ?? Math.round(avgVol);
  return NextResponse.json({
    symbol,
    quote,
    profile,
    partial: !quote || bars.length === 0 || !profile,
    errors: { quote: quoteErr || null, history: histErr || null, profile: profileErr || null },
    derived: {
      offHighPct: pHi52 ? Math.round(((pPx - pHi52) / pHi52) * 10000) / 100 : null,
      offLowPct: pLo52 ? Math.round(((pPx - pLo52) / pLo52) * 10000) / 100 : null,
      avgVol20: Math.round(pAvgVol),
      yieldPct: yld !== null ? Math.round(yld * 10000) / 100 : null,
      mktCap, trailPE, fwdPE,
    },
    links: {
      screener: `https://www.screener.in/company/${encodeURIComponent(base)}/`,
      tradingview: `https://www.tradingview.com/chart/?symbol=NSE%3A${encodeURIComponent(base)}`,
      yahoo: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    },
  });
}
