// Bullion Droid — universal search: the command line, replaced.
// Layered, deterministic intent router (spec §S7):
//   1. NL navigation patterns      2. function codes / desk labels
//   3. local 2,260-symbol index    4. commodity/alias map
//   5. AI fallback (caller sends the residue to /api/ai/chat)
// No server call happens inside this module.

import { MODULES } from "@/lib/modules";
import { CODE_TO_ID, funcCode } from "@/lib/terminal";
import { WATCHLIST } from "@/lib/watchlist";
import { stripYahooSuffix } from "@/lib/utils";
import type { Intent } from "./types";
import type { DeskEntry } from "./categories";
import { ALL_DESKS } from "./categories";

// ---- local symbol index -------------------------------------------------
const BASE_TO_SYM = new Map<string, string>();
for (const s of WATCHLIST) {
  const b = stripYahooSuffix(s);
  if (!BASE_TO_SYM.has(b)) BASE_TO_SYM.set(b, s);
}
const KNOWN = new Set<string>([...BASE_TO_SYM.keys(), ...WATCHLIST]);

// Commodity / index aliases typed in plain english.
const ALIASES: Record<string, string> = {
  NIFTY: "^NSEI", "NIFTY 50": "^NSEI", NIFTY50: "^NSEI", BANKNIFTY: "^NSEBANK",
  "BANK NIFTY": "^NSEBANK", SENSEX: "^BSESN", VIX: "^INDIAVIX", INDIAVIX: "^INDIAVIX",
  GOLD: "GC=F", SILVER: "SI=F", CRUDE: "CL=F", OIL: "CL=F", NATGAS: "NG=F",
  USDINR: "USDINR=X", "USD INR": "USDINR=X", DOLLAR: "USDINR=X",
  BITCOIN: "BTC-USD", BTC: "BTC-USD", ETHEREUM: "ETH-USD", ETH: "ETH-USD",
  SP500: "^GSPC", "S&P500": "^GSPC", NIFTYIT: "^CNXIT",
};

export interface SymHit {
  symbol: string;
  base: string;
  score: number;
}

export function localSymbols(q: string, limit = 8): SymHit[] {
  const t = (q || "").trim().toUpperCase();
  if (!t) return [];
  const out: SymHit[] = [];
  const alias = ALIASES[t];
  if (alias) out.push({ symbol: alias, base: alias, score: 1000 });
  if (KNOWN.has(t)) {
    const s = BASE_TO_SYM.get(t) ?? (WATCHLIST.includes(t) ? t : `${t}.NS`);
    out.push({ symbol: s, base: t, score: 900 });
  }
  for (const b of BASE_TO_SYM.keys()) {
    if (out.length >= limit * 3) break;
    if (b === t) continue;
    const i = b.indexOf(t);
    if (i < 0) continue;
    out.push({ symbol: BASE_TO_SYM.get(b)!, base: b, score: i === 0 ? 600 - b.length : 400 - b.length });
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return out.filter((h) => (seen.has(h.symbol) ? false : (seen.add(h.symbol), true))).slice(0, limit);
}

// ---- desk index ---------------------------------------------------------

export interface DeskHit extends DeskEntry {
  score: number;
}

export function matchDesks(q: string, limit = 8): DeskHit[] {
  const t = (q || "").trim().toUpperCase();
  if (!t) return [];
  const hits: DeskHit[] = [];
  const codeHit = CODE_TO_ID[t];
  if (codeHit) {
    const d = ALL_DESKS.find((x) => x.m.id === codeHit);
    if (d) hits.push({ ...d, score: 1000 });
  }
  for (const d of ALL_DESKS) {
    const label = d.m.label.toUpperCase();
    const cat = d.m.category.toUpperCase();
    let s = 0;
    if (label === t) s = 850;
    else if (label.startsWith(t)) s = 700;
    else if (label.includes(t)) s = 520;
    else if (cat.includes(t)) s = 300;
    else if (d.m.description.toUpperCase().includes(t)) s = 200;
    else if (d.code.toUpperCase() === t) s = 880;
    if (s) hits.push({ ...d, score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

// ---- NL patterns --------------------------------------------------------

const STOP = new Set([
  "SHOW", "OPEN", "ME", "PLEASE", "FOR", "THE", "MY", "A", "AN", "OF", "ON",
  "IN", "TO", "GET", "GIVE", "CAN", "I", "WHAT", "IS", "ARE", "WITH", "AND",
  "NOW", "TODAY", "FULL", "VIEW", "LOOK", "CHECK", "WHICH", "HOW", "WHY",
]);

const COMMODITY_BASE: Record<string, string> = {
  GOLD: "GC=F", SILVER: "SI=F", CRUDE: "CL=F", OIL: "CL=F",
};

function tokens(raw: string): string[] {
  return raw
    .toUpperCase()
    .replace(/[?,!:;"'`]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract the first recognizable security from a phrase. */
export function symbolIn(phrase: string): string | null {
  const toks = tokens(phrase);
  // two-word aliases first: "BANK NIFTY", "NIFTY 50", "USD INR"
  for (let i = 0; i < toks.length - 1; i++) {
    const two = `${toks[i]} ${toks[i + 1]}`;
    if (ALIASES[two]) return ALIASES[two];
  }
  for (const tk of toks) {
    if (ALIASES[tk]) return ALIASES[tk];
    if (STOP.has(tk)) continue;
    if (/^[A-Z0-9&.-]{1,12}$/.test(tk) === false) continue;
    if (KNOWN.has(tk)) return BASE_TO_SYM.get(tk) ?? tk;
    if (KNOWN.has(`${tk}.NS`)) return `${tk}.NS`;
    if (tk.startsWith("^") || tk.includes("=") || /\.[A-Z]{1,4}$/.test(tk)) return tk;
  }
  return null;
}

/** Map a plain-english question onto a deterministic desk/tab intent. */
export function parseIntent(raw: string): Intent | null {
  const q = (raw || "").trim();
  if (!q) return null;
  const up = q.toUpperCase();

  // exact terminal-style command still works: "RELIANCE FS", "TCS DCF"
  const toks = tokens(q);
  let codeId: string | null = null;
  let symTok: string | null = null;
  for (const tk of toks) {
    if (!codeId && CODE_TO_ID[tk]) codeId = CODE_TO_ID[tk];
    if (!symTok && !STOP.has(tk)) {
      const s = symbolIn(tk);
      if (s) symTok = s;
    }
  }
  if (codeId && symTok) return { kind: "desk", symbol: symTok, funcId: codeId };
  if (codeId) return { kind: "desk", funcId: codeId };
  if (symTok && toks.filter((t) => !STOP.has(t)).length <= 2) {
    return { kind: "security", symbol: symTok };
  }

  // compare: "compare A and B" / "A vs B" / "gold vs silver"
  if (/\bVS\b|\bVERSUS\b|^COMPARE\b/.test(up)) {
    const parts = up.split(/\bVS\b|\bVERSUS\b|\bAND\b|^COMPARE\b/);
    const syms = parts.map((p) => symbolIn(p)).filter((s): s is string => !!s);
    if (syms.length >= 2) return { kind: "compare", symbols: [syms[0], syms[1]] };
  }

  const sym = symbolIn(up);
  const has = (re: RegExp) => re.test(up);

  if (has(/\bWHAT CAN I ANALYSE\b|\bWHAT CAN I ANALYZE\b|\bANALYSE ME\b|\bANALYZE ME\b/) && sym) {
    return { kind: "security", symbol: sym, tab: "overview", label: "ANALYSIS" };
  }
  if (has(/\bNEWS\b|\bHEADLINES\b/) && sym) return { kind: "security", symbol: sym, tab: "news" };
  if (has(/\bCHART\b|\bPRICE\b|\bTREND\b/) && sym) return { kind: "security", symbol: sym, tab: "chart" };
  if (has(/\bTECHNICAL\b|\bRSI\b|\bMACD\b|\bINDICATOR/) && sym)
    return { kind: "desk", symbol: sym, funcId: "1" };
  if (has(/\bFUNDAMENTAL\b|\bFINANCIAL\b|\bSTATEMENT\b|\bBALANCE SHEET\b|\bP&L\b|\bINCOME\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "12" };
  if (has(/\bDCF\b|\bINTRINSIC\b|\bFAIR VALUE\b|\bVALUATION\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "18" };
  if (has(/\bOPTION CHAIN\b|\bOPTIONS CHAIN\b|\bPCR\b|\bMAX PAIN\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "110" };
  if (has(/\bSTRATEG\b|\bSTRADDLE\b|\bSTRANGLE\b|\bSPREAD\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "70" };
  if (has(/\bGREEK\b/) && sym) return { kind: "desk", symbol: sym, funcId: "33" };
  if (has(/\bRISK\b|\bVAR\b|\bDRAWDOWN\b/) && sym) return { kind: "desk", symbol: sym, funcId: "22" };
  if (has(/\bDIVIDEND\b/) && sym) return { kind: "desk", symbol: sym, funcId: "40" };
  if (has(/\bOWNERSHIP\b|\bSHAREHOLDING\b|\bPROMOTER\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "39" };
  if (has(/\bANALYST\b|\bESTIMATE\b|\bTARGET\b|\bCONSENSUS\b|\bRATING\b/) && sym)
    return { kind: "desk", symbol: sym, funcId: "112" };
  if (has(/\bEARNINGS\b|\bRESULTS\b|\bQUARTER\b/) && sym) return { kind: "security", symbol: sym, tab: "news" };
  if (has(/\bMOMENTUM\b|\bSCREENER\b|\bSTOCKS WITH\b|\bOVERSOLD\b/) && !sym)
    return { kind: "desk", funcId: "67" };
  if (has(/\bSECTOR\b/) && sym) return { kind: "desk", symbol: sym, funcId: "35" };
  if (has(/\bMORNING BRIEF\b|\bBRIEF\b|\bWHAT CHANGED\b/) && !sym) return { kind: "brief" };
  if (sym && has(/\bVALUATION\b|\bP\/E\b|\bROCE\b|\bROE\b/)) return { kind: "security", symbol: sym, tab: "fundamentals" };

  if (sym) return { kind: "security", symbol: sym };

  const desk = matchDesks(up, 1)[0];
  if (desk && desk.score >= 520) return { kind: "desk", funcId: desk.m.id };

  return null;
}

/** Suggestions shown while typing (before Enter). */
export function suggest(raw: string, limit = 6): {
  symbols: SymHit[];
  desks: DeskHit[];
} {
  const q = (raw || "").trim().toUpperCase();
  if (!q) return { symbols: [], desks: [] };
  return { symbols: localSymbols(q, limit), desks: matchDesks(q, limit) };
}


export { CODE_TO_ID, funcCode, MODULES };
