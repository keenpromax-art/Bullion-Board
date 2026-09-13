import { NextRequest, NextResponse } from "next/server";
import { yahooFetch, yahooHeaders } from "@/lib/yahoo";
import {
  CAPTURE_SLOTS, OPENING_UNIVERSE, VIX_THRESHOLD, buildSignals, istStamp, nearestSlot, vixCondition,
} from "@/lib/opening";

interface DayBar { last: number | null; chg: number | null; date: string | null }

async function dayPct(symbol: string): Promise<DayBar> {
  try {
    const r = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { next: { revalidate: 120 } });
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    const ts: number[] = res?.timestamp ?? [];
    const c = closes.filter((v): v is number => v !== null && isFinite(v));
    if (c.length < 2) return { last: null, chg: null, date: null };
    const last = c[c.length - 1], prev = c[c.length - 2];
    return {
      last, chg: ((last - prev) / prev) * 100,
      date: ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : null,
    };
  } catch {
    return { last: null, chg: null, date: null };
  }
}

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

// --- NSE official breadth (mirrors fetch_market_breadth) ---
const NSE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

async function nseBreadth() {
  const base = {
    "User-Agent": NSE_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.nseindia.com/market-data/advance",
  };
  const home = await fetch("https://www.nseindia.com", {
    headers: base, signal: AbortSignal.timeout(7000),
  });
  if (!home.ok) throw new Error(`nse home ${home.status}`);
  const rawCookies: string[] =
    typeof (home.headers as any).getSetCookie === "function"
      ? (home.headers as any).getSetCookie()
      : (home.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=[^;,]+;)/);
  const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
  const get = async (path: string) => {
    const r = await fetch(`https://www.nseindia.com${path}`, {
      headers: { ...base, Cookie: cookie }, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`nse ${path} ${r.status}`);
    return r.json();
  };
  const j500 = await get("/api/equity-stock-indices?index=NIFTY%20500");
  const data500: any[] = j500?.data ?? [];
  const stocks = data500.filter((d) => d.symbol && !String(d.symbol).startsWith("NIFTY"));
  const rows = stocks.map((d) => {
    const chg = Number(d.pChange ?? 0);
    return {
      symbol: String(d.symbol),
      last: Number(d.lastPrice ?? 0),
      chgPct: chg,
      volume: Number(d.totalTradedVolume ?? 0),
      valueCr: Math.round(Number(d.totalTradedValue ?? 0) / 1e7 * 100) / 100,
      status: chg > 0 ? "Advance" : chg < 0 ? "Decline" : "Unchanged",
    };
  });

  const jAll = await get("/api/allIndices");
  const pick = (name: string): [number, number, number] => {
    const f = (jAll?.data ?? []).find((d: any) => d.index === name);
    return [Number(f?.advances ?? 0), Number(f?.declines ?? 0), Number(f?.unchanged ?? 0)];
  };
  const matrix = {
    nifty50: pick("NIFTY 50"),
    n500: pick("NIFTY 500"),
    midcap: pick("NIFTY MIDCAP 150"),
    smallcap: pick("NIFTY SMALLCAP 250"),
    total: pick("NIFTY TOTAL MARKET"),
  };
  let [a50, d50, u50] = matrix.nifty50;
  if (!a50 && !d50 && rows.length) {
    const first50 = rows.slice(0, 50);
    a50 = first50.filter((r) => r.status === "Advance").length;
    d50 = first50.filter((r) => r.status === "Decline").length;
    u50 = first50.filter((r) => r.status === "Unchanged").length;
  }
  return { adv: a50, dec: d50, unc: u50, rows, matrix, source: "NSE" as const };
}

async function fallbackBreadth() {
  const rows = await mapPool(OPENING_UNIVERSE, 12, async (sym) => {
    const d = await dayPct(sym);
    if (d.chg === null || d.last === null) return null;
    return {
      symbol: sym.replace(".NS", ""), last: d.last,
      chgPct: Math.round(d.chg * 100) / 100, volume: 0, valueCr: 0,
      status: d.chg > 0 ? "Advance" : d.chg < 0 ? "Decline" : "Unchanged",
    };
  });
  const adv = rows.filter((r) => r.status === "Advance").length;
  const dec = rows.filter((r) => r.status === "Decline").length;
  const unc = rows.filter((r) => r.status === "Unchanged").length;
  return {
    adv, dec, unc, rows,
    matrix: { nifty50: [adv, dec, unc] as [number, number, number], n500: [0, 0, 0] as [number, number, number], midcap: [0, 0, 0] as [number, number, number], smallcap: [0, 0, 0] as [number, number, number], total: [0, 0, 0] as [number, number, number] },
    source: "YAHOO" as const,
  };
}

export async function GET(req: NextRequest) {
  // ?summary=1 skips the intraday tape + per-stock rows (tape chip only
  // needs score/breadth/vix) — same signals, fraction of the payload.
  const lite = req.nextUrl.searchParams.get("summary") === "1";
  try {
    const [ndq, dow, sti, vix, nifty] = await Promise.all([
      dayPct("^IXIC"), dayPct("^DJI"), dayPct("^STI"),
      (async () => {
        try {
          const r = await yahooFetch(`/v8/finance/chart/%5EINDIAVIX?range=5d&interval=1d`, { next: { revalidate: 120 } });
          const j = await r.json();
          const c: (number | null)[] = j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
          const f = c.filter((v): v is number => v !== null && isFinite(v));
          return f.length ? f[f.length - 1] : null;
        } catch { return null; }
      })(),
      (async () => {
        try {
          const r = await yahooFetch(`/v8/finance/chart/%5ENSEI?range=5d&interval=1d`, { next: { revalidate: 60 } });
          const j = await r.json();
          const res = j?.chart?.result?.[0];
          const q = res?.indicators?.quote?.[0] ?? {};
          const c: number[] = (q.close ?? []).filter((v: number | null): v is number => v !== null && isFinite(v));
          if (c.length < 2) return { open: null, last: null, high: null, low: null, chg: null, date: null };
          const i = c.length - 1;
          const o: (number | null)[] = q.open ?? [];
          const h: (number | null)[] = q.high ?? [];
          const l: (number | null)[] = q.low ?? [];
          return {
            open: o[i] ?? null, last: c[i], high: h[i] ?? null, low: l[i] ?? null,
            chg: ((c[i] - c[i - 1]) / c[i - 1]) * 100,
            date: res?.timestamp?.length ? new Date(res.timestamp[res.timestamp.length - 1] * 1000).toISOString().slice(0, 10) : null,
          };
        } catch { return { open: null, last: null, high: null, low: null, chg: null, date: null }; }
      })(),
    ]);

    // Intraday 1h Nifty, converted to IST (skipped in summary mode)
    let intraday: Array<{ time: string; date: string; open: number; high: number; low: number; close: number }> = [];
    if (!lite) {
    try {
      const r = await yahooFetch(`/v8/finance/chart/%5ENSEI?range=5d&interval=1h`, { next: { revalidate: 60 } });
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const q = res?.indicators?.quote?.[0] ?? {};
      const ts: number[] = res?.timestamp ?? [];
      const all = ts.map((t, k) => {
        const ist = new Date((t + 19800) * 1000);
        const hh = String(ist.getUTCHours()).padStart(2, "0");
        const mm = String(ist.getUTCMinutes()).padStart(2, "0");
        return {
          time: `${hh}:${mm}`,
          date: ist.toISOString().slice(0, 10),
          open: q.open?.[k] ?? null, high: q.high?.[k] ?? null,
          low: q.low?.[k] ?? null, close: q.close?.[k] ?? null,
        };
      }).filter((b) => b.close !== null && isFinite(b.close));
      const latestDate = all.length ? all[all.length - 1].date : null;
      intraday = all.filter((b) => b.date === latestDate) as typeof intraday;
    } catch { intraday = []; }
    }

    // Breadth: NSE official first, Yahoo universe fallback
    let breadth: Awaited<ReturnType<typeof nseBreadth>> | Awaited<ReturnType<typeof fallbackBreadth>>;
    try {
      breadth = await nseBreadth();
    } catch {
      breadth = await fallbackBreadth();
    }
    const total = breadth.adv + breadth.dec + breadth.unc;

    // Global cue: SGX first (Nifty futures proxy), else US average
    let gcSource: string | null = null, gcLast: number | null = null, gcChg: number | null = null, gcFallback = false;
    if (sti.chg !== null) {
      gcSource = "SGX / Straits Times"; gcLast = sti.last; gcChg = sti.chg;
    } else {
      const us = [ndq.chg, dow.chg].filter((v): v is number => v !== null && isFinite(v));
      if (us.length) {
        gcSource = "US-market proxy (avg Nasdaq+Dow)"; gcChg = us.reduce((a, b) => a + b, 0) / us.length; gcFallback = true;
      }
    }

    const { signals, score, n, verdict } = buildSignals({
      nasdaqChg: ndq.chg, dowChg: dow.chg,
      advances: breadth.adv, declines: breadth.dec, breadthTotal: total,
      globalChg: gcChg,
    });

    const sorted = [...breadth.rows].sort((a, b) => b.chgPct - a.chgPct);
    return NextResponse.json({
      fetchedAtIST: istStamp(),
      currentSlot: nearestSlot(),
      slots: CAPTURE_SLOTS,
      usDate: ndq.date, sgxDate: sti.date, niftyDate: nifty.date,
      nasdaq: { last: ndq.last, chg: ndq.chg },
      dow: { last: dow.last, chg: dow.chg },
      sgx: { last: sti.last, chg: sti.chg },
      vix, vixCond: vixCondition(vix), vixThreshold: VIX_THRESHOLD,
      nifty: { ...nifty, range: nifty.high !== null && nifty.low !== null ? nifty.high - nifty.low : null },
      intraday,
      breadth: {
        adv: breadth.adv, dec: breadth.dec, unc: breadth.unc, total,
        sentiment: total ? (breadth.adv > breadth.dec ? "BULLISH" : breadth.dec > breadth.adv ? "BEARISH" : "NEUTRAL") : null,
        matrix: breadth.matrix, source: breadth.source,
        gainers: lite ? [] : sorted.slice(0, 5), losers: lite ? [] : sorted.slice(-5).reverse(),
        rows: lite ? [] : breadth.rows,
      },
      globalCue: { source: gcSource, last: gcLast, chg: gcChg, fallback: gcFallback },
      score: { value: score, n, verdict, signals },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "snapshot failed" }, { status: 502 });
  }
}
