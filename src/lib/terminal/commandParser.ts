// Command parser for the Bloomberg-style terminal shell.
// READ-ONLY over src/lib/modules.ts registry + src/lib/terminal.ts codes.
// Does NOT touch any math/data logic — navigation only.

import { MODULES, MODULE_MAP, MERGED_IDS } from "../modules";
import { CODE_TO_ID, FUNC_CODES, funcCode, parseCommand as baseParse } from "../terminal";
import { PSEUDO_DESKS } from "./functionKeyMap";
import { normalizeTicker } from "../utils";

export type SpecialCommand = "MENU" | "CANCEL" | "HELP" | null;

export interface FuncSuggestion {
  id: string;
  code: string;
  label: string;
  category: string;
  description: string;
}

export interface TerminalCommand {
  raw: string;
  ticker: string | null;
  funcId: string | null;
  openNew: boolean;
  unknown: string | null;
  special: SpecialCommand;
}

// Pseudo codes that resolve without a registry mnemonic (like BBG's
// <EQUITY>/<INDEX> yellow-key shorthands resolve to a sector menu).
const PSEUDO_CODES: Record<string, string> = {
  DIR: "DIR",
  NOTE: "NOTE",
  SET: "SET",
  CFG: "SET",
  CONFIG: "SET",
  SETTINGS: "SET",
  OCH: "110",
  OC: "110",
  IND: "111",
  MAC: "111",
};

const SPECIAL_WORDS: Record<string, Exclude<SpecialCommand, null>> = {
  MENU: "MENU",
  CANCEL: "CANCEL",
  HELP: "HELP",
};

// Plain Enter reuses focused panel. Shift+Enter OR a trailing NEW token
// opens a new panel. Documented in the command-line HELP overlay.
export function parseTerminalCommand(raw: string, shiftNew = false): TerminalCommand {
  const upper = raw.toUpperCase();
  const tokens = upper.split(/[\s,;]+/).filter(Boolean);
  const openNew = shiftNew || tokens[tokens.length - 1] === "NEW";
  const stripped = openNew && tokens[tokens.length - 1] === "NEW"
    ? tokens.slice(0, -1).join(" ")
    : raw;
  const head = (stripped.toUpperCase().split(/[\s,;]+/).filter(Boolean)[0] ?? "");
  const special: SpecialCommand = SPECIAL_WORDS[head] ?? null;
  if (special) {
    return { raw, ticker: null, funcId: null, openNew, unknown: null, special };
  }
  const p = baseParse(stripped);
  let { ticker, funcId, unknown } = p;
  // Numeric IDs (70<GO>) and pseudo codes (OCH<GO>) bypass the base parser.
  if (!funcId && unknown) {
    const resolved = resolveFuncId(unknown);
    if (resolved) {
      funcId = resolved;
      unknown = null;
    }
  }
  return { raw, ticker, funcId, openNew, unknown, special };
}

export function resolveFuncId(input: string): string | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  if (MERGED_IDS[t]) return MERGED_IDS[t]; // retired id directly
  if (MODULE_MAP[t]) return t; // numeric id directly
  if (CODE_TO_ID[t]) return MERGED_IDS[CODE_TO_ID[t]] ?? CODE_TO_ID[t];
  if (PSEUDO_CODES[t]) return PSEUDO_CODES[t];
  return null;
}

function fuzzyScore(hay: string, needle: string): number {
  // Subsequence score: higher = better. -1 = no match.
  if (!needle) return 0;
  let hi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const c = needle[ni];
    const found = hay.indexOf(c, hi);
    if (found === -1) return -1;
    if (found === hi) consecutive++;
    else {
      score -= found - hi;
      consecutive = 0;
    }
    score += 2 + consecutive;
    hi = found + 1;
  }
  // Prefer prefix / code-exact matches.
  if (hay.startsWith(needle)) score += 12;
  return score;
}

export function suggestFunctions(query: string, limit = 8): FuncSuggestion[] {
  const q = query.trim().toUpperCase();
  if (!q) {
    // Default: curated most-used first (mirrors functionKeyMap order).
    const curated = ["70", "110", "2", "12", "109", "111", "66", "53"];
    return curated
      .filter((id) => MODULE_MAP[id])
      .map((id) => {
        const m = MODULE_MAP[id];
        return { id, code: funcCode(id), label: m.label, category: m.category, description: m.description };
      })
      .slice(0, limit);
  }
  const scored: Array<{ s: FuncSuggestion; score: number }> = [];
  // Workspace pseudo-desks (DIR/NOTE/SET) live outside modules.ts but must
  // still autocomplete — e.g. typing SET offers the settings desk instead
  // of Enter completing to a fuzzy module match.
  for (const [id, pseudo] of Object.entries(PSEUDO_DESKS)) {
    const label = pseudo.label.toUpperCase();
    const sCode = fuzzyScore(id, q);
    const sLabel = fuzzyScore(label.replace(/[^A-Z0-9]/g, ""), q.replace(/[^A-Z0-9]/g, ""));
    const best = Math.max(sCode + 8, sLabel);
    if (best > 0 || id.startsWith(q) || label.includes(q)) {
      scored.push({
        s: { id, code: id, label: pseudo.label, category: pseudo.category, description: "Workspace panel" },
        score: best + (id === q ? 60 : 0),
      });
    }
  }
  for (const m of MODULES) {
    if (m.hidden) continue;
    const code = (FUNC_CODES[m.id] ?? m.id).toUpperCase();
    const label = m.label.toUpperCase();
    const cat = m.category.toUpperCase();
    const sCode = fuzzyScore(code, q);
    const sLabel = fuzzyScore(label.replace(/[^A-Z0-9]/g, ""), q.replace(/[^A-Z0-9]/g, ""));
    const sId = m.id === q ? 100 : -1;
    const best = Math.max(sCode + 8, sLabel, sId, fuzzyScore(cat, q) - 4);
    if (best > 0 || code.startsWith(q) || label.includes(q) || m.id === q) {
      scored.push({
        s: { id: m.id, code, label: m.label, category: m.category, description: m.description },
        score: best + (code === q ? 50 : 0),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.s);
}

export function suggestSymbols(query: string, universe: string[], limit = 6): string[] {
  const q = query.trim().toUpperCase();
  if (!q || q.length < 1) return [];
  const out: Array<{ sym: string; score: number }> = [];
  for (const sym of universe) {
    const u = sym.toUpperCase();
    if (u.startsWith(q)) out.push({ sym, score: 100 - u.length });
    else if (u.includes(q)) out.push({ sym, score: 10 - u.length * 0.01 });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.sym);
}

export function normalizeSymbolInput(tok: string): string {
  return normalizeTicker(tok.toUpperCase());
}

// ---- command history (in-memory + localStorage, capped at 50) ----
const HIST_KEY = "bb.workspace.cmdHistory";

export function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HIST_KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    /* quota — ignore */
  }
}

export function pushHistory(items: string[], cmd: string): string[] {
  const t = cmd.trim().toUpperCase();
  if (!t) return items;
  const next = [t, ...items.filter((x) => x !== t)].slice(0, 50);
  saveHistory(next);
  return next;
}
