// Yahoo Finance server helper — replaces yfinance in special.py.
// Uses the public v8 chart API (no key needed) with in-memory TTL cache,
// mirroring _YF_DOWNLOAD_CACHE (10 min) behaviour.

import type { OHLCBar, Quote } from "./types";
import { YF_INCOME_KEYS, YF_BALANCE_KEYS, YF_CASHFLOW_KEYS } from "./yfKeys";
import { isIndianTicker, localeForTicker, tickerCurrency } from "./utils";

const chartCache = new Map<string, { ts: number; data: OHLCBar[]; tick: LiveTick | null }>();
const quoteCache = new Map<string, { ts: number; data: Quote }>();

const CHART_TTL = 10 * 60 * 1000;
const QUOTE_TTL = 60 * 1000;

export function yahooHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "application/json",
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let YCOOKIE = "";
let cookieAt = 0;

async function ensureYahooCookies(force = false): Promise<void> {
  if (!force && YCOOKIE && Date.now() - cookieAt < 30 * 60 * 1000) return;
  try {
    const r = await fetch("https://fc.yahoo.com", {
      headers: { "User-Agent": yahooHeaders()["User-Agent"] },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const getSet = (r.headers as any).getSetCookie?.() as string[] | undefined;
    const parts = getSet ?? [];
    if (parts.length) {
      YCOOKIE = parts.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      cookieAt = Date.now();
    }
  } catch {
    /* keep stale cookies */
  }
}

// Yahoo throttles hard under desk-hopping load. Retry with pauses,
// fail over between mirrors, and refresh the fc.yahoo.com cookie jar on 401.
export async function yahooFetch(path: string, init?: RequestInit, retries = 2): Promise<Response> {
  let lastErr = "";
  await ensureYahooCookies();
  for (let attempt = 0; attempt <= retries; attempt++) {
    const host = attempt % 2 === 0 ? "query1" : "query2";
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com${path}`, {
        ...init,
        headers: { ...yahooHeaders(), ...(YCOOKIE ? { cookie: YCOOKIE } : {}), ...(init?.headers ?? {}) },
      });
      if (res.ok) return res;
      lastErr = `yahoo ${res.status}`;
      if (res.status === 401) await ensureYahooCookies(true);
      if (![429, 401, 500, 502, 503].includes(res.status)) break;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : "network failed";
    }
    if (attempt < retries) await sleep(1200 * (attempt + 1));
  }
  throw new Error(lastErr || "yahoo failed");
}

/**
 * Last print Yahoo knows about, pulled from the chart response's own `meta`.
 *
 * This is the only live-tick source that actually works on the free feed:
 * `/v7/finance/quote` is now 401-locked for every symbol, batched or not. The
 * chart endpoint carries `regularMarketPrice` and `regularMarketTime` alongside
 * the bars, so a desk that needs today's print gets it from the request it was
 * already making instead of paying for a second one.
 */
export interface LiveTick {
  price: number;
  /** Seconds since epoch of the most recent trade. */
  epoch: number;
}

interface ChartPayload {
  bars: OHLCBar[];
  tick: LiveTick | null;
}

async function fetchChart(symbol: string, range: string, interval: string): Promise<ChartPayload> {
  const key = `${symbol}|${range}|${interval}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.ts < CHART_TTL) return { bars: hit.data, tick: hit.tick };

  const url = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%7Csplit`;
  let res: Response;
  try {
    res = await yahooFetch(url, { next: { revalidate: 300 } });
  } catch (e: unknown) {
    // yahooFetch only gives up immediately on non-retryable codes (404 =
    // unknown symbol). Everything else is genuinely feed trouble.
    if (e instanceof Error && /yahoo 404/.test(e.message)) throw new UnknownSymbolError(symbol);
    throw e;
  }
  if (!res.ok) throw new Error(`Yahoo chart failed (${res.status}) for ${symbol}`);
  const j = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new UnknownSymbolError(symbol);
  const ts: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose as number[] | undefined;
  const bars: OHLCBar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close === null || close === undefined) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      time: ts[i],
      open: q.open?.[i] ?? close,
      high: q.high?.[i] ?? close,
      low: q.low?.[i] ?? close,
      close,
      volume: q.volume?.[i] ?? 0,
      adjClose: adj?.[i],
    });
  }
  const meta = result.meta ?? {};
  const price = meta.regularMarketPrice;
  const epoch = meta.regularMarketTime;
  const tick =
    typeof price === "number" && price > 0 && typeof epoch === "number" ? { price, epoch } : null;
  chartCache.set(key, { ts: Date.now(), data: bars, tick });
  if (!bars.length) throw new UnknownSymbolError(symbol);
  return { bars, tick };
}

export async function fetchHistory(symbol: string, range = "6mo", interval = "1d"): Promise<OHLCBar[]> {
  return (await fetchChart(symbol, range, interval)).bars;
}

/** Bars plus the exchange's last print, from the same single chart request. */
export async function fetchHistoryTick(
  symbol: string,
  range = "6mo",
  interval = "1d"
): Promise<{ bars: OHLCBar[]; tick: LiveTick | null }> {
  return fetchChart(symbol, range, interval);
}

// ---- Unknown-ticker handling ----
// A typo (APPL for AAPL) or company name (APPLE) 404s on the chart API.
// That is NOT feed throttling — it needs typo resolution, not a retry.
// UnknownSymbolError marks the case; searchSymbols/pickReplacement recover.

export class UnknownSymbolError extends Error {
  symbol: string;
  constructor(symbol: string) {
    super(`UNKNOWN TICKER ${symbol} — NO YAHOO TAPE`);
    this.name = "UnknownSymbolError";
    this.symbol = symbol;
  }
}

export interface SymbolHit {
  symbol: string;
  name: string;
  exch: string;
  type: string;
}

// Live Yahoo search (same source as /api/lookup) for typo recovery.
export async function searchSymbols(query: string, n = 4): Promise<SymbolHit[]> {
  const q = (query || "").trim().toUpperCase();
  if (!q) return [];
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`,
      { headers: yahooHeaders(), next: { revalidate: 120 }, signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) return [];
    const j = await r.json();
    const quotes = (j?.quotes ?? []) as any[];
    return quotes
      .filter((x) => x && x.symbol)
      .map((x) => ({
        symbol: String(x.symbol).toUpperCase(),
        name: String(x.shortname ?? x.longname ?? x.symbol).toUpperCase().slice(0, 44),
        exch: String(x.exchDisp ?? x.exchange ?? "").toUpperCase().slice(0, 12),
        type: String(x.quoteType ?? "").toUpperCase().slice(0, 10),
      }))
      .slice(0, Math.max(1, Math.min(8, n)));
  } catch {
    return [];
  }
}

// Best-effort typo recovery: exact symbol hit wins, else Yahoo's top rank
// (APPL → AAPL, APPLE → AAPL, RELIANEC → RELIANCE.NS).
export async function pickReplacement(symbol: string): Promise<{ resolved: string | null; suggestions: SymbolHit[] }> {
  const suggestions = await searchSymbols(symbol, 4);
  const exact = suggestions.find((s) => s.symbol === symbol);
  const top = exact ?? suggestions[0] ?? null;
  return { resolved: top ? top.symbol : null, suggestions };
}

/**
 * Build a Quote from a chart response's `meta`.
 *
 * Chart meta carries MORE of what a quote needs than the old v7 endpoint did in
 * practice: day high/low, 52-week high/low, real change percent, volume, name
 * and currency. What it genuinely does not carry is market cap, trailing/forward
 * PE, dividend yield, bid and ask. Those are left null rather than guessed — the
 * callers that want them already fall back to quoteSummary or derive them from
 * history, and a fabricated number is worse than an honest gap.
 */
function quoteFromChartMeta(symbol: string, meta: any, prevClose: number | null): Quote {
  const price = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : 0;
  // `regularMarketChange` is not in meta, but the previous close is, and the
  // chart's own bars give the settled close when it is not.
  const change =
    prevClose !== null && prevClose > 0 ? price - prevClose : (meta.fulldayChange ?? 0);
  const pct =
    typeof meta.regularMarketChangePercent === "number"
      ? meta.regularMarketChangePercent
      : prevClose && prevClose > 0
        ? (change / prevClose) * 100
        : 0;
  return {
    symbol: meta.symbol ?? symbol,
    shortName: meta.shortName ?? meta.longName ?? symbol,
    longName: meta.longName,
    currency: meta.currency ?? tickerCurrency(symbol),
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: pct,
    regularMarketVolume: meta.regularMarketVolume,
    bid: null,
    ask: null,
    marketCap: null,
    trailingPE: null,
    forwardPE: null,
    dividendYield: null,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
  };
}

/**
 * Live quote for one symbol.
 *
 * Built on `/v8/finance/chart`, NOT `/v7/finance/quote`. The v7 endpoint is gone:
 * it answers 401 for every symbol, batched or single, with or without the cookie
 * jar. The old code still called it, and because `yahooFetch` retries a 401 three
 * times with a cookie refresh and 1.2s/2.4s/3.6s of backoff, every cold load of a
 * desk spent ~4s discovering that, then discarded the result via `.catch(() =>
 * null)` and fell through to the history path below anyway.
 *
 * One chart call does it in ~90ms and returns strictly better data. Do not
 * "restore" the v7 call - it is not flaky, it is closed.
 */
export async function fetchQuote(symbol: string): Promise<Quote> {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.ts < QUOTE_TTL) return hit.data;
  const url =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1y&interval=1d&includePrePost=true`;
  try {
    const res = await yahooFetch(url, { next: { revalidate: 60 } });
    const result = (await res.json())?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) throw new Error(`No chart meta for ${symbol}`);
    const closes: number[] = (result?.indicators?.quote?.[0]?.close ?? []).filter(
      (v: unknown): v is number => typeof v === "number"
    );
    const prevClose = meta.chartPreviousClose ?? (closes.length > 1 ? closes[closes.length - 2] : null);
    const q = quoteFromChartMeta(symbol, meta, prevClose);
    quoteCache.set(symbol, { ts: Date.now(), data: q });
    return q;
  } catch {
    // Fallback: derive quote from last history bar
    const bars = await fetchHistory(symbol, "5d", "1d");
    const last = bars[bars.length - 1];
    if (!last) throw new Error(`No quote for ${symbol}`);
    const q: Quote = {
      symbol,
      shortName: symbol,
      currency: tickerCurrency(symbol),
      regularMarketPrice: last.close,
      regularMarketChange: bars.length > 1 ? last.close - bars[bars.length - 2].close : 0,
      regularMarketChangePercent: bars.length > 1 ? ((last.close - bars[bars.length - 2].close) / bars[bars.length - 2].close) * 100 : 0,
      regularMarketVolume: last.volume,
    };
    quoteCache.set(symbol, { ts: Date.now(), data: q });
    return q;
  }
}

let CRUMB = "";
let crumbAt = 0;

// Crumb-authed quoteSummary (recommendationTrend, earningsTrend, key stats).
// Works globally; v7 analyst fields are empty for some names so this is the
// fallback source.
export async function yahooQuoteSummary(symbol: string, modules: string): Promise<any> {
  const load = async (): Promise<any> => {
    if (!CRUMB || Date.now() - crumbAt > 30 * 60 * 1000) {
      await ensureYahooCookies(true);
      const r = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
        headers: { "User-Agent": yahooHeaders()["User-Agent"], Accept: "*/*", ...(YCOOKIE ? { cookie: YCOOKIE } : {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) throw new Error(`crumb ${r.status}`);
      CRUMB = (await r.text()).trim();
      crumbAt = Date.now();
    }
    const res = await yahooFetch(
      `/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(CRUMB)}`,
      { next: { revalidate: 600 } }
    );
    const j = await res.json();
    const out = j?.quoteSummary?.result?.[0];
    if (!out) throw new Error("no summary");
    return out;
  };
  try {
    return await load();
  } catch (e) {
    CRUMB = ""; // stale crumb → refresh once and retry
    return await load();
  }
}

// Crumb for routes that need POST auth (finance/screener, quoteSummary).
// Refreshes the cookie jar first, exactly like yahooQuoteSummary does.
export async function yahooCrumb(force = false): Promise<string> {
  if (!CRUMB || force || Date.now() - crumbAt > 30 * 60 * 1000) {
    await ensureYahooCookies(true);
    const r = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": yahooHeaders()["User-Agent"], Accept: "*/*", ...(YCOOKIE ? { cookie: YCOOKIE } : {}) },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`crumb ${r.status}`);
    CRUMB = (await r.text()).trim();
    crumbAt = Date.now();
  }
  return CRUMB;
}

export function barsToCloses(bars: OHLCBar[]): number[] {
  return bars.map((b) => b.close);
}
export function barsToHighs(bars: OHLCBar[]): number[] {
  return bars.map((b) => b.high);
}
export function barsToLows(bars: OHLCBar[]): number[] {
  return bars.map((b) => b.low);
}
export function barsToVolumes(bars: OHLCBar[]): number[] {
  return bars.map((b) => b.volume);
}

// ---- yfinance-compatible fundamentals (fundamentals-timeseries) ----
// Same source Python yfinance uses for Ticker.income_stmt / balance_sheet /
// cash_flow: ws/fundamentals-timeseries with annual/quarterly types.
// Yahoo-only: no screener.in scraping.

export interface YFTable {
  periods: string[];
  rows: Array<{ label: string; values: (number | null)[]; raw: string[] }>;
}

const STMT_CACHE = new Map<string, { ts: number; data: YFTable }>();
const STMT_TTL = 6 * 60 * 60 * 1000;
const YF_PERIOD1 = Math.floor(new Date("2016-12-31T00:00:00Z").getTime() / 1000);

// Per-share / count / rate keys stay raw; everything else is currency.
// Indian listings scale to ₹ Cr (÷1e7); global listings scale to millions
// (÷1e6) so AAPL-scale numbers stay readable.
// NOTE: do NOT use substring "ratio" — it false-positives "OpeRATIO n".
function noScale(key: string): boolean {
  return /(eps|pershare|dividendpershare|^taxrateforcalcs|averageshares|sharesnumber|^shareissued|treasurysharesnumber|preferredsharesnumber|ordinarysharesnumber)$/i.test(
    key
  );
}

function prettyLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

function fmtPeriod(asOf: string): string {
  // asOf: "2024-03-31" -> "Mar 2024"
  const d = new Date(asOf.length <= 10 ? asOf + "T00:00:00Z" : asOf);
  if (isNaN(d.getTime())) return asOf.slice(0, 10);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCFullYear()}`;
}

async function fetchTimeseriesChunk(symbol: string, timescale: "annual" | "quarterly", keys: string[]): Promise<any[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const CHUNK = 50;
  const out: any[] = [];
  // Ensure crumb is warm (yahooQuoteSummary refreshes it); timeseries needs it too.
  if (!CRUMB || Date.now() - crumbAt > 30 * 60 * 1000) {
    try {
      await yahooQuoteSummary(symbol, "price");
    } catch {
      /* timeseries fetch will surface the real error */
    }
  }
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const types = chunk.map((k) => timescale + k).join(",");
    const path =
      `/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}` +
      `?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(types)}` +
      `&period1=${YF_PERIOD1}&period2=${period2}&crumb=${encodeURIComponent(CRUMB)}`;
    try {
      const res = await yahooFetch(path, { next: { revalidate: 21600 } });
      const j = await res.json();
      const arr = j?.timeseries?.result ?? [];
      out.push(...arr);
    } catch {
      /* skip failed chunk — other chunks still give partial ledger */
    }
  }
  return out;
}

function timeseriesToTable(raw: any[], timescale: "annual" | "quarterly", orderedKeys: string[], symbol: string): YFTable {
  // date -> key -> value (raw listing currency)
  const indian = isIndianTicker(symbol);
  const locale = localeForTicker(symbol);
  const divisor = indian ? 1e7 : 1e6; // ₹ Cr vs global millions
  const dateMap = new Map<string, Map<string, number | null>>();
  for (const entry of raw) {
    const dataKey = Object.keys(entry).find((k) => k !== "meta" && k !== "timestamp");
    if (!dataKey) continue;
    const key = dataKey.replace(new RegExp(`^${timescale}`), "");
    const arr = entry[dataKey] as Array<{ asOfDate?: string; reportedValue?: { raw?: number } }>;
    if (!Array.isArray(arr)) continue;
    for (const pt of arr) {
      const asOf = typeof pt?.asOfDate === "string" ? pt.asOfDate.slice(0, 10) : null;
      if (!asOf) continue;
      if (!dateMap.has(asOf)) dateMap.set(asOf, new Map());
      const v = pt?.reportedValue?.raw;
      dateMap.get(asOf)!.set(key, typeof v === "number" && isFinite(v) ? v : null);
    }
  }
  const dates = Array.from(dateMap.keys()).sort();
  // Yahoo caps at 4 annual / 5 quarterly — keep last 8 for UI parity.
  const keep = dates.slice(-8);
  const periods = keep.map(fmtPeriod);
  const rows: YFTable["rows"] = [];
  for (const key of orderedKeys) {
    const vals: (number | null)[] = [];
    let hasAny = false;
    const scale = noScale(key) ? 1 : divisor;
    for (const d of keep) {
      const rawV = dateMap.get(d)?.get(key) ?? null;
      if (rawV !== null && rawV !== undefined) {
        hasAny = true;
        const v = rawV / scale;
        vals.push(Math.round(v * 100) / 100);
      } else {
        vals.push(null);
      }
    }
    if (!hasAny) continue;
    rows.push({
      label: prettyLabel(key),
      values: vals,
      raw: vals.map((v) => (v === null ? "—" : v.toLocaleString(locale))),
    });
  }
  return { periods, rows };
}

export async function fetchYahooTable(
  symbol: string,
  statement: "income" | "balance-sheet" | "cash-flow",
  freq: "annual" | "quarterly" = "annual"
): Promise<YFTable> {
  const timescale = freq === "annual" ? "annual" : "quarterly";
  const cacheKey = `${symbol}|${statement}|${timescale}`;
  const hit = STMT_CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < STMT_TTL) return hit.data;
  const keys = statement === "income" ? YF_INCOME_KEYS : statement === "balance-sheet" ? YF_BALANCE_KEYS : YF_CASHFLOW_KEYS;
  const raw = await fetchTimeseriesChunk(symbol, timescale, keys);
  if (!raw.length) throw new Error(`No ${statement} ${freq} data for ${symbol}`);
  const table = timeseriesToTable(raw, timescale, keys, symbol);
  if (!table.periods.length || !table.rows.length) throw new Error(`Empty ${statement} ${freq} for ${symbol}`);
  STMT_CACHE.set(cacheKey, { ts: Date.now(), data: table });
  return table;
}
