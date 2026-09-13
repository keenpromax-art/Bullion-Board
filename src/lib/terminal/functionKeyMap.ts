// Curated F1–F12 mapping across module categories (section 0).
// Covers: equity/chart overview, options strategy, option chain,
// fundamentals, pre-market opening, macro/news, AI chat, settings-ish.
// IDs reference src/lib/modules.ts registry (read-only).

export interface FunctionKeyDef {
  key: string; // "F1".."F12"
  funcId: string;
  label: string; // short label shown on the bar
  category: string;
}

export const FUNCTION_KEYS: FunctionKeyDef[] = [
  { key: "F1", funcId: "DIR", label: "DIRECTORY", category: "Terminal" },
  { key: "F2", funcId: "2", label: "CHART CH", category: "Technical" },
  { key: "F3", funcId: "1", label: "TECH TI", category: "Technical" },
  { key: "F4", funcId: "12", label: "FUND FS", category: "Fundamental" },
  { key: "F5", funcId: "70", label: "STRAT", category: "Options" },
  { key: "F6", funcId: "110", label: "OPTIONS OCH", category: "Terminal" },
  { key: "F7", funcId: "109", label: "OPENING", category: "Terminal" },
  { key: "F8", funcId: "111", label: "MACRO IND", category: "Terminal" },
  { key: "F9", funcId: "47", label: "NEWS WIRE", category: "News" },
  { key: "F10", funcId: "22", label: "RISK RSK", category: "Risk" },
  { key: "F11", funcId: "66", label: "AI CHAT", category: "AI" },
  { key: "F12", funcId: "NOTE", label: "NOTES", category: "Terminal" },
];

export const FUNCTION_KEY_MAP: Record<string, FunctionKeyDef> = Object.fromEntries(
  FUNCTION_KEYS.map((d) => [d.key, d])
);

// Pseudo-ids used only by the workspace shell (not in modules.ts).
// DIR = function directory/dashboard, NOTE = notes panel.
export const PSEUDO_DESKS: Record<string, { label: string; category: string }> = {
  DIR: { label: "Function Directory", category: "Terminal" },
  NOTE: { label: "Notes", category: "Terminal" },
};
