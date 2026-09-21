// Small utilities — ports of safe_div, formatters, seeded RNG from special.py
import { WATCHLIST } from "./watchlist";

const WATCHLIST_SET: Set<string> = new Set(WATCHLIST);

export function safeDiv(a: number, b: number, fallback = 0): number {
  if (!isFinite(a) || !isFinite(b) || b === 0) return fallback;
  return a / b;
}

export function fmtINR(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

export function fmtNum(v: number | null | undefined, dec = 2, locale = "en-IN"): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function fmtPct(v: number | null | undefined, mult = false, dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const x = mult ? v * 100 : v;
  return `${x.toFixed(dec)}%`;
}

export function fmtCr(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return fmtINR(v);
}

export function normalizeTicker(raw: string, fallback = "RELIANCE.NS"): string {
  // Global-aware port of normalize_cli_ticker().
  // Bare Indian names resolve to .NS via the 2,260-symbol watchlist
  // (RELIANCE -> RELIANCE.NS); anything else passes through untouched so
  // US/EU/JP tickers (AAPL, MSFT, SONY.T, VOW.DE, RELIANCE.NS, ^NSEI,
  // GC=F, USDINR=X, BTC-USD) keep working.
  let t = (raw || fallback || "RELIANCE.NS").trim().toUpperCase();
  if (!t) return "RELIANCE.NS";
  if (t.startsWith("^") || t.includes(".") || t.includes("=")) return t;
  // Yahoo crypto pairs (BTC-USD) pass through; hyphenated NSE names
  // (BAJAJ-AUTO) still get .NS — hence the anchored $-USD test.
  if (/-USD$/.test(t)) return t;
  if (WATCHLIST_SET.has(`${t}.NS`)) return `${t}.NS`;
  return t;
}

// ---- Global market helpers (currency / locale / formatting) ----
// Yahoo quotes carry the listing currency; these map a symbol to its
// expected currency when the quote hasn't loaded yet.

export function isIndianTicker(sym: string): boolean {
  const t = (sym || "").trim().toUpperCase();
  return t.endsWith(".NS") || t.endsWith(".BO");
}

function isIndianIndex(sym: string): boolean {
  const t = (sym || "").trim().toUpperCase();
  return t.startsWith("^NSE") || t.startsWith("^BSE") || t.startsWith("^CNX") || t === "^INDIAVIX";
}

export function tickerCurrency(sym: string): string {
  const t = (sym || "").trim().toUpperCase();
  if (isIndianTicker(t) || isIndianIndex(t)) return "INR";
  if (t.endsWith("-USD")) return "USD";
  if (t.includes("=")) {
    // FX crosses quote in the counter currency (EURINR=X -> INR).
    if (/INR=X$/.test(t)) return "INR";
    if (/JPY=X$/.test(t)) return "JPY";
    if (/EUR=X$/.test(t)) return "EUR";
    if (/GBP=X$/.test(t)) return "GBP";
    return "USD";
  }
  const m = t.match(/\.([A-Z]{1,4})$/);
  const suf = m ? m[1] : "";
  switch (suf) {
    case "L": return "GBP";
    case "DE": case "PA": case "AS": case "MI": case "MC": case "BR": case "LS": case "VX": return "EUR";
    case "T": case "JP": return "JPY";
    case "HK": return "HKD";
    case "AX": return "AUD";
    case "TO": case "V": case "CN": return "CAD";
    case "SW": return "CHF";
    case "KS": case "KQ": return "KRW";
    case "SS": case "SZ": return "CNY";
    case "TW": return "TWD";
    case "SI": return "SGD";
    case "NS": case "BO": return "INR";
    case "SA": return "BRL";
    case "MX": return "MXN";
    case "TA": return "ILS";
    case "JK": return "IDR";
    case "KL": return "MYR";
    case "BK": return "THB";
    default: return "USD";
  }
}

export function currencySymbol(cur: string): string {
  switch ((cur || "USD").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "JPY": return "¥";
    case "CNY": return "¥";
    case "HKD": return "HK$";
    case "AUD": return "A$";
    case "CAD": return "C$";
    case "CHF": return "CHF ";
    case "KRW": return "₩";
    case "SGD": return "S$";
    default: return `${(cur || "USD").toUpperCase()} `;
  }
}

export function localeForCurrency(cur: string): string {
  return (cur || "").toUpperCase() === "INR" ? "en-IN" : "en-US";
}

export function localeForTicker(sym: string): string {
  return localeForCurrency(tickerCurrency(sym));
}

export function fmtMoney(v: number | null | undefined, cur = "INR", dec = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const sym = currencySymbol(cur);
  const loc = localeForCurrency(cur);
  // CHF-style prefixes already carry a trailing space.
  if (sym.endsWith(" ")) return `${sym}${v.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  return `${sym}${v.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

// Market-cap shortening: ₹ Cr/L for India, B/M/K everywhere else.
export function fmtMcap(mcap: number | null | undefined, cur = "INR"): string {
  if (mcap === null || mcap === undefined || !isFinite(mcap)) return "—";
  const c = (cur || "USD").toUpperCase();
  if (c === "INR") return fmtCr(mcap);
  const sym = currencySymbol(c);
  const abs = Math.abs(mcap);
  const pre = sym.endsWith(" ") ? sym : sym;
  if (abs >= 1e9) return `${pre}${(mcap / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${pre}${(mcap / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${pre}${(mcap / 1e3).toFixed(2)}K`;
  return fmtMoney(mcap, c, 0);
}

// Strip any Yahoo suffix (.NS/.BO/.L/.T/...) for venue-specific deep links.
export function stripYahooSuffix(sym: string): string {
  return (sym || "").trim().toUpperCase().replace(/\.[A-Z]{1,4}$/, "");
}

export function truncate(s: string, maxLen = 50): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${dd}-${months[d.getMonth()]}-${d.getFullYear()} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

// Deterministic PRNG (mulberry32) — replaces np.random.seed(42) usage so
// Monte-Carlo DCF is reproducible like the Python version.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller normal sampler using a uniform RNG
export function randnFactory(uniform: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = uniform();
    while (v === 0) v = uniform();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mag * Math.cos(2.0 * Math.PI * v);
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function retryFetch(url: string, init?: RequestInit, retries = 2, timeoutMs = 15000): Promise<Response> {
  let lastErr: string = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      lastErr = `${res.status}`;
      if (![429, 500, 502, 503].includes(res.status)) break;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : "network failed";
    }
    if (attempt < retries) await sleep(1200 * (attempt + 1));
  }
  throw new Error(lastErr || "fetch failed");
}
