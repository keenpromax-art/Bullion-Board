import { NextRequest, NextResponse } from "next/server";

// Fetch an article URL server-side and return clean readable text.
// Used by the news desks so a click reads inline instead of a new tab.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function blockedHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0];
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^\[?(::1|fe80|fc00|fd)/i.test(h)) return true;
  return false;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 16)); } catch { return ""; }
    }).replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(Number(n)); } catch { return ""; }
    });
}

function stripTags(s: string): string {
  return decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function pickH1(html: string): string {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) {
    const t = stripTags(m[1]);
    if (t.length > 8) return t.slice(0, 200);
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? stripTags(t[1]).slice(0, 200) : "";
}

function extractBody(html: string): string[] {
  // Prefer semantic containers (Ghost sites use .gh-content/.post-content).
  const zones: string[] = [];
  const zone = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) zones.push(m[1]);
  };
  zone(/<article[^>]*>([\s\S]*?)<\/article>/gi);
  // Balanced scan: inner content of the first div/section whose class
  // matches (handles nested divs that cut naive non-greedy matches short).
  const balanced = (openRe: RegExp): string | null => {
    const o = openRe.exec(html);
    if (!o || o.index === undefined) return null;
    const tag = o[0].startsWith("<section") ? "section" : "div";
    let depth = 0;
    const re = new RegExp(`<(/?)${tag}[^>]*>`, "gi");
    re.lastIndex = o.index;
    let m: RegExpExecArray | null;
    const start = o.index + o[0].length;
    while ((m = re.exec(html))) {
      if (m[1] === "/") {
        depth--;
        if (depth === 0) return html.slice(start, m.index);
      } else depth++;
      if (depth > 60) return null;
    }
    return null;
  };
  const zoneHtml = balanced(/<(?:div|section)[^>]*class="[^"]*(?:gh-content|post-content|article-body|story-body|entry-content|full-detail|story_details|articleBody)[^"]*"[^>]*>/i);
  if (zoneHtml) zones.push(zoneHtml);
  if (!zones.length) zone(/<main[^>]*>([\s\S]*?)<\/main>/gi);
  const scope = zones.length ? zones.join("\n") : html;
  const clean = scope
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const paras: string[] = [];
  const re = /<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/(?:p|h2|h3|li)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) && paras.length < 80) {
    const t = stripTags(m[2]);
    if (t.length < 40) continue;
    if (/^(also read|read more|subscribe|sign up|follow us|advertisement)/i.test(t)) continue;
    paras.push(t);
    if (paras.join(" ").length > 12000) break;
  }
  // Dedupe repeated blocks (related-story widgets repeat text).
  const seen = new Set<string>();
  return paras.filter((p) => {
    const k = p.slice(0, 60).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function GET(req: NextRequest) {
  const url = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || blockedHost(u.hostname)) {
    return NextResponse.json({ error: "url not allowed" }, { status: 400 });
  }
  try {
    const r = await fetch(u.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    try {
      if (new URL(r.url).hostname.includes("news.google.com")) {
        throw new Error("WRAPPED_LINK");
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "WRAPPED_LINK") {
        throw new Error("publisher hides this link — use OPEN ORIGINAL ↗");
      }
    }
    const buf = await r.arrayBuffer();
    if (buf.byteLength > 1_500_000) throw new Error("page too large");
    // Press/RSS pages are UTF-8 in practice; non-fatal keeps one stray byte
    // from nuking the whole document (fatal:true + meta-sniff fallback caused
    // whole-page latin1 mojibake on a single bad byte).
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const title = pickH1(html);
    const paragraphs = extractBody(html);
    if (!paragraphs.length) throw new Error("no readable text found");
    return NextResponse.json({ url: u.toString(), title, count: paragraphs.length, paragraphs });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "article failed", url }, { status: 502 });
  }
}
