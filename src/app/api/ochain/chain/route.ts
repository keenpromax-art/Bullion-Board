import { NextRequest, NextResponse } from "next/server";
import { nseGet } from "@/lib/nse";
import type { ChainRow } from "@/lib/ochain";

const cache = new Map<string, { ts: number; payload: unknown }>();
const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return isFinite(n) ? n : 0;
};

// Full merged chain for symbol+expiry (mirrors NseCore.fetch_option_chain).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = (sp.get("symbol") || "NIFTY").toUpperCase();
  const expiry = sp.get("expiry") || "";
  const mode = (sp.get("mode") || "Index").toLowerCase().startsWith("stock") ? "Equity" : "Indices";
  if (!expiry) return NextResponse.json({ error: "expiry required", symbol }, { status: 400 });

  const key = `${symbol}|${expiry}|${mode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < 60_000) return NextResponse.json(hit.payload);

  try {
    const r = await nseGet(
      `https://www.nseindia.com/api/option-chain-v3?type=${mode}&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}`
    );
    if (!r.ok) throw new Error(`chain ${r.status} — NSE may be blocking this host (see README)`);
    const j = await r.json();
    const items: any[] = j?.records?.data ?? [];
    const same = items.filter(
      (d) => String(d?.expiryDates ?? "").toLowerCase() === expiry.toLowerCase() && d.CE && d.PE
    );
    if (!same.length) throw new Error("empty chain for this expiry");

    const underlying = same.map((d) => Number(d.PE?.underlyingValue ?? d.CE?.underlyingValue ?? 0)).find((v) => v !== 0) ?? 0;
    const rows: ChainRow[] = same.map((d) => {
      const ce = d.CE ?? {}, pe = d.PE ?? {};
      return {
        strike: Number(d.strikePrice ?? ce.strikePrice ?? pe.strikePrice ?? 0),
        ceOI: num(ce.openInterest), ceChgOI: num(ce.changeinOpenInterest), ceVol: num(ce.totalTradedVolume),
        ceIV: num(ce.impliedVolatility), ceLTP: num(ce.lastPrice), ceNetChg: num(ce.change),
        ceBidQty: num(ce.buyQuantity1), ceBidPx: num(ce.buyPrice1), ceAskPx: num(ce.sellPrice1), ceAskQty: num(ce.sellQuantity1),
        peOI: num(pe.openInterest), peChgOI: num(pe.changeinOpenInterest), peVol: num(pe.totalTradedVolume),
        peIV: num(pe.impliedVolatility), peLTP: num(pe.lastPrice), peNetChg: num(pe.change),
        peBidQty: num(pe.buyQuantity1), peBidPx: num(pe.buyPrice1), peAskPx: num(pe.sellPrice1), peAskQty: num(pe.sellQuantity1),
      };
    }).filter((r) => r.strike > 0).sort((a, b) => a.strike - b.strike);

    const payload = {
      symbol, expiry, mode,
      underlying,
      timestamp: j?.records?.timestamp ?? new Date().toISOString(),
      count: rows.length,
      rows,
    };
    cache.set(key, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "chain failed", symbol, expiry },
      { status: 502 }
    );
  }
}
