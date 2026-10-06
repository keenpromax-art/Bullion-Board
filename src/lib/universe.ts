// World equity universe — crawls Yahoo's screener feed (the same route
// yfinance wraps) and keeps a compact, searchable index of every EQUITY
// worldwide. Yahoo
// allows ~238k equities but clamps one query to ~10k rows, so the crawl is
// sharded: region x sector for the four giant regions (US/DE/IT/TW),
// region-only for everything else. Rows are deduplicated by symbol.

import { promises as fs } from "fs";
import path from "path";
import { yahooFetch, yahooCrumb, yahooHeaders } from "./yahoo";

export interface UniverseRow {
  symbol: string;
  name: string;
  exchange: string;
  region: string;
  sector: string;
  industry: string;
  currency: string;
  mcap: number | null;
}

export interface UniverseIndex {
  builtAt: string;
  discovered: number;
  note: string;
  rows: UniverseRow[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "universe.json");
const TTL = 24 * 60 * 60 * 1000;

// Region codes accepted by the Yahoo screener with their live totals
// (probed 2026-10). Regions whose totals run over ~10k are broken out by
// sector so no shard exceeds the pagination clamp.
const REGIONS: Array<{ code: string; sectorShard?: boolean }> = [
  { code: "us", sectorShard: true },
  { code: "de", sectorShard: true },
  { code: "it", sectorShard: true },
  { code: "tw", sectorShard: true },
  { code: "in" }, { code: "gb" }, { code: "jp" }, { code: "au" },
  { code: "hk" }, { code: "kr" }, { code: "ca" }, { code: "cn" },
  { code: "fr" }, { code: "br" }, { code: "za" }, { code: "nl" },
  { code: "es" }, { code: "se" }, { code: "ch" }, { code: "sg" },
  { code: "ie" }, { code: "mx" }, { code: "pl" }, { code: "be" },
  { code: "at" }, { code: "dk" }, { code: "fi" }, { code: "no" },
  { code: "pt" }, { code: "nz" }, { code: "il" }, { code: "ar" },
  { code: "cl" }, { code: "my" }, { code: "th" }, { code: "id" },
  { code: "tr" }, { code: "eg" }, { code: "sa" },
];

const SECTORS = [
  "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
  "Industrials", "Communication Services", "Consumer Defensive", "Energy",
  "Basic Materials", "Real Estate", "Utilities",
];

interface ScreenerBody { operator: string; operands: unknown[] }

function shardBody(region: string, sector?: string): Record<string, unknown> {
  const ops: ScreenerBody[] = [
    { operator: "or", operands: [{ operator: "eq", operands: ["region", region] }] },
  ];
  if (sector) ops.push({ operator: "eq", operands: ["sector", sector] });
  // Percentchange > -100 is a tautology that passes the query builder
  // (an empty AND fails with "Unable to generate query").
  ops.push({ operator: "or", operands: [{ operator: "gt", operands: ["percentchange", -100] }] });
  return {
    query: { operator: "AND", operands: ops },
    offset: 0, size: 250,
    sortField: "ticker", sortType: "ASC", quoteType: "EQUITY",
  };
}

async function screenerPage(crumb: string, body: Record<string, unknown>): Promise<any> {
  const res = await yahooFetch(
    `/v1/finance/screener?crumb=${encodeURIComponent(crumb)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...yahooHeaders() },
      body: JSON.stringify(body),
    },
    2,
  );
  const j = await res.json();
  return j?.finance?.result?.[0] ?? null;
}

async function shardRows(crumb: string, region: string, sector?: string): Promise<UniverseRow[]> {
  const first = await screenerPage(crumb, shardBody(region, sector));
  if (!first) return [];
  const total: number = first.total ?? 0;
  const pages = Math.ceil(Math.min(total, 9900) / 250);
  const out: UniverseRow[] = [];
  // The quote payload's own region field is the market-read region (US for
  // nearly everything), so keep the shard's region instead.
  const pick = (r: any): UniverseRow | null =>
    r && r.symbol
      ? {
          symbol: String(r.symbol).toUpperCase(),
          name: String(r.shortName ?? r.longName ?? r.symbol),
          exchange: String(r.exchange ?? "").toUpperCase(),
          region: region.toUpperCase(),
          sector: String(r.sector ?? sector ?? "").toUpperCase() || "—",
          industry: String(r.industry ?? "").toUpperCase(),
          currency: String(r.currency ?? "").toUpperCase(),
          mcap: typeof r.marketCap === "number" && isFinite(r.marketCap) ? r.marketCap : null,
        }
      : null;
  for (const q of first.quotes ?? []) {
    const row = pick(q);
    if (row) out.push(row);
  }
  for (let i = 1; i < pages; i++) {
    const page = await screenerPage(crumb, { ...shardBody(region, sector), offset: i * 250 });
    for (const q of page?.quotes ?? []) {
      const row = pick(q);
      if (row) out.push(row);
    }
  }
  return out;
}

async function mapPool<T, R>(arr: T[], n: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(arr.length).fill(null);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      try { out[k] = await fn(arr[k]); } catch { out[k] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, w));
  return out.filter((x): x is R => x !== null);
}

export async function crawlUniverse(): Promise<UniverseIndex> {
  const crumb = await yahooCrumb(true);
  const shards: Array<{ region: string; sector?: string }> = [];
  for (const r of REGIONS) {
    if (r.sectorShard) {
      for (const s of SECTORS) shards.push({ region: r.code, sector: s });
    } else {
      shards.push({ region: r.code });
    }
  }
  const results = await mapPool(shards, 6, async (sh) => {
    try { return await shardRows(crumb, sh.region, sh.sector); }
    catch { return null; }
  });
  const bySymbol = new Map<string, UniverseRow>();
  for (const rows of results) {
    for (const r of rows) if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  }
  const rows = Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    builtAt: new Date().toISOString(),
    discovered: rows.length,
    note:
      "DISCOVERED VIA YAHOO SCREENER FEED (EQUITY ONLY, TYPES NOT COVERED SHOWN AS —). " +
      "REGION/SECTOR SHARDED PAGINATION: COVERAGE MAY OMIT SECTOR-LESS LISTINGS.",
    rows,
  };
}

let cache: UniverseIndex | null = null;
let loading: Promise<UniverseIndex | null> | null = null;

function readable(index: UniverseIndex | null): boolean {
  if (!index || !Array.isArray(index.rows) || !index.rows.length) return false;
  return true;
}

export async function getUniverse(): Promise<UniverseIndex | null> {
  if (cache && Date.now() - new Date(cache.builtAt).getTime() < TTL) return cache;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw) as UniverseIndex;
        if (readable(parsed)) {
          cache = parsed;
          return parsed;
        }
      } catch { /* cold */ }
      return null;
    })();
    loading = loading.finally(() => { loading = null; });
  }
  return loading;
}

export async function refreshUniverse(): Promise<UniverseIndex> {
  const idx = await crawlUniverse();
  cache = idx;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(idx), "utf8");
  } catch { /* write failed — in-memory only */ }
  return idx;
}

export interface UniverseQuery {
  q?: string;
  region?: string;
  sector?: string;
  exch?: string;
  sort?: "symbol" | "name" | "mcap";
  dir?: "asc" | "desc";
  page?: number;
  size?: number;
}

export function queryUniverse(index: UniverseIndex, q: UniverseQuery) {
  const needle = (q.q ?? "").trim().toUpperCase();
  let rows = index.rows;
  if (needle) {
    rows = rows.filter(
      (r) => r.symbol.includes(needle) || r.name.toUpperCase().includes(needle),
    );
  }
  if (q.region) rows = rows.filter((r) => r.region === q.region);
  if (q.sector) rows = rows.filter((r) => r.sector === q.sector);
  if (q.exch) rows = rows.filter((r) => r.exchange === q.exch);

  const sort = q.sort ?? "symbol";
  const dir = q.dir === "desc" ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    if (sort === "mcap") {
      const av = a.mcap ?? -Infinity;
      const bv = b.mcap ?? -Infinity;
      return (av - bv) * dir;
    }
    if (sort === "name") return a.name.localeCompare(b.name) * dir;
    return a.symbol.localeCompare(b.symbol) * dir;
  });

  const page = Math.max(1, q.page ?? 1);
  const size = Math.min(100, Math.max(10, q.size ?? 25));
  const total = rows.length;
  const rows_page = rows.slice((page - 1) * size, page * size);
  const regions = Array.from(new Set(index.rows.map((r) => r.region))).sort();
  const sectors = Array.from(new Set(index.rows.map((r) => r.sector))).sort();
  const exchanges = Array.from(new Set(index.rows.map((r) => r.exchange))).sort();
  return {
    rows: rows_page,
    total,
    page,
    size,
    pages: Math.max(1, Math.ceil(total / size)),
    facetRegions: regions,
    facetSectors: sectors,
    facetExchanges: exchanges,
  };
}

// Fast ranked substring match for the lookup overlay / ticker search.
export function searchUniverse(index: UniverseIndex, q: string, n = 8): UniverseRow[] {
  const needle = (q ?? "").trim().toUpperCase();
  if (!needle) return [];
  const starts: UniverseRow[] = [];
  const contains: UniverseRow[] = [];
  const namehits: UniverseRow[] = [];
  for (const r of index.rows) {
    if (r.symbol.startsWith(needle)) starts.push(r);
    else if (r.symbol.includes(needle)) contains.push(r);
    else if (r.name.toUpperCase().includes(needle)) namehits.push(r);
    if (starts.length >= n) break;
  }
  return [...starts, ...contains, ...namehits].slice(0, n);
}
