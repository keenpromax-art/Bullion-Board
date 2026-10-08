// NSE filings client — the JSON feeds that sit behind the exchange's filings
// pages. Sits on nseGet()'s existing cookie jar rather than re-implementing it.
//
// Two feeds, because NSE changed taxonomy mid-stream:
//   - integrated-filing-results  SEBI's IFIndAs / in-capmkt, quarters from the
//                               quarter ended 31-Mar-2025 onward. Carries an
//                               XBRL instance URL per row.
//   - corporates-financial-results  the legacy in-bse-fin feed, back to 2010.
//                               Rows carry a presentation link, and their
//                               `xbrl` field is frequently the literal
//                               sentinel "-" (a URL that 404s) - nulled out
//                               here rather than followed.
//
// A single NSE XBRL document covers ONE period, so a time series needs several
// documents; mergeIndiaFilings() in lib/india.ts does the merging.

import { nseGet, nseArchiveHeaders } from "./nse";
import { parseIndiaXbrl, type IndiaDoc, type IndiaEntry } from "./india";

export interface NseFilingRow {
  seqId: string;
  symbol: string;
  companyName: string;
  /** Filing type as NSE labels it, e.g. "Integrated Filing- Financials". */
  type: string;
  /** Period the filing reports on, "30-JUN-2026". */
  periodEnd: string;
  filedAt: string;
  audited: string | null;
  consolidated: string | null;
  revisedDate: string | null;
  revisionRemark: string | null;
  /** Absolute XBRL instance URL, or null when NSE published no instance. */
  xbrl: string | null;
  /** Absolute inline-XBRL viewer URL — the as-filed human view. */
  ixbrl: string | null;
  pdf: string | null;
  presentation: string | null;
  sizeText: string | null;
}

function ddmmyyyy(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()}`;
}

/** NSE uses Indian month-name date format: 30-JUN-2026. */
const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function nseDateToISO(s: string): string | null {
  const m = String(s ?? "").trim().toUpperCase().match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2]];
  if (!mm) return null;
  return `${m[3]}-${mm}-${String(m[1]).padStart(2, "0")}`;
}

/**
 * NSE timestamps arrive as `30-Oct-2010 13:09` (legacy) or
 * `28-Jul-2026 18:43:22` (integrated) — Indian month names, DD-MMM-YYYY, NOT
 * ISO. Slicing these to ISO was the bug that let a 2010 filing pass a
 * `>= 2024-08-01` window check, because "30-Oct-2010" sorts after "2024".
 * Everything is normalised to a real ISO instant here so every downstream
 * comparison is a comparison and not a lexicographic accident.
 */
export function nseTimestampToISO(s: string): string | null {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const mm = MONTHS[m[2].toUpperCase()];
    if (!mm) return null;
    const hh = String(m[4] ?? "00").padStart(2, "0");
    const mi = String(m[5] ?? "00").padStart(2, "0");
    const ss = String(m[6] ?? "00").padStart(2, "0");
    return `${m[3]}-${mm}-${String(m[1]).padStart(2, "0")}T${hh}:${mi}:${ss}`;
  }
  // Already ISO (or something we must not mangle into a wrong date).
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.replace(" ", "T").slice(0, 19);
  return null;
}

/** A row whose xbrl field is NSE's "-" sentinel is a 404 waiting to happen. */
function usableXbrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s === "-" || !/^https?:\/\//i.test(s)) return null;
  return s;
}

function usableUrl(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!/^https?:\/\//i.test(s)) return null;
  // NSE literally returns ".../corporate/null" when there is no PDF.
  if (/\/null$/i.test(s)) return null;
  return s;
}

function mapIntegrated(rows: any[], symbol: string): NseFilingRow[] {
  const out: NseFilingRow[] = [];
  for (const r of rows ?? []) {
    const type = String(r?.type ?? "");
    if (!type) continue;
    const periodEnd = nseDateToISO(String(r?.qe_Date ?? "")) ?? "";
    const filed = nseTimestampToISO(String(r?.broadcast_Date ?? r?.creation_Date ?? ""));
    out.push({
      seqId: String(r?.seq_Id ?? ""),
      symbol: String(r?.symbol ?? symbol),
      companyName: String(r?.smName ?? r?.cmName ?? ""),
      type,
      periodEnd,
      filedAt: filed ?? "",
      audited: r?.audited === null || r?.audited === undefined ? null : String(r.audited),
      consolidated: r?.consolidated === null || r?.consolidated === undefined ? null : String(r.consolidated),
      revisedDate: r?.revised_Date ? String(r.revised_Date) : null,
      revisionRemark: r?.revision_Remark ? String(r.revision_Remark) : null,
      xbrl: usableXbrl(r?.xbrl),
      ixbrl: usableUrl(r?.ixbrl),
      pdf: usableUrl(r?.pdf_attach),
      presentation: null,
      sizeText: r?.xbrlFileSize ? String(r.xbrlFileSize) : null,
    });
  }
  return out;
}

function mapLegacy(rows: any[], symbol: string): NseFilingRow[] {
  const out: NseFilingRow[] = [];
  for (const r of rows ?? []) {
    const toDate = String(r?.toDate ?? "");
    const periodEnd = nseDateToISO(toDate) ?? "";
    if (!periodEnd) continue;
    const filed = nseTimestampToISO(String(r?.broadCastDate ?? r?.filingDate ?? ""));
    out.push({
      seqId: String(r?.seqNumber ?? ""),
      symbol: String(r?.symbol ?? symbol),
      companyName: String(r?.companyName ?? ""),
      type: "Financial Results (Legacy)",
      periodEnd,
      filedAt: filed ?? "",
      audited: r?.audited ? String(r.audited) : null,
      consolidated: r?.consolidated ? String(r.consolidated) : null,
      revisedDate: null,
      revisionRemark: r?.oldNewFlag ? String(r.oldNewFlag) : null,
      xbrl: usableXbrl(r?.xbrl),
      ixbrl: null,
      pdf: null,
      presentation: usableUrl(r?.resultDetailedDataLink),
      sizeText: null,
    });
  }
  return out;
}

/** SEBI integrated filings — quarters from the 31-Mar-2025 cutover onward. */
export async function nseIntegratedFilings(symbol: string, fromISO: string, toISO: string): Promise<NseFilingRow[]> {
  const url =
    `https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(symbol)}` +
    `&from_date=${ddmmyyyy(new Date(fromISO))}&to_date=${ddmmyyyy(new Date(toISO))}`;
  const r = await nseGet(url);
  if (!r.ok) throw new Error(`nse integrated ${r.status}`);
  const j: any = await r.json();
  return mapIntegrated(Array.isArray(j?.data) ? j.data : [], symbol);
}

/**
 * Legacy financial-results rows. The feed ignores the date window in practice
 * and returns the tail of its own history, so the caller filters.
 */
export async function nseLegacyFilings(symbol: string): Promise<NseFilingRow[]> {
  const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}`;
  const r = await nseGet(url);
  if (!r.ok) throw new Error(`nse legacy ${r.status}`);
  const j: any = await r.json();
  return mapLegacy(Array.isArray(j) ? j : [], symbol);
}

/** Both feeds merged and de-duplicated on period + basis + type. */
export async function nseAllFilings(
  symbol: string,
  fromISO: string,
  toISO: string
): Promise<{ rows: NseFilingRow[]; legacyError: string | null; integratedError: string | null }> {
  // Each leg fails open but is REPORTED, so a dead feed shows as a named error
  // rather than as a filing list that is quietly short.
  const integrated = await nseIntegratedFilings(symbol, fromISO, toISO).then(
    (r): NseFilingRow[] | { err: string } => r,
    (e): NseFilingRow[] | { err: string } => ({ err: e?.message ?? "unknown" })
  );
  const legacy = await nseLegacyFilings(symbol).then(
    (r): NseFilingRow[] | { err: string } => r,
    (e): NseFilingRow[] | { err: string } => ({ err: e?.message ?? "unknown" })
  );
  const iErr = !Array.isArray(integrated) ? integrated.err : null;
  const lErr = !Array.isArray(legacy) ? legacy.err : null;
  const rows = [...(Array.isArray(integrated) ? integrated : []), ...(Array.isArray(legacy) ? legacy : [])];

  // Same period filed as both consolidated and standalone, or twice: keep the
  // newest per (periodEnd, consolidated, type).
  const seen = new Map<string, NseFilingRow>();
  for (const row of rows) {
    const key = `${row.periodEnd}|${row.consolidated ?? "-"}|${row.type}`;
    const prev = seen.get(key);
    if (!prev || prev.filedAt < row.filedAt) seen.set(key, row);
  }
  return {
    rows: [...seen.values()].sort((a, b) => (a.filedAt < b.filedAt ? 1 : a.filedAt > b.filedAt ? -1 : 0)),
    legacyError: lErr,
    integratedError: iErr,
  };
}

/**
 * Download and parse the XBRL instance documents behind a filing window.
 * Legs fail open: one dead URL must not lose the other periods.
 */
export async function nseXbrlDocs(rows: NseFilingRow[]): Promise<{ entries: IndiaEntry[]; fetched: number; failed: number; totalFacts: number; totalContexts: number }> {
  const withXbrl = rows.filter((r) => r.xbrl);
  const out: IndiaEntry[] = [];
  let failed = 0;
  let totalFacts = 0;
  let totalContexts = 0;

  // nseGet is throttled internally but is not concurrency-safe, so these run
  // in sequence rather than Promise.all.
  for (const row of withXbrl) {
    try {
      const r = await nseGet(row.xbrl!, nseArchiveHeaders());
      if (!r.ok) {
        failed++;
        continue;
      }
      const xml = await r.text();
      if (!/<(?:\w+:)?context\b/.test(xml)) {
        failed++;
        continue;
      }
      const doc: IndiaDoc = parseIndiaXbrl(xml);
      // A document that parses to zero facts is a parse failure wearing a
      // success hat; counting it here is what makes that visible.
      if (!doc.facts.length) {
        failed++;
        continue;
      }
      totalFacts += doc.facts.length;
      totalContexts += doc.contexts.size;
      out.push({
        doc,
        basis: /standalone|non-?consolidated/i.test(row.consolidated ?? "") ? "Standalone" : "Consolidated",
        filedAt: row.filedAt,
        accession: row.seqId,
        audited: row.audited,
      });
    } catch {
      failed++;
    }
  }
  return { entries: out, fetched: out.length, failed, totalFacts, totalContexts };
}

/** Derive a fetch window from `months`, as api/documents does. */
export function nseWindow(months: number, toISO: string): { fromISO: string; toISO: string } {
  const m = Math.max(6, Math.min(36, months));
  const to = new Date(toISO);
  const from = new Date(to.getTime() - m * 30.44 * 86400000);
  return { fromISO: from.toISOString().slice(0, 10), toISO };
}