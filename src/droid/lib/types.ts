// Bullion Droid — shared types for the mobile surface.

import type { OHLCBar } from "@/lib/types";

export type DroidMode = "simple" | "pro" | "terminal";

export interface WatchList {
  id: string;
  name: string;
  symbols: string[];
}

export interface DroidPrefs {
  sort: "manual" | "chg" | "name";
  refreshSec: number;
  columns: 1 | 2 | 3;
}

export interface DroidNotif {
  id: string;
  kind: "ALERT" | "EVENT" | "NEWS";
  title: string;
  detail?: string;
  href?: string;
  ts: number;
  read: boolean;
}

export interface BriefCache {
  date: string; // YYYY-MM-DD
  text: string;
  ts: number;
  sections?: Record<string, string>;
}

export interface Intent {
  kind: "security" | "desk" | "compare" | "brief" | "ai";
  symbol?: string;
  funcId?: string;
  query?: string;
  symbols?: string[];
  tab?: string;
  label?: string;
}

export interface HistResp {
  symbol: string;
  range: string;
  interval: string;
  count: number;
  bars: OHLCBar[];
  resolvedFrom?: string;
  error?: string;
}

export interface MarketRow {
  sym: string;
  label: string;
  price: number;
  chgPct: number;
  spark: number[];
  ok: boolean;
}

export interface BreadthRow {
  symbol: string;
  price: number;
  dayChgPct: number;
  above20: boolean;
  volRatio: number;
  gapPct: number;
}
