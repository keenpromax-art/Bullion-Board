// NSE India filings -> statements. Framework-free, regex-based like the
// screener.in scrapers in api/statements and api/ownership.
//
// WHAT THE LIVE FEED ACTUALLY CONTAINS (verified against RELIANCE and INFY
// integrated filings): the INTEGRATED_FILING_INDAS instance carries EPS, auditor
// identity and opinion flags, coverage ratios, segment revenue/assets/
// liabilities, OCI and comprehensive income, and large narrative text blocks.
// It does NOT carry revenue, total assets, inventories, payables or the expense
// stack. Those numbers live in the filed PDF.
//
// So this module extracts what is genuinely tagged and says plainly what is
// not. It never fills a core statement line from an unsourced guess: a missing
// Indian line reads "—" and the coverage panel names the count.
//
// A single filing covers ONE period, so the desk's time series is assembled by
// merging several filings into one axis — see mergeIndiaFilings.
//
// The legacy `in-bse-fin` taxonomy (FY2015-16 to the 2025 SEBI cutover) did
// carry the core statements, so those tag names are mapped too: where an issuer
// filed them, they resolve.

import type { FilingBlock, FilingLine, FilingNote, FilingPeriod, StatementSet, XbrlCoverage } from "./types";

// ------------------------------------------------------------------- parser

export interface IndiaFact {
  /** Local tag name, namespace stripped. */
  name: string;
  context: string;
  unit: string;
  /** Numeric value after scale + sign are applied. Null for text blocks. */
  num: number | null;
  text: string | null;
  /** True when the fact sits in a dimensioned (segment / expense-head) context. */
  dimensional: boolean;
}

export interface IndiaContext {
  id: string;
  instant: string | null;
  start: string | null;
  end: string | null;
  /** Consolidated / Standalone, as the issuer labelled the filing. */
  basis: "Consolidated" | "Standalone" | null;
  /** True when the context carries any xbrldi dimension member. */
  dimensional: boolean;
}

export interface IndiaDoc {
  contexts: Map<string, IndiaContext>;
  facts: IndiaFact[];
  taxonomy: string;
  scripCode: string | null;
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

const DAY = 86400000;

/**
 * NSE instance documents carry no `ix:nonFraction` wrapper and every fact is
 * namespace-qualified (`<in-capmkt:RevenueFromOperations …>`), so the element
 * pattern must accept an optional `prefix:` and the backreference must match
 * the qualified name while the CANONICAL lookup uses the local name.
 *   <in-capmkt:RevenueFromOperations contextRef="OneD" unitRef="INR" decimals="-7">482110000000</…>
 *   <in-capmkt:AuditorsFirmName contextRef="D_Auditor1">Deloitte Haskins &amp; Sells</…>
 * `scale` and `sign` are applied when present (XBRL-standard); NSE usually
 * files absolute rupees with `decimals="-7"` and no scale, so values arrive
 * as filed and are scaled to the desk's unit at the boundary instead.
 *
 * The body pattern is `[^<]*`, not a lazy any-char: an XBRL fact is a leaf, so
 * it can never contain a child element. A lazy body lets a self-closing tag
 * earlier in the document pair with a later closing tag and swallow the whole
 * instance, which is exactly what it did here — one match for a 46KB file.
 */
const FACT_RE = /<((?:[A-Za-z][\w.\-]*:)?[A-Za-z][\w.\-]*)((?:\s+[^>]*)?)>([^<]*)<\/\1\s*>/g;

export function parseIndiaXbrl(xml: string): IndiaDoc {
  const contexts = new Map<string, IndiaContext>();

  for (const m of xml.matchAll(/<(?:\w+:)?context\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/gi)) {
    const id = m[1];
    const body = m[2];
    const instant = body.match(/<(?:\w+:)?instant>([^<]+)</i)?.[1]?.trim() ?? null;
    const start = body.match(/<(?:\w+:)?startDate>([^<]+)</i)?.[1]?.trim() ?? null;
    const end = body.match(/<(?:\w+:)?endDate>([^<]+)</i)?.[1]?.trim() ?? null;
    // Only a basis/segment axis marks the context as dimensional; an ordinary
    // date period does not, so `OneD` is undimensioned and a segment is not.
    const dims = [...body.matchAll(/dimension="(?:\w+:)?([^"]+)">(?:\w+:)?([A-Za-z0-9_]+)Member/gi)].map((d) => d[2].toLowerCase());
    const dimText = dims.join(" ");
    contexts.set(id, {
      id,
      instant,
      start,
      end,
      basis: /consolidated/i.test(dimText) ? "Consolidated" : /standalone/i.test(dimText) ? "Standalone" : null,
      dimensional: dims.length > 0,
    });
  }

  const facts: IndiaFact[] = [];
  for (const m of xml.matchAll(FACT_RE)) {
    const qname = m[1];
    if (/^(xbrli|xbrldi|link|xlink)$/i.test(qname.split(":")[0])) continue;
    const name = localName(qname);
    if (/^(context|unit|measure|divide|unitNumerator|unitDenominator|schemaRef)$/i.test(name)) continue;
    const ctx = attr(m[2], "contextRef");
    if (!ctx) continue;

    const unit = attr(m[2], "unitRef");
    const scaleAttr = attr(m[2], "scale");
    const sign = attr(m[2], "sign");
    const raw = stripTags(m[3]);
    if (!raw && !unit) continue;

    let num: number | null = null;
    if (unit) {
      const cleaned = raw.replace(/,/g, "").replace(/\s/g, "");
      if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
        let v = Number(cleaned);
        const scale = scaleAttr !== null ? Number(scaleAttr) : 0;
        if (isFinite(scale) && scale !== 0) v = v * Math.pow(10, scale);
        if (sign === "-") v = -v;
        num = isFinite(v) ? v : null;
      }
    }
    const c = contexts.get(ctx);
    facts.push({ name, context: ctx, unit: unit ?? "", num, text: raw.slice(0, 4000), dimensional: !!c && c.dimensional });
  }

  const taxonomy = xml.match(/xmlns:([A-Za-z0-9\-]+)="http:\/\/www\.sebi\.gov\.in\/xbrl/i)?.[1] ?? "in-capmkt";
  const scripCode = xml.match(/ScripCode"[^>]*>([^<]+)</)?.[1]?.trim() ?? null;

  return { contexts, facts, taxonomy, scripCode };
}

// ------------------------------------------------------- NSE tag -> canonical

/**
 * Local tag names, in preference order, taken from live RELIANCE and INFY
 * integrated filings. The same line item is filed under different prefixes by
 * different eras (in-bse-fin legacy vs in-capmkt SEBI integrated), which is why
 * matching is on the local name and never on the qualified name.
 *
 * `ContinuingAndDiscontinued` outranks `ContinuingOperations` for EPS because
 * it is the headline total; the continuing-only figure is the fallback for an
 * issuer with no discontinued operation to report separately.
 */
export const NSE_IS_TAGS: Record<string, string[]> = {
  revenue: ["RevenueFromOperations", "RevenueFromContractWithCustomerExcludingAssessedTax", "TotalRevenueFromOperations", "Revenue", "SalesRevenue"],
  cost_of_materials: ["CostOfMaterialsConsumed", "CostOfGoodsSold", "CostOfMaterialsConsumedRawMaterials"],
  purchases: ["PurchasesOfStockInTrade", "PurchasesOfGoods"],
  other_income: ["OtherIncome"],
  employee_cost: ["EmployeeBenefitExpense", "EmployeeCosts", "SalariesAndWages"],
  finance_cost: ["FinanceCosts", "FinanceCost"],
  depreciation: ["DepreciationDepletionAndAmortisationExpense", "DepreciationAmortisationAndDepletionExpense", "DepreciationAndAmortisationExpense", "DepreciationAmortisationExpense"],
  other_expenses: ["OtherExpenses"],
  total_income: ["Income", "TotalIncome"],
  total_expenses: ["Expenses", "TotalExpenses", "TotalOtherExpenses"],
  ebit: ["ProfitBeforeExceptionalItemsAndTax", "EBITBeforeFinanceCostsTaxDepreciationAmortisationAndExceptionalItems", "ProfitLossFromOperatingActivitiesBeforeFinanceCostsAndExceptionalItems"],
  pbt: ["ProfitBeforeTax", "ProfitLossBeforeTax"],
  tax: ["TaxExpense", "CurrentTaxExpense"],
  pat: ["ProfitLossForPeriod", "ProfitLoss", "ProfitAfterTax", "ProfitLossForPeriodFromContinuingOperations"],
  pat_owners: ["ProfitOrLossAttributableToOwnersOfParent", "ProfitLossAttributableToOwnersOfParent"],
  pat_nci: ["ProfitOrLossAttributableToNonControllingInterests", "ProfitLossAttributableToNonControllingInterests"],
  oci: ["OtherComprehensiveIncomeNetOfTaxes", "OtherComprehensiveIncome"],
  eps_basic: ["BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "BasicEarningsPerShare", "BasicEarningsLossPerShareFromContinuingOperations"],
  eps_diluted: ["DilutedEarningsLossPerShareFromContinuingAndDiscontinuedOperations", "DilutedEarningsPerShare", "DilutedEarningsLossPerShareFromContinuingOperations"],
  paid_up: ["PaidUpValueOfEquityShareCapital", "PaidUpEquityCapital"],
  face_value: ["FaceValueOfEquityShareCapital", "FaceValuePerShare"],
};

export const NSE_BS_TAGS: Record<string, string[]> = {
  cash: ["CashAndCashEquivalents", "CashAndCashEquivalentsAtBank"],
  receivables: ["TradeReceivables", "TradeReceivablesAndOtherDebts"],
  inventories: ["Inventories", "Inventory"],
  current_assets: ["TotalCurrentAssets", "CurrentAssets"],
  ppe: ["PropertyPlantAndEquipment", "PropertyPlantAndEquipmentNet"],
  goodwill: ["Goodwill"],
  noncurrent_assets: ["TotalNonCurrentAssets", "NonCurrentAssets"],
  total_assets: ["TotalAssets", "Assets"],
  equity_share_capital: ["EquityShareCapital", "PaidUpEquityCapital"],
  equity: ["TotalEquity", "Equity", "TotalShareholdersEquity"],
  trade_payables: ["TradePayables", "TradePayablesAndOtherCreditors"],
  current_liabilities: ["TotalCurrentLiabilities", "CurrentLiabilities"],
  borrowings: ["TotalBorrowings", "Borrowings", "LongTermBorrowings"],
  noncurrent_liabilities: ["TotalNonCurrentLiabilities", "NonCurrentLiabilities"],
  total_liabilities: ["TotalLiabilities", "Liabilities"],
};

export const NSE_CF_TAGS: Record<string, string[]> = {
  ocf: ["NetCashFlowsFromUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"],
  capex: ["PurchaseOfPropertyPlantAndEquipment", "PaymentsForPurchaseOfFixedAssets"],
  dividends_paid: ["DividendsPaid", "PaymentOfDividend"],
  net_change_cash: ["NetIncreaseDecreaseInCashAndCashEquivalents", "NetChangeInCashAndCashEquivalents"],
};

/** [canonicalKey, label, unitClass] in print order. */
const IS_ORDER: Array<[string, string, FilingLine["unit"]]> = [
  ["revenue", "Total Revenue", "money"],
  ["other_income", "Other Income", "money"],
  ["total_income", "Total Income", "money"],
  ["cost_of_materials", "Cost Of Materials Consumed", "money"],
  ["purchases", "Purchases Of Stock In Trade", "money"],
  ["employee_cost", "Employee Benefit Expense", "money"],
  ["finance_cost", "Finance Costs", "money"],
  ["depreciation", "Depreciation And Amortisation", "money"],
  ["other_expenses", "Other Expenses", "money"],
  ["total_expenses", "Total Expenses", "money"],
  ["ebit", "Operating Income", "money"],
  ["pbt", "Pretax Income", "money"],
  ["tax", "Tax Provision", "money"],
  ["pat", "Net Income", "money"],
  ["pat_owners", "Net Income Owners", "money"],
  ["pat_nci", "Net Income Non-Controlling", "money"],
  ["oci", "Other Comprehensive Income", "money"],
  ["eps_basic", "Basic EPS", "perShare"],
  ["eps_diluted", "Diluted EPS", "perShare"],
  ["face_value", "Face Value", "money"],
  ["paid_up", "Paid Up Equity Capital", "money"],
];

const BS_ORDER: Array<[string, string, FilingLine["unit"]]> = [
  ["cash", "Cash And Cash Equivalents", "money"],
  ["receivables", "Receivables", "money"],
  ["inventories", "Inventory", "money"],
  ["current_assets", "Total Current Assets", "money"],
  ["ppe", "Net PPE", "money"],
  ["goodwill", "Goodwill", "money"],
  ["noncurrent_assets", "Total Non Current Assets", "money"],
  ["total_assets", "Total Assets", "money"],
  ["equity_share_capital", "Equity Share Capital", "money"],
  ["equity", "Total Equity", "money"],
  ["trade_payables", "Trade Payables", "money"],
  ["current_liabilities", "Total Current Liabilities", "money"],
  ["borrowings", "Total Borrowings", "money"],
  ["noncurrent_liabilities", "Total Non Current Liabilities", "money"],
  ["total_liabilities", "Total Liabilities", "money"],
];

const CF_ORDER: Array<[string, string, FilingLine["unit"]]> = [
  ["ocf", "Operating Cash Flow", "money"],
  ["capex", "Capital Expenditure", "money"],
  ["dividends_paid", "Dividends Paid", "money"],
  ["net_change_cash", "Net Change In Cash", "money"],
];

const TAGS_FOR: Record<string, Record<string, string[]>> = { is: NSE_IS_TAGS, bs: NSE_BS_TAGS, cf: NSE_CF_TAGS };

// --------------------------------------------------------------- resolution

interface IndiaEntry {
  doc: IndiaDoc;
  /** Consolidated or Standalone, from the filing index rather than the doc. */
  basis: "Consolidated" | "Standalone";
  /** Filing timestamp, used to break ties when the same period was filed twice. */
  filedAt: string;
  accession: string;
  /** "Audited" / "Un-Audited" as NSE labelled the row. */
  audited?: string | null;
}

/**
 * NSE files absolute rupees; the desk shows Indian money in ₹ Crore, the same
 * divisor api/statements uses for its Yahoo leg. Applied once, at the edge, so
 * every downstream consumer sees the unit it says it does.
 */
const RUPEE_SCALE = 1e7;

function toCrore(v: number): number {
  return v / RUPEE_SCALE;
}

function factsFor(doc: IndiaDoc, basis: "Consolidated" | "Standalone"): IndiaFact[] {
  return doc.facts.filter((f) => {
    const c = doc.contexts.get(f.context);
    if (!c) return false;
    return c.basis === basis || c.basis === null;
  });
}

/**
 * tag -> value for one filing, undimensioned facts winning over segment facts.
 * Money (INR) and non-money (INRPerShare, pure ratios) are kept apart so a
 * per-share figure is never divided by a crore scale factor.
 */
interface TagValues {
  money: Map<string, number>;
  other: Map<string, number>;
}

function tagValues(facts: IndiaFact[]): TagValues {
  const plain = new Map<string, number>();
  const dim = new Map<string, number>();
  const plainOther = new Map<string, number>();
  const dimOther = new Map<string, number>();
  for (const f of facts) {
    if (f.num === null) continue;
    const isMoney = /^INR$/.test(f.unit);
    const target = f.dimensional ? (isMoney ? dim : dimOther) : isMoney ? plain : plainOther;
    if (!target.has(f.name)) target.set(f.name, f.num);
  }
  const money = new Map<string, number>();
  for (const [k, v] of new Map([...dim, ...plain])) money.set(k, toCrore(v));
  return { money, other: new Map([...dimOther, ...plainOther]) };
}

function periodOf(doc: IndiaDoc, basis: "Consolidated" | "Standalone"): FilingPeriod | null {
  // Prefer an instant context (a balance-sheet date); fall back to the longest
  // duration declared, which is the annual filing.
  let best: { end: string; kind: "A" | "Q" | "I"; days: number } | null = null;
  for (const c of doc.contexts.values()) {
    if (c.basis !== basis && c.basis !== null) continue;
    const end = c.instant ?? c.end;
    if (!end) continue;
    if (c.instant) {
      const days = 0;
      if (!best || days > best.days) best = { end, kind: "I", days };
      continue;
    }
    if (!c.start) continue;
    const days = Math.round((Date.parse(end) - Date.parse(c.start)) / DAY);
    if (!isFinite(days) || days < 20) continue;
    if (!best || days > best.days) best = { end, kind: days >= 340 ? "A" : "Q", days };
  }
  if (!best) return null;
  return { end: best.end, kind: best.kind === "I" ? "I" : "Q", accn: "", form: "Integrated Filing", fy: null, fp: null, days: best.days || null, filed: best.end };
}

/**
 * Merge several NSE filings into one time series. Each entry contributes its
 * own period; per period the entry carrying the MOST statement facts wins,
 * with the later filing breaking ties.
 *
 * Ranking by filing time alone is wrong: NSE files a Governance document
 * (auditor names, peer-review flags, declarations — useful, but no statement
 * lines) AFTER the Financials document for the same period end. It would win
 * every race and blank the whole income statement. Evidence beats recency.
 */
export function mergeIndiaFilings(
  entries: IndiaEntry[],
  opts: { basis: "Consolidated" | "Standalone"; periodLimit?: number; companyName?: string; unitLabel?: string }
): StatementSet {
  const basis = opts.basis;
  const periodLimit = opts.periodLimit ?? 8;

  // end -> { period, vals, filedAt, accession, weight }
  const byEnd = new Map<
    string,
    { period: FilingPeriod; vals: TagValues; filedAt: string; accession: string; weight: number }
  >();
  for (const e of entries) {
    if (e.basis !== basis) continue;
    const p = periodOf(e.doc, basis);
    if (!p) continue;
    const vals = tagValues(factsFor(e.doc, basis));
    const weight = vals.money.size;
    const prev = byEnd.get(p.end);
    if (prev && (prev.weight > weight || (prev.weight === weight && prev.filedAt >= e.filedAt))) continue;
    byEnd.set(p.end, {
      period: { ...p, accn: e.accession, filed: e.filedAt },
      vals,
      filedAt: e.filedAt,
      accession: e.accession,
      weight,
    });
  }

  const periods: FilingPeriod[] = [...byEnd.values()]
    .sort((a, b) => (a.period.end < b.period.end ? 1 : -1))
    .slice(0, periodLimit)
    .map((x) => x.period);
  const ordered = periods.map((p) => byEnd.get(p.end)!);

  const buildBlock = (order: Array<[string, string, FilingLine["unit"]]>, block: "is" | "bs" | "cf"): FilingBlock => {
    const tags = TAGS_FOR[block];
    const lines: FilingLine[] = order.map(([key, label, unit]) => {
      // Money lines read the crore-scaled map; EPS and ratios read the raw one.
      const bag = (u: FilingLine["unit"]) => (u === "money" ? ordered.map((o) => o.vals.money) : ordered.map((o) => o.vals.other));
      const grid = bag(unit);
      let tag: string | null = null;
      const values: (number | null)[] = new Array(periods.length).fill(null);
      for (const t of tags[key] ?? []) {
        if (!grid.some((g) => g.has(t))) continue;
        tag = t;
        grid.forEach((g, i) => {
          const v = g.get(t);
          values[i] = v === undefined ? null : v;
        });
        break;
      }
      return { key, label, values, tag, restated: false, unit };
    });
    return { lines };
  };

  const cov = (block: FilingBlock): XbrlCoverage => {
    const resolved = block.lines.filter((l) => l.tag).map((l) => l.key);
    const missing = block.lines.filter((l) => !l.tag).map((l) => l.key);
    return {
      // The denominator is THIS block's own line count, not the US canonical
      // count — the NSE map is a different (larger) list and comparing across
      // them produced coverage readings above 100%.
      canonical: block.lines.length,
      resolved,
      missing,
      source: `NSE INTEGRATED FILING / ${entries[0]?.doc.taxonomy ?? "in-capmkt"}`,
      caveat: missing.length
        ? `${missing.length} OF ${block.lines.length} MAPPED NSE LINES WERE NOT TAGGED IN ANY OF THE ${periods.length} FILINGS READ. THEY READ "—" BECAUSE THE INTEGRATED FILING DOES NOT CARRY THAT ELEMENT, NOT BECAUSE THE FIGURE IS ZERO`
        : null,
    };
  };

  const isBlock = buildBlock(IS_ORDER, "is");
  const bsBlock = buildBlock(BS_ORDER, "bs");
  const cfBlock = buildBlock(CF_ORDER, "cf");

  return {
    region: "IN",
    entity: opts.companyName ?? "",
    taxonomy: entries[0]?.doc.taxonomy ?? "in-capmkt",
    unit: opts.unitLabel ?? "INR CRORE",
    currency: "INR",
    // tagValues() has already applied RUPEE_SCALE, so these ARE crore.
    divisor: 1,
    periods,
    is: isBlock,
    bs: bsBlock,
    cf: cfBlock,
    coverage: {
      is: cov(isBlock),
      bs: cov(bsBlock),
      cf: cov(cfBlock),
    },
    notes: indiaNotes(entries, basis),
    asOf: periods[0]?.end ?? null,
  };
}

/**
 * The disclosures NSE actually tags, and the ones that fill the desk's auditor,
 * qualification, coverage and segment panels directly.
 *
 * Searched across ALL filings newest-first rather than only the winning one:
 * the auditor's name and peer-review flags live in the Governance document,
 * which is filed separately from the Financials document and never wins the
 * statement race. A two-year-old narrative block is ignored because the search
 * is date-ordered.
 */
export function indiaNotes(entries: IndiaEntry[], basis: "Consolidated" | "Standalone"): FilingNote[] {
  const ordered = entries.filter((e) => e.basis === basis).sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1));
  if (!ordered.length) return [];
  const facts = ordered.flatMap((e) => factsFor(e.doc, basis));

  const text = (re: RegExp): string | null => {
    for (const f of facts) if (f.num === null && f.text && re.test(f.name)) return f.text;
    return null;
  };
  // Money facts are reported in ₹ Crore to match the statement blocks; ratios
  // and per-share figures come from the pure / INRPerShare units and stay raw.
  const num = (re: RegExp, money = false): number | null => {
    for (const f of facts) {
      if (f.num === null || !re.test(f.name)) continue;
      if (!money) return f.num;
      if (/^INR$/.test(f.unit)) return toCrore(f.num);
    }
    return null;
  };
  const audited = ordered[0]?.audited ?? null;

  const out: FilingNote[] = [];
  const push = (key: string, label: string, value: string | null, numv: number | null) => {
    if (value === null && numv === null) return;
    out.push({ key, label, value: value ?? String(numv), num: numv });
  };

  push("auditor_name", "Auditor Firm Name", text(/Auditors?FirmName/i), null);
  push("auditor_domain", "Auditor Domain", text(/AuditorDomain/i), null);
  push("peer_review", "Peer Review Certificate Held", text(/HoldsAValidPeerReviewCertificate/i), null);
  push("auditor_qualification", "Auditor Qualifications", text(/AuditorQualification/i), null);
  push("audit_opinion", "Audit Opinion", text(/AuditOpinion|OpinionOnFinancialStatements/i), null);
  push("basis_of_prep", "Basis of Preparation", text(/BasisOfPreparation|BasisOfAccounting/i), null);
  push("going_concern", "Going Concern Flag", text(/GoingConcern/i), null);
  push("audited_flag", "Audited Flag As Filed", text(/WhetherResultsAreAudited/i), null);
  /**
 * Pure-unit ratios from the SEBI taxonomy carry `unitRef="pure"` and no scale,
 * and the filed values are not always what an analyst would expect — RELIANCE's
 * Q1 FY27 DebtEquityRatio is filed as 0.004, which is not a usable gearing
 * ratio. They are shown exactly as filed and flagged, because substituting our
 * own arithmetic for a filed number would be inventing data.
 */
push("dbt_equity", "Debt / Equity Ratio (AS FILED)", null, num(/^DebtEquityRatio$/i));
  push("dscr", "Debt Service Coverage Ratio (AS FILED)", null, num(/DebtServiceCoverageRatio/i));
  push("iscr", "Interest Service Coverage Ratio (AS FILED)", null, num(/InterestServiceCoverageRatio/i));
  push("oci", "Other Comprehensive Income ₹ Cr", null, num(/^OtherComprehensiveIncomeNetOfTaxes$/i, true));
  push("oci_reclass", "OCI Reclass Items ₹ Cr", null, num(/AmountOfItemThatWillBe/i, true));
  push("segment_note", "Segment Note", text(/DisclosureOfNotesOnSegments/i), null);
  push("results_note", "Results Note", text(/DisclosureOfNotesOnFinancialResults/i), null);
  push("filing_basis", "Audit Status As Filed", audited, null);
  push("source_seq", "Newest NSE Sequence Id", ordered[0]?.accession || null, null);

// Segment revenue / assets / PBT. The taxonomy member names are indices
// (Reportable1Member, Reportable2Member) with no label attached, so these are
// numbered in file order and NOT presented as the issuer's segment names —
// guessing "O2C / Digital / Retail" from an index would be invention.
const seen = new Set<string>();
for (const f of facts) {
  if (f.num === null || !/SegmentRevenue|SegmentAssets|SegmentProfitLoss/.test(f.name)) continue;
  const dim = f.context.match(/Reportable(\d+)/)?.[1];
  const what = /SegmentAssets/.test(f.name) ? "ASSETS" : /SegmentProfitLoss/.test(f.name) ? "PBT" : "REVENUE";
  // No dimension means the group total, which includes inter-segment revenue
  // and therefore exceeds consolidated revenue. It is labelled, not hidden.
  const key = `${what}|${dim ?? "GROUP"}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const cr = /^INR$/.test(f.unit) ? toCrore(f.num) : f.num;
  const label = dim ? `SEGMENT ${what} ₹ Cr · SEG ${dim}` : `SEGMENT ${what} ₹ Cr · GROUP (INCL INTER-SEGMENT)`;
  out.push({ key, label, value: cr.toFixed(2), num: cr });
}

  return out;
}

export type { IndiaEntry };