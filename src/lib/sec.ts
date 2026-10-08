// SEC EDGAR client — unauthenticated data.sec.gov JSON APIs.
//
// EDGAR asks three things of every caller, and all three are load-bearing:
//   1. a descriptive User-Agent naming the app AND a contact email,
//   2. no more than 10 requests/second per IP (we hold a 130ms floor),
//   3. download only what you need (we project companyfacts down before
//      it ever leaves this module).
// Missing the UA is a 403. Bursting is a 429 and a temporary block.
//
// The contact address is a person's email, so it is never echoed back to a
// browser in full and never exported in a settings backup (backup.ts
// SECRET_KEYS). Precedence mirrors lib/fred.ts fredKey(): explicit param ->
// process.env -> empty.

const SEC_UA_BASE = "BullionBoard/1.0 (filings desk; research terminal)";
const DEFAULT_CONTACT = "contact-not-configured";
const FLOOR_MS = 130;

let lastFetch = 0;

async function throttle() {
  const wait = FLOOR_MS - (Date.now() - lastFetch);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
}

/** Resolved EDGAR contact. Empty string means the operator never set one. */
export function secContact(param?: string | null): string {
  return (param || process.env.SEC_CONTACT || "").trim();
}

export function secHasContact(param?: string | null): boolean {
  return secContact(param).length > 0;
}

export function secUserAgent(param?: string | null): string {
  const c = secContact(param);
  return c ? `${SEC_UA_BASE}; contact: ${c}` : `${SEC_UA_BASE}; contact: ${DEFAULT_CONTACT}`;
}

function secHeaders(param?: string | null): Record<string, string> {
  return {
    "user-agent": secUserAgent(param),
    accept: "application/json, text/html;q=0.8",
    "accept-encoding": "gzip, deflate",
  };
}

/** One EDGAR GET. Throws a tagged Error so callers can surface the reason. */
export async function secFetch(
  url: string,
  opts: { revalidate?: number; accept?: string; timeoutMs?: number; retries?: number; ua?: string | null } = {}
): Promise<Response> {
  const { revalidate, timeoutMs = 20000, retries = 2, ua } = opts;
  const headers = { ...secHeaders(ua) };
  if (opts.accept) headers.accept = opts.accept;

  let last = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const r = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        // Without an explicit revalidate Next tries to persist the body, and
        // logs "items over 2MB can not be cached" for every companyfacts pull.
        ...(revalidate !== undefined ? { next: { revalidate } } : { cache: "no-store" }),
      } as RequestInit);
      if (r.ok) return r;

      last = `edgar ${r.status}`;
      // 404 is a real answer ("this CIK filed no such thing") — never retry it.
      if (r.status === 404) throw Object.assign(new Error(last), { fatal: true });
      // 403 is almost always the missing-contact case; say so plainly.
      if (r.status === 403) {
        throw Object.assign(
          new Error("EDGAR REFUSED THE REQUEST — SET SEC_CONTACT OR iss.sec.contact WITH A REAL EMAIL, EDGAR ASKS FOR ONE"),
          { fatal: true }
        );
      }
      if (attempt === retries) break;
      await new Promise((r2) => setTimeout(r2, 700 * (attempt + 1)));
    } catch (e: any) {
      if (e?.fatal) throw e;
      last = e?.message || String(e);
      if (attempt === retries) break;
      await new Promise((r2) => setTimeout(r2, 700 * (attempt + 1)));
    }
  }
  throw new Error(last || "edgar unreachable");
}

// ---------------------------------------------------------------- CIK lookup

export interface SecTickerHit {
  cik: string;
  ticker: string;
  name: string;
}

let tickerMap: Map<string, SecTickerHit> | null = null;
let tickerFetchedAt = 0;
const TICKER_TTL = 24 * 60 * 60 * 1000;

/**
 * Yahoo writes share classes with a dot (BRK.B); EDGAR uses a hyphen
 * (BRK-B). Both forms must land on the same row.
 */
export function secTickerKeys(symbol: string): string[] {
  const s = (symbol || "").trim().toUpperCase().replace(/^[A-Z]+:/, "");
  if (!s) return [];
  const out = new Set<string>([s]);
  if (s.includes(".")) out.add(s.replace(/\./g, "-"));
  if (s.includes("-")) out.add(s.replace(/-/g, "."));
  // Yahoo suffixes for ADR-ish listings are not part of the EDGAR ticker.
  for (const suf of [".NS", ".BO", ".L", ".DE", ".TO", ".AX", ".T", ".HK", ".TSE", ".AXJO"]) {
    if (s.endsWith(suf)) out.add(s.slice(0, -suf.length));
  }
  return [...out].filter(Boolean);
}

async function secTickerMap(ua?: string | null): Promise<Map<string, SecTickerHit>> {
  if (tickerMap && Date.now() - tickerFetchedAt < TICKER_TTL) return tickerMap;
  const r = await secFetch("https://www.sec.gov/files/company_tickers.json", { revalidate: 86400, ua });
  const j: any = await r.json();
  const m = new Map<string, SecTickerHit>();
  const rows: any[] = Array.isArray(j) ? j : Object.values(j || {});
  for (const row of rows) {
    const cik = String(row?.cik_str ?? row?.cik ?? "").replace(/\D/g, "");
    const tick = String(row?.ticker ?? "").trim().toUpperCase();
    const name = String(row?.title ?? row?.name ?? "").trim();
    if (!cik || !tick) continue;
    const padded = cik.padStart(10, "0");
    const hit: SecTickerHit = { cik: padded, ticker: tick, name };
    m.set(tick, hit);
    // Index the hyphen form of a class ticker too.
    if (tick.includes("-")) m.set(tick.replace(/-/g, "."), hit);
  }
  tickerMap = m;
  tickerFetchedAt = Date.now();
  return m;
}

/** Resolve a Yahoo symbol to a CIK, or null when it is not an SEC registrant. */
export async function cikForTicker(symbol: string, ua?: string | null): Promise<SecTickerHit | null> {
  const map = await secTickerMap(ua);
  for (const k of secTickerKeys(symbol)) {
    const hit = map.get(k);
    if (hit) return hit;
  }
  return null;
}

/** Free-text search across registrant names and tickers. */
export async function secSearchRegistry(query: string, limit = 12, ua?: string | null): Promise<SecTickerHit[]> {
  const q = (query || "").trim().toUpperCase();
  if (!q) return [];
  const map = await secTickerMap(ua);
  const out: SecTickerHit[] = [];
  for (const hit of map.values()) {
    if (hit.ticker.startsWith(q) || hit.name.toUpperCase().includes(q)) {
      out.push(hit);
      if (out.length >= limit * 4) break;
    }
  }
  out.sort((a, b) => {
    const at = a.ticker === q ? 0 : a.ticker.startsWith(q) ? 1 : 2;
    const bt = b.ticker === q ? 0 : b.ticker.startsWith(q) ? 1 : 2;
    return at - bt || a.ticker.length - b.ticker.length;
  });
  return out.slice(0, limit);
}

// -------------------------------------------------------------- submissions

export interface SecFiling {
  accession: string;
  accessionNoDash: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  primaryDocDescription: string;
  isXBRL: boolean;
  isInlineXBRL: boolean;
  items: string;
  size: number | null;
  /** Absolute URL to the filing index on www.sec.gov. */
  url: string;
  /** Absolute URL to the primary document. */
  doc: string;
}

const PERIODIC_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F", "6-K", "8-K", "10-K/A", "10-Q/A", "20-F/A", "40-F/A"]);
const STATEMENT_FORMS = new Set(["10-K", "10-Q", "10-K/A", "10-Q/A", "20-F", "40-F", "6-K"]);

export function isStatementForm(form: string): boolean {
  return STATEMENT_FORMS.has(String(form || "").toUpperCase());
}

function archiveBase(cik: string, accnNoDash: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}`;
}

/** EDGAR sends these flags as 1/0, not true/false. */
const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";

function mapRecent(cik: string, r: any): SecFiling[] {
  const n = (r?.accessionNumber?.length ?? 0);
  const out: SecFiling[] = [];
  for (let i = 0; i < n; i++) {
    const accn = String(r.accessionNumber[i] ?? "");
    const accnNoDash = accn.replace(/-/g, "");
    if (!accn) continue;
    const form = String(r.form?.[i] ?? "");
    const primaryDocument = String(r.primaryDocument?.[i] ?? "");
    const base = archiveBase(cik, accnNoDash);
    out.push({
      accession: accn,
      accessionNoDash: accnNoDash,
      form,
      filingDate: String(r.filingDate?.[i] ?? ""),
      reportDate: String(r.reportDate?.[i] ?? ""),
      primaryDocument,
      primaryDocDescription: String(r.primaryDocDescription?.[i] ?? ""),
      isXBRL: truthy(r.isXBRL?.[i]),
      isInlineXBRL: truthy(r.isInlineXBRL?.[i]),
      items: String(r.items?.[i] ?? ""),
      size: Number.isFinite(Number(r.size?.[i])) ? Number(r.size[i]) : null,
      url: `${base}/`,
      doc: primaryDocument ? `${base}/${primaryDocument}` : `${base}/`,
    });
  }
  return out;
}

export interface SecSubmissions {
  cik: string;
  entityName: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  stateOfIncorporation: string;
  fiscalYearEnd: string;
  entityType: string;
  category: string;
  /** True when the registrant is not a domestic filer (20-F / 40-F / 6-K). */
  foreignPrivateIssuer: boolean;
  filings: SecFiling[];
  /** Older filings live in a second file; fetched only when asked. */
  olderFiles: Array<{ name: string; filingCount: number; filingFrom: string; filingTo: string }>;
}

export async function secSubmissions(cik: string, ua?: string | null): Promise<SecSubmissions> {
  const r = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { revalidate: 3600, ua });
  const j: any = await r.json();
  const forms: string[] = Array.isArray(j?.forms) ? j.forms : [];
  const recent = mapRecent(cik, j?.filings?.recent);
  return {
    cik,
    entityName: String(j?.name ?? ""),
    sic: String(j?.sic ?? ""),
    sicDescription: String(j?.sicDescription ?? ""),
    tickers: Array.isArray(j?.tickers) ? j.tickers.map(String) : [],
    exchanges: Array.isArray(j?.exchanges) ? j.exchanges.map(String) : [],
    stateOfIncorporation: String(j?.stateOfIncorporation ?? ""),
    fiscalYearEnd: String(j?.fiscalYearEnd ?? ""),
    entityType: String(j?.entityType ?? ""),
    category: String(j?.category ?? ""),
    foreignPrivateIssuer: forms.some((f) => /^(20-F|40-F|6-K)/.test(f)),
    filings: recent,
    olderFiles: Array.isArray(j?.filings?.files)
      ? j.filings.files.map((f: any) => ({
          name: String(f?.name ?? ""),
          filingCount: Number(f?.filingCount ?? 0),
          filingFrom: String(f?.filingFrom ?? ""),
          filingTo: String(f?.filingTo ?? ""),
        }))
      : [],
  };
}

// ------------------------------------------------------------- companyfacts

export interface SecFact {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
}

/** companyfacts is 4-50MB for a mega-cap. Past this we refuse rather than hang. */
const MAX_FACTS_BYTES = 40 * 1024 * 1024;

export interface SecFacts {
  entityName: string;
  cik: string;
  /** taxonomy -> concept -> unit -> facts[] */
  facts: Record<string, Record<string, Record<string, SecFact[]>>>;
}

/**
 * Next's data cache refuses a body over 2MB, and companyfacts is 4MB+ for a
 * mega-cap — passing `revalidate` there logs a cache error and re-downloads on
 * every request. So the raw payload is NOT given to Next; instead it is fetched
 * with `cache: "no-store"` and held here, and the *projection* (which is
 * ~80KB) is what survives. Cached per lambda instance, same as every other
 * Map cache in this codebase.
 */
const FACTS_TTL = 12 * 60 * 60 * 1000;
const factsCache = new Map<string, { at: number; facts: SecFacts }>();

export function clearSecFactsCache(cik?: string): void {
  if (cik) factsCache.delete(cik);
  else factsCache.clear();
}

export async function secCompanyFacts(cik: string, ua?: string | null): Promise<SecFacts> {
  const hit = factsCache.get(cik);
  if (hit && Date.now() - hit.at < FACTS_TTL) return hit.facts;

  const r = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    timeoutMs: 45000,
    retries: 1,
    ua,
  });
  const declared = Number(r.headers.get("content-length") ?? "0");
  if (declared && declared > MAX_FACTS_BYTES) {
    throw new Error(`COMPANYFACTS ${(declared / 1048576).toFixed(0)}MB — OVER THE ${MAX_FACTS_BYTES / 1048576}MB READ LIMIT`);
  }
  const j: any = await r.json();
  const facts: SecFacts = { entityName: String(j?.entityName ?? ""), cik, facts: j?.facts ?? {} };
  // A hard cap on retained entries so a symbol sweep cannot walk the heap out.
  if (factsCache.size >= 40) {
    const oldest = [...factsCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) factsCache.delete(oldest[0]);
  }
  factsCache.set(cik, { at: Date.now(), facts });
  return facts;
}

// --------------------------------------------------- as-filed R-file reports

export interface SecReportRef {
  file: string;
  shortName: string;
  longName: string;
  menuCategory: string;
}

/** FilingSummary.xml is the index EDGAR's own viewer uses. */
export async function secFilingReports(cik: string, accnNoDash: string, ua?: string | null): Promise<SecReportRef[]> {
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/FilingSummary.xml`;
  const r = await secFetch(url, { revalidate: 86400, accept: "application/xml, text/xml", ua });
  const xml = await r.text();
  const out: SecReportRef[] = [];
  for (const m of xml.matchAll(/<Report\b[^>]*>([\s\S]*?)<\/Report>/gi)) {
    const body = m[1];
    const pick = (tag: string) => body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1]?.trim() ?? "";
    const file = pick("HtmlFileName") || pick("XmlFileName");
    const shortName = pick("ShortName");
    if (!file || !shortName) continue;
    out.push({
      file,
      shortName,
      longName: pick("LongName"),
      menuCategory: pick("MenuCategory"),
    });
  }
  return out;
}

export function secReportUrl(cik: string, accnNoDash: string, file: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/${file}`;
}

export async function secReportHtml(cik: string, accnNoDash: string, file: string, ua?: string | null): Promise<string> {
  const r = await secFetch(secReportUrl(cik, accnNoDash, file), {
    revalidate: 86400,
    accept: "text/html",
    timeoutMs: 25000,
    ua,
  });
  return await r.text();
}

/** Standalone xlsx of every statement + note, straight from the archive. */
export function secFinancialReportXlsx(cik: string, accnNoDash: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accnNoDash}/Financial_Report.xlsx`;
}

// ------------------------------------------------------------------- status

export function secStatus(ua?: string | null): { hasContact: boolean; contactHint: string } {
  const has = secHasContact(ua);
  return {
    hasContact: has,
    contactHint: has
      ? "EDGAR CONTACT SET — FAIR-ACCESS HEADERS SENT"
      : "EDGAR CONTACT NOT SET — SET SEC_CONTACT OR iss.sec.contact. EDGAR ASKS EVERY CALLER FOR A REAL EMAIL ADDRESS",
  };
}