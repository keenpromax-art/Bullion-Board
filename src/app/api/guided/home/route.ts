import { NextResponse } from "next/server";
import { fetchHistory, yahooFetch } from "@/lib/yahoo";
import { SECTORS } from "@/lib/sectors";
import { DEFAULT_TICKER } from "@/lib/watchlist";

// ONE payload for the Guided home screen: indices, sector map, movers, breadth.
//
// This is deliberately NOT /api/market. The Guided home is a first paint on a
// phone, so it needs everything in one round trip rather than four, and it needs
// sector-level numbers, which /api/market does not carry at all.
//
// HONESTY RULES THIS ROUTE KEEPS:
//   - a sector with no live reading is returned with chg:null and a count of what
//     did report. It is never dropped, because a heatmap that silently loses
//     three tiles looks like "those sectors are flat".
//   - sector change is the EQUAL-WEIGHT mean of its constituents' day change,
//     labelled as such. It is not an index and must not be read like one.
//   - every constituent failure is counted, so a sector built on one live name
//     says so instead of pretending to be a sector.

export const revalidate = 30;

interface Row {
  sym: string;
  last: number | null;
  chg: number | null;
}

/** Live day change for a symbol set, fail-open per name. */
async function dayMoves(symbols: string[], limit = 8): Promise<Row[]> {
  const out: Row[] = new Array(symbols.length).fill(null).map(() => ({ sym: "", last: null, chg: null }));
  let i = 0;
  const worker = async () => {
    while (i < symbols.length) {
      const k = i++;
      const sym = symbols[k]!;
      try {
        // One chart request gives both the level and the reference close, which
        // is cheaper than a quote + history pair per symbol.
        const r = await yahooFetch(
          `/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`,
          { next: { revalidate: 30 } }
        );
        const res = (await r.json())?.chart?.result?.[0];
        if (!res) continue;
        const meta = res.meta ?? {};
        const closes: number[] = (res.indicators?.quote?.[0]?.close ?? []).filter(
          (v: unknown): v is number => typeof v === "number" && isFinite(v)
        );
        const live = typeof meta.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
        const last = live ?? (closes.length ? closes[closes.length - 1]! : null);
        const usable = (v: unknown): v is number =>
          typeof v === "number" && isFinite(v) && v > 0 && (live === null || v !== live);
        const prev = usable(meta.previousClose)
          ? meta.previousClose
          : usable(meta.chartPreviousClose)
            ? meta.chartPreviousClose
            : closes.length > 1
              ? closes[closes.length - 2]!
              : null;
        if (last === null || prev === null) continue;
        const chg = ((last - prev) / prev) * 100;
        if (Math.abs(chg) > 25) continue;
        out[k] = { sym, last: Math.round(last * 100) / 100, chg: Math.round(chg * 100) / 100 };
      } catch {
        /* leave the row null — the caller reports it */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, symbols.length) }, worker));
  return out;
}

const INDEXES = [
  { sym: "^NSEI", label: "NIFTY 50", short: "NIFTY" },
  { sym: "^NSEBANK", label: "NIFTY BANK", short: "BANK" },
  { sym: "^BSESN", label: "SENSEX", short: "SENSEX" },
  { sym: "^CNXIT", label: "NIFTY IT", short: "IT" },
  { sym: "^INDIAVIX", label: "INDIA VIX", short: "VIX" },
  { sym: "^CNXAUTO", label: "NIFTY AUTO", short: "AUTO" },
  { sym: "^CNXPHARMA", label: "NIFTY PHARMA", short: "PHARMA" },
  { sym: "^CNXENERGY", label: "NIFTY ENERGY", short: "ENERGY" },
];

export async function GET() {
  // ---- sectors: every one, in parallel, equal-weight from its constituents ----
  const sectorKeys = Object.keys(SECTORS);
  const sectorMoves = await Promise.all(
    sectorKeys.map(async (key) => {
      const tickers = SECTORS[key]!.tickers;
      const rows = await dayMoves(tickers, 10);
      const live = rows.filter((r) => r.chg !== null);
      const mean = live.length
        ? live.reduce((a, r) => a + r.chg!, 0) / live.length
        : null;
      return {
        key,
        name: SECTORS[key]!.name,
        // Equal weight across the names that reported. NOT a sector index.
        chg: mean === null ? null : Math.round(mean * 100) / 100,
        reported: live.length,
        of: tickers.length,
        best: live.sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0))[0] ?? null,
      };
    })
  );

  // ---- indices + a broad mover set, concurrently ----
  const moverUniverse = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "SBIN.NS",
    "BHARTIARTL.NS", "ITC.NS", "LT.NS", "AXISBANK.NS", "KOTAKBANK.NS", "MARUTI.NS",
    "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS", "ASIANPAINT.NS", "HINDUNILVR.NS", "BAJFINANCE.NS",
    "WIPRO.NS", "HCLTECH.NS", "TATASTEEL.NS", "POWERGRID.NS", "NTPC.NS", "ADANIENT.NS",
  ];
  const [indexRows, moverRows] = await Promise.all([
    dayMoves(INDEXES.map((i) => i.sym), 6),
    dayMoves(moverUniverse, 10),
  ]);

  const indexes = INDEXES.map((meta, i) => ({
    ...meta,
    last: indexRows[i]?.last ?? null,
    chg: indexRows[i]?.chg ?? null,
  }));

  const live = moverRows.filter((r) => r.chg !== null);
  const gainers = [...live].sort((a, b) => (b.chg ?? 0) - (a.chg ?? 0)).slice(0, 5);
  const losers = [...live].sort((a, b) => (a.chg ?? 0) - (b.chg ?? 0)).slice(0, 5);

  // ---- the hero's sparkline: Nifty 1-month daily closes ----
  let spark: number[] = [];
  try {
    const bars = await fetchHistory("^NSEI", "1mo", "1d");
    spark = bars.map((b) => b.close);
  } catch {
    spark = [];
  }

  // ---- session state from the index board itself, not from the clock ----
  const nifty = indexes[0]!;
  const vix = indexes.find((i) => i.short === "VIX");
  const reported = sectorMoves.filter((s) => s.chg !== null);
  const up = reported.filter((s) => s.chg! > 0).length;
  const sectorMean = reported.length
    ? reported.reduce((a, s) => a + s.chg!, 0) / reported.length
    : null;

  return NextResponse.json({
    defaultTicker: DEFAULT_TICKER,
    indexes,
    sectors: sectorMoves.sort((a, b) => (b.chg ?? -99) - (a.chg ?? -99)),
    gainers,
    losers,
    spark,
    summary: {
      index: nifty.chg,
      vix: vix?.chg ?? null,
      sectorsUp: up,
      sectorsTotal: reported.length,
      sectorsDown: reported.length - up,
      sectorMean: sectorMean === null ? null : Math.round(sectorMean * 100) / 100,
    },
    degraded: {
      indexes: indexes.filter((i) => i.chg === null).length,
      sectors: sectorMoves.filter((s) => s.chg === null).map((s) => s.name),
      moversReported: live.length,
      moversTotal: moverUniverse.length,
    },
  });
}