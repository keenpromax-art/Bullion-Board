// Server-side filings resolution, shared by every caller.
//
// This exists so there is exactly ONE implementation of "given a ticker, go
// and get its filings" in the codebase. /api/filings/*, /api/statements and
// /api/schedule all need it, and an earlier version had /api/statements
// calling /api/filings/xbrl over HTTP against a hardcoded localhost — which
// works in dev and breaks the moment the app is deployed, and would silently
// fall back to Yahoo instead of filings. Callers import these functions
// directly; nothing here reaches the network over HTTP to reach itself.

import type { StatementSet } from "./types";
import { cikForTicker, isStatementForm, secCompanyFacts, secSubmissions, secFilingReports, secReportHtml, secReportUrl } from "./sec";
import { buildUsStatementSets, deriveLines, ltmFromQuarterly, noteTerms, parseAsFiled } from "./filings";
import { mergeIndiaFilings } from "./india";
import { nseAllFilings, nseWindow, nseXbrlDocs, type NseFilingRow } from "./nsefilings";

export const BSE_REFUSAL =
  "BSE LISTING — BSE'S ANNOUNCEMENT API ANSWERS 403 WITHOUT A LIVE BROWSER SESSION, SO NO BSE FILINGS CAN BE READ SERVER-SIDE. THE NSE FEED STILL SERVES MOST BSE-EQUITY COUNTERPARTS BY NSE SYMBOL.";

export interface FilingsRegion {
  code: "US" | "IN";
  venue: string | null;
  symbol: string;
  base: string;
  name: string | null;
  cik: string | null;
  refusal: string | null;
}

/**
 * Decide which registry owns this symbol. The Yahoo suffix is the only signal:
 * .NS / .BO are Indian, everything else is put to EDGAR.
 */
export async function resolveRegion(symbolRaw: string, ua: string | null): Promise<FilingsRegion> {
  const raw = (symbolRaw || "").trim().toUpperCase();
  const suffix = raw.match(/\.(NS|BO)$/)?.[1] ?? null;
  const base = suffix ? raw.slice(0, -(suffix.length + 1)) : raw;

  if (suffix === "BO") {
    return { code: "IN", venue: null, symbol: raw, base, name: null, cik: null, refusal: BSE_REFUSAL };
  }
  if (suffix === "NS") {
    return { code: "IN", venue: "NSE", symbol: raw, base, name: null, cik: null, refusal: null };
  }
  const hit = await cikForTicker(base, ua);
  if (!hit) {
    return {
      code: "US",
      venue: null,
      symbol: raw,
      base,
      name: null,
      cik: null,
      refusal: `NO CIK FOR ${base} IN EDGAR'S REGISTRANT FILE. IT MAY BE A FUND, AN OTC NAME, A NON-US LISTING, OR A FOREIGN ISSUER THAT DOES NOT FILE WITH THE SEC.`,
    };
  }
  return { code: "US", venue: "SEC", symbol: raw, base, name: hit.name, cik: hit.cik, refusal: null };
}

export interface XbrlSource {
  ok: boolean;
  error?: string;
  region: "US" | "IN";
  venue: string | null;
  entity: string;
  cik?: string;
  basis?: string;
  taxonomy: string;
  documents?: { fetched: number; failed: number; facts: number; contexts: number };
  partial?: boolean;
  errors?: Record<string, string | null>;
  annual: StatementSet;
  quarterly: StatementSet;
  ltm: { periods: StatementSet["periods"]; is: StatementSet["is"]; cf: StatementSet["is"] } | null;
  derived: ReturnType<typeof deriveLines>;
  caveat?: string | null;
}

/**
 * IS / BS / CFS for a ticker, resolved from the registrant's own filings.
 * Never throws: a registry that cannot answer comes back as `ok:false` with an
 * UPPERCASE reason, because callers render that reason rather than an empty
 * table that would read like a result.
 */
export async function resolveXbrl(
  symbol: string,
  opts: { ua?: string | null; basis?: "Consolidated" | "Standalone"; annualLimit?: number; quarterlyLimit?: number; months?: number; now?: string } = {}
): Promise<XbrlSource> {
  const ua = opts.ua ?? null;
  const rg = await resolveRegion(symbol, ua);
  const today = opts.now ?? new Date().toISOString().slice(0, 10);

  if (rg.refusal) {
    const blank = {
      region: rg.code,
      venue: rg.venue,
      entity: rg.name ?? rg.base,
      taxonomy: "—",
      annual: blankSet(rg.code, rg.name ?? rg.base),
      quarterly: blankSet(rg.code, rg.name ?? rg.base),
      ltm: null,
      derived: [],
    };
    return { ...blank, ok: false, error: rg.refusal };
  }

  if (rg.code === "IN") {
    const months = opts.months ?? 36;
    const { fromISO, toISO } = nseWindow(months, today);
    const { rows, legacyError, integratedError } = await nseAllFilings(rg.base, fromISO, toISO);
    const { entries, fetched, failed, totalFacts, totalContexts } = await nseXbrlDocs(rows);
    if (!entries.length) {
      const blank = {
        region: "IN" as const,
        venue: "NSE",
        entity: rows[0]?.companyName ?? rg.base,
        taxonomy: "in-capmkt",
        annual: blankSet("IN", rows[0]?.companyName ?? rg.base),
        quarterly: blankSet("IN", rows[0]?.companyName ?? rg.base),
        ltm: null,
        derived: [],
      };
      return {
        ...blank,
        ok: false,
        error: `NO NSE XBRL INSTANCE COULD BE READ FOR ${rg.base} — ${fetched} FETCHED, ${failed} FAILED, ${legacyError ?? ""} ${integratedError ?? ""}`.trim(),
      };
    }
    const basis = opts.basis ?? "Consolidated";
    const set = mergeIndiaFilings(entries, { basis, periodLimit: 8, companyName: rows[0]?.companyName ?? "" });
    return {
      ok: true,
      region: "IN",
      venue: "NSE",
      entity: set.entity || (rows[0]?.companyName ?? ""),
      basis,
      taxonomy: set.taxonomy,
      documents: { fetched, failed, facts: totalFacts, contexts: totalContexts },
      partial: failed > 0 || !!(legacyError || integratedError),
      errors: {
        legacy: legacyError,
        integrated: integratedError,
        xbrl: failed ? `${failed} XBRL DOCUMENTS FAILED TO PARSE` : null,
      },
      // A consolidated Indian filing carries one period per document and no
      // annual/quarterly split, so both axes are the same series.
      annual: set,
      quarterly: set,
      ltm: null,
      derived: deriveLines(set),
      caveat:
        "NSE INTEGRATED FILINGS ARE FILED PER PERIOD, NOT AS AN ANNUAL/QUARTERLY PAIR, AND SEBI DOES NOT REQUIRE A BALANCE SHEET IN A Q1 OR Q3 FILING — THOSE COLUMNS READ \"—\". SEGMENT AND COVERAGE RATIOS ARE SHOWN AS FILED, INCLUDING VALUES THAT DO NOT LOOK LIKE CLEAN RATIOS.",
    };
  }

  const facts = await secCompanyFacts(rg.cik!, ua);
  const annualLimit = opts.annualLimit ?? 6;
  const quarterlyLimit = opts.quarterlyLimit ?? 9;
  const { annual, quarterly } = buildUsStatementSets(facts, { annualLimit, quarterlyLimit });
  if (!annual.periods.length && !quarterly.periods.length) {
    return {
      ok: false,
      error: `NO USABLE PERIODS IN ${facts.entityName}'S XBRL — EVERY CONCEPT WAS FILTERED OUT OR UNTAGGED`,
      region: "US",
      venue: "SEC",
      entity: facts.entityName,
      taxonomy: annual.taxonomy,
      annual,
      quarterly,
      ltm: null,
      derived: [],
    };
  }
  const ltm = ltmFromQuarterly(quarterly);
  return {
    ok: true,
    region: "US",
    venue: "SEC",
    entity: facts.entityName,
    cik: rg.cik ?? undefined,
    taxonomy: annual.taxonomy,
    partial: false,
    errors: {},
    annual,
    quarterly,
    ltm: ltm.block.lines.length ? { periods: ltm.periods, is: ltm.block, cf: ltm.block } : null,
    derived: [...deriveLines(annual), ...deriveLines(quarterly)],
    caveat:
      "XBRL TAGGING IS MANDATORY ONLY FROM 2009, SO PRE-2009 PERIODS ARE ABSENT. LINE LABELS FOLLOW YAHOO'S fundamentals-timeseries VOCABULARY SO THE EXISTING STATEMENT DESKS CAN CONSUME THESE WITHOUT FORK.",
  };
}

function blankSet(region: "US" | "IN", entity: string): StatementSet {
  const cov = {
    canonical: 0,
    resolved: [],
    missing: [],
    source: "—",
    caveat: null,
  };
  return {
    region,
    entity,
    taxonomy: "—",
    unit: region === "IN" ? "INR CRORE" : "USD",
    currency: region === "IN" ? "INR" : "USD",
    divisor: region === "IN" ? 1 : 1e6,
    periods: [],
    is: { lines: [] },
    bs: { lines: [] },
    cf: { lines: [] },
    coverage: { is: cov, bs: cov, cf: cov },
    notes: [],
    asOf: null,
  };
}

export interface NotesSource {
  ok: boolean;
  error?: string;
  entity: string;
  accession: string | null;
  form: string | null;
  count: number;
  rows: Array<{ label: string; values: Record<string, string> }>;
  source: string;
  reportsAvailable: string[];
}

/**
 * Note schedules behind a ledger row, read from EDGAR's rendered R-files.
 * `parent` empty returns the whole note index, which is what a drill-down
 * picker needs; a named row returns the matching schedule.
 */
export async function resolveNotes(
  symbol: string,
  parent: string,
  opts: { ua?: string | null } = {}
): Promise<NotesSource> {
  const ua = opts.ua ?? null;
  const empty = (error: string): NotesSource => ({ ok: false, error, entity: "", accession: null, form: null, count: 0, rows: [], source: "EDGAR", reportsAvailable: [] });

  const rg = await resolveRegion(symbol, ua);
  if (rg.code !== "US" || !rg.cik) {
    return empty(rg.refusal ?? "NOTE SCHEDULES COME FROM EDGAR'S RENDERED NOTE REPORTS. THERE IS NO EQUIVALENT FOR NSE FILINGS.");
  }

  const sub = await secSubmissions(rg.cik, ua);
  const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const latest = sub.filings.find((f) => isStatementForm(f.form) && f.filingDate >= cutoff && f.isInlineXBRL);
  if (!latest) return empty(`NO 10-K/10-Q WITH INLINE XBRL IN THE LAST 400 DAYS FOR ${rg.base}`);

  const accnNoDash = latest.accession.replace(/-/g, "");
  const reports = await secFilingReports(rg.cik, accnNoDash, ua);
  const notes = reports.filter((r) => r.menuCategory === "Notes");
  if (!notes.length) return empty(`${latest.form} ${latest.accession} LISTS NO NOTE REPORTS`);

  const terms = noteTerms(parent);
  const scored = notes
    .map((n) => ({ n, hit: terms.length ? terms.filter((t) => n.shortName.toLowerCase().includes(t)).length / terms.length : 0 }))
    .filter((x) => (parent ? x.hit > 0 : true))
    .sort((a, b) => b.hit - a.hit)
    .slice(0, 4);
  if (!scored.length) {
    return empty(`NO NOTE REPORT IN ${latest.form} MATCHES "${parent}". ITS NOTES ARE: ${notes.map((n) => n.shortName).slice(0, 12).join("; ")}`);
  }

  const rows: Array<{ label: string; values: Record<string, string> }> = [];
  for (const { n } of scored) {
    try {
      const html = await secReportHtml(rg.cik, accnNoDash, n.file, ua);
      const parsed = parseAsFiled(html, n.file, secReportUrl(rg.cik, accnNoDash, n.file));
      if (!parsed) continue;
      parsed.rows.slice(0, 80).forEach((r, i) => {
        const values: Record<string, string> = {};
        parsed.cols.forEach((c, ci) => {
          const v = r.cells[ci];
          if (v) values[c] = v;
        });
        rows.push({ label: r.label || `${n.shortName} #${i + 1}`, values });
      });
    } catch {
      /* one unreadable note does not lose the others */
    }
  }

  return {
    ok: rows.length > 0,
    error: rows.length ? undefined : `THE ${scored.length} MATCHING NOTE REPORTS DID NOT PARSE`,
    entity: sub.entityName,
    accession: latest.accession,
    form: latest.form,
    count: rows.length,
    rows,
    source: `SEC EDGAR RENDERED NOTES / ${latest.form} ${latest.accession}`,
    reportsAvailable: notes.map((n) => n.shortName).slice(0, 40),
  };
}

/** Fetch one NSE filing's XBRL instance and parse it. Exposed for reuse. */
export async function nseDoc(row: NseFilingRow) {
  const { entries } = await nseXbrlDocs([row]);
  return entries[0] ?? null;
}