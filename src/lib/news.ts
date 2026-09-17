// News aggregation — powers every news desk (WIRE, hub, sentiment, finshots,
// NBFC, livemint). Sources: Yahoo Finance search news (no key) + Google News
// RSS (no key). Sentiment via finance-tuned lexicon scorer.

import { yahooHeaders } from "./yahoo";
import { retryFetch } from "./utils";

export interface NewsItem {
  id: string;
  title: string;
  link: string;
  source: string;
  published: string;
  ago: string;
  score: number;
  label: "BULL" | "BEAR" | "NEUT";
  desc?: string; // RSS <description> summary — reader fallback when the page blocks fetch
}

const POS = new Set(
  "surge surges jump jumps rally rallies record profits profit beats beat upgrade upgrades growth bullish breakout highs gain gains soars rebound outperform buy approval approve deal merger dividend bonus split expansion launch launches strong robust confidence raises raise hike hikes upgrade outperform outperformer top gainer".split(" ")
);
const NEG = new Set(
  "falls fall drops drop slides slide crash plunges plunge loss losses misses miss downgrade downgrades bearish breakdown lows decline declines slump weak probe fraud default layoffs layoff sell warning risks risk lawsuit fine penalty cuts cut slowdown concern concerns volatile crisis volatility top loser".split(" ")
);

export function scoreSentiment(text: string): { score: number; label: "BULL" | "BEAR" | "NEUT" } {
  const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);
  let p = 0, n = 0;
  for (const w of words) {
    if (POS.has(w)) p++;
    else if (NEG.has(w)) n++;
  }
  const score = (p - n) / Math.max(1, p + n);
  return { score: Math.round(score * 100) / 100, label: score >= 0.25 ? "BULL" : score <= -0.25 ? "BEAR" : "NEUT" };
}

export function ago(tsMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}M AGO`;
  if (s < 86400) return `${Math.floor(s / 3600)}H AGO`;
  return `${Math.floor(s / 86400)}D AGO`;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

async function fetchYahooNews(query: string): Promise<NewsItem[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=50`;
    const r = await retryFetch(url, { headers: yahooHeaders(), next: { revalidate: 300 } });
    if (!r.ok) return [];
    const j = await r.json();
    const quotes: string[] = (j?.quotes ?? [])
      .map((q: any) => String(q?.symbol ?? "").toUpperCase())
      .filter(Boolean);
    const quoteSet = new Set(quotes);
    // Ticker-like queries (no spaces) must match relatedTickers — otherwise
    // Yahoo returns a generic US lifestyle fallback (Toronto court, HPE,
    // mosquito maps, hoodies…) that buries the real wire. Free-text queries
    // (custom search, "Nifty Sensex…") skip this filter.
    const isTickerLike = !/\s/.test(query.trim());
    const raw: Array<{ n: any; i: number }> = (j?.news ?? []).map((n: any, i: number) => ({ n, i }));
    const kept = raw.filter(({ n }) => {
      if (!isTickerLike) return true;
      if (quoteSet.size === 0) return false;
      const rel: string[] = Array.isArray(n.relatedTickers) ? n.relatedTickers : [];
      if (rel.length === 0) return false;
      return rel.some((t) => quoteSet.has(String(t).toUpperCase()));
    });
    return kept.map(({ n, i }) => {
      const s = scoreSentiment(`${n.title ?? ""}`);
      const ts = (n.providerPublishTime ?? 0) * 1000;
      return {
        id: `yh-${n.uuid ?? i}`,
        title: n.title ?? "",
        link: n.link ?? "",
        source: (n.publisher ?? "YAHOO").toUpperCase(),
        published: ts ? new Date(ts).toISOString() : "",
        ago: ts ? ago(ts) : "—",
        score: s.score,
        label: s.label,
      } as NewsItem;
    });
  } catch {
    return [];
  }
}

async function fetchGoogleRSS(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  return fetchRSS(url, null, 100);
}

async function fetchFinshotsRSS(): Promise<NewsItem[]> {
  return fetchRSS("https://finshots.in/rss/", "FINSHOTS", 30);
}

// Bing News RSS wraps links as apiclick.aspx?...&url=<publisher> — the
// publisher URL decodes straight out, unlike Google's encrypted token.
async function fetchBingRSS(query: string, limit = 12): Promise<NewsItem[]> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&cc=in`;
    const r = await retryFetch(url, { headers: yahooHeaders(), next: { revalidate: 300 } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items: NewsItem[] = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(xml)) && items.length < limit) {
      const block = m[1];
      const pick = (tag: string) => {
        const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        if (!mm) return "";
        return decodeEntities(mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim());
      };
      const rawLink = pick("link").replace(/&amp;/g, "&");
      let link = rawLink;
      try {
        const inner = new URL(rawLink).searchParams.get("url");
        if (inner) link = inner;
      } catch { /* keep raw */ }
      if (!/^https?:\/\//i.test(link)) continue;
      if (/\/(section|sections|topic|topics)\//i.test(link)) continue;
      const title = pick("title");
      if (!title || title.length < 20) continue;
      let host = "";
      try { host = new URL(link).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* keep */ }
      const source = host.split(".")[0].toUpperCase().slice(0, 24) || "NEWS";
      const pub = pick("pubDate");
      const ts = pub ? Date.parse(pub) : NaN;
      const s = scoreSentiment(title);
      items.push({
        id: `bing-${i++}`,
        title,
        link,
        source,
        published: isFinite(ts) ? new Date(ts).toISOString() : "",
        ago: isFinite(ts) ? ago(ts) : "—",
        score: s.score,
        label: s.label,
      });
    }
    return items;
  } catch {
    return [];
  }
}

async function fetchRSS(url: string, sourceOverride: string | null, limit: number): Promise<NewsItem[]> {
  try {
    const r = await retryFetch(url, { headers: yahooHeaders(), next: { revalidate: 300 } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items: NewsItem[] = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(xml)) && items.length < limit) {
      const block = m[1];
      const pick = (tag: string) => {
        const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        if (!mm) return "";
        return decodeEntities(mm[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").trim());
      };
      let title = pick("title");
      const srcTag = pick("source");
      if (!title) continue;
      let source = sourceOverride ?? srcTag;
      if (!source && title.includes(" - ")) {
        const parts = title.split(" - ");
        source = parts[parts.length - 1];
        title = parts.slice(0, -1).join(" - ");
      }
      // Drop a trailing " - <source>" echo so RSS + search copies dedup.
      if (source) {
        const esc = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        title = title.replace(new RegExp(`\\s+-\\s+${esc}$`, "i"), "").trim();
      }
      const pub = pick("pubDate");
      const ts = pub ? Date.parse(pub) : NaN;
      const s = scoreSentiment(title);
      // Feed summary doubles as the reader fallback when the publisher
      // page blocks server fetch (403/paywall). Plain text, capped.
      const rawDesc = pick("description").replace(/<[^>]*>/g, " ");
      const desc = decodeEntities(rawDesc).replace(/\s+/g, " ").trim().slice(0, 600) || undefined;
      // Google News wraps links as news.google.com/rss/articles/... (JS wall
      // for server fetch), but the item's <source> tag carries the real
      // publisher URL — prefer it so the reader + OPEN ORIGINAL land direct.
      let link = pick("link");
      const srcUrlM = block.match(/<source[^>]*\surl="([^"]+)"/i);
      if (srcUrlM) {
        const cand = decodeEntities(srcUrlM[1]).replace(/&amp;/g, "&").trim();
        try {
          if (/^https?:\/\//i.test(cand) && /news\.google\.com/i.test(new URL(link).hostname)) link = cand;
        } catch { /* keep wrapper */ }
      }
      items.push({
        id: `rss-${sourceOverride ? "fin" : "g"}-${i++}`,
        title,
        link,
        source: (source || "NEWS").toUpperCase().slice(0, 24),
        published: isFinite(ts) ? new Date(ts).toISOString() : "",
        ago: isFinite(ts) ? ago(ts) : "—",
        score: s.score,
        label: s.label,
        ...(desc ? { desc } : {}),
      });
    }
    return items;
  } catch {
    return [];
  }
}

export type NewsFeed = "company" | "wire" | "finshots" | "nbfc" | "mint" | "editorials";

export async function getNews(symbol: string, feed: NewsFeed, customQ?: string): Promise<{ items: NewsItem[]; sources: string[] }> {
  if (customQ && customQ.trim()) {
    const q = customQ.trim();
    const parts = await Promise.all([fetchYahooNews(q), fetchGoogleRSS(q)]);
    return mergeParts(parts);
  }
  const base = symbol.replace(/\.NS$|\.BO$|^\^/, "");
  const jobs: Promise<NewsItem[]>[] = [];
  if (feed === "company") {
    jobs.push(fetchYahooNews(symbol));
    jobs.push(fetchGoogleRSS(`${base} share price`));
  } else if (feed === "wire") {
    jobs.push(fetchYahooNews(symbol));
    // Symbol-specific Google keeps <NARROW> working (e.g. SMFG): without
    // this the wire is only Nifty-market news, so filtering by ticker
    // always yields 0 ("WIRE QUIET") while the rail shows unfiltered tops.
    if (base && base.length >= 2) jobs.push(fetchGoogleRSS(`${base} stock`));
    jobs.push(fetchGoogleRSS("Nifty Sensex stock market today"));
    jobs.push(fetchYahooNews("Nifty"));
  } else if (feed === "finshots") {
    // Finshots-first: publisher RSS + site-restricted search. No generic
    // Yahoo company wire (that is what made it look like "news, not Finshots").
    jobs.push(fetchFinshotsRSS());
    jobs.push(fetchGoogleRSS(`site:finshots.in ${base}`));
    jobs.push(fetchGoogleRSS("site:finshots.in markets"));
  } else if (feed === "nbfc") {
    jobs.push(fetchYahooNews(symbol));
    jobs.push(fetchGoogleRSS("NBFC RBI Bajaj Finance Shriram"));
    jobs.push(fetchYahooNews("BAJFINANCE.NS"));
  } else if (feed === "mint") {
    jobs.push(fetchYahooNews(symbol));
    jobs.push(fetchGoogleRSS("site:livemint.com markets"));
  } else if (feed === "editorials") {
    // Opinion/editorial pages with DIRECT publisher links (Bing exposes the
    // target URL; Google encrypts it, which breaks the inline reader).
    jobs.push(fetchBingRSS("site:livemint.com opinion economy markets"));
    jobs.push(fetchBingRSS("site:thehindu.com editorial economy markets"));
    jobs.push(fetchBingRSS("site:indianexpress.com opinion economy markets"));
    jobs.push(fetchBingRSS("editorial opinion stock market economy RBI"));
  }
  const parts = await Promise.all(jobs);
  return mergeParts(parts);
}

function mergeParts(parts: NewsItem[][]): { items: NewsItem[]; sources: string[] } {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const list of parts) {
    for (const n of list) {
      const key = n.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  out.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const sources = [...new Set(out.map((n) => n.source))].slice(0, 12);
  return { items: out.slice(0, 150), sources };
}
