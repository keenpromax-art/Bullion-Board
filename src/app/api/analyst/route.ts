import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";
import { yahooQuoteSummary } from "@/lib/yahoo";

const raw = (v: any): number | null =>
  v && typeof v.raw === "number" && isFinite(v.raw) ? v.raw : null;

// Analyst consensus + estimates via crumb-authed quoteSummary.
// Per-firm tables and price targets need a ratings feed — the desk says so.
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  try {
    const s = await yahooQuoteSummary(
      symbol,
      "recommendationTrend,defaultKeyStatistics,price,earningsTrend,financialData"
    );
    const trend = (((s?.recommendationTrend ?? {}) as any).trend ?? []) as any[];
    const rows = trend.map((t: any) => ({
      period: String(t.period ?? ""),
      strongBuy: Number(t.strongBuy ?? 0),
      buy: Number(t.buy ?? 0),
      hold: Number(t.hold ?? 0),
      sell: Number(t.sell ?? 0),
      strongSell: Number(t.strongSell ?? 0),
    }));
    // Yahoo orders newest-first ("0m" = current month).
    const latest = rows.find((r) => r.period === "0m") ?? rows[rows.length - 1] ?? { period: "", strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };
    const buys = latest.strongBuy + latest.buy;
    const total = buys + latest.hold + latest.sell + latest.strongSell;
    const pctBuy = total ? Math.round((buys / total) * 1000) / 10 : 0;
    const consensus =
      total === 0 ? "NO COVERAGE"
      : pctBuy >= 80 ? "STRONG BUY" : pctBuy >= 60 ? "BUY"
      : pctBuy >= 40 ? "HOLD" : pctBuy >= 20 ? "SELL" : "STRONG SELL";

    const et = (((s?.earningsTrend ?? {}) as any).trend ?? []) as any[];
    const fy = [...et].reverse().find((t: any) => t.earningsEstimate) ?? et[et.length - 1] ?? {};
    const dk = ((s?.defaultKeyStatistics ?? {}) as any);
    const px = ((s?.price ?? {}) as any);
    const fd = ((s?.financialData ?? {}) as any);
    const price = raw(px.regularMarketPrice) ?? raw(fd.currentPrice) ?? 0;
    const tMean = raw(fd.targetMeanPrice), tMed = raw(fd.targetMedianPrice);
    const tHigh = raw(fd.targetHighPrice), tLow = raw(fd.targetLowPrice);

    return NextResponse.json({
      symbol,
      fetchedAt: new Date().toISOString(),
      price: price,
      currency: "INR",
      consensus, pctBuy, nAnalysts: total,
      trend: rows,
      targets: {
        mean: tMean, median: tMed, high: tHigh, low: tLow,
        upsidePct: tMean && price ? Math.round(((tMean - price) / price) * 10000) / 100 : null,
        downsidePct: tLow && price ? Math.round(((tLow - price) / price) * 10000) / 100 : null,
        dispersionPct: tHigh && tLow && tMean ? Math.round(((tHigh - tLow) / tMean) * 10000) / 100 : null,
        nAnalysts: raw(fd.numberOfAnalystOpinions) ?? total,
      },
      streetMean: raw(fd.recommendationMean),
      streetKey: typeof fd.recommendationKey === "string" ? fd.recommendationKey : null,
      estimates: et.map((t: any) => {
        const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
        return {
          period: String(t.period ?? ""),
          endDate: t?.endDate?.fmt ? String(t.endDate.fmt) : null,
          epsAvg: r2(raw(t?.earningsEstimate?.avg)), epsLow: r2(raw(t?.earningsEstimate?.low)), epsHigh: r2(raw(t?.earningsEstimate?.high)),
          epsAnalysts: raw(t?.earningsEstimate?.numberOfAnalysts),
          revAvg: raw(t?.revenueEstimate?.avg), revLow: raw(t?.revenueEstimate?.low), revHigh: raw(t?.revenueEstimate?.high),
          growthPct: t?.growth ? Math.round(raw(t.growth)! * 10000) / 100 : null,
          up7d: raw(t?.epsRevisions?.upLast7days) ?? 0, down7d: raw(t?.epsRevisions?.downLast7days) ?? 0,
          up30d: raw(t?.epsRevisions?.upLast30days) ?? 0, down30d: raw(t?.epsRevisions?.downLast30days) ?? 0,
        };
      }),
      earnings: {
        period: String(fy.period ?? ""),
        endDate: String(fy.endDate ?? "").slice(0, 10),
        growthPct: fy.growth ? Math.round(raw(fy.growth)! * 10000) / 100 : null,
        epsAvg: raw(fy?.earningsEstimate?.avg) !== null ? Math.round(raw(fy?.earningsEstimate?.avg)! * 100) / 100 : null,
        epsLow: raw(fy?.earningsEstimate?.low) !== null ? Math.round(raw(fy?.earningsEstimate?.low)! * 100) / 100 : null,
        epsHigh: raw(fy?.earningsEstimate?.high) !== null ? Math.round(raw(fy?.earningsEstimate?.high)! * 100) / 100 : null,
        yearAgoEps: raw(fy?.yearAgoEps),
        nAnalysts: fy?.earningsEstimate?.numberOfAnalysts ? raw(fy.earningsEstimate.numberOfAnalysts) : null,
      },
      stats: {
        forwardPE: raw(dk.forwardPE),
        trailingPE: raw(dk.trailingPE),
        bookValue: raw(dk.bookValue),
        trailingEps: raw(dk.trailingEps),
        priceToBook: raw(dk.priceToBook),
      },
      hasData: total > 0,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "analyst failed", symbol }, { status: 502 });
  }
}
