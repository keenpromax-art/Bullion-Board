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
