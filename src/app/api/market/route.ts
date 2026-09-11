import { NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";

// Live index/commodity/FX tape — backs sector/macro/dashboard desks.
const BOARD: Array<{ sym: string; label: string }> = [
  { sym: "^NSEI", label: "NIFTY 50" },
  { sym: "^NSEBANK", label: "BANK NIFTY" },
  { sym: "^BSESN", label: "SENSEX" },
  { sym: "^INDIAVIX", label: "INDIA VIX" },
  { sym: "^GSPC", label: "S&P 500" },
  { sym: "^FTSE", label: "FTSE 100" },
  { sym: "^N225", label: "NIKKEI" },
  { sym: "GC=F", label: "GOLD" },
  { sym: "SI=F", label: "SILVER" },
  { sym: "CL=F", label: "CRUDE" },
  { sym: "NG=F", label: "NAT GAS" },
  { sym: "USDINR=X", label: "USD/INR" },
  { sym: "EURINR=X", label: "EUR/INR" },
  { sym: "GBPINR=X", label: "GBP/INR" },
  { sym: "BTC-USD", label: "BITCOIN" },
  { sym: "ETH-USD", label: "ETHEREUM" },
  { sym: "NIFTYBEES.NS", label: "NIFTYBEES" },
  { sym: "GOLDBEES.NS", label: "GOLDBEES" },
  { sym: "^CNXIT", label: "NIFTY IT" },
];

export async function GET() {
  const rows = await Promise.all(
    BOARD.map(async (b) => {
      try {
        const bars = await fetchHistory(b.sym, "1mo", "1d");
        const c = bars.map((x) => x.close);
        const last = c[c.length - 1];
        const prev = c.length > 1 ? c[c.length - 2] : last;
        return {
          sym: b.sym, label: b.label, price: last,
          chgPct: prev ? ((last - prev) / prev) * 100 : 0,
          spark: c.slice(-30), ok: true,
        };
      } catch {
        return { sym: b.sym, label: b.label, price: NaN, chgPct: NaN, spark: [], ok: false };
      }
    })
  );
  return NextResponse.json({ count: rows.length, rows });
}
