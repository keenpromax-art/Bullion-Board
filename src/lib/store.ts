// Browser persistence — replaces my_watchlist.json, my_portfolio.json,
// my_notes.json, my_watchlist_notes.json, app prefs + OR-key files in special.py.
// Uses localStorage so it works on Vercel (serverless has no local disk).

import type { Note } from "./types";
import { DEFAULT_TICKER } from "./watchlist";

export interface Position { id: number; symbol: string; qty: number; avg: number }
export interface Alert {
  id: number; symbol: string; cond: "above" | "below"; price: number;
  active: boolean; triggered: boolean; created: string;
}

const K = {
  ticker: "iss.activeTicker",
  watchlist: "iss.watchlist",
  favorites: "iss.favorites",
  portfolio: "iss.portfolio",
  positions: "iss.positions",
  alerts: "iss.alerts",
  notes: "iss.notes",
  orKey: "iss.openrouter.key",
  orModel: "iss.openrouter.model",
  fredKey: "iss.fred.key",
  macroExtra: "iss.macro.extra",
  explainerModel: "iss.explainer.model",
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, val: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota — ignore */
  }
}

export const store = {
  getTicker(): string {
    return read<string>(K.ticker, DEFAULT_TICKER);
  },
  setTicker(t: string): void {
    write(K.ticker, t);
  },
  getWatchlist(): string[] {
    return read<string[]>(K.watchlist, []);
  },
  setWatchlist(w: string[]): void {
    write(K.watchlist, w);
  },
  getFavorites(): string[] {
    const raw = read<string[]>(K.favorites, []);
    // Keep only non-empty strings, de-duped, order-preserved.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of raw) {
      if (typeof id !== "string" || !id) continue;
      const key = id.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return out;
  },
  setFavorites(ids: string[]): void {
    write(K.favorites, ids);
  },
  toggleFavorite(id: string): string[] {
    const key = id.toUpperCase();
    const cur = this.getFavorites();
    const has = cur.some((x) => x.toUpperCase() === key);
    const next = has ? cur.filter((x) => x.toUpperCase() !== key) : [...cur, id];
    write(K.favorites, next);
    return next;
  },
  isFavorite(id: string): boolean {
    const key = id.toUpperCase();
    return this.getFavorites().some((x) => x.toUpperCase() === key);
  },
  getPortfolio(): string[] {
    return read<string[]>(K.portfolio, []);
  },
  setPortfolio(p: string[]): void {
    write(K.portfolio, p);
  },
  getPositions(): Position[] {
    return read<Position[]>(K.positions, []);
  },
  setPositions(p: Position[]): void {
    write(K.positions, p);
  },
  getAlerts(): Alert[] {
    return read<Alert[]>(K.alerts, []);
  },
  setAlerts(a: Alert[]): void {
    write(K.alerts, a);
  },
  getNotes(): Note[] {
    return read<Note[]>(K.notes, []);
  },
  setNotes(n: Note[]): void {
    write(K.notes, n);
  },
  getORKey(): string {
    return read<string>(K.orKey, "");
  },
  setORKey(k: string): void {
    write(K.orKey, k);
  },
  getORModel(fallback = "nvidia/nemotron-3-super-120b-a12b:free"): string {
    return read<string>(K.orModel, fallback);
  },
  setORModel(m: string): void {
    write(K.orModel, m);
  },
  getFredKey(): string {
    return read<string>(K.fredKey, "");
  },
  setFredKey(k: string): void {
    write(K.fredKey, k);
  },
  getMacroExtra(): string[] {
    return read<string[]>(K.macroExtra, []);
  },
  setMacroExtra(ids: string[]): void {
    write(K.macroExtra, ids);
  },
  getExplainerModel(fallback = "nvidia/nemotron-3-super-120b-a12b:free"): string {
    return read<string>(K.explainerModel, fallback);
  },
  setExplainerModel(m: string): void {
    write(K.explainerModel, m);
  },
};
