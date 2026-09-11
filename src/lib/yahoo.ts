// Yahoo Finance server helper — replaces yfinance in special.py.
// Uses the public v8 chart API (no key needed) with in-memory TTL cache,
// mirroring _YF_DOWNLOAD_CACHE (10 min) behaviour.

import type { OHLCBar, Quote } from "./types";
import { YF_INCOME_KEYS, YF_BALANCE_KEYS, YF_CASHFLOW_KEYS } from "./yfKeys";

const chartCache = new Map<string, { ts: number; data: OHLCBar[] }>();
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

export async function fetchHistory(symbol: string, range = "6mo", interval = "1d"): Promise<OHLCBar[]> {
  const key = `${symbol}|${range}|${interval}`;
  const hit = chartCache.get(key);
  if (hit && Date.now() - hit.ts < CHART_TTL) return hit.data;

  const url = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%7Csplit`;
  const res = await yahooFetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`Yahoo chart failed (${res.status}) for ${symbol}`);
  const j = await res.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
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
  chartCache.set(key, { ts: Date.now(), data: bars });
  return bars;
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.ts < QUOTE_TTL) return hit.data;
  const url = `/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  try {
    const res = await yahooFetch(url, { next: { revalidate: 60 } });
    const j = await res.json();
    const r = j?.quoteResponse?.result?.[0];
    if (!r) throw new Error(`No quote for ${symbol}`);
    const q: Quote = {
      symbol: r.symbol ?? symbol,
      shortName: r.shortName ?? r.longName ?? symbol,
      longName: r.longName,
      currency: r.currency ?? "INR",
      regularMarketPrice: r.regularMarketPrice ?? 0,
      regularMarketChange: r.regularMarketChange ?? 0,
      regularMarketChangePercent: r.regularMarketChangePercent ?? 0,
      regularMarketVolume: r.regularMarketVolume,
      bid: typeof r.bid === "number" ? r.bid : null,
      ask: typeof r.ask === "number" ? r.ask : null,
      marketCap: r.marketCap ?? null,
      trailingPE: r.trailingPE ?? null,
      forwardPE: r.forwardPE ?? null,
      dividendYield: r.dividendYield ?? null,
      fiftyTwoWeekHigh: r.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: r.fiftyTwoWeekLow ?? null,
    };
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
      currency: symbol.endsWith(".NS") ? "INR" : "USD",
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
// Works for NSE names where v7 analyst fields come back empty.
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

// Per-share / count / rate keys stay raw; everything else is currency (INR -> ₹ Cr).
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

function timeseriesToTable(raw: any[], timescale: "annual" | "quarterly", orderedKeys: string[]): YFTable {
  // date -> key -> value(raw INR)
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
    const scale = noScale(key) ? 1 : 1e7; // INR -> ₹ Crores
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
      raw: vals.map((v) => (v === null ? "—" : v.toLocaleString("en-IN"))),
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
  const table = timeseriesToTable(raw, timescale, keys);
  if (!table.periods.length || !table.rows.length) throw new Error(`Empty ${statement} ${freq} for ${symbol}`);
  STMT_CACHE.set(cacheKey, { ts: Date.now(), data: table });
  return table;
}
