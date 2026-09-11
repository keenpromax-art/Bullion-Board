import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";

// Yahoo-only: fundamentals-timeseries has no schedule drill-downs
// (screener.in Company.showSchedule has no Yahoo equivalent).
// Return empty so ledger rows render "NO BREAKUP ON FEED."

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const parent = (sp.get("parent") || "").trim().slice(0, 80);
  const section = (sp.get("section") || "profit-loss").trim().slice(0, 40);
  return NextResponse.json({ symbol, parent, section, count: 0, rows: [], source: "yahoo-only (no schedules)" });
}
