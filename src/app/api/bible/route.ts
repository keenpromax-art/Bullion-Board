import { NextRequest, NextResponse } from "next/server";

// Scripture backend via the free bolls.life API (no key).
const BASE = "https://bolls.life";

function cleanVerse(s: string): string {
  return s
    .replace(/<S>.*?<\/S>/g, "")
    .replace(/<sup>(.*?)<\/sup>/g, " ($1)")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const book = parseInt(sp.get("book") || "43", 10); // John
  const chapter = parseInt(sp.get("chapter") || "3", 10);
  const trans = (sp.get("trans") || "KJV").toUpperCase();
  try {
    if (sp.get("books")) {
      const r = await fetch(`${BASE}/get-books/${encodeURIComponent(trans)}/`, { next: { revalidate: 86400 } });
      if (!r.ok) throw new Error(`bolls ${r.status}`);
      const j = await r.json();
      const books = (Array.isArray(j) ? j : []).map((b: any, i: number) => ({
        id: Number(b.bookid ?? b.id ?? i + 1),
        name: String(b.name ?? b.book ?? `BOOK ${i + 1}`),
        chapters: Number(b.chapters ?? 0),
      }));
      return NextResponse.json({ trans, books });
    }
    const r = await fetch(`${BASE}/get-text/${encodeURIComponent(trans)}/${book}/${chapter}/`, { next: { revalidate: 86400 } });
    if (!r.ok) throw new Error(`bolls ${r.status}`);
    const j = await r.json();
    const verses = (Array.isArray(j) ? j : []).map((v: any) => ({
      n: Number(v.verse ?? v.pk ?? 0),
      text: cleanVerse(String(v.text ?? "")),
    })).filter((v) => v.text);
    return NextResponse.json({ trans, book, chapter, count: verses.length, verses });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bible failed" }, { status: 502 });
  }
}
