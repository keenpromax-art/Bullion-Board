import { NextRequest, NextResponse } from "next/server";
import { fredSearch, fredKey } from "@/lib/fred";

// Keyed series search — resolves codes like ISM PMI without guessing.
// Needs FRED_API_KEY env or ?fkey= override (free key, no card).
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
  if (!q) return NextResponse.json({ results: [] });
  const key = fredKey(req.nextUrl.searchParams.get("fkey"));
  if (!key) {
    return NextResponse.json(
      { error: "FRED key missing — add FRED_API_KEY env or ?fkey= (free at fred.stlouisfed.org)", results: [] },
      { status: 401 }
    );
  }
  try {
    const results = await fredSearch(q, key);
    return NextResponse.json({ q, count: results.length, results, keyed: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "search failed", q, results: [] }, { status: 502 });
  }
}
