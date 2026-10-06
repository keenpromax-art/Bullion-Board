import { NextRequest, NextResponse } from "next/server";
import { getNews, type NewsFeed } from "@/lib/news";
import { normalizeTicker } from "@/lib/utils";

const FEEDS: NewsFeed[] = ["company", "wire", "finshots", "nbfc", "mint", "editorials"];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const feed = (sp.get("feed") || "company").toLowerCase() as NewsFeed;
  const f = FEEDS.includes(feed) ? feed : "company";
  const q = (sp.get("q") || "").trim().slice(0, 80);
  try {
    const { items, sources, legs, collapsed, stale, irrelevant } = await getNews(symbol, f, q || undefined);
    const bull = items.filter((i) => i.label === "BULL").length;
    const bear = items.filter((i) => i.label === "BEAR").length;
    // Per-leg health travels with the payload. A wire that silently drops a
    // publisher looks identical to a quiet news day; this does not.
    const pubLegs = legs.filter((l) => l.name.startsWith("pub:"));
    return NextResponse.json({
      symbol,
      feed: f,
      count: items.length,
      bull,
      bear,
      neut: items.length - bull - bear,
      sources,
      items,
      diagnostics: {
        legs,
        publishersLive: pubLegs.filter((l) => l.ok && l.items > 0).length,
        publishersTotal: pubLegs.length,
        publishersDown: pubLegs.filter((l) => !l.ok || l.items === 0).map((l) => l.name.replace("pub:", "")),
        collapsed,
        stale,
        irrelevant,
        maxMs: legs.reduce((a, l) => Math.max(a, l.ms), 0),
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "news failed", symbol }, { status: 502 });
  }
}
