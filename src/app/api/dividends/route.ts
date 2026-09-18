import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";
import { yahooHeaders } from "@/lib/yahoo";

// Full dividend + split ledger back to listing (Yahoo chart events, range=max),
// plus summary stats in the spirit of a terminal DVD screen.
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  const currency = symbol.endsWith(".NS") ? "INR" : symbol.endsWith(".BO") ? "INR" : "USD";
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d&events=div%7Csplit`;
    const r = await fetch(url, { headers: yahooHeaders(), next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`chart ${r.status}`);
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error("no data");
    const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    let price = 0;
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] !== null && isFinite(closes[i] as number)) { price = closes[i] as number; break; }
    }

    const divs = Object.values((res?.events?.dividends ?? {}) as Record<string, any>)
      .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), ts: d.date * 1000, amount: Number(d.amount) || 0 }))
      .filter((d) => d.amount > 0)
      .sort((a, b) => b.ts - a.ts);
    const splits = Object.values((res?.events?.splits ?? {}) as Record<string, any>)
      .map((s) => ({
        date: new Date(s.date * 1000).toISOString().slice(0, 10),
        ts: s.date * 1000,
        ratio: `${s.numerator}:${s.denominator}`,
      }))
      .sort((a, b) => b.ts - a.ts);

    const nowMs = Date.now();
    const DAY = 86400000;
    const sumWin = (fromAgo: number, toAgo: number) =>
      divs.filter((d) => nowMs - d.ts <= fromAgo * DAY && nowMs - d.ts > toAgo * DAY)
        .reduce((s, d) => s + d.amount, 0);
    const ttm = sumWin(365, 0);
    const prev1 = sumWin(730, 365);
    const ttm3 = sumWin(1095, 0);
    const prev3 = sumWin(2190, 1095);
    const ttmCount = divs.filter((d) => nowMs - d.ts <= 365 * DAY).length;
    const growth1Y = prev1 > 0 ? ((ttm - prev1) / prev1) * 100 : null;
    const growth3Y = prev3 > 0 ? ((ttm3 - prev3) / prev3) * 100 : null;
    const lastAmt = divs.length ? divs[0].amount : 0;
    const indicated = ttmCount > 0 ? lastAmt * ttmCount : 0;
    const freq = ttmCount === 0 ? "—" : ttmCount === 1 ? "ANNUAL" : ttmCount === 2 ? "HALF-YEARLY" : ttmCount <= 5 ? "QUARTERLY" : "MONTHLY+";

    const byYear = new Map<number, { total: number; count: number }>();
    for (const d of divs) {
      const y = Number(d.date.slice(0, 4));
      const e = byYear.get(y) ?? { total: 0, count: 0 };
      e.total += d.amount; e.count++;
      byYear.set(y, e);
    }
    const annual = [...byYear.entries()]
      .map(([year, v]) => ({ year, total: Math.round(v.total * 100) / 100, count: v.count }))
      .sort((a, b) => b.year - a.year);

    const yrs = annual.map((a) => a.year);
    for (let i = 0; i < annual.length; i++) {
      const prev = annual.find((a) => a.year === annual[i].year - 1);
      (annual[i] as any).growth = prev && prev.total > 0 ? Math.round(((annual[i].total - prev.total) / prev.total) * 1000) / 10 : null;
    }

    return NextResponse.json({
      symbol, price, currency,
      count: divs.length,
      firstDate: divs.length ? divs[divs.length - 1].date : null,
      lastDate: divs.length ? divs[0].date : null,
      ttmTotal: Math.round(ttm * 100) / 100,
      ttmYieldPct: price ? Math.round((ttm / price) * 10000) / 100 : 0,
      indicated: Math.round(indicated * 100) / 100,
      indicatedYieldPct: price && indicated ? Math.round((indicated / price) * 10000) / 100 : 0,
      growth1Y: growth1Y !== null ? Math.round(growth1Y * 10) / 10 : null,
      growth3Y: growth3Y !== null ? Math.round(growth3Y * 10) / 10 : null,
      freq, ttmCount,
      annual,
      dividends: divs.slice(0, 300),
      splits: splits.slice(0, 40),
      yearRange: yrs.length ? [yrs[yrs.length - 1], yrs[0]] : null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "dividends failed", symbol }, { status: 502 });
  }
}
