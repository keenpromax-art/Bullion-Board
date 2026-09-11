import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";
import { yahooHeaders } from "@/lib/yahoo";

// Corporate actions: dividend events + splits from the chart feed.
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=div%7Csplit`;
    const r = await fetch(url, { headers: yahooHeaders(), next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`chart ${r.status}`);
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) throw new Error("no data");
    const closes: (number | null)[] = res?.indicators?.quote?.[0]?.close ?? [];
    const price = [...closes].reverse().find((v) => v != null) ?? 0;

    const divs = Object.values((res?.events?.dividends ?? {}) as Record<string, any>)
      .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), ts: d.date * 1000, amount: d.amount }))
      .sort((a, b) => b.ts - a.ts);
    const splits = Object.values((res?.events?.splits ?? {}) as Record<string, any>)
      .map((s) => ({
        date: new Date(s.date * 1000).toISOString().slice(0, 10),
        ts: s.date * 1000,
        ratio: `${s.numerator}:${s.denominator}`,
      }))
      .sort((a, b) => b.ts - a.ts);

    const cutoff = Date.now() - 365 * 86400000;
    const ttm = divs.filter((d) => d.ts > cutoff);
    const ttmSum = ttm.reduce((s, d) => s + d.amount, 0);
    return NextResponse.json({
      symbol, price,
      ttmYieldPct: price ? Math.round((ttmSum / price) * 10000) / 100 : 0,
      ttmTotal: Math.round(ttmSum * 100) / 100,
      payoutsTTM: ttm.length,
      dividends: divs.slice(0, 60),
      splits: splits.slice(0, 20),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "events failed", symbol }, { status: 502 });
  }
}
