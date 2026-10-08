// Filings -> statements. Framework-free so routes, pages and panels share it.
//
// The spine is SEC EDGAR's companyfacts XBRL: one request holding every tagged
// fact the registrant has ever filed. Two problems make that non-trivial:
//
//   1. us-gaap is standardized, issuer EXTENSIONS are not. Revenue might be
//      RevenueFromContractWithCustomerExcludingAssessedTax, Revenues,
//      SalesRevenueNet or something a filer invented. So every canonical line
//      carries an ORDERED fallback chain and the tag that actually won is
//      recorded, never assumed.
//
//   2. A period can be filed more than once — that is what a restatement IS.
//      Facts are deduped by accession keeping the latest `filed`, and when an
//      earlier filing of the same period disagreed, the line is flagged.
//
// Labels deliberately reproduce Yahoo's prettyLabel() vocabulary ("Total
// Revenue", "Net Income") because StatementsTerminal's 27-point machinery is
// regex-driven against those strings. Change them and 70 desks go dark.
//
// Unknown is null, never 0. A tag that was not filed renders "—".

import type { SecFact, SecFacts } from "./sec";
import type { FilingBlock, FilingLine, FilingPeriod, StatementSet, XbrlCoverage } from "./types";
import { safeDiv } from "./utils";

export type FilingUnit = "money" | "perShare" | "ratio" | "count";

export interface CanonicalLine {
  key: string;
  label: string;
  /** Ordered preference. First tag present with usable facts wins. */
  tags: string[];
  unit: FilingUnit;
}

// --------------------------------------------------------------- line maps

/**
 * Only lines a filer plausibly tags appear here. Adding a line that 95% of
 * registrants do not file would inflate `canonical` and make the coverage
 * number lie, so the map stays deliberately tight.
 */
export const CANON_IS: CanonicalLine[] = [
  { key: "revenue", label: "Total Revenue", unit: "money", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet", "RevenueFromContractWithCustomerExcludingAssessedTaxProductAndService"] },
  { key: "cost_of_revenue", label: "Cost Of Revenue", unit: "money", tags: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization", "CostOfServices"] },
  { key: "gross_profit", label: "Gross Profit", unit: "money", tags: ["GrossProfit"] },
  { key: "rnd", label: "Research And Development", unit: "money", tags: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"] },
  { key: "sga", label: "Selling General And Administrative", unit: "money", tags: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"] },
  { key: "operating_expenses", label: "Total Operating Expenses", unit: "money", tags: ["OperatingExpenses", "CostsAndExpenses", "BenefitsLossesAndExpenses"] },
  { key: "operating_income", label: "Operating Income", unit: "money", tags: ["OperatingIncomeLoss"] },
  { key: "interest_expense", label: "Interest Expense", unit: "money", tags: ["InterestExpense", "InterestExpenseNonoperating", "InterestIncomeExpenseNet", "InterestAndDebtExpense"] },
  { key: "pretax_income", label: "Pretax Income", unit: "money", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign"] },
  { key: "tax_expense", label: "Tax Provision", unit: "money", tags: ["IncomeTaxExpenseBenefit", "CurrentIncomeTaxExpenseBenefit", "IncomeTaxExpenseBenefitContinuingOperations"] },
  { key: "net_income", label: "Net Income", unit: "money", tags: ["NetIncomeLoss", "ProfitLoss"] },
  { key: "net_income_owners", label: "Net Income Common Stockholders", unit: "money", tags: ["NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLossAttributableToParent"] },
  { key: "eps_basic", label: "Basic EPS", unit: "perShare", tags: ["EarningsPerShareBasic", "IncomeLossFromContinuingOperationsPerBasicShare"] },
  { key: "eps_diluted", label: "Diluted EPS", unit: "perShare", tags: ["EarningsPerShareDiluted", "IncomeLossFromContinuingOperationsPerDilutedShare"] },
  { key: "shares_basic", label: "Basic Shares Outstanding", unit: "count", tags: ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"] },
  { key: "shares_diluted", label: "Diluted Shares Outstanding", unit: "count", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
];

export const CANON_BS: CanonicalLine[] = [
  { key: "cash", label: "Cash And Cash Equivalents", unit: "money", tags: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  { key: "short_term_investments", label: "Other Short Term Investments", unit: "money", tags: ["ShortTermInvestments", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "MarketableSecuritiesCurrent", "OtherShortTermInvestments"] },
  { key: "receivables", label: "Receivables", unit: "money", tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsNotesAndLoansReceivableNetCurrent"] },
  { key: "inventory", label: "Inventory", unit: "money", tags: ["InventoryNet", "InventoryFinishedGoodsNetOfAllowancesCustomerAdvancesAndProgressBillings"] },
  { key: "other_current_assets", label: "Other Current Assets", unit: "money", tags: ["OtherAssetsCurrent", "PrepaidExpenseAndOtherAssetsCurrent"] },
  { key: "current_assets", label: "Total Current Assets", unit: "money", tags: ["AssetsCurrent"] },
  { key: "ppe", label: "Net PPE", unit: "money", tags: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"] },
  { key: "goodwill", label: "Goodwill", unit: "money", tags: ["Goodwill"] },
  { key: "intangibles", label: "Goodwill And Intangible Assets", unit: "money", tags: ["FiniteLivedIntangibleAssetsNet", "IntangibleAssetsNetExcludingGoodwill", "GoodwillAndIntangibleAssets"] },
  { key: "lt_investments", label: "Long Term Investments", unit: "money", tags: ["LongTermInvestments", "EquityMethodInvestments", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent", "MarketableSecuritiesNoncurrent"] },
  { key: "other_noncurrent_assets", label: "Other Non Current Assets", unit: "money", tags: ["OtherAssetsNoncurrent"] },
  { key: "total_assets", label: "Total Assets", unit: "money", tags: ["Assets"] },
  { key: "payables", label: "Payables", unit: "money", tags: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent", "AccountsPayableTradeCurrent"] },
  { key: "short_term_debt", label: "Current Debt", unit: "money", tags: ["LongTermDebtCurrent", "ShortTermBorrowings", "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"] },
  { key: "current_liabilities", label: "Total Current Liabilities", unit: "money", tags: ["LiabilitiesCurrent"] },
  { key: "lt_debt", label: "Long Term Debt", unit: "money", tags: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"] },
  { key: "other_noncurrent_liabilities", label: "Other Non Current Liabilities", unit: "money", tags: ["OtherLiabilitiesNoncurrent", "OtherNoncurrentLiabilities"] },
  { key: "total_liabilities", label: "Total Liabilities", unit: "money", tags: ["Liabilities"] },
  { key: "common_equity", label: "Common Stock Equity", unit: "money", tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "PartnersCapital"] },
  { key: "retained_earnings", label: "Retained Earnings", unit: "money", tags: ["RetainedEarningsAccumulatedDeficit"] },
  { key: "shares_outstanding", label: "Common Stock Shares Outstanding", unit: "count", tags: ["CommonStockSharesOutstanding", "CommonStockSharesIssued"] },
];

export const CANON_CF: CanonicalLine[] = [
  { key: "ocf", label: "Operating Cash Flow", unit: "money", tags: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { key: "icf", label: "Investing Cash Flow", unit: "money", tags: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"] },
  { key: "fcf_fin", label: "Financing Cash Flow", unit: "money", tags: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"] },
  { key: "capex", label: "Capital Expenditure", unit: "money", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"] },
  { key: "dna", label: "Depreciation And Amortization", unit: "money", tags: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"] },
  { key: "sbc", label: "Stock Based Compensation", unit: "money", tags: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"] },
  { key: "dividends_paid", label: "Dividends Paid", unit: "money", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfDividendsMinorityInterest"] },
  { key: "buybacks", label: "Common Stock Repurchased", unit: "money", tags: ["PaymentsForRepurchaseOfCommonStock"] },
  { key: "debt_issued", label: "Issuance Of Debt", unit: "money", tags: ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt"] },
  { key: "net_change_cash", label: "Net Change In Cash", unit: "money", tags: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "IncreaseDecreaseInCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
];

/** Non-statement facts worth a panel — auditors, coverage, employee counts. */
export const CANON_NOTES_US: Array<{ key: string; label: string; tags: string[] }> = [
  { key: "auditor_opinion", label: "Auditor Opinion", tags: ["AuditorOpinion", "OpinionOnAuditingFinancialStatements"] },
  { key: "auditor_name", label: "Auditor Name", tags: ["AuditorName", "AuditorNameOfIndependentRegisteredPublicAccountingFirm"] },
  { key: "auditor_fy_end", label: "Auditor Fiscal Year End", tags: ["AuditorFiscalYearEnd"] },
  { key: "auditor_going", label: "Going Concern", tags: ["GoingConcernOpinionSubstantial Doubt"] },
  { key: "auditor_independent", label: "Auditor Independence", tags: ["AuditorIndependence"] },
  { key: "entity_shares_dei", label: "Entity Shares Outstanding (DEI)", tags: ["EntityCommonStockSharesOutstanding"] },
  { key: "public_float", label: "Public Float", tags: ["EntityPublicFloat"] },
  { key: "unrecognized_tax", label: "Unrecognized Tax Benefits", tags: ["UnrecognizedTaxBenefits"] },
  { key: "litigation", label: "Litigation Settlement", tags: ["LitigationSettlementExpense"] },
  { key: "restructuring", label: "Restructuring Charges", tags: ["RestructuringCharges", "RestructuringCosts"] },
  { key: "impairment", label: "Goodwill Impairment", tags: ["GoodwillImpairmentLoss", "GoodwillAndIntangibleAssetImpairment"] },
  { key: "debt_guarantees", label: "Guarantees Given", tags: ["GuaranteePriorYearAmount", "Guarantees"] },
];

export function canonFor(block: "is" | "bs" | "cf"): CanonicalLine[] {
  return block === "is" ? CANON_IS : block === "bs" ? CANON_BS : CANON_CF;
}

// ------------------------------------------------------------ fact plumbing

const DAY = 86400000;

function days(a: string, b: string): number | null {
  const t1 = Date.parse(a);
  const t2 = Date.parse(b);
  if (!isFinite(t1) || !isFinite(t2)) return null;
  return Math.round((t2 - t1) / DAY);
}

/** The unit key a concept's facts live under, per the requested unit class. */
function unitForKind(unit: FilingUnit, available: string[], taxPrefix: string): string | null {
  const money = available.includes("USD");
  const perShare = available.includes(`${taxPrefix}/shares`) || available.includes("USD/shares");
  const shares = available.includes("shares");
  if (unit === "money") return money ? "USD" : null;
  if (unit === "perShare") return perShare ? available.find((u) => /shares$/i.test(u) && /USD|\/shares/i.test(u)) ?? null : null;
  if (unit === "count") return shares ? "shares" : null;
  if (unit === "ratio") return available.includes("pure") ? "pure" : null;
  return null;
}

interface FactIndex {
  /** tag -> unit -> facts */
  byTag: Map<string, Record<string, SecFact[]>>;
  taxonomy: string;
}

/**
 * companyfacts is `facts -> taxonomy -> concept -> {label, units}`. This map
 * holds the UNITS BAG for each tag, which is what a resolution pass actually
 * indexes into; storing the whole concept would put "label" and "description"
 * where unit names are expected.
 */
export function indexFacts(facts: SecFacts): FactIndex {
  const byTag = new Map<string, Record<string, SecFact[]>>();
  const tax = facts.facts?.["us-gaap"] ? "us-gaap" : Object.keys(facts.facts ?? {})[0] ?? "us-gaap";
  const bag = facts.facts?.[tax] ?? {};
  for (const [tag, concept] of Object.entries(bag)) {
    const units = (concept as any)?.units;
    if (units && typeof units === "object") byTag.set(tag, units as Record<string, SecFact[]>);
  }
  return { byTag, taxonomy: tax };
}

/** Look a concept up in us-gaap, then fall back to the extension taxonomy. */
function conceptUnits(idx: FactIndex, tag: string, all: SecFacts): Record<string, SecFact[]> | null {
  const inTax = idx.byTag.get(tag);
  if (inTax) return inTax;
  for (const [tax, bag] of Object.entries(all.facts ?? {})) {
    if (tax === idx.taxonomy) continue;
    const units = (bag as any)?.[tag]?.units;
    if (units && typeof units === "object") return units as Record<string, SecFact[]>;
  }
  return null;
}

// ------------------------------------------------------------ period buckets

interface Bucket {
  period: FilingPeriod;
  /** accn -> filed -> val. Multiple filings of one period is normal. */
  vals: Map<string, { filed: string; val: number }[]>;
}

function bucketKey(end: string, kind: string): string {
  return `${kind}|${end}`;
}

/**
 * Duration facts are bucketed A (350-380d) or Q (60-100d); anything else is
 * dropped rather than mislabelled. Instant facts (no `start`) are I.
 * YTD durations (100-340d) are kept aside — they are how a Q2 or Q3 figure is
 * derived when the issuer files only cumulative columns.
 */
function bucketFacts(facts: SecFact[], kind: "A" | "Q" | "I" | "YTD") {
  const out = new Map<string, Bucket>();
  for (const f of facts) {
    if (!f || !isFinite(f.val) || !f.end) continue;
    let pk: string;
    let per: FilingPeriod;
    if (!f.start) {
      if (kind !== "I") continue;
      pk = bucketKey(f.end, "I");
      per = { end: f.end, kind: "I", accn: f.accn, form: f.form, fy: f.fy ?? null, fp: f.fp ?? null, days: null, filed: f.filed };
    } else {
      const d = days(f.start, f.end);
      if (d === null || d < 20) continue;
      const k = kind === "A" ? "A" : kind === "Q" ? "Q" : kind === "YTD" ? "YTD" : null;
      if (!k) continue;
      if (k === "A" && (d < 340 || d > 400)) continue;
      if (k === "Q" && (d < 60 || d > 100)) continue;
      if (k === "YTD" && (d < 100 || d > 340)) continue;
      pk = bucketKey(f.end, k);
      per = { end: f.end, kind: k === "YTD" ? "A" : "Q", accn: f.accn, form: f.form, fy: f.fy ?? null, fp: f.fp ?? null, days: d, filed: f.filed };
    }
    let b = out.get(pk);
    if (!b) {
      b = { period: per, vals: new Map() };
      out.set(pk, b);
    }
    const arr = b.vals.get(f.accn) ?? [];
    arr.push({ filed: f.filed, val: f.val });
    b.vals.set(f.accn, arr);
    // Keep the period metadata from the most recent filing of that period.
    if (f.filed > b.period.filed) b.period = per;
  }
  return out;
}

/** Latest filing of a period wins. Multiple disagreeing filings = restated. */
function bucketRead(b: Bucket): { val: number; restated: boolean } | null {
  const all: Array<{ filed: string; val: number; accn: string }> = [];
  for (const [accn, arr] of b.vals) for (const x of arr) all.push({ ...x, accn });
  if (!all.length) return null;
  all.sort((a, b2) => (a.filed < b2.filed ? -1 : a.filed > b2.filed ? 1 : 0));
  const latest = all[all.length - 1];
  const restated = all.some((x) => Math.abs(x.val - latest.val) > Math.max(1e-6, Math.abs(latest.val) * 1e-9));
  return { val: latest.val, restated };
}

// --------------------------------------------------------------- resolution

export interface ResolveOptions {
  /** How many annual + quarterly columns to keep. */
  annualLimit?: number;
  quarterlyLimit?: number;
  /** Forms allowed to supply periods — excludes Form 4 / S-* noise. */
  forms?: string[];
}

const DEFAULT_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "6-K"];

export interface ResolvedBlock {
  block: FilingBlock;
  periods: FilingPeriod[];
  coverage: XbrlCoverage;
}

/**
 * Resolve one canonical block. For each line the FIRST tag in the chain with
 * usable facts wins; the tag that won is reported so the desk can name it.
 * Periods are the union across resolved lines, newest first.
 */
export function resolveBlock(
  idx: FactIndex,
  all: SecFacts,
  canon: CanonicalLine[],
  kind: "A" | "Q" | "I",
  source: string,
  opts: ResolveOptions = {}
): ResolvedBlock {
  const forms = opts.forms ?? DEFAULT_FORMS;
  const limit = kind === "I" ? (opts.quarterlyLimit ?? 9) : kind === "A" ? (opts.annualLimit ?? 6) : (opts.quarterlyLimit ?? 9);

  const resolvedTags: string[] = [];
  const missing: string[] = [];
  // Only the tag that actually won each line is kept, so the desk can name it.
  const winners: Array<{ line: CanonicalLine; tag: string; buckets: Map<string, Bucket> }> = [];

  for (const line of canon) {
    let picked: { tag: string; buckets: Map<string, Bucket> } | null = null;
    for (const tag of line.tags) {
      const units = conceptUnits(idx, tag, all);
      if (!units) continue;
      const uk = unitForKind(line.unit, Object.keys(units), "USD");
      if (!uk) continue;
      const list = units[uk];
      if (!Array.isArray(list) || !list.length) continue;
      const usable = list.filter((f) => forms.includes(f.form));
      if (!usable.length) continue;
      const buckets = bucketFacts(usable, kind);
      if (!buckets.size) continue;
      picked = { tag, buckets };
      break;
    }
    if (!picked) {
      missing.push(line.key);
      continue;
    }
    resolvedTags.push(line.key);
    winners.push({ line, tag: picked.tag, buckets: picked.buckets });
  }

  // Union of periods across winners, newest first.
  const periodMap = new Map<string, FilingPeriod>();
  for (const w of winners) {
    for (const [pk, b] of w.buckets) {
      const prev = periodMap.get(pk);
      if (!prev || b.period.filed > prev.filed) periodMap.set(pk, b.period);
    }
  }
  const periods = [...periodMap.values()]
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
    .slice(0, limit);

  const lines: FilingLine[] = [];
  for (const w of winners) {
    const values: (number | null)[] = [];
    const restated: boolean[] = [];
    for (const p of periods) {
      const b = w.buckets.get(bucketKey(p.end, kind === "I" ? "I" : kind));
      const read = b ? bucketRead(b) : null;
      values.push(read ? read.val : null);
      restated.push(read ? read.restated : false);
    }
    lines.push({
      key: w.line.key,
      label: w.line.label,
      values,
      tag: w.tag,
      restated: restated.some(Boolean),
      unit: w.line.unit,
    });
  }

  const coverage: XbrlCoverage = {
    canonical: canon.length,
    resolved: resolvedTags,
    missing,
    source,
    caveat:
      missing.length === 0
        ? null
        : `${missing.length} OF ${canon.length} CANONICAL LINES ARE NOT TAGGED BY THIS REGISTRANT — THEY READ "—" BECAUSE THE FILING DOES NOT CARRY THEM, NOT BECAUSE THEY ARE ZERO`,
  };
  return { block: { lines }, periods, coverage };
}

// ------------------------------------------------------------------ notes

/**
 * Ledger rows name a schedule in trading language; note captions name it in
 * filing language. CapitalDesks asks for "Borrowings" where EDGAR captions the
 * note "Debt", so a drill-down on trading vocabulary would miss every issuer.
 * These are the equivalences that actually come up in a 10-K.
 */
export const NOTE_SYNONYMS: Record<string, string[]> = {
  borrowings: ["debt", "borrow", "long-term debt", "notes payable", "financing"],
  fixedassets: ["property", "plant", "equipment", "ppe", "fixed asset"],
  provisions: ["provision", "contingenc", "commitment", "accrual"],
  reserves: ["reserve", "retained earnings", "equity", "accumulated"],
  investments: ["investment", "securities", "fair value", "financial instruments"],
  receivables: ["receivable", "accounts receivable", "trade"],
  payables: ["payable", "accounts payable", "trade"],
  inventory: ["inventor", "inventories"],
  leases: ["lease", "right-of-use"],
  sharecapital: ["equity", "shareholders", "stockholders", "share-based", "capital"],
  taxes: ["tax", "income tax"],
  goodwill: ["goodwill", "intangible", "business combination"],
  segments: ["segment", "reportable"],
  eps: ["earnings per share", "eps"],
};

/** Expand a ledger row into search terms, synonyms first. */
export function noteTerms(parent: string): string[] {
  const base = parent.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const extra = NOTE_SYNONYMS[base.join("")] ?? [];
  return [...new Set([...extra, ...base])];
}

/** Narrative / non-statement facts, flattened to text for the notes panel. */
export interface ResolvedNote {
  key: string;
  label: string;
  value: string;
  num: number | null;
  tag: string;
  unit: string;
  end: string;
}

export function resolveNotes(idx: FactIndex, all: SecFacts, canon = CANON_NOTES_US, forms = DEFAULT_FORMS): ResolvedNote[] {
  const out: ResolvedNote[] = [];
  for (const want of canon) {
    for (const tag of want.tags) {
      const units = conceptUnits(idx, tag, all);
      if (!units) continue;
      let hit: ResolvedNote | null = null;
      for (const [unit, list] of Object.entries(units)) {
        if (!Array.isArray(list) || !list.length) continue;
        const usable = list.filter((f) => forms.includes(f.form));
        if (!usable.length) continue;
        usable.sort((a, b) => (a.filed < b.filed ? -1 : 1));
        const latest = usable[usable.length - 1];
        const raw = String(latest.val ?? "").trim();
        hit = {
          key: want.key,
          label: want.label,
          value: raw.slice(0, 400),
          num: isFinite(Number(latest.val)) ? Number(latest.val) : null,
          tag,
          unit,
          end: latest.end,
        };
        break;
      }
      if (hit) out.push(hit);
      break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ as-filed

/**
 * EDGAR R-files NEST tables and note schedules open SEVERAL of them: an
 * outer `<table class="report">` containing inner ones per section, and a debt
 * or fair-value note continuing into a second top-level table. Two traps here:
 *   - a non-greedy `[\s\S]*?</table>` stops at the first INNER close tag and
 *     returns a fragment (fine for a flat statement, fatal for a note), and
 *   - reading only the FIRST top-level table truncates a multi-table note to
 *     its opening block.
 * So every top-level `class="report"` table is extracted by depth counting and
 * all of them are parsed.
 */
function extractReportTables(html: string): string[] {
  const re = /<table[^>]*class="report"/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const open = m.index;
    let depth = 0;
    const scan = /<\/?table\b[^>]*>/gi;
    scan.lastIndex = open;
    let t: RegExpExecArray | null;
    let end = html.length;
    while ((t = scan.exec(html))) {
      if (t[0][1] === "/") {
        depth--;
        if (depth === 0) {
          end = scan.lastIndex;
          break;
        }
      } else {
        depth++;
      }
    }
    out.push(html.slice(open, end));
    re.lastIndex = end;
  }
  return out;
}

/**
 * EDGAR's rendered R-files are a `<DOCUMENT>` wrapper around one or more HTML
 * tables. The label cell carries a `defref_us-gaap_Tag` href, which gives the
 * exact tag per printed line — better provenance than the canonical chain.
 */
export function parseAsFiled(html: string, file: string, url: string): {
  shortName: string;
  caption: string;
  cols: string[];
  rows: Array<{ label: string; cells: (string | null)[]; tag: string | null }>;
  url: string;
} | null {
const tables = extractReportTables(html);
if (!tables.length) return null;

  const first = tables[0];
  const caption = decodeEntities((first.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1] ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());

  const shortName = caption.split(" - ")[0]?.slice(0, 160) ?? file;

  // Column headers are the `th.th` cells across ALL header rows. The caption
  // cell is `th.tl` and is excluded; so are the span-group labels ("3 Months
  // Ended"), which describe a COLUMN GROUP rather than a column. A balance
  // sheet has a single header row and an income statement has two, so every
  // header row is read rather than skipping the first.
  const SPAN_LABEL = /^\s*(?:\d+|three|nine|six|twelve)\s+(?:months?|years?|weeks?|days?)\s+ended\b/i;
  const cols: string[] = [];
  const rows: Array<{ label: string; cells: (string | null)[]; tag: string | null }> = [];

  // Every top-level report table contributes, so a multi-table note schedule is
  // returned whole instead of stopping at its opening block.
  for (const t of tables) {
    for (const m of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      if (!/<th/i.test(m[1])) continue;
      for (const th of m[1].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/gi)) {
        const isCaption = /\bclass\s*=\s*"[^"]*\btl\b/.test(th[1]);
        if (isCaption) continue;
        const txt = decodeEntities(th[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        if (!txt || SPAN_LABEL.test(txt)) continue;
        if (cols[cols.length - 1] === txt) continue;
        cols.push(txt);
      }
    }

    for (const m of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const tr = m[1];
      if (!/<td/i.test(tr)) continue;
      const labelCell = tr.match(/<td[^>]*class="[^"]*\bpl\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
      // `defref_us-gaap_CashAndCashEquivalentsAtCarryingValue` — the namespace
      // may contain a hyphen, so it is matched lazily up to the first underscore.
      const tag = labelCell?.[1]?.match(/defref_([A-Za-z0-9.\-]+?)_([A-Za-z0-9]+)/)?.[2] ?? null;

      // Only EMPTY spans are dropped. Statement cells end with a footnote-marker
      // `<span></span>` that must go; but note and detail cells wrap the FIGURE
      // itself in a styled `<span>`, and stripping spans wholesale silently
      // emptied every value in every note schedule.
      const clean = (s: string) =>
        decodeEntities(s.replace(/<span[^>]*>\s*<\/span>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      // Two markups live in one R-file. Statements mark the label `pl` and the
      // figures `nump`/`num`. NOTE and DETAIL schedules mark only the label
      // `pl` and leave every figure as a bare `<td>` with no class at all — so
      // a class-only selector returns a note's heading row and nothing else.
      let label: string;
      let cells: (string | null)[];
      if (labelCell) {
        label = clean(labelCell[1]);
        cells = [...tr.matchAll(/<td[^>]*class="[^"]*(?:\bnump\b|\bnum\b|\btext\b)[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)].map((td) => {
          const txt = clean(td[1]);
          return txt && txt !== "—" ? txt : null;
        });
      } else {
        const all = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((td) => clean(td[1]));
        if (!all.length) continue;
        label = all[0] ?? "";
        cells = all.slice(1).map((txt) => (txt && txt !== "—" ? txt : null));
      }
      if (!label && !cells.length) continue;
      // "[Abstract]" / "[Table]" / "[Details]" rows are XBRL navigation scaffolding
      // that EDGAR's viewer prints, not line items of the statement.
      if (/\[\s*(abstract|table|details|policynote)\s*\]\s*$/i.test(label)) continue;
      rows.push({ label: label || "—", cells, tag });
    }
  }
  if (!rows.length) return null;

  return { shortName, caption, cols, rows, url };
}


// ------------------------------------------------------------------ md&a text

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", copy: "©", reg: "®",
  trade: "™", deg: "°", bull: "•", middot: "·", times: "×", frac12: "½",
};

/**
 * Inline XBRL filings are dense with `&#160;` non-breaking spaces and
 * `&#8217;` curly quotes. Left undecoded, `Management&#8217;s Discussion` no
 * longer matches any heading pattern and the MD&A extractor reports "no
 * heading found" on a document that plainly has one.
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED_ENTITIES[n.toLowerCase()] ?? m);
}

/** Filings prose: tags to spaces, entities decoded, whitespace collapsed. */
export function htmlToProse(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------------------------------------------ derived

export interface DerivedRow {
  label: string;
  values: (number | null)[];
}

const map2 = (a: (number | null)[], b: (number | null)[], fn: (x: number, y: number) => number): (number | null)[] =>
  a.map((x, i) => (x === null || b[i] === null ? null : fn(x, b[i]!)));
const div = (a: (number | null)[], b: (number | null)[]) => map2(a, b, (x, y) => safeDiv(x, y));
const mul100 = (a: (number | null)[], b: (number | null)[]) => map2(a, b, (x, y) => safeDiv(x, y) * 100);
const add = (a: (number | null)[], b: (number | null)[]) =>
  a.map((x, i) => (x === null && b[i] === null ? null : (x ?? 0) + (b[i] ?? 0)));
const sub = (a: (number | null)[], b: (number | null)[]) =>
  a.map((x, i) => (x === null || b[i] === null ? null : x - b[i]!));
const neg = (a: (number | null)[]) => a.map((x) => (x === null ? null : -x));

/** Year-over-year, one column to the left. The first column has no prior. */
export function yoy(vals: (number | null)[]): (number | null)[] {
  return vals.map((x, i) => {
    if (i === 0) return null;
    const prev = vals[i - 1];
    if (x === null || prev === null || !prev) return null;
    return ((x - prev) / Math.abs(prev)) * 100;
  });
}

/**
 * Analytics computed from a resolved StatementSet. Every ratio is NaN-safe: a
 * missing denominator yields null so it prints "-" rather than a false 0.
 */
export function deriveLines(set: StatementSet): DerivedRow[] {
  const n = set.periods.length;
  const g = (block: FilingBlock, key: string): (number | null)[] => {
    const line = block.lines.find((l) => l.key === key);
    return line && line.values.length === n ? line.values : new Array(n).fill(null);
  };

  const rev = g(set.is, "revenue");
  const gp = g(set.is, "gross_profit");
  const ebit = g(set.is, "operating_income");
  const ni = g(set.is, "net_income");
  const tax = g(set.is, "tax_expense");
  const pretax = g(set.is, "pretax_income");

  const assets = g(set.bs, "total_assets");
  const equity = g(set.bs, "common_equity");
  const liab = g(set.bs, "total_liabilities");
  const curA = g(set.bs, "current_assets");
  const curL = g(set.bs, "current_liabilities");
  const cash = g(set.bs, "cash");

  const ocf = g(set.cf, "ocf");
  const capex = neg(g(set.cf, "capex"));
  const dna = g(set.cf, "dna");
  const sbc = g(set.cf, "sbc");

  const fcf = sub(ocf, capex);
  const debt = add(g(set.bs, "lt_debt"), g(set.bs, "short_term_debt"));
  const accruals = sub(ni, ocf);

  return [
    { label: "Revenue YoY %", values: yoy(rev) },
    { label: "Gross Margin %", values: mul100(gp, rev) },
    { label: "Operating Margin %", values: mul100(ebit, rev) },
    { label: "Net Margin %", values: mul100(ni, rev) },
    { label: "Effective Tax Rate %", values: mul100(tax, pretax) },
    { label: "OCF Margin %", values: mul100(ocf, rev) },
    { label: "Free Cash Flow", values: fcf },
    { label: "FCF Margin %", values: mul100(fcf, rev) },
    { label: "Cash Conversion OCF/NI %", values: mul100(ocf, ni) },
    { label: "D&A / Revenue %", values: mul100(dna, rev) },
    { label: "SBC / Revenue %", values: mul100(sbc, rev) },
    { label: "Return On Equity %", values: mul100(ni, equity) },
    { label: "Return On Assets %", values: mul100(ni, assets) },
    { label: "Debt / Equity", values: div(debt, equity) },
    { label: "Current Ratio", values: div(curA, curL) },
    { label: "Cash / Total Liabilities %", values: mul100(cash, liab) },
    { label: "Accruals (NI-OCF) / Assets %", values: mul100(accruals, assets) },
  ];
}

// ----------------------------------------------------------------- assembly

export interface StatementPair {
  annual: StatementSet;
  quarterly: StatementSet;
}

/**
 * Pull a block's values onto the target period axis. The balance sheet is
 * point-in-time while the income statement is a duration, so BS instants are
 * matched to the period END DATE rather than the kind - a Q3 income column and
 * the Q3 balance sheet share an end date but not a period length.
 */
function alignBlock(block: FilingBlock, srcPeriods: FilingPeriod[], axis: FilingPeriod[]): FilingBlock {
  const at = new Map<string, number>();
  srcPeriods.forEach((p, i) => {
    if (!at.has(p.end)) at.set(p.end, i);
  });
  return {
    lines: block.lines.map((l) => {
      const values: (number | null)[] = new Array(axis.length).fill(null);
      const flagged: boolean[] = new Array(axis.length).fill(false);
      axis.forEach((p, i) => {
        const j = at.get(p.end);
        if (j !== undefined) {
          values[i] = l.values[j] ?? null;
          flagged[i] = l.restated;
        }
      });
      return { ...l, values, restated: flagged.some(Boolean) };
    }),
  };
}

/**
 * One companyfacts payload, two axes. The 4MB+ download happens once and both
 * periods resolve from it - annual and quarterly share most of their tags, so
 * a second pass would be wasted work.
 */
export function buildUsStatementSets(
  facts: SecFacts,
  opts: { annualLimit?: number; quarterlyLimit?: number } = {}
): StatementPair {
  const idx = indexFacts(facts);
  const source = `SEC EDGAR XBRL / ${idx.taxonomy}`;
  const annualLimit = opts.annualLimit ?? 6;
  const quarterlyLimit = opts.quarterlyLimit ?? 9;
  const notes = resolveNotes(idx, facts);

  const build = (basis: "A" | "Q"): StatementSet => {
    const limit = basis === "A" ? annualLimit : quarterlyLimit;
    const isR = resolveBlock(idx, facts, CANON_IS, basis, source, { annualLimit, quarterlyLimit });
    // The balance sheet is an INSTANT, so its period list is every quarter-end
    // in the feed, not the fiscal-year ends the income statement uses. An
    // annual axis must therefore reach ~4x deeper to still contain its own
    // year-ends once the quarterly instants are interleaved; without this the
    // annual balance sheet matches only the one or two most recent year ends.
    const instantLimit = basis === "A" ? annualLimit * 4 + 2 : quarterlyLimit + 2;
    const bsR = resolveBlock(idx, facts, CANON_BS, "I", source, { quarterlyLimit: instantLimit });
    const cfR = resolveBlock(idx, facts, CANON_CF, basis, source, { annualLimit, quarterlyLimit });
    // An axis with no income-statement periods is unusable; borrow the balance
    // sheet instants so the block still renders where it can.
    const axis = (isR.periods.length ? isR.periods : bsR.periods).slice(0, limit);

    return {
      region: "US",
      entity: facts.entityName,
      taxonomy: idx.taxonomy,
      unit: "USD",
      currency: "USD",
      // Raw dollars as filed. The statements projection divides by 1e6 to reach
      // the "USD MILLIONS" convention every other desk in this app formats
      // against, so the divisor is declared here rather than guessed downstream.
      divisor: 1e6,
      periods: axis,
      is: alignBlock(isR.block, isR.periods, axis),
      bs: alignBlock(bsR.block, bsR.periods, axis),
      cf: alignBlock(cfR.block, cfR.periods, axis),
      coverage: { is: isR.coverage, bs: bsR.coverage, cf: cfR.coverage },
      notes,
      asOf: axis[0]?.end ?? null,
    };
  };

  return { annual: build("A"), quarterly: build("Q") };
}

/**
 * LTM = the last four single quarters, summed. Returns nothing unless all four
 * legs are present, because a three-quarter "LTM" is a lie.
 */
export function ltmFromQuarterly(q: StatementSet): { periods: FilingPeriod[]; block: FilingBlock } {
  const take = q.periods.filter((p) => p.kind === "Q").slice(0, 4);
  if (take.length < 4 || !q.periods.length) return { periods: [], block: { lines: [] } };
  const ends = new Set(take.map((p) => p.end));
  const lines: FilingLine[] = [];
  for (const l of q.is.lines.concat(q.cf.lines)) {
    if (l.unit !== "money") continue;
    const vals = l.values.filter((_, i) => ends.has(q.periods[i]?.end));
    if (vals.length < 4 || vals.some((v) => v === null)) continue;
    const sum = vals.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    lines.push({ ...l, values: [sum] });
  }
  const period: FilingPeriod = {
    end: take[0].end,
    kind: "A",
    accn: take[0].accn,
    form: "LTM",
    fy: take[0].fy,
    fp: "LTM",
    days: null,
    filed: take[0].filed,
  };
  return { periods: [period], block: { lines } };
}
