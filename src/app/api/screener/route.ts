import { NextRequest, NextResponse } from "next/server";
import { fetchHistory, fetchQuote } from "@/lib/yahoo";
import { yahooHeaders } from "@/lib/yahoo";
import type { Quote } from "@/lib/types";
import { rsi, last } from "@/lib/indicators";

// Running set: Nifty-50 core + leaders. Batch quote for yield/52w stats,
// per-ticker history for momentum / RSI scans.
const UNIVERSE = [
  "RELIANCE.NS","HDFCBANK.NS","BHARTIARTL.NS","ICICIBANK.NS","INFY.NS","TCS.NS",
  "SBIN.NS","ITC.NS","HINDUNILVR.NS","LT.NS","BAJFINANCE.NS","HCLTECH.NS",
  "MARUTI.NS","SUNPHARMA.NS","NTPC.NS","ONGC.NS","KOTAKBANK.NS","M&M.NS",
  "AXISBANK.NS","TATAMOTORS.NS","TITAN.NS","ULTRACEMCO.NS","POWERGRID.NS",
  "ADANIENT.NS","ADANIPORTS.NS","TATASTEEL.NS","JSWSTEEL.NS","COALINDIA.NS",
  "GRASIM.NS","TECHM.NS","WIPRO.NS","NESTLEIND.NS","BRITANNIA.NS","EICHERMOT.NS",
  "HEROMOTOCO.NS","BAJAJ-AUTO.NS","DRREDDY.NS","CIPLA.NS","APOLLOHOSP.NS",
  "DIVISLAB.NS","BAJAJFINSV.NS","SBILIFE.NS","HDFCLIFE.NS","INDUSINDBK.NS",
  "SHRIRAMFIN.NS","TATACONSUM.NS","TRENT.NS","BEL.NS","BPCL.NS","HINDALCO.NS",
];

async function mapPool<T, R>(arr: T[], n: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(arr.length).fill(null);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      try { out[k] = await fn(arr[k]); } catch { out[k] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, w));
  return out.filter((x): x is R => x !== null);
}

// Yahoo rejects batched v7 quotes (401) but serves single symbols — fan out.
async function batchQuotes(): Promise<Quote[]> {
  return mapPool(UNIVERSE, 10, (sym) => fetchQuote(sym));
}

export async function GET(req: NextRequest) {
  const kind = (req.nextUrl.searchParams.get("kind") || "momentum").toLowerCase();
  try {
    if (kind === "dividend") {
      // Yahoo quote yield fields are empty for NSE names — derive TTM yield
      // from actual dividend events on the chart feed.
      const rows = await mapPool(UNIVERSE, 12, async (sym) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d&events=div`;
          const r = await fetch(url, { headers: yahooHeaders(), next: { revalidate: 3600 } });
          if (!r.ok) return null;
          const j = await r.json();
          const res = j?.chart?.result?.[0];
          if (!res) return null;
          const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
          const price = [...closes].reverse().find((v) => v != null) ?? 0;
          if (!price) return null;
          const divs = res?.events?.dividends ?? {};
          const cutoff = Date.now() / 1000 - 365 * 86400;
          let sum = 0, n = 0;
          for (const k of Object.keys(divs)) {
            const d = divs[k];
            if (d && d.date > cutoff && d.amount > 0) { sum += d.amount; n++; }
          }
          return {
            symbol: sym, price: Math.round(price * 100) / 100,
            chgPct: 0, yieldPct: Math.round((sum / price) * 10000) / 100,
            pe: null, hi52: null as number | null, offHighPct: 0, payoutsTTM: n,
          };
        } catch { return null; }
      });
      rows.sort((a, b) => b.yieldPct - a.yieldPct);
      return NextResponse.json({ kind, universe: UNIVERSE.length, count: rows.length, rows: rows.slice(0, 25) });
    }

    if (kind === "dip") {
      // 52W fields are empty on quote responses — derive from 1Y histories.
      const rows = await mapPool(UNIVERSE, 12, async (sym) => {
        try {
          const bars = await fetchHistory(sym, "1y", "1d");
          if (bars.length < 60) return null;
          const price = bars[bars.length - 1].close;
          const hi = Math.max(...bars.map((b) => b.high));
          const lo = Math.min(...bars.map((b) => b.low));
          return {
            symbol: sym, price: Math.round(price * 100) / 100,
            chgPct: 0, yieldPct: 0, pe: null,
            hi52: Math.round(hi * 100) / 100,
            offHighPct: Math.round(((price - hi) / hi) * 10000) / 100,
            offLowPct: Math.round(((price - lo) / lo) * 10000) / 100,
          };
        } catch { return null; }
      });
      rows.sort((a, b) => a.offHighPct - b.offHighPct);
      return NextResponse.json({ kind, universe: UNIVERSE.length, count: rows.length, rows: rows.slice(0, 25) });
    }

    if (kind === "candle") {
      // Last-bar candlestick patterns across the universe.
      const rows = await mapPool(UNIVERSE, 12, async (sym) => {
        try {
          const bars = await fetchHistory(sym, "3mo", "1d");
          if (bars.length < 5) return null;
          const b = bars[bars.length - 1];
          const p = bars[bars.length - 2];
          const body = Math.abs(b.close - b.open);
          const range = b.high - b.low;
          if (!range) return null;
          const lower = Math.min(b.open, b.close) - b.low;
          const upper = b.high - Math.max(b.open, b.close);
          let pattern: string | null = null;
          if (body / range < 0.1) pattern = "DOJI";
          else if (lower > 2 * body && upper < body) pattern = b.close > b.open ? "HAMMER" : "HAMMER (BEAR)";
          else if (p.close < p.open && b.close > b.open && b.close >= p.open && b.open <= p.close) pattern = "BULL ENGULF";
          else if (p.close > p.open && b.close < b.open && b.close <= p.open && b.open >= p.close) pattern = "BEAR ENGULF";
          if (!pattern) return null;
          return { symbol: sym, price: Math.round(b.close * 100) / 100, pattern, chg20Pct: 0, rsi14: null as number | null };
        } catch { return null; }
      });
      return NextResponse.json({ kind, universe: UNIVERSE.length, count: rows.length, rows });
    }

    if (kind === "momentum" || kind === "oversold" || kind === "swing" || kind === "all") {
      const needLong = kind !== "momentum";
      const range = needLong ? "3mo" : "1mo";
      const rows = await mapPool(UNIVERSE, 12, async (sym) => {
        const bars = await fetchHistory(sym, range, "1d");
        if (bars.length < 15) return null;
        const closes = bars.map((b) => b.close);
        const price = closes[closes.length - 1];
        const ref = closes[Math.max(0, closes.length - 22)];
        const chg20 = ((price - ref) / ref) * 100;
        const r = needLong ? last<number>(rsi(closes, 14)) : null;
        return { symbol: sym, price, chg20Pct: Math.round(chg20 * 100) / 100, rsi14: r === null ? null : Math.round(r * 100) / 100 };
      });
      const mom = [...rows].sort((a, b) => b.chg20Pct - a.chg20Pct).slice(0, 25);
      if (kind === "momentum") return NextResponse.json({ kind, universe: UNIVERSE.length, count: mom.length, rows: mom });
      const over = rows.filter((r) => r.rsi14 !== null).sort((a, b) => (a.rsi14 as number) - (b.rsi14 as number)).slice(0, 25);
      if (kind === "oversold") return NextResponse.json({ kind, universe: UNIVERSE.length, count: over.length, rows: over });
      const swing = rows
        .filter((r) => r.rsi14 !== null && (r.rsi14 as number) < 60)
        .map((r) => ({ ...r, score: Math.round((r.chg20Pct + (50 - (r.rsi14 as number)) * 0.15) * 100) / 100 }))
        .sort((a, b) => (b as any).score - (a as any).score)
        .slice(0, 20);
      if (kind === "swing") return NextResponse.json({ kind, universe: UNIVERSE.length, count: swing.length, rows: swing });
      // all = workflow scanner: three views in one call
      return NextResponse.json({ kind: "all", universe: UNIVERSE.length, momentum: mom.slice(0, 10), oversold: over.slice(0, 10), swing: swing.slice(0, 10) });
    }

    return NextResponse.json({
      kind, universe: UNIVERSE.length, count: 0, rows: [],
      notice: "NO FREE BULK-DEAL / IPO FEED — USE MOMENTUM / DIP / DIVIDEND SCANS, OR TRACK VIA EXCHANGE FILINGS.",
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "scan failed", kind }, { status: 502 });
  }
}
