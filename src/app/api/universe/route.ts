import { NextRequest, NextResponse } from "next/server";
import { getUniverse, queryUniverse } from "@/lib/universe";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const index = await getUniverse();
  if (!index) {
    return NextResponse.json(
      { error: "UNIVERSE INDEX COLD — RUN POST /api/universe/refresh ONCE", cold: true },
      { status: 503 },
    );
  }
  const { page, total, size, rows, pages, facetRegions, facetSectors, facetExchanges } =
    queryUniverse(index, {
      q: p.get("q") ?? undefined,
      region: p.get("region")?.toUpperCase() || undefined,
      sector: p.get("sector")?.toUpperCase() || undefined,
      exch: p.get("exch")?.toUpperCase() || undefined,
      sort: (p.get("sort") as "symbol" | "name" | "mcap") || "symbol",
      dir: p.get("dir") === "desc" ? "desc" : "asc",
      page: Number(p.get("page") ?? 1) || 1,
      size: Number(p.get("size") ?? 25) || 25,
    });
  return NextResponse.json({
    builtAt: index.builtAt,
    discovered: index.discovered,
    note: index.note,
    total,
    page,
    pages,
    size,
    facetRegions,
    facetSectors,
    facetExchanges,
    rows,
  });
}
