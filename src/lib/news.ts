// News aggregation — powers every news desk (WIRE, hub, sentiment, finshots,
// NBFC, livemint).
//
// Three tiers, in priority order:
//
//   1. PUBLISHER FEEDS — each outlet's own RSS, fetched directly. Authoritative
//      attribution, a working link, and no intermediary to decrypt. Probed live:
//      Livemint, Economic Times, Business Standard, NDTV Profit, News18 and
//      Finshots all serve fresh items; CNBC-TV18, Moneycontrol, Upstox,
//      Financial Express and Zee Business are dead or stale and are NOT here.
//   2. YAHOO SEARCH — publisher-quality search news for a ticker, with an
//      explicit relatedTickers filter so a ticker query cannot fall back to
//      unrelated US lifestyle results.
//   3. GOOGLE / BING SEARCH RSS — breadth. Good recall, poor precision, so its
//      items are ranked BELOW publisher items and are the first thing dropped
//      when the feed is full.
//
// Every leg is fail-open and reports its own outcome, so a dead feed is visible
// as a dead feed instead of silently shrinking the wire.

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
  /** 1 = publisher's own wire, 2 = Yahoo search, 3 = aggregator. Drives ranking. */
  tier: 1 | 2 | 3;
  /** Number of outlets carrying this story after clustering. 1 = single source. */
  also?: number;
  /** 1-3: how directly this item is about the focused ticker. Drives ranking. */
  about?: number;
}

export interface FeedLeg {
  name: string;
  ok: boolean;
  items: number;
  ms: number;
  error?: string;
}

export interface NewsResult {
  items: NewsItem[];
  sources: string[];
  legs: FeedLeg[];
  /** Stories that existed in the raw pull but were collapsed as duplicates. */
  collapsed: number;
  /** Items dropped for being older than the feed's freshness window. */
  stale: number;
  /** Items dropped because a general-purpose wire item was not market news. */
  irrelevant: number;
}

const POS = new Set(
  "surge surges jump jumps rally rallies record profit profits beats beat upgrade upgrades growth bullish breakout highs gain gains soars rebound outperform buy approval approve deal merger dividend bonus split expansion launch launches strong robust confidence raises raise hike hikes profit surge advance climbs jump top gainer winner winning accelerates".split(" ")
);
const NEG = new Set(
  "fall falls drop drops slide slides crash plunges plunge loss losses miss misses downgrade downgrades bearish breakdown lows decline declines slump weak probe probes fraud default layoffs layoff layoffs sell warning warnings risk risks lawsuit fine penalty cuts cut slowdown concern concerns volatile crisis volatility top loser losers tumble slumps sinks fall weaker drag dragged pressure pressured fears fear".split(" ")
);

/** Headline words that flip meaning in a market context. */
const NEGATORS = new Set(["not", "no", "never", "without", "fails", "fail", "failed", "unlikely", "avoid", "denies", "denied", "halts", "halted", "bottleneck"]);

export function scoreSentiment(text: string): { score: number; label: "BULL" | "BEAR" | "NEUT" } {
  const words = (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);
  let p = 0, n = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let hit = 0;
    if (POS.has(w)) hit = 1;
    else if (NEG.has(w)) hit = -1;
    if (hit === 0) continue;
    // A negator in the preceding two words reverses the sense: "fails to rise",
    // "not approved". Counted as a mild negative rather than a full flip, since
    // headline negation is noisy.
    if (i >= 1 && (NEGATORS.has(words[i - 1]) || (i >= 2 && NEGATORS.has(words[i - 2])))) {
      n += 0.5;
      continue;
    }
    if (hit > 0) p++;
    else n++;
  }
  const total = p + n;
  const score = total === 0 ? 0 : (p - n) / total;
  return {
    score: Math.round(score * 100) / 100,
    label: score >= 0.25 ? "BULL" : score <= -0.25 ? "BEAR" : "NEUT",
  };
}

export function ago(tsMs: number): string {
  const s = Math.max(0, Math.floor((Date.now() - tsMs) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}M AGO`;
  if (s < 86400) return `${Math.floor(s / 3600)}H AGO`;
  return `${Math.floor(s / 86400)}D AGO`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&nbsp;/g, " ");
}

/** Google and Yahoo both append "- Publisher" to headlines. Strip it. */
function stripSourceEcho(title: string, source: string): string {
  let t = title.trim();
  if (source) {
    const esc = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s*[|\\-–—]\\s*${esc}\\s*$`, "i"), "").trim();
  }
  // Any trailing "- SomePublisher" that the source tag did not name.
  t = t.replace(/\s*[|]\s*[^-|]{2,28}$/, (m) => (/\b(news|business|markets|money|india|times|stock|live|today)\b/i.test(m) ? "" : m));
  return t.trim() || title.trim();
}

function parseDate(...cands: string[]): number {
  for (const c of cands) {
    if (!c) continue;
    const t = Date.parse(c.trim());
    if (isFinite(t)) return t;
  }
  return NaN;
}

/**
 * Upstream cache windows. Publishers and search RSS re-fetch every minute so a
 * 60s client poll actually sees new stories; they used to sit at 300s, which
 * meant four polls in five returned byte-identical data and the wire only
 * refreshed once every five minutes. Next's data cache is shared across
 * requests, so this is ONE upstream pull per leg per minute no matter how many
 * browsers are open.
 */
const RSS_REVALIDATE = 60;
/** Yahoo's search endpoint is the fragile one and returns nothing for most
 *  Indian tickers anyway — cache it long and let a miss cost one request. */
const YAHOO_REVALIDATE = 300;

const rssHeaders = (): Record<string, string> => ({
  ...yahooHeaders(),
  Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
});

// ---------------------------------------------------------------------------
// Tier 1 — publisher feeds
// ---------------------------------------------------------------------------

export interface Publisher {
  key: string;
  label: string;
  url: string;
  /** Section tag used for feeds that need a per-topic variant. */
  feed?: "wire" | "economy" | "opinion" | "company" | "nbfc" | "finshots" | "mint";
  /**
   * `markets` = the feed is already market-only, so every item qualifies.
   * `general` = a broad newswire. Its items must clear MARKET_RELEVANCE before
   * they reach a market feed, or the wire fills up with film reviews and
   * cricket. NDTV Profit's root RSS is general; its markets feed is not.
   */
  kind: "markets" | "general";
}

/** Probed live. Anything not listed here either 404s or serves stale content. */
const PUBLISHERS: Publisher[] = [
  { key: "mint-markets", label: "LIVEMINT", url: "https://www.livemint.com/rss/markets", feed: "mint", kind: "markets" },
  { key: "mint-economy", label: "LIVEMINT", url: "https://www.livemint.com/rss/economy", feed: "economy", kind: "markets" },
  { key: "mint-companies", label: "LIVEMINT", url: "https://www.livemint.com/rss/companies", feed: "company", kind: "markets" },
  { key: "mint-opinion", label: "LIVEMINT", url: "https://www.livemint.com/rss/opinion", feed: "opinion", kind: "general" },
  { key: "et-markets", label: "ECONOMIC TIMES", url: "https://economictimes.indiatimes.com/markets/rssfeedsdefault.cms", feed: "wire", kind: "markets" },
  { key: "bs-markets", label: "BUSINESS STANDARD", url: "https://www.business-standard.com/rss/markets-106.rss", feed: "wire", kind: "markets" },
  { key: "bs-economy", label: "BUSINESS STANDARD", url: "https://www.business-standard.com/rss/economy-102.rss", feed: "economy", kind: "markets" },
  { key: "ndtv-profit", label: "NDTV PROFIT", url: "https://www.ndtvprofit.com/rss", kind: "general" },
  { key: "news18-business", label: "NEWS18", url: "https://www.news18.com/commonfeeds/v1/eng/rss/business.xml", kind: "general" },
  { key: "finshots", label: "FINSHOTS", url: "https://finshots.in/rss/", feed: "finshots", kind: "markets" },
];

const publishersFor = (feed: Publisher["feed"] | undefined, keys: string[]) =>
  PUBLISHERS.filter((p) => keys.includes(p.key) || (feed && p.feed === feed));

/**
 * Market vocabulary, used to gate general-purpose wires so a market desk does
 * not serve a trailer release or a cricket fixture. Deliberately broad on
 * macro and commodity terms: an oil or rates headline moves Nifty even when no
 * index is named.
 */
const MARKET_TERMS = new Set(
  `nifty sensex bse nse market markets stock stocks share shares equity equities
   index indices rupee niftybank bank banking banks niftyit financial financials
   finance fintech rbi repo rate rates ratecut ratehike inflation cpi wpi
   gdp fiscal budget deficit revenue gst tax taxes tariff tariffs trade trading
   profit profits loss losses earnings revenue margin margins capex fpo ipo listing
   listed invest investment investing fund funds mutual mf etf sip bond bonds yield
   yields treasury crude oil brent gold silver copper commodity commodities dollar
   fed federalrate fomc wallstreet nasdaq dowjones sp500 bondyield currencypair
   dollarindex crudeoil goldprice company companies corporate ltd results
   q1 q2 q3 q4 guidance outlook upgrade downgrade targetprice broker
   brokerage valuation ratio marketcap aum nav demat arbitrage
   short covering fii dii fpii bulk deal block deal promoter
   bull bear rally decline surge plunge crash correction consolidation breakout
   exchange nifty50 sensex30 banknifty midcap smallcap largacap midcaps
   export import monsoon rainfall drought consumption power refinery
   nbfc hfc mutualfund goldprice commodity broking`
    .split(/\s+/)
    .filter(Boolean)
);

const isMarketRelevant = (title: string): boolean => {
  const words = (title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return words.some((w) => MARKET_TERMS.has(w));
};

/**
 * Sector vocabulary for the NBFC desk. A generic market gate is not enough
 * here: the Livemint and ET market wires are full of items that clear it while
 * having nothing to do with lenders. So an NBFC desk needs a lending term too.
 */
const NBFC_TERMS = new Set(
  `nbfc nbhfc hfc lender lending loans loan borrower borrowing credit
   mudra microfinance microfinance emi msme sme
   bajajfinance shriramfin cholamandalam muthoot manappuram
   au_smallfinance au bank equitas bandhan pioclayspn
   l&tfinance srfinpoonamallea bafl aurelin poonawalla
   rbi repo slr nppa kmp dirl financial inclusion
   delinquency npa grossnpa netnpa provisioning
   disbursement aum sanctions book lending book
   unsecured secured overdraft personal loan gold loan
   vehicle finance housing finance mortgage
   creditcard credit card fintech lending platform
   capital adequacy net worth capital adequacy ratio
   novaxis dsp hirer krbl aufinance`
    .split(/\s+/)
    .filter(Boolean)
);

const isNBFCRelevant = (title: string): boolean => {
  const words = (title.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return words.some((w) => NBFC_TERMS.has(w));
};

/** Per-feed extra gate, applied on top of the base relevance rule. */
const FEED_GATE: Partial<Record<NewsFeed, (title: string) => boolean>> = {
  nbfc: isNBFCRelevant,
};

/**
 * A story's identity must be a property of the story, not of its position.
 * An index-derived id changes whenever the feed re-sorts, which made every
 * re-pull look like a completely new wire to anything tracking arrivals — the
 * "N NEW" counter would fire on all 130 rows each minute instead of on the
 * handful that actually arrived. Prefer the link; fall back to the headline.
 */
function stableId(prefix: string, link: string, title: string, ts: number): string {
  // Both parts, not just the link: several distinct headlines can arrive on one
  // publisher URL (a wire's rolling story page), and a link-only id made those
  // collide — 10 duplicate ids in a single pull, which breaks React keys and
  // under-counts arrivals. Normalising the title keeps the id stable across
  // re-sorts while staying unique per story.
  const norm = title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
  const basis = `${link}|${norm}|${isFinite(ts) ? new Date(ts).toISOString().slice(0, 16) : ""}`;
  let h = 2166136261;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

/** Parse an RSS/Atom document into NewsItems. Shared by every feed leg. */
function parseFeed(xml: string, label: string, tier: 1 | 2 | 3, limit: number, prefix: string): NewsItem[] {
  const out: NewsItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g),
    ...xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/g),
  ];
  for (const b of blocks) {
    if (out.length >= limit) break;
    const block = b[1];
    const pick = (tag: string): string => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!m) return "";
      return decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();
    };
    let title = pick("title").replace(/<[^>]*>/g, "").trim();
    if (!title || title.length < 18) continue;

    let link = pick("link");
    if (!link) {
      const href = block.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? decodeEntities(href[1]) : "";
    }
    link = link.replace(/&amp;/g, "&").trim();

    const ts = parseDate(pick("pubDate"), pick("published"), pick("updated"), pick("dc:date"), pick("date"));
    const s = scoreSentiment(title);
    const srcTag = pick("source");
    const source = (label || srcTag || "NEWS").toUpperCase().slice(0, 24);
    title = stripSourceEcho(title, source);

    const rawDesc = pick("description").replace(/<[^>]*>/g, " ");
    const desc = decodeEntities(rawDesc).replace(/\s+/g, " ").trim().slice(0, 600) || undefined;

    out.push({
      id: stableId(prefix, link, title, ts),
      title,
      link,
      source,
      published: isFinite(ts) ? new Date(ts).toISOString() : "",
      ago: isFinite(ts) ? ago(ts) : "—",
      score: s.score,
      label: s.label,
      tier,
      ...(desc ? { desc } : {}),
    });
  }
  return out;
}

async function fetchPublisher(p: Publisher): Promise<{ items: NewsItem[]; irrelevant: number }> {
  const r = await retryFetch(p.url, { headers: rssHeaders(), next: { revalidate: RSS_REVALIDATE } });
  if (!r.ok) return { items: [], irrelevant: 0 };
  const items = parseFeed(await r.text(), p.label, 1, 40, `pub-${p.key}`);
  // A general-purpose wire must prove it is market news before it lands on a
  // market desk. Filtered here rather than in the UI so every consumer of the
  // lib benefits, and so the drop is counted rather than invisible.
  if (p.kind === "general") {
    const kept = items.filter((n) => isMarketRelevant(n.title));
    return { items: kept, irrelevant: items.length - kept.length };
  }
  return { items, irrelevant: 0 };
}

// ---------------------------------------------------------------------------
// Tier 2 — Yahoo search (ticker-aware)
// ---------------------------------------------------------------------------

async function fetchYahooNews(query: string, requireTicker: boolean): Promise<NewsItem[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=50`;
    const r = await retryFetch(url, { headers: yahooHeaders(), next: { revalidate: YAHOO_REVALIDATE } });
    if (!r.ok) return [];
    const j = await r.json();
    const quotes: string[] = (j?.quotes ?? [])
      .map((q: any) => String(q?.symbol ?? "").toUpperCase())
      .filter(Boolean);
    const quoteSet = new Set(quotes);
    // Ticker-like queries (no spaces) must match relatedTickers — otherwise
    // Yahoo returns a generic US lifestyle fallback that buries the real wire.
    const isTickerLike = !/\s/.test(query.trim());
    const raw: Array<{ n: any; i: number }> = (j?.news ?? []).map((n: any, i: number) => ({ n, i }));
    const kept = raw.filter(({ n }) => {
      if (!isTickerLike || !requireTicker) return true;
      if (quoteSet.size === 0) return false;
      const rel: string[] = Array.isArray(n.relatedTickers) ? n.relatedTickers : [];
      return rel.length > 0 && rel.some((t) => quoteSet.has(String(t).toUpperCase()));
    });
    return kept.map(({ n, i }) => {
      const s = scoreSentiment(String(n.title ?? ""));
      const ts = (n.providerPublishTime ?? 0) * 1000;
      const publisher = String(n.publisher ?? "YAHOO").toUpperCase().slice(0, 24);
      return {
        id: `yh-${n.uuid ?? i}`,
        title: stripSourceEcho(String(n.title ?? ""), publisher),
        link: String(n.link ?? ""),
        source: publisher,
        published: ts ? new Date(ts).toISOString() : "",
        ago: ts ? ago(ts) : "—",
        score: s.score,
        label: s.label,
        tier: 2,
      } as NewsItem;
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — search RSS (breadth, lowest precision)
// ---------------------------------------------------------------------------

async function fetchGoogleRSS(query: string, limit = 40): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const r = await retryFetch(url, { headers: rssHeaders(), next: { revalidate: RSS_REVALIDATE } });
    if (!r.ok) return [];
    return parseGoogle(await r.text(), limit);
  } catch {
    return [];
  }
}

/** Bing wraps links as apiclick.aspx?...&url=<publisher> — the real URL decodes out. */
async function fetchBingRSS(query: string, limit = 15): Promise<NewsItem[]> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&cc=in`;
    const r = await retryFetch(url, { headers: rssHeaders(), next: { revalidate: RSS_REVALIDATE } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items: NewsItem[] = [];
    for (const b of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
      if (items.length >= limit) break;
      const block = b[1];
      const pick = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : "";
      };
      let link = pick("link").replace(/&amp;/g, "&");
      try {
        const inner = new URL(link).searchParams.get("url");
        if (inner) link = inner;
      } catch { /* keep raw */ }
      if (!/^https?:\/\//i.test(link)) continue;
      const title = pick("title");
      if (!title || title.length < 18) continue;
      let host = "";
      try { host = new URL(link).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* keep */ }
      const source = host.split(".")[0].toUpperCase().slice(0, 24) || "NEWS";
      const ts = parseDate(pick("pubDate"));
      const s = scoreSentiment(title);
      items.push({
        id: stableId("bing", link, title, ts),
        title: stripSourceEcho(title, source),
        link,
        source,
        published: isFinite(ts) ? new Date(ts).toISOString() : "",
        ago: isFinite(ts) ? ago(ts) : "—",
        score: s.score,
        label: s.label,
        tier: 3,
      });
    }
    return items;
  } catch {
    return [];
  }
}

function parseGoogle(xml: string, limit: number): NewsItem[] {
  const out: NewsItem[] = [];
  for (const b of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)) {
    if (out.length >= limit) break;
    const block = b[1];
    const pick = (tag: string) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return m ? decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : "";
    };
    let title = pick("title");
    if (!title) continue;
    let link = pick("link").replace(/&amp;/g, "&");
    const srcTag = pick("source");
    // Google wraps links behind a JS wall; the item's <source url> carries the
    // real publisher, so OPEN ORIGINAL lands direct.
    const srcUrl = block.match(/<source[^>]*\surl="([^"]+)"/i);
    if (srcUrl) {
      const cand = decodeEntities(srcUrl[1]).replace(/&amp;/g, "&").trim();
      try {
        if (/^https?:\/\//i.test(cand) && /news\.google\.com/i.test(new URL(link).hostname)) link = cand;
      } catch { /* keep wrapper */ }
    }
    const source = (srcTag || "NEWS").toUpperCase().slice(0, 24);
    title = stripSourceEcho(title, source);
    const ts = parseDate(pick("pubDate"));
    const s = scoreSentiment(title);
    const rawDesc = pick("description").replace(/<[^>]*>/g, " ");
    const desc = decodeEntities(rawDesc).replace(/\s+/g, " ").trim().slice(0, 600) || undefined;
    out.push({
      id: stableId("g", link, title, ts),
      title,
      link,
      source,
      published: isFinite(ts) ? new Date(ts).toISOString() : "",
      ago: isFinite(ts) ? ago(ts) : "—",
      score: s.score,
      label: s.label,
      tier: 3,
      ...(desc ? { desc } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clustering — collapse one story carried by many outlets into one row
// ---------------------------------------------------------------------------

const STOP = new Set(
  "a an the and or of in on at to for from by with after before as is are was were be been being it its this that these those up down over under new latest today live news blog update updates report reports says said will may mayn't could would amid more than into out about how why what when who which here now not no".split(" ")
);

function tokenSet(title: string): Set<string> {
  return new Set(
    (title.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .filter((w) => w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Cluster by headline similarity, keeping the highest-tier copy and counting
 * the rest as `also`. Without this the wire shows one Sensex crash six times
 * and one holiday notice seven times, because every outlet headlines the same
 * event with its own synonym.
 */
function cluster(items: NewsItem[]): { items: NewsItem[]; collapsed: number } {
  const groups: Array<{ rep: NewsItem; tokens: Set<string>; also: number }> = [];
  for (const n of items) {
    const t = tokenSet(n.title);
    let placed = false;
    for (const g of groups) {
      if (jaccard(t, g.tokens) >= 0.55) {
        g.also++;
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ rep: n, tokens: t, also: 0 });
  }
  let collapsed = 0;
  const out = groups
    .sort((a, b) => a.rep.tier - b.rep.tier || a.also - b.also)
    .map((g) => {
      collapsed += g.also;
      return g.also > 0 ? { ...g.rep, also: g.also } : g.rep;
    });
  return { items: out, collapsed };
}

// ---------------------------------------------------------------------------
// Feed assembly
// ---------------------------------------------------------------------------

export type NewsFeed = "company" | "wire" | "finshots" | "nbfc" | "mint" | "editorials";

interface LegSpec {
  name: string;
  kind: "pub" | "yahoo" | "google" | "bing";
  arg?: string;
  /** Publisher key for `pub` legs. */
  key?: string;
  /** Extra per-feed relevance gate for this leg. */
  gate?: (title: string) => boolean;
}

function planLegs(symbol: string, feed: NewsFeed): { legs: LegSpec[]; publishers: Publisher[]; maxAgeH: number } {
  const base = symbol.replace(/\.NS$|\.BO$|^\^/, "");
  // Search by the name a headline would actually use. BAJFINANCE matches
  // nothing in a headline; "Bajaj Finance" matches everything that matters.
  const query = searchNameFor(symbol);
  void base;
  switch (feed) {
    case "company":
      // Search hard on the security itself and let the generic COMPANIES wire
      // backfill breadth. The wire's relevance to RELIANCE is low (it covers
      // every listed company), so the ticker-targeted legs must be denser than
      // a single query or the desk shows Codelco and NTPC under RELIANCE.
      return {
        legs: [
          { name: "google:ticker", kind: "google", arg: `"${query}" share price` },
          { name: "google:ticker-news", kind: "google", arg: `"${query}" stock news India` },
          { name: "google:ticker-results", kind: "google", arg: `"${query}" results earnings` },
          { name: "yahoo:ticker", kind: "yahoo", arg: symbol },
        ],
        publishers: publishersFor("company", ["mint-companies", "mint-markets"]),
        maxAgeH: 168,
      };
    case "wire":
      return {
        legs: [
          { name: "google:indices", kind: "google", arg: "Nifty Sensex stock market today India" },
          { name: "google:exchanges", kind: "google", arg: "BSE NSE market news today" },
          { name: "yahoo:indices", kind: "yahoo", arg: "Nifty 50 index India market" },
          { name: "yahoo:sensex", kind: "yahoo", arg: "Sensex BSE index market today" },
        ],
        publishers: publishersFor("wire", ["et-markets", "bs-markets", "mint-markets", "mint-economy", "news18-business", "ndtv-profit"]),
        maxAgeH: 36,
      };
    case "finshots":
      // Finshots publishes roughly one long piece a day, so a two-week window
      // left the desk showing 10 posts. 45 days matches their actual cadence.
      return {
        legs: [
          { name: "google:site-base", kind: "google", arg: `site:finshots.in ${base}` },
          { name: "google:site-markets", kind: "google", arg: "site:finshots.in markets" },
        ],
        publishers: publishersFor("finshots", []),
        maxAgeH: 1080,
      };
    case "nbfc":
      // Yahoo search news returns nothing for Indian tickers, so this desk leans
      // on publisher wires plus targeted search rather than ticker search.
      return {
        legs: [
          { name: "google:nbfc", kind: "google", arg: "NBFC RBI Bajaj Finance Shriram" },
          { name: "google:banking", kind: "google", arg: "Indian banking NBFC sector news" },
          { name: "google:rate", kind: "google", arg: "RBI repo rate Nifty Bank sector impact" },
          { name: "google:mfi", kind: "google", arg: "Bajaj Finance Shriram Finance Cholamandalam Muthoot Fin" },
        ],
        publishers: publishersFor("nbfc", []),
        maxAgeH: 336,
      };
    case "mint":
      return {
        legs: [
          { name: "google:site-mint", kind: "google", arg: "site:livemint.com markets" },
          { name: "yahoo:ticker", kind: "yahoo", arg: symbol },
        ],
        publishers: publishersFor("mint", ["mint-markets", "mint-economy"]),
        maxAgeH: 96,
      };
    case "editorials":
      // Opinion pages need DIRECT links — Bing exposes the target URL, Google
      // encrypts it, which breaks the inline reader.
      return {
        legs: [
          { name: "bing:mint", kind: "bing", arg: "site:livemint.com opinion economy markets" },
          { name: "bing:hindu", kind: "bing", arg: "site:thehindu.com editorial economy markets" },
          { name: "bing:ie", kind: "bing", arg: "site:indianexpress.com opinion economy markets" },
          { name: "bing:et", kind: "bing", arg: "site:economictimes.indiatimes.com editorial economy markets" },
        ],
        publishers: publishersFor("opinion", ["mint-opinion"]),
        maxAgeH: 336,
      };
  }
}

interface LegOut {
  items: NewsItem[];
  leg: FeedLeg;
  /** Items a publisher dropped for failing the market-relevance gate. */
  irrelevant: number;
}

async function runLeg(spec: LegSpec, publishers: Publisher[]): Promise<LegOut> {
  const t0 = Date.now();
  try {
    let items: NewsItem[] = [];
    let irrelevant = 0;
    if (spec.kind === "pub") {
      const p = publishers.find((x) => x.key === spec.key);
      if (p) ({ items, irrelevant } = await fetchPublisher(p));
    } else if (spec.kind === "yahoo") {
      items = await fetchYahooNews(String(spec.arg), true);
    } else if (spec.kind === "google") {
      items = await fetchGoogleRSS(String(spec.arg));
    } else {
      items = await fetchBingRSS(String(spec.arg));
    }
    if (spec.gate && items.length) {
      const kept = items.filter((n) => spec.gate!(n.title));
      irrelevant += items.length - kept.length;
      items = kept;
    }
    return {
      items,
      irrelevant,
      leg: { name: spec.name, ok: true, items: items.length, ms: Date.now() - t0 },
    };
  } catch (e: unknown) {
    return {
      items: [],
      irrelevant: 0,
      leg: { name: spec.name, ok: false, items: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : "failed" },
    };
  }
}

const tsOf = (n: NewsItem): number => (n.published ? Date.parse(n.published) : NaN);

/** Corporate words that stand in for a company name in a headline. */
const CORP = new Set(["ltd", "limited", "plc", "inc", "corp", "company", "co", "group", "holdings", "india"]);

/**
 * How directly an item is about the focused security, 0-3.
 *   3 = the bare name appears ("Reliance", "Bajaj Finance")
 *   2 = a distinctive alias ("Jio" for RIL, "Tata" family)
 *   1 = sector words only
 * A publisher's generic COMPANIES feed is one wire for every listed company, so
 * without this the RELIANCE desk fills with Codelco and NTPC stories that carry
 * no relationship to the security in the command line.
 */
/**
 * A ticker stem like BAJFINANCE or HDFCBANK never appears in prose, but the
 * exchange code often does: "(NSE: BAJFINANCE)", "HDFCBANK.NS", "NSE:HDFBANK".
 * Recognising that form is what lets a company desk rank the right stories,
 * since every search hit about the security quotes its exchange code.
 */
/**
 * Aliases so generic that a match is incidental. "hdfc" appears in a story
 * about a rival bank; "bank" appears everywhere. An alias in this set scores 2
 * at best — present, but never proof the story is about this security. ITC and
 * RELIANCE are deliberately absent: no unrelated headline writes them.
 */
const WEAK_ALIAS = new Set(["hdfc", "sbi", "icici", "axis", "lt", "indi", "bank", "tata", "adani", "bajaj", "nestle", "mahindra"]);

function tickerAffinity(title: string, aliases: string[], codes: string[]): number {
  const hay = ` ${title.toLowerCase().replace(/[^a-z0-9&]/g, " ").replace(/\s+/g, " ").trim()} `;
  for (const c of codes) {
    if (c.length >= 4 && hay.includes(` ${c} `)) return 3;
  }
  let best = 1;
  for (const a of aliases) {
    if (a.length < 3 || CORP.has(a)) continue;
    const needle = ` ${a.replace(/\s+/g, " ")} `;
    // The alias must appear as a whole phrase. "Bajaj Finance Q2 Results" has
    // to match, "Nestle India (NESTLEIND)" must not — and note that scoring
    // only the first N aliases silently dropped multi-word ones whose match sat
    // later in the list, which is why Bajaj Finance scored 1 for its own story.
    if (!hay.includes(needle)) continue;
    if (a.includes(" ") || !WEAK_ALIAS.has(a)) best = Math.max(best, 3);
    else best = Math.max(best, 2);
  }
  return best;
}

/** The bare exchange codes a headline quotes for this security. */
function codesFor(symbol: string): string[] {
  const stem = symbol.replace(/\.NS$|\.BO$|^\^/, "").toUpperCase();
  return stem.length >= 4 ? [stem] : [];
}

/**
 * Rank. Ticker relevance leads on a company desk and trails everywhere else:
 * on a focused ticker feed, a search hit that names the security beats an
 * authoritative wire item about a different company entirely. On a market or
 * editorial feed there is no ticker to be relevant to, so publisher tier leads.
 */
function makeRank(byTicker: boolean) {
  return (a: NewsItem, b: NewsItem): number => {
    if (byTicker) {
      const aa = a.about ?? 0, ab = b.about ?? 0;
      if (aa !== ab) return ab - aa;
    }
    if (a.tier !== b.tier) return a.tier - b.tier;
    const x = a.also ?? 1, y = b.also ?? 1;
    if (x !== y) return y - x;
    const ta = isFinite(tsOf(a)) ? tsOf(a) : 0;
    const tb = isFinite(tsOf(b)) ? tsOf(b) : 0;
    if (tb !== ta) return tb - ta;
    return b.score - a.score;
  };
}

/**
 * Aliases keyed by the exchange stem as written by Yahoo: RELIANCE.NS,
 * HDFCBANK.NS, BAJFINANCE.NS, M&M.NS. The company name rarely equals the stem —
 * BAJFINANCE is BAJ + FINANCE, WIPRO is not "Wipro Ltd", TATAMOTORS drops the
 * second "a" — so the key must be the stem verbatim, not the company's name.
 */
const ALIASES: Record<string, string[]> = {
  reliance: ["reliance", "reliance industries", "reliance retail", "ril", "jio"],
  tcs: ["tcs", "tata consultancy"],
  infy: ["infosys"],
  hdfcbank: ["hdfc bank", "hdfc"],
  hdfc: ["hdfc bank", "hdfc"],
  icicibank: ["icici bank", "icici"],
  icici: ["icici bank", "icici"],
  sbin: ["state bank of india", "sbi"],
  sbi: ["state bank of india", "sbi"],
  bajfinance: ["bajaj finance", "bajaj finserv", "bajaj"],
  bajajfinance: ["bajaj finance", "bajaj finserv", "bajaj"],
  axisbank: ["axis bank", "axis"],
  axis: ["axis bank"],
  maruti: ["maruti suzuki", "maruti"],
  tatamotors: ["tata motors", "tata"],
  tata: ["tata motors", "tata steel", "tata power", "tata"],
  hcltech: ["hcl tech", "hcltech", "hcl"],
  hcl: ["hcl tech", "hcltech"],
  wipro: ["wipro"],
  asianpaint: ["asian paints"],
  sunpharma: ["sun pharmaceutical", "sun pharma", "sunpharma"],
  coalindia: ["coal india", "coalindia"],
  ongc: ["oil and natural gas", "ongc"],
  powergrid: ["power grid"],
  adanient: ["adani enterprises", "adani"],
  adani: ["adani enterprises", "adani"],
  bajajauto: ["bajaj auto", "bajaj"],
  "m&m": ["m&m", "mahindra mahindra", "mahindra"],
  nestleind: ["nestle india", "nestle"],
  nestleindia: ["nestle india", "nestle"],
  hindunilvr: ["hindustan unilever", "hul"],
  hindustanunilever: ["hindustan unilever", "hul"],
  itc: ["itc"],
  shriramfin: ["shriram finance", "shriram"],
  aufin: ["au financial", "au small finance", "au bank"],
  piocl: ["p&c insurance", "general insurance corporation", "piotulla"],
  manappuram: ["manappuram"],
  muthootfin: ["muthoot finance", "muthoot"],
  muthoot: ["muthoot finance", "muthoot"],
  cholafin: ["cholamandalam investment", "cholamandalam"],
  cholamandalam: ["cholamandalam investment", "cholamandalam"],
  "l&t": ["larsen & toubro", "l&t", "larsen"],
  lnt: ["larsen & toubro", "l&t", "larsen"],
  yesbank: ["yes bank"],
  federalbank: ["federal bank"],
  ioc: ["indian oil", "ioc"],
  bpcl: ["bharat petroleum", "bpc l"],
  indusindbk: ["indusind bank", "indusind"],
  yes: ["yes bank"],
  niftybank: ["bank nifty"],
  niftyit: ["nifty it"],
  bajaj: ["bajaj finance", "bajaj auto", "bajaj"],
};

/**
 * Every word a headline might use to mean this security, best name first.
 *
 * The key is matched SEVERAL WAYS, because exchange symbols are written
 * inconsistently: BAJFINANCE, Bajaj_Finance, BajajFinance, BAJ-FINANCE. An
 * earlier exact-lookup version silently missed every one of those and left the
 * company desk scoring its own security's news as 1 (not about the ticker).
 */
export function aliasesFor(symbol: string): string[] {
  const stem = symbol.replace(/\.NS$|\.BO$|^\^/, "");
  const keys = [stem.toLowerCase(), stem.toLowerCase().replace(/[_\-.]/g, ""), stem.toLowerCase().replace(/([a-z])([A-Z])/g, "$1_$2").replace(/_/g, "")];
  const extra: string[] = [];
  for (const k of keys) {
    for (const a of ALIASES[k] ?? []) if (!extra.includes(a)) extra.push(a);
  }
  const bare = stem.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (bare.length >= 3 && !extra.includes(bare)) extra.push(bare);
  return extra;
}

/**
 * The name to SEARCH a publisher's index with. A searchable phrase, never the
 * exchange code: searching `"bajajfinance"` returns nothing, because no
 * headline writes the ticker that way, while `"bajaj finance"` returns the
 * security's actual coverage.
 */
export function searchNameFor(symbol: string): string {
  const stem = symbol.replace(/\.NS$|\.BO$|^\^/, "");
  const key = stem.toLowerCase();
  const named = (ALIASES[key] ?? []).find((a) => a.includes(" "));
  if (named) return named;
  const pascal = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return pascal.includes(" ") ? pascal : stem;
}

export async function getNews(
  symbol: string,
  feed: NewsFeed,
  customQ?: string
): Promise<NewsResult> {
  // Custom search has no publisher mapping — it is a user query, so breadth
  // beats authority and the freshness window is generous.
  if (customQ && customQ.trim()) {
    const q = customQ.trim();
    const specs: LegSpec[] = [
      { name: "google:query", kind: "google", arg: q },
      { name: "bing:query", kind: "bing", arg: q },
      { name: "yahoo:query", kind: "yahoo", arg: q },
    ];
    return singleFlight(`q:${q.toLowerCase()}`, async () => {
      const settled = await settledOf(specs, []);
      return assemble(settled, 240, 120, symbol, true);
    });
  }

  const { legs, publishers, maxAgeH } = planLegs(symbol, feed);
  const gate = FEED_GATE[feed];
  const specs: LegSpec[] = [
    ...publishers.map((p) => ({ name: `pub:${p.key}`, kind: "pub" as const, key: p.key, gate })),
    ...legs.map((l) => ({ ...l, gate: l.gate ?? gate })),
  ];
  return singleFlight(`${feed}:${symbol.toUpperCase()}`, async () => {
    const settled = await settledOf(specs, publishers);
    return assemble(settled, maxAgeH, 150, symbol, feed === "company");
  });
}

function settledOf(specs: LegSpec[], publishers: Publisher[]) {
  return Promise.all(specs.map((s) => runLeg(s, publishers)));
}

/**
 * One pull per key at a time, plus a short last-good memory.
 *
 * Every client polls once a minute. Without single-flight, ten open desks that
 * refresh on the same second fire ten identical upstream requests and get the
 * publishers to throttle us — which is how a wire goes dark. Without the
 * last-good memory, one throttled response blanks a desk that was working a
 * minute ago.
 */
const inflight = new Map<string, Promise<NewsResult>>();
const lastGood = new Map<string, { at: number; data: NewsResult }>();
const LAST_GOOD_MS = 5 * 60_000;

async function singleFlight(key: string, run: () => Promise<NewsResult>): Promise<NewsResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = run()
    .then((data) => {
      lastGood.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((e: unknown) => {
      // Every leg is fail-open, so this is only reached if assembly itself
      // fails. Still prefer stale data over an empty wire.
      const prev = lastGood.get(key);
      if (prev) return prev.data;
      throw e;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

function assemble(
  settled: LegOut[],
  maxAgeH: number,
  cap: number,
  symbol: string,
  byTicker: boolean
): NewsResult {
  const raw = settled.flatMap((s) => s.items);
  const irrelevant = settled.reduce((a, s) => a + s.irrelevant, 0);
  const legs = settled.map((s) => {
    const l = s.leg;
    if (l.name.startsWith("pub:") && !l.ok && !l.error) l.error = "feed unavailable";
    return l;
  });
  const cutoff = Date.now() - maxAgeH * 3600_000;

  // Undated items are kept: a feed with no <pubDate> is still real news, and
  // dropping it would silently empty a working publisher. Dated-but-stale items
  // are dropped, because a September holiday notice in today's wire is noise.
  const fresh: NewsItem[] = [];
  let stale = 0;
  const aliases = aliasesFor(symbol);
  const codes = codesFor(symbol);
  const scored = aliases.length || codes.length;
  for (const n of raw) {
    const t = tsOf(n);
    if (isFinite(t) && t < cutoff) { stale++; continue; }
    fresh.push(scored ? { ...n, about: tickerAffinity(n.title, aliases, codes) } : n);
  }

  const { items: clustered, collapsed } = cluster(fresh);

  // Exact-title dedup survives clustering as a cheap second pass.
  const seen = new Set<string>();
  const dedup: NewsItem[] = [];
  for (const n of clustered) {
    const key = n.title.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedup.push(n);
  }

  dedup.sort(makeRank(byTicker));
  const items = dedup.slice(0, cap);
  const sources = [...new Set(items.map((n) => n.source))].slice(0, 16);
  return { items, sources, legs, collapsed, stale, irrelevant };
}
