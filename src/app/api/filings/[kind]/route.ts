// Filings desk (module 117) — one endpoint, six kinds.
//
//   search    ticker -> registry identity (CIK for US, NSE symbol + ISIN for IN)
//   index     the unified filing list across both registries
//   xbrl      IS / BS / CFS resolved from filed XBRL, annual + quarterly + LTM
//   asfiled   the statement EXACTLY as the issuer printed it (US: EDGAR R-files)
//   mda       the MD&A prose, verbatim
//   notes     note disclosures behind a ledger line — backs /api/schedule
//
// Honesty contract, same as api/documents: a failure returns a fully populated
// ok:false payload with an UPPERCASE reason, never a silently empty table that
// reads like a result. Unknown is null; a line the filing does not carry is
// "—" with the count of what was missing.

import { NextRequest, NextResponse } from "next/server";
import type { AsFiledTable, FilingRecord } from "@/lib/types";
import { normalizeTicker } from "@/lib/utils";
import {
  cikForTicker,
  isStatementForm,
  secFetch,
  secFinancialReportXlsx,
  secFilingReports,
  secReportHtml,
  secReportUrl,
  secSearchRegistry,
  secStatus,
  secSubmissions,
  type SecFiling,
} from "@/lib/sec";
import { htmlToProse, parseAsFiled } from "@/lib/filings";
import { resolveNotes, resolveXbrl } from "@/lib/filingsSource";
import { nseAllFilings, nseWindow, type NseFilingRow } from "@/lib/nsefilings";
import { nseGet } from "@/lib/nse";
import type { DocFamily } from "@/app/api/documents/route";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ------------------------------------------------------------------ helpers

interface Region {
  code: "US" | "IN";
  /** "NSE" | "SEC" | null when the venue is unknown or refused. */
  venue: string | null;
  symbol: string;
  base: string;
  name: string | null;
  isin: string | null;
  cik: string | null;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  foreignIssuer: boolean;
  /** Set when the registry cannot serve this symbol at all. */
  refusal: string | null;
}

const BSE_REFUSAL =
  "BSE LISTING — BSE'S ANNOUNCEMENT API ANSWERS 403 WITHOUT A LIVE BROWSER SESSION, SO NO BSE FILINGS CAN BE READ SERVER-SIDE. THE NSE FEED STILL SERVES MOST BSE-EQUITY COUNTERPARTS BY NSE SYMBOL.";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Decide which registry owns this symbol. Yahoo suffixes are the only signal:
 * .NS / .BO are Indian, everything else is put to EDGAR.
 */
async function resolveRegion(symbolRaw: string, ua: string | null): Promise<Region> {
  const raw = (symbolRaw || "").trim().toUpperCase();
  const suffix = raw.match(/\.(NS|BO)$/)?.[1] ?? null;
  const base = suffix ? raw.slice(0, -(suffix.length + 1)) : raw;

  if (suffix === "BO") {
    return {
      code: "IN", venue: null, symbol: raw, base, name: null, isin: null, cik: null,
      sic: null, sicDescription: null, fiscalYearEnd: null, foreignIssuer: false,
      refusal: BSE_REFUSAL,
    };
  }
  if (suffix === "NS") {
    return {
      code: "IN", venue: "NSE", symbol: raw, base, name: null, isin: null, cik: null,
      sic: null, sicDescription: null, fiscalYearEnd: null, foreignIssuer: false,
      refusal: null,
    };
  }
  // Non-NSE, non-BSE: could still be an EDGAR registrant. Ask.
  const hit = await cikForTicker(base, ua);
  if (!hit) {
    return {
      code: "US", venue: null, symbol: raw, base, name: null, isin: null, cik: null,
      sic: null, sicDescription: null, fiscalYearEnd: null, foreignIssuer: false,
      refusal: `NO CIK FOR ${base} IN EDGAR'S REGISTRANT FILE. IT MAY BE A FUND, AN OTC NAME, A NON-US LISTING, OR A FOREIGN ISSUER THAT DOES NOT FILE WITH THE SEC.`,
    };
  }
  return {
    code: "US", venue: "SEC", symbol: raw, base, name: hit.name, isin: null, cik: hit.cik,
    sic: null, sicDescription: null, fiscalYearEnd: null, foreignIssuer: false,
    refusal: null,
  };
}

function fail(kind: string, symbol: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, kind, symbol, error, ...extra }, { status: 200 });
}

/**
 * `Number(null)` is 0, not NaN — without the null/empty guard an absent
 * ?annual= would silently clamp to the minimum instead of using the default.
 */
function intParam(sp: URLSearchParams, key: string, dflt: number, lo: number, hi: number): number {
  const raw = sp.get(key);
  if (raw === null || raw.trim() === "") return dflt;
  const n = Number(raw);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/** EDGAR form -> the desk's family vocabulary, so one filter works for both. */
function usFamily(f: SecFiling): DocFamily {
  const form = f.form.toUpperCase();
  if (/^10-[KQ]/.test(form)) return "RESULTS";
  if (form === "DEF 14A") return "GOVERNANCE";
  if (form === "8-K") return "DISCLOSURE";
  if (/^(N-CSR|N-CSRS|NPORT-P|NPORT-EX)/.test(form)) return "DISCLOSURE";
  if (/^(S-|424B|SC |13F|13D|13G|POS AM|144)/.test(form)) return "ROUTINE";
  return "ROUTINE";
}

function nseFamily(row: NseFilingRow): DocFamily {
  const t = row.type.toLowerCase();
  if (t.includes("financial")) return "RESULTS";
  if (t.includes("governance") || t.includes("board") || t.includes("auditor")) return "GOVERNANCE";
  if (t.includes("capital") || t.includes("dividend") || t.includes("borrow")) return "CAPITAL";
  return "DISCLOSURE";
}

const SEC_FORMS = new Set([
  "10-K", "10-Q", "20-F", "40-F", "6-K", "8-K", "DEF 14A", "S-1", "S-3", "424B5", "20-F/A", "10-K/A", "10-Q/A",
]);

function toRecord(f: SecFiling): FilingRecord {
  return {
    id: f.accession,
    date: f.filingDate,
    form: f.form,
    period: f.reportDate,
    title: f.primaryDocDescription || f.primaryDocument || f.form,
    accession: f.accession,
    xbrl: f.isXBRL || f.isInlineXBRL,
    pdf: null,
    html: f.doc,
    family: usFamily(f),
    size: f.size,
    audited: null,
    consolidated: null,
  };
}

function toNseRecord(row: NseFilingRow): FilingRecord {
  // filedAt is a real ISO instant now; fall back to the period end when NSE
  // published a row with no usable timestamp rather than emitting "30-Oct-201".
  const filedDay = (row.filedAt || "").slice(0, 10);
  return {
    id: `nse-${row.seqId}`,
    date: /^\d{4}-\d{2}-\d{2}$/.test(filedDay) ? filedDay : row.periodEnd || "—",
    form: row.type,
    period: row.periodEnd,
    title: `${row.type}${row.audited ? ` · ${row.audited}` : ""}${row.consolidated ? ` · ${row.consolidated}` : ""}`.trim(),
    accession: row.seqId,
    xbrl: !!row.xbrl,
    pdf: row.pdf ?? row.presentation,
    html: row.ixbrl,
    family: nseFamily(row),
    size: null,
    audited: row.audited,
    consolidated: row.consolidated,
  };
}

// ----------------------------------------------------------------- handlers

async function handleSearch(sp: URLSearchParams, ua: string | null) {
  const q = (sp.get("q") ?? sp.get("symbol") ?? "").trim();
  if (!q) return fail("search", "", "NO QUERY — PASS ?q= WITH A TICKER OR COMPANY NAME");

  const suffix = q.toUpperCase().match(/\.(NS|BO)$/)?.[1] ?? null;
  if (suffix) {
    const base = q.toUpperCase().slice(0, -(suffix.length + 1));
    // The NSE equity list comes through api/ochain/symbols; ask NSE directly
    // for the name rather than duplicating that list here.
    let name: string | null = null;
    try {
      const r = await nseGet(
        `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(base)}`,
        { accept: "application/json" }
      );
      if (r.ok) {
        const j: any = await r.json();
        name = typeof j?.info?.companyName === "string" ? j.info.companyName : null;
      }
    } catch {
      /* identity is cosmetic — the index leg still works without it */
    }
    return NextResponse.json({
      ok: true,
      kind: "search",
      query: q,
      registry: "NSE",
      region: "IN",
      hits: [{ cik: null, ticker: base, name, venue: suffix === "BO" ? "BSE" : "NSE", symbol: `${base}.${suffix}` }],
    });
  }

  const hits = await secSearchRegistry(q, 14, ua);
  return NextResponse.json({
    ok: hits.length > 0,
    kind: "search",
    query: q,
    registry: "SEC EDGAR",
    region: "US",
    error: hits.length ? undefined : `NO EDGAR REGISTRANT MATCHES "${q}"`,
    hits: hits.map((h) => ({ cik: h.cik, ticker: h.ticker, name: h.name, venue: "SEC", symbol: h.ticker })),
  });
}

async function handleIndex(sp: URLSearchParams, ua: string | null) {
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const months = intParam(sp, "months", 24, 6, 36);
  const rg = await resolveRegion(symbol, ua);
  if (rg.refusal && rg.venue === null && rg.code === "US") return fail("index", symbol, rg.refusal);

  if (rg.code === "IN") {
    if (rg.refusal) return fail("index", symbol, rg.refusal, { region: "IN", venue: null });
    const { fromISO, toISO } = nseWindow(months, todayISO());
    const { rows, legacyError, integratedError } = await nseAllFilings(rg.base, fromISO, toISO);
    // NSE's legacy feed ignores the window it is given and returns the tail of
    // its own history, so the filter is applied here against real ISO dates.
    const filtered = rows.filter((r) => (r.filedAt || r.periodEnd).slice(0, 10) >= fromISO);
    const filings = filtered.map(toNseRecord);
    const first = filtered[0];
    return NextResponse.json({
      ok: filings.length > 0,
      kind: "index",
      symbol,
      region: "IN",
      venue: "NSE",
      entity: first?.companyName ?? rg.name,
      isin: null,
      from: fromISO,
      to: toISO,
      total: filings.length,
      // A leg that never answered is reported, not hidden behind a zero.
      partial: !!(legacyError || integratedError),
      errors: { legacy: legacyError, integrated: integratedError },
      error: filings.length ? undefined : `NO NSE FILINGS IN THE LAST ${months} MONTHS — WIDEN ?MONTHS= UP TO 36 IF THE LISTING IS OLD`,
      withXbrl: filings.filter((f) => f.xbrl).length,
      filings,
    });
  }

  const sub = await secSubmissions(rg.cik!, ua);
  const cutoff = new Date(Date.now() - months * 30.44 * 86400000).toISOString().slice(0, 10);
  const kept = sub.filings.filter((f) => SEC_FORMS.has(f.form.toUpperCase()) && f.filingDate >= cutoff);
  const filings = kept.map(toRecord);
  const withXbrl = kept.filter((f) => f.isXBRL || f.isInlineXBRL).length;
  return NextResponse.json({
    ok: filings.length > 0,
    kind: "index",
    symbol,
    region: "US",
    venue: "SEC",
    entity: sub.entityName,
    isin: null,
    cik: sub.cik,
    sic: sub.sic,
    sicDescription: sub.sicDescription,
    fiscalYearEnd: sub.fiscalYearEnd,
    foreignIssuer: sub.foreignPrivateIssuer,
    exchange: sub.exchanges.join(","),
    from: cutoff,
    to: todayISO(),
    total: filings.length,
    partial: false,
    errors: {},
    error: filings.length
      ? undefined
      : `NO ${SEC_FORMS.size}-STYLE FILINGS IN THE LAST ${months} MONTHS. ${sub.foreignPrivateIssuer ? "THIS REGISTRANT IS A FOREIGN PRIVATE ISSUER — 6-K CARRIES NO FINANCIAL STATEMENTS." : ""}`,
    withXbrl,
    // A foreign private issuer filing only 6-K is the single most common
    // reason an ADR desk looks empty; say it rather than showing a gap.
    caveat: sub.foreignPrivateIssuer
      ? "FOREIGN PRIVATE ISSUER — 20-F/40-F ARE ANNUAL ONLY AND 6-K CARRIES NO XBRL FINANCIALS. QUARTERLY DATA IS NOT FILED WITH THE SEC FOR THIS REGISTRANT."
      : null,
    filings,
  });
}

async function handleXbrl(sp: URLSearchParams, ua: string | null) {
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  // Delegated to the shared resolver so /api/statements reads filings through
  // exactly this code path rather than a fork of it.
  const r = await resolveXbrl(symbol, {
    ua,
    basis: sp.get("basis") === "Standalone" ? "Standalone" : "Consolidated",
    annualLimit: intParam(sp, "annual", 6, 2, 12),
    quarterlyLimit: intParam(sp, "quarterly", 9, 4, 16),
  });
  if (!r.ok) return fail("xbrl", symbol, String(r.error ?? "filings unavailable"), { region: r.region });
  return NextResponse.json({ kind: "xbrl", symbol, ...r });
}

/** Pick the R-file reports that hold the printed statements. */
function statementReports(reports: Array<{ file: string; shortName: string; menuCategory: string }>) {
  const isOf = (s: string) => /income|operation|earnings|profit|loss.*statement|statement.*operation/i.test(s);
  const bsOf = (s: string) => /balance sheet|financial position/i.test(s);
  const cfOf = (s: string) => /cash flow|cash flow/i.test(s);
  const inCat = reports.filter((r) => r.menuCategory === "Statements");
  return {
    is: inCat.filter((r) => isOf(r.shortName) && !bsOf(r.shortName) && !cfOf(r.shortName) && !/parenthetical|comprehensive/i.test(r.shortName)),
    bs: inCat.filter((r) => bsOf(r.shortName) && !/parenthetical/i.test(r.shortName)),
    cf: inCat.filter((r) => cfOf(r.shortName)),
    // Parentheticals carry share counts and the like; kept but marked apart.
    notes: reports.filter((r) => r.menuCategory === "Notes"),
  };
}

async function handleAsfiled(sp: URLSearchParams, ua: string | null) {
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const accn = (sp.get("accn") ?? "").trim();
  const rg = await resolveRegion(symbol, ua);
  if (rg.code !== "US" || !rg.cik) {
    return fail("asfiled", symbol, "AS-FILED RENDERED STATEMENTS ARE AN EDGAR ARTEFACT. NSE FILES PRESENTATION PDFs, NOT R-FILES — USE THE PDF LINK IN THE INDEX PANEL.", { region: rg.code });
  }
  if (!accn) {
    return fail("asfiled", symbol, "NO ACCESSION — PICK A FILING IN THE INDEX PANEL AND PASS ITS ACCESSION AS ?accn=");
  }

  const accnNoDash = accn.replace(/-/g, "");
  const reports = await secFilingReports(rg.cik, accnNoDash, ua);
  const pick = statementReports(reports);
  const wanted = [...pick.is, ...pick.bs, ...pick.cf].slice(0, 4);
  if (!wanted.length) {
    return fail("asfiled", symbol, `ACCESSION ${accn} HAS NO RENDERED STATEMENT REPORTS — ITS FILING SUMMARY LISTS ${reports.length} REPORTS, NONE OF THEM A STATEMENT. THIS USUALLY MEANS A FORM 4 OR AN 8-K RATHER THAN A 10-K/10-Q.`);
  }

  const tables: AsFiledTable[] = [];
  let failed = 0;
  for (const r of wanted) {
    try {
      const html = await secReportHtml(rg.cik, accnNoDash, r.file, ua);
      const parsed = parseAsFiled(html, r.file, secReportUrl(rg.cik, accnNoDash, r.file));
      if (parsed) tables.push({ report: r.file, shortName: parsed.shortName, caption: parsed.caption, cols: parsed.cols, rows: parsed.rows, url: parsed.url });
      else failed++;
    } catch {
      failed++;
    }
  }
  if (!tables.length) {
    return fail("asfiled", symbol, `THE ${wanted.length} RENDERED STATEMENT REPORTS OF ${accn} DID NOT PARSE — EDGAR'S VIEWER MARKUP MAY HAVE CHANGED. THE NORMALISED XBRL NUMBERS ARE UNAFFECTED.`);
  }
  return NextResponse.json({
    ok: true,
    kind: "asfiled",
    symbol,
    entity: rg.name,
    cik: rg.cik,
    accession: accn,
    tables,
    xlsx: secFinancialReportXlsx(rg.cik, accnNoDash),
    partial: failed > 0,
    errors: { reports: failed ? `${failed} OF ${wanted.length} RENDERED REPORTS FAILED TO PARSE` : null },
    caveat:
      "THIS IS THE TABLE EXACTLY AS THE ISSUER PRINTED IT, INCLUDING ITS OWN CAPTION, COLUMN SPANS AND FOOTNOTE MARKERS. WHERE IT DIFFERS FROM THE NORMALISED XBRL BLOCK, THE FILING WINS.",
    noteReportCount: pick.notes.length,
  });
}

async function handleMda(sp: URLSearchParams, ua: string | null) {
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const rg = await resolveRegion(symbol, ua);
  if (rg.code !== "US" || !rg.cik) {
    return fail("mda", symbol, "THE MD&A READER READS SEC FILINGS. FOR AN INDIAN NAME THE MD&A AND MANAGEMENT COMMENTARY LIVE IN THE NSE 'MANAGEMENT DISCUSSION' DISCLOSURES — READ THOSE IN THE INDEX PANEL, WHERE THE FILED PROSE IS ALREADY SHOWN.");
  }

  const accnParam = (sp.get("accn") ?? "").trim();
  let target = accnParam;
  let form = "";
  if (target) {
    const noDash = target.replace(/-/g, "");
    const f = `https://www.sec.gov/Archives/edgar/data/${Number(rg.cik)}/${noDash}/${noDash}-index.htm`;
    try {
      const sub = await secSubmissions(rg.cik, ua);
      const hit = sub.filings.find((x) => x.accession.replace(/-/g, "") === noDash);
      if (hit) {
        form = hit.form;
        if (!isStatementForm(hit.form)) {
          return fail("mda", symbol, `ACCESSION ${accnParam} IS A ${hit.form}, WHICH CARRIES NO MANAGEMENT DISCUSSION. OPEN A 10-K, 10-Q, 20-F OR 40-K FILING.`);
        }
      }
    } catch {
      /* fall through — the document fetch will report its own failure */
    }
    void f;
  } else {
    const sub = await secSubmissions(rg.cik, ua);
    const latest = sub.filings.find((f) => isStatementForm(f.form) && f.filingDate >= new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10));
    if (!latest) return fail("mda", symbol, `NO 10-K/10-Q/20-F FILED IN THE LAST 200 DAYS FOR ${rg.name ?? rg.base}`);
    target = latest.accession;
    form = latest.form;
  }

  const noDash = target.replace(/-/g, "");
  const sub2 = await secSubmissions(rg.cik, ua);
  const filing = sub2.filings.find((x) => x.accession.replace(/-/g, "") === noDash);
  if (!filing) return fail("mda", symbol, `ACCESSION ${accnParam || "AUTO"} IS NOT IN EDGAR'S RECENT SUBMISSIONS FOR ${rg.base}`);

  const html = await secFetch(filing.doc, { revalidate: 86400, accept: "text/html", ua }).then((r) => r.text());
  const plain = htmlToProse(html);

  // MD&A is Item 7 in a 10-K and Item 2 in a 10-Q. The heading is matched on
  // the LAST occurrence, not the first: every filing opens with a table of
  // contents that repeats the same string, and starting there would return the
  // contents page instead of the discussion.
  const isQuarterly = /^10-Q/.test(form);
  const wantNext = isQuarterly
    ? /ITEM\s*2\.?\s*MANAGEMENT[’'`]?S\s+DISCUSSION/i
    : /ITEM\s*7\.?\s*MANAGEMENT[’'`]?S\s+DISCUSSION/i;
  const wantEnd = isQuarterly
    ? /ITEM\s*3\.?\s*(?:QUANTITATIVE|DEFAULTS|QUANTITATIVE AND QUALITATIVE)/i
    : /ITEM\s*(?:7A|8)\.?\s/i;

  let startMatch: RegExpExecArray | null = null;
  for (const m of plain.matchAll(new RegExp(wantNext.source, `${wantNext.flags.replace("g", "")}g`))) startMatch = m;
  if (!startMatch || startMatch.index === undefined) {
    return fail(
      "mda",
      symbol,
      `NO "${isQuarterly ? "ITEM 2" : "ITEM 7"} MANAGEMENT'S DISCUSSION" HEADING FOUND IN ${form} ${accnParam || target}. THE DOCUMENT MAY BE AN EXHIBIT OR STRUCTURED DIFFERENTLY — OPEN THE FILED DOCUMENT DIRECTLY.`,
      { doc: filing.doc, form }
    );
  }
  const from = startMatch.index + startMatch[0].length;
  // Where the section ends. The trap here is a cross-reference: MSFT's 10-K
  // says "...Notes to Financial Statements (Part II, Item 8)" two sentences into
  // Item 7, and cutting there returned 464 characters of the MD&A instead of
  // the whole section. So an end marker is only accepted when it is not
  // preceded by cross-reference language and sits past a minimum length.
  const CROSS_REF = /(part\s+[ivx]+|see|refer|described\s+in|set\s+forth\s+in|in\s+item|per)\s*[,)]?\s*$/i;
  const MIN_SECTION = 1500;
  let body = "";
  const rest = plain.slice(from, from + 200000);
  for (const m of rest.matchAll(new RegExp(wantEnd.source, `${wantEnd.flags.replace("g", "")}g`))) {
    if (m.index === undefined) continue;
    if (m.index < MIN_SECTION) continue;
    if (CROSS_REF.test(rest.slice(Math.max(0, m.index - 60), m.index))) continue;
    body = rest.slice(0, m.index).trim();
    break;
  }
  if (!body) body = rest.slice(0, 60000).trim();
  if (body.length < 400) {
    return fail("mda", symbol, `THE ${form} MD&A SECTION EXTRACTED TO ${body.length} CHARACTERS — TOO SHORT TO BE THE DISCUSSION. OPEN THE FILED DOCUMENT.`, { doc: filing.doc, form });
  }

  // Split into paragraphs on sentence-ish boundaries so the reader can show
  // a shape without us re-writing the issuer's words.
  const paras = body
    .split(/(?<=\.)\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40)
    .slice(0, 120);

  return NextResponse.json({
    ok: true,
    kind: "mda",
    symbol,
    entity: sub2.entityName,
    cik: rg.cik,
    accession: target,
    form,
    filedAt: filing.filingDate,
    period: filing.reportDate,
    item: isQuarterly ? "ITEM 2" : "ITEM 7",
    doc: filing.doc,
    chars: body.length,
    paragraphs: paras,
    text: body.slice(0, 24000),
    caveat:
      "VERBATIM FILING TEXT, TAG STRIPPED AND WHITESPACE COLLAPSED. PARAGRAPH BREAKS ARE INFERRED FROM SENTENCE BOUNDARIES — THE ISSUER'S OWN HEADINGS AND FOOTNOTES ARE NOT REPRODUCED. READ THE FILED DOCUMENT FOR THE AUTHORITATIVE VERSION.",
  });
}

/**
 * Note disclosures behind a ledger line. Backs /api/schedule, whose contract
 * is rows of { label, values keyed by period label } ? so the resolver is the
 * shared one in lib/filingsSource, not a second implementation.
 */
async function handleNotes(sp: URLSearchParams, ua: string | null) {
  const symbol = normalizeTicker(sp.get("symbol") || "RELIANCE.NS");
  const parent = (sp.get("parent") ?? "").trim().slice(0, 80);
  const r = await resolveNotes(symbol, parent, { ua });
  if (!r.ok) return fail("notes", symbol, String(r.error ?? "notes unavailable"));
  return NextResponse.json({ kind: "notes", symbol, parent, ...r });
}

// -------------------------------------------------------------------- router

export async function GET(req: NextRequest, ctx: { params: { kind: string } }) {
  const kind = String(ctx?.params?.kind ?? "").toLowerCase();
  const sp = req.nextUrl.searchParams;
  const ua = sp.get("secua");

  try {
    if (kind === "status") {
      return NextResponse.json({ ok: true, kind: "status", ...secStatus(ua) });
    }
    if (kind === "search") return await handleSearch(sp, ua);
    if (kind === "index") return await handleIndex(sp, ua);
    if (kind === "xbrl") return await handleXbrl(sp, ua);
    if (kind === "asfiled") return await handleAsfiled(sp, ua);
    if (kind === "mda") return await handleMda(sp, ua);
    if (kind === "notes") return await handleNotes(sp, ua);
    return fail(kind, sp.get("symbol") ?? "", `UNKNOWN FILINGS KIND "${kind}" — USE search, index, xbrl, asfiled, mda, notes OR status`);
  } catch (e: any) {
    // 502 for a genuine upstream failure; the payload still carries the reason
    // so the desk can print it instead of a bare status code.
    return NextResponse.json(
      { ok: false, kind, symbol: sp.get("symbol") ?? "", error: String(e?.message ?? e).toUpperCase().slice(0, 300) },
      { status: 502 }
    );
  }
}

export type { Region };