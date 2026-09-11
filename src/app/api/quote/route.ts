import { NextRequest, NextResponse } from "next/server";
import { fetchQuote } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  try {
    const q = await fetchQuote(symbol);
    return NextResponse.json(q);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "quote failed";
    return NextResponse.json({ error: msg, symbol }, { status: 502 });
  }
}
