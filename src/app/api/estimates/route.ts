import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";
import { yahooQuoteSummary } from "@/lib/yahoo";

// Analyst estimates + recommendation + earnings surprise history.
// Same Yahoo quoteSummary feed yfinance wraps (earningsTrend etc).
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  try {
    const out = await yahooQuoteSummary(
      symbol,
      "earningsTrend,earningsHistory,recommendationTrend,calendarEvents,defaultKeyStatistics,financialData"
    );
    const num = (v: any): number | null => {
      const n = v && typeof v === "object" ? v.raw : v;
      return typeof n === "number" && isFinite(n) ? n : null;
    };
    const trend = out?.earningsTrend?.trend ?? [];
    const rec = (out?.recommendationTrend?.trend ?? [])[0] ?? null;
    const hist = out?.earningsHistory?.history ?? [];
    return NextResponse.json({
      symbol,
      source: "yahoo quoteSummary (yfinance)",
      earningsTrend: trend.map((t: any) => ({
        period: t?.period ?? t?.endDate?.fmt ?? "—",
        endDate: t?.endDate?.fmt ?? null,
        epsTrend: { current: num(t?.epsTrend?.current), low: num(t?.epsTrend?.low), high: num(t?.epsTrend?.high) },
        epsRevisions: {
          up7d: num(t?.epsRevisions?.upLast7days), down7d: num(t?.epsRevisions?.downLast7days),
          up30d: num(t?.epsRevisions?.upLast30days), down30d: num(t?.epsRevisions?.downLast30days),
        },
        revenueEstimate: { avg: num(t?.revenueEstimate?.avg), low: num(t?.revenueEstimate?.low), high: num(t?.revenueEstimate?.high) },
        growth: num(t?.growth),
      })),
      surprise: hist.map((h: any) => ({
        quarter: h?.quarter?.fmt ?? "—",
        epsActual: num(h?.epsActual),
        epsEstimate: num(h?.epsEstimate),
      })),
      recommendation: rec
        ? {
            strongBuy: num(rec.strongBuy), buy: num(rec.buy), hold: num(rec.hold),
            sell: num(rec.sell), strongSell: num(rec.strongSell),
          }
        : null,
      nextEarnings: (() => {
        const e = out?.calendarEvents?.earnings;
        const arr = Array.isArray(e?.earningsDate) ? e.earningsDate : [];
        const t = arr.map((x: any) => (x && typeof x === "object" ? x.fmt ?? x.raw : x)).find((x: any) => x);
        return t ?? null;
      })(),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "estimates failed", symbol }, { status: 502 });
  }
}
