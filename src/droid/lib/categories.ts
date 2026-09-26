// Bullion Droid — the 86-desk catalog compressed into 7 touch-friendly groups.
// Terminal codes stay hidden unless mode === "terminal" (spec §35/§16).

import { MODULES } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";

// modules.ts keeps ModuleInfo private — derive the shape from the registry.
export type ModuleInfo = (typeof MODULES)[number];

export type DeskGroup =
  | "PRICE"
  | "FUNDAMENTALS"
  | "VALUATION"
  | "DERIVATIVES"
  | "RISK"
  | "RESEARCH"
  | "AI & TOOLS";

export const GROUP_ORDER: DeskGroup[] = [
  "PRICE",
  "FUNDAMENTALS",
  "VALUATION",
  "DERIVATIVES",
  "RISK",
  "RESEARCH",
  "AI & TOOLS",
];

export const GROUP_ICON: Record<DeskGroup, string> = {
  PRICE: "📈",
  FUNDAMENTALS: "💰",
  VALUATION: "💎",
  DERIVATIVES: "🔗",
  RISK: "⚠",
  RESEARCH: "📰",
  "AI & TOOLS": "🤖",
};

export const GROUP_BLURB: Record<DeskGroup, string> = {
  PRICE: "CHART · TECHNICALS · MOMENTUM · MODELS",
  FUNDAMENTALS: "STATEMENTS · RATIOS · DUPONT · OWNERSHIP",
  VALUATION: "DCF · LBO · MULTIPLES",
  DERIVATIVES: "OPTION CHAIN · GREEKS · STRATEGIES",
  RISK: "VAR · DRAWDOWN · BETA · VOLATILITY",
  RESEARCH: "NEWS · EVENTS · SCREENERS · MARKET",
  "AI & TOOLS": "AI CHAT · CALCULATORS · READERS · SETTINGS",
};

// Category → group (terminal-native desks handled per-ID below).
const CATEGORY_GROUP: Record<string, DeskGroup> = {
  Technical: "PRICE",
  Intraday: "PRICE",
  Statistical: "PRICE",
  ML: "PRICE",
  Backtest: "PRICE",
  Fundamental: "FUNDAMENTALS",
  Portfolio: "FUNDAMENTALS",
  Valuation: "VALUATION",
  Options: "DERIVATIVES",
  Risk: "RISK",
  Market: "RESEARCH",
  News: "RESEARCH",
  Screener: "RESEARCH",
  Reading: "RESEARCH",
  Terminal: "RESEARCH",
  AI: "AI & TOOLS",
  Tools: "AI & TOOLS",
};

// Individual overrides so terminal-native desks land where a user expects.
const ID_GROUP: Record<string, DeskGroup> = {
  "101": "FUNDAMENTALS", // Portfolio blotter
  "102": "AI & TOOLS", // Price alerts
  "103": "RESEARCH", // Compare
  "104": "RISK", // Correlation
  "105": "RESEARCH", // Seasonality
  "106": "RESEARCH", // History & actions
  "107": "RESEARCH", // Breadth & movers
  "108": "AI & TOOLS", // Calculators
  "109": "RESEARCH", // Pre-market
  "110": "DERIVATIVES", // Option chain
  "111": "RESEARCH", // Macro
  "112": "FUNDAMENTALS", // Analyst ratings
  "113": "VALUATION", // Capital structure
  "114": "AI & TOOLS", // Nexus CFA
  "115": "AI & TOOLS", // Book reader
};

export function groupOf(m: ModuleInfo): DeskGroup {
  return ID_GROUP[m.id] ?? CATEGORY_GROUP[m.category] ?? "RESEARCH";
}

export interface DeskEntry {
  m: ModuleInfo;
  code: string;
  group: DeskGroup;
}

export const ALL_DESKS: DeskEntry[] = MODULES.filter((m) => !m.hidden)
  .map((m) => ({ m, code: funcCode(m.id), group: groupOf(m) }))
  .sort((a, b) => a.m.label.localeCompare(b.m.label));

export const DESK_GROUPS: Record<DeskGroup, DeskEntry[]> = GROUP_ORDER.reduce(
  (acc, g) => {
    acc[g] = ALL_DESKS.filter((d) => d.group === g);
    return acc;
  },
  {} as Record<DeskGroup, DeskEntry[]>
);

/** Curated one-tap quick actions attached to every security (spec §17). */
export interface QuickAction {
  key: string;
  label: string;
  icon: string;
  href?: string;
  funcId?: string;
  tab?: string;
  sheet?: "alert" | "compare" | "watch" | "ai";
}

export const QUICK_ACTIONS: QuickAction[] = [
  { key: "watch", label: "WATCH", icon: "★", sheet: "watch" },
  { key: "alert", label: "ALERT", icon: "⏰", sheet: "alert" },
  { key: "compare", label: "COMPARE", icon: "⇄", sheet: "compare" },
  { key: "chart", label: "CHART", icon: "📈", tab: "chart" },
  { key: "funda", label: "FUNDAMENTALS", icon: "📊", tab: "fundamentals" },
  { key: "tech", label: "TECHNICALS", icon: "⚙", tab: "technicals" },
  { key: "valuation", label: "VALUATION", icon: "🧮", tab: "valuation" },
  { key: "news", label: "NEWS", icon: "📰", tab: "news" },
  { key: "options", label: "OPTIONS", icon: "🔗", funcId: "110" },
  { key: "strat", label: "STRATEGIES", icon: "🎯", funcId: "70" },
  { key: "ai", label: "ASK AI", icon: "🤖", sheet: "ai" },
];
