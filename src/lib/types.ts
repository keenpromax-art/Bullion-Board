// Central shared types — mirrors the dataclasses / dict shapes in special.py

export interface OHLCBar {
  date: string; // ISO date
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
}

export interface Quote {
  symbol: string;
  shortName: string;
  longName?: string;
  currency: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume?: number;
  bid?: number | null;
  ask?: number | null;
  marketCap?: number | null;
  trailingPE?: number | null;
  forwardPE?: number | null;
  dividendYield?: number | null;
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
}

export interface PiotroskiResult {
  score: number;
  interpretation: string;
  cssClass: "pos" | "neg" | "neutral";
  checks: Array<{ label: string; detail: string; pass: boolean }>;
}

export interface AltmanResult {
  zScore: number;
  X1: number; X2: number; X3: number; X4: number; X5: number;
  zone: string;
  cssClass: "pos" | "neg" | "neutral";
}

export interface BeneishResult {
  mScore: number;
  risk: string;
  cssClass: "pos" | "neg" | "neutral";
  inputs: Record<string, number>;
}

export interface MonteCarloDCF {
  p10: number; p25: number; p50: number; p75: number; p90: number;
  mean: number; std: number;
  histCounts: number[]; histEdges: number[];
  nPaths: number;
  params: { wacc: number; termG: number; gMeans: number[] };
  error?: string;
}

export interface ReverseDCF {
  impliedGrowthPct: number;
  verdict: string;
  cssClass: string;
  waccUsed: number;
  terminalGUsed: number;
  error?: string;
}

export type OptionSide = "CALL" | "PUT";

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  theta: number; // per day
  vega: number;  // per 1% vol (/100 like python)
  rho: number;
  vanna: number;
  vomma: number;
  charm: number;
  speed: number;
  probITM: number;
  intrinsic: number;
  extrinsic: number;
  breakeven: number;
  moneyness: number;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  ticker: string | null;
  tags: string[];
  pinned: boolean;
  created: string;
  modified: string;
}

export interface ModuleInfo {
  id: string;
  pyFn: string;
  label: string;
  category: string;
  description: string;
  route: string;
  hidden?: boolean;
}

// ---------------------------------------------------------------- filings 117
// One normalized shape across SEC EDGAR and NSE, so the desk renders the same
// statement block whichever registry answered. Unknown is null, never 0.

/** A reporting period a statement column lines up with. */
export interface FilingPeriod {
  /** ISO end date. */
  end: string;
  /** A = annual duration, Q = quarterly duration, I = point-in-time (balance sheet). */
  kind: "A" | "Q" | "I";
  /** The accession / seq id the value was filed under. */
  accn: string;
  form: string;
  fy: number | null;
  fp: string | null;
  /** Duration in days; null for instants. */
  days: number | null;
  filed: string;
}

export interface FilingLine {
  /** Canonical key, stable across regions (e.g. "revenue", "total_assets"). */
  key: string;
  /** Yahoo-vocabulary label so the existing 27-point regex machinery matches. */
  label: string;
  values: (number | null)[];
  /** Which taxonomy tag actually produced the number. */
  tag: string | null;
  /** True when a later filing changed this period's value (a restatement). */
  restated: boolean;
  /** "ratio" for per-share and coverage lines, which never scale. */
  unit: "money" | "perShare" | "ratio" | "count";
}

export interface FilingBlock {
  lines: FilingLine[];
}

export interface XbrlCoverage {
  /** How many canonical lines this block defines. */
  canonical: number;
  resolved: string[];
  missing: string[];
  /** e.g. "SEC EDGAR XBRL / us-gaap" or "NSE INTEGRATED FILING / in-capmkt". */
  source: string;
  caveat: string | null;
}

export interface StatementSet {
  region: "US" | "IN";
  entity: string;
  taxonomy: string;
  /** Human label for `unit`, e.g. "USD" or "INR CRORE". */
  unit: string;
  currency: string;
  /**
   * What to divide a raw money value by to reach `unit`. Declared by the
   * source rather than inferred from the ticker: US filings arrive in raw
   * dollars (1e6), while the NSE parser has ALREADY converted rupees to crore
   * (1). Inferring it from `indian` double-divided every Indian figure by 1e7
   * and printed revenue as 0.03.
   */
  divisor: number;
  /** Ordered, newest first: the filings desk reads this way. */
  periods: FilingPeriod[];
  is: FilingBlock;
  bs: FilingBlock;
  cf: FilingBlock;
  coverage: { is: XbrlCoverage; bs: XbrlCoverage; cf: XbrlCoverage };
  /** Narrative + non-statement facts worth showing (auditor, ratios, text). */
  notes: FilingNote[];
  asOf: string | null;
}

export interface FilingNote {
  key: string;
  label: string;
  value: string;
  /** Numeric value when the disclosure is a number rather than prose. */
  num: number | null;
}

/** A filing as it appears in the unified cross-region index. */
export interface FilingRecord {
  id: string;
  /** YYYY-MM-DD. */
  date: string;
  /** 10-K / 10-Q / 20-F / Integrated Filing- Financials / … */
  form: string;
  /** Period the filing reports on, YYYY-MM-DD. */
  period: string;
  title: string;
  accession: string;
  xbrl: boolean;
  pdf: string | null;
  html: string | null;
  /** NSE disclosure family, or a derived bucket for US forms. */
  family: string;
  size: number | null;
  audited: string | null;
  consolidated: string | null;
}

/** A statement exactly as the issuer printed it, from EDGAR's R-files. */
export interface AsFiledTable {
  report: string;
  shortName: string;
  caption: string;
  /** Column headers, period labels, in print order. */
  cols: string[];
  rows: Array<{ label: string; cells: (string | null)[]; tag: string | null }>;
  url: string;
}

export interface AsFiledSet {
  tables: AsFiledTable[];
  /** Direct archive download of every statement + note as xlsx. */
  xlsx: string | null;
  caveat: string | null;
}
