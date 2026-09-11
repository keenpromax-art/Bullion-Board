import { NextRequest, NextResponse } from "next/server";

const API = "https://en.wikipedia.org/w/api.php";

// Wikipedia terminal backend: search + article extracts (no key).
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim().slice(0, 120);
  const title = (sp.get("title") || "").trim().slice(0, 200);
  try {
    if (title) {
      const u = `${API}?action=query&format=json&prop=extracts&explaintext&exsectionformat=plain&redirects=1&titles=${encodeURIComponent(title)}&origin=*`;
      const r = await fetch(u, { headers: { "User-Agent": "StockTerminal/1.0" }, next: { revalidate: 86400 } });
      if (!r.ok) throw new Error(`wiki ${r.status}`);
      const j = await r.json();
      const pages = j?.query?.pages ?? {};
      const first = Object.values(pages)[0] as any;
      if (!first || first.missing) throw new Error("no article");
      const full: string = first.extract ?? "";
      return NextResponse.json({
        title: first.title,
        intro: full.split("\n").slice(0, 4).join("\n").slice(0, 3000),
        body: full.slice(0, 12000),
        link: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(first.title).replace(/ /g, "_"))}`,
      });
    }
    if (!q) return NextResponse.json({ results: [] });
    const u = `${API}?action=query&format=json&list=search&srsearch=${encodeURIComponent(q)}&srlimit=10&srprop=size&origin=*`;
    const r = await fetch(u, { headers: { "User-Agent": "StockTerminal/1.0" }, next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`wiki ${r.status}`);
    const j = await r.json();
    return NextResponse.json({
      results: ((j?.query?.search ?? []) as any[]).map((s) => ({ title: s.title, words: s.wordcount })),
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "wiki failed" }, { status: 502 });
  }
}
