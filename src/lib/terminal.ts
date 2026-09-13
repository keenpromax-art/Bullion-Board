// Bloomberg-style function codes + command parser.
// Every module gets a short FNC mnemonic (like GP, FA, DCF). The command bar
// accepts `TICKER FNC`, `FNC`, `TICKER`, e.g. `RELIANCE GP <GO>`.

import { MODULE_MAP } from "./modules";
import { normalizeTicker } from "./utils";

export const FUNC_CODES: Record<string, string> = {
  "1": "TI", "2": "CH", "3": "MC", "4": "CMP", "5": "PTS", "6": "MJ",
  "7": "XGB", "8": "OF", "9": "FC", "10": "AM", "11": "FA", "12": "FS",
  "13": "SC", "14": "DUP", "15": "FOR", "16": "SA", "17": "PROF",
  "18": "DCF", "19": "LBO", "20": "HI", "21": "GI", "22": "RSK",
  "23": "RR", "24": "GV", "25": "RG", "26": "VT", "27": "PR",
  "28": "FMF", "29": "FR", "30": "MRV", "31": "MCA", "32": "OV",
  "33": "GRK", "34": "SNS", "35": "SCA", "36": "AGRK", "37": "NH",
  "38": "ECO", "39": "HDS", "40": "DVD", "41": "BD", "42": "XL",
  "43": "DOCS", "44": "FSHT", "45": "NBFC", "46": "LM", "47": "WIRE",
  "48": "ARB", "49": "BBL", "51": "WIKI", "52": "SV",
  "53": "TOP", "54": "AE", "55": "HYB", "56": "TRF", "57": "PORT",
  "58": "SWARM", "59": "NOD", "60": "NET", "61": "RL", "62": "HMM",
  "63": "RRA", "64": "LINK", "65": "NEW", "66": "AI", "67": "SCR",
   "68": "BT", "69": "ARENA", "70": "STRAT", "71": "TASK",
   "72": "EDT",
  "73": "PRED", "74": "SWING", "75": "DIP",
  "101": "HOLD", "102": "ALRT", "103": "COMP", "104": "CORR",
  "105": "SEAS", "106": "EVTS", "107": "BRTH",   "108": "CALC", "109": "PRE",
  "110": "OC", "111": "IND", "112": "ANR", "113": "CAST", "114": "NEXUS",
};

export const CODE_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(FUNC_CODES).map(([id, code]) => [code.toUpperCase(), id])
);

export function funcCode(id: string): string {
  return FUNC_CODES[id] ?? id;
}

export function funcLabel(id: string): string {
  const m = MODULE_MAP[id];
  return m ? `${funcCode(id)} — ${m.label}` : id;
}

export interface ParsedCommand {
  ticker: string | null;
  funcId: string | null;
  unknown: string | null;
}

function looksLikeTicker(tok: string): boolean {
  const t = tok.toUpperCase();
  if (t.startsWith("^")) return true;
  // NSE/BSE equities plus Yahoo futures (=F), FX (=X) and crypto (-USD).
  if (/^[A-Z0-9&.=-]+(\.(NS|BO))?$/.test(t) && /[A-Z]/.test(t)) return true;
  return false;
}

export function parseCommand(raw: string): ParsedCommand {
  const tokens = raw
    .toUpperCase()
    .replace(/<GO>|<EQUITY>|<HELP>/g, " ")
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  let ticker: string | null = null;
  let funcId: string | null = null;
  let unknown: string | null = null;
  for (const tok of tokens) {
    if (!funcId && CODE_TO_ID[tok]) {
      funcId = CODE_TO_ID[tok];
      continue;
    }
    if (!ticker && looksLikeTicker(tok)) {
      ticker = normalizeTicker(tok);
      continue;
    }
    if (!unknown) unknown = tok;
  }
  return { ticker, funcId, unknown };
}
