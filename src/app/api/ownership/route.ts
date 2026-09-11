import { NextRequest, NextResponse } from "next/server";
import { normalizeTicker } from "@/lib/utils";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function strip(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

function parseNum(raw: string): number | null {
  const s = raw.replace(/,/g, "").replace(/%/g, "").trim();
  if (!s || s === "—" || s === "-" || s === "–") return null;
  const v = Number(s);
  return isFinite(v) ? v : null;
}

// Quarterly holder mix (promoter/FII/DII/public) with QoQ deltas,
// parsed from the screener.in shareholding ledger.
export async function GET(req: NextRequest) {
  const symbol = normalizeTicker(req.nextUrl.searchParams.get("symbol") || "RELIANCE.NS");
  const base = symbol.replace(/\.NS$|\.BO$/, "");
  try {
    const r = await fetch(`https://www.screener.in/company/${encodeURIComponent(base)}/`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      next: { revalidate: 21600 },
    });
    if (!r.ok) throw new Error(`screener ${r.status}`);
    const html = await r.text();
    const start = html.indexOf('<section id="shareholding"');
    if (start < 0) throw new Error("no shareholding section");
    const next = html.indexOf("<section", start + 10);
    const chunk = html.slice(start, next < 0 ? start + 120000 : next);
    const tm = chunk.match(/<table[\s\S]*?<\/table>/);
    if (!tm) throw new Error("no table");
    const rawRows: string[][] = [];
    const re = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tm[0]))) {
      const cells: string[] = [];
      const cre = /<t[hd][^>]*>([\s\S]*?)<\/t[dh]>/g;
      let c: RegExpExecArray | null;
      while ((c = cre.exec(m[1]))) cells.push(strip(c[1]));
      if (cells.length > 1) rawRows.push(cells);
    }
    if (rawRows.length < 2) throw new Error("empty table");
    const periods = rawRows[0].slice(1);
    const rows = rawRows.slice(1).map((rr) => ({
      label: rr[0],
      values: rr.slice(1).map(parseNum),
    }));
    const latest: Record<string, number | null> = {};
    const qoq: Record<string, number | null> = {};
    for (const row of rows) {
      const vals = row.values.filter((v): v is number => v !== null);
      latest[row.label] = vals.length ? vals[vals.length - 1] : null;
      qoq[row.label] = vals.length > 1 ? Math.round((vals[vals.length - 1] - vals[vals.length - 2]) * 100) / 100 : null;
    }
    return NextResponse.json({ symbol, periods, rows, latest, qoq });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ownership failed", symbol }, { status: 502 });
  }
}
