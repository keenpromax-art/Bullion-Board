import { NextResponse } from "next/server";

// Live prediction markets via Polymarket's free Gamma API (no key).
export async function GET() {
  try {
    const r = await fetch("https://gamma-api.polymarket.com/events?limit=25&active=true&closed=false", {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });
    if (!r.ok) throw new Error(`gamma ${r.status}`);
    const events = await r.json();
    const rows = (Array.isArray(events) ? events : []).map((e: any) => {
      const markets = (e.markets ?? []).map((m: any) => {
        let outcomes: string[] = [];
        let prices: number[] = [];
        try { outcomes = JSON.parse(m.outcomes ?? "[]"); } catch { outcomes = []; }
        try { prices = (JSON.parse(m.outcomePrices ?? "[]") as string[]).map(Number); } catch { prices = []; }
        const yi = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        return {
          question: m.question ?? "",
          yesPct: yi >= 0 && isFinite(prices[yi]) ? Math.round(prices[yi] * 1000) / 10 : null,
          volume: Number(m.volume ?? 0),
        };
      });
      const vol = markets.reduce((s: number, m: any) => s + (m.volume || 0), 0);
      return { title: e.title ?? "", slug: e.slug ?? "", volume: Math.round(vol), markets: markets.slice(0, 4) };
    }).sort((a: any, b: any) => b.volume - a.volume);
    return NextResponse.json({ count: rows.length, rows: rows.slice(0, 20) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "polymarket failed" }, { status: 502 });
  }
}
