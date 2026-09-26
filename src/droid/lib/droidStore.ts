// Bullion Droid — localStorage contracts (additive keys only).
// Existing terminal keys (bb.workspace.*, iss.ai.sessions, store K-map) are
// read/reused, never renamed.

import { store } from "@/lib/store";
import type { BriefCache, DroidMode, DroidNotif, DroidPrefs, WatchList } from "./types";

const K = {
  mode: "bb.droid.mode.v1",
  lite: "bb.droid.lite.v1",
  prefs: "bb.droid.prefs.v1",
  lists: "bb.droid.watchlists.v1",
  recents: "bb.droid.recents.v1",
  brief: "bb.droid.brief.v1",
  notif: "bb.droid.notif.v1",
  installDismissed: "bb.droid.install.v1",
} as const;

export const DEFAULT_LIST_ID = "wl-main";

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

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export const droidStore = {
  // ---- mode ----
  getMode(): DroidMode {
    const m = read<DroidMode | null>(K.mode, null);
    return m === "pro" || m === "terminal" ? m : "simple";
  },
  setMode(m: DroidMode): void {
    write(K.mode, m);
  },

  // ---- lite ----
  isLite(): boolean {
    return read<boolean>(K.lite, false) === true;
  },
  setLite(v: boolean): void {
    write(K.lite, v);
  },

  // ---- prefs ----
  getPrefs(): DroidPrefs {
    return read<DroidPrefs>(K.prefs, { sort: "manual", refreshSec: 15, columns: 1 });
  },
  setPrefs(p: DroidPrefs): void {
    write(K.prefs, p);
  },

  // ---- watchlists (first run migrates terminal store watchlist) ----
  getLists(): WatchList[] {
    const lists = read<WatchList[] | null>(K.lists, null);
    if (lists && Array.isArray(lists) && lists.length) return lists;
    const legacy = (() => {
      try {
        const w = store.getWatchlist();
        return Array.isArray(w) ? w : [];
      } catch {
        return [];
      }
    })();
    const seeded: WatchList[] = [
      {
        id: DEFAULT_LIST_ID,
        name: "MY WATCHLIST",
        symbols: legacy.length
          ? [...legacy]
          : ["RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS", "^NSEI"],
      },
    ];
    write(K.lists, seeded);
    return seeded;
  },
  setLists(l: WatchList[]): void {
    write(K.lists, l);
  },
  createList(name: string): WatchList[] {
    const lists = droidStore.getLists();
    const next = [...lists, { id: uid(), name: (name || "NEW LIST").toUpperCase().slice(0, 18), symbols: [] }];
    droidStore.setLists(next);
    return next;
  },
  renameList(id: string, name: string): WatchList[] {
    const next = droidStore.getLists().map((l) => (l.id === id ? { ...l, name: name.toUpperCase().slice(0, 18) } : l));
    droidStore.setLists(next);
    return next;
  },
  deleteList(id: string): WatchList[] {
    const next = droidStore.getLists().filter((l) => l.id !== id);
    droidStore.setLists(next.length ? next : [{ id: DEFAULT_LIST_ID, name: "MY WATCHLIST", symbols: [] }]);
    return droidStore.getLists();
  },
  toggleSymbol(listId: string, symbol: string): boolean {
    const lists = droidStore.getLists();
    let added = false;
    const next = lists.map((l) => {
      if (l.id !== listId) return l;
      const has = l.symbols.includes(symbol);
      added = !has;
      return { ...l, symbols: has ? l.symbols.filter((s) => s !== symbol) : [...l.symbols, symbol] };
    });
    droidStore.setLists(next);
    // Keep terminal store in sync so desktop tape/panels follow along.
    try {
      const main = next.find((l) => l.id === DEFAULT_LIST_ID) ?? next[0];
      if (main) store.setWatchlist(main.symbols);
    } catch {
      /* storage unavailable */
    }
    return added;
  },
  inAnyList(symbol: string): boolean {
    return droidStore.getLists().some((l) => l.symbols.includes(symbol));
  },
  setSymbols(listId: string, symbols: string[]): void {
    const next = droidStore.getLists().map((l) => (l.id === listId ? { ...l, symbols } : l));
    droidStore.setLists(next);
  },

  // ---- recents ----
  getRecents(): string[] {
    return read<string[]>(K.recents, []);
  },
  pushRecent(symbol: string): string[] {
    const cur = droidStore.getRecents().filter((s) => s !== symbol);
    const next = [symbol, ...cur].slice(0, 12);
    write(K.recents, next);
    return next;
  },

  // ---- morning brief cache ----
  getBrief(): BriefCache | null {
    return read<BriefCache | null>(K.brief, null);
  },
  setBrief(b: BriefCache): void {
    write(K.brief, b);
  },

  // ---- notifications ----
  getNotifs(): DroidNotif[] {
    return read<DroidNotif[]>(K.notif, []);
  },
  setNotifs(n: DroidNotif[]): void {
    write(K.notif, n.slice(0, 60));
  },
  pushNotif(n: Omit<DroidNotif, "id" | "ts" | "read">): DroidNotif[] {
    const list = droidStore.getNotifs();
    if (list[0] && list[0].title === n.title) return list;
    const next = [{ ...n, id: uid(), ts: Date.now(), read: false }, ...list].slice(0, 60);
    droidStore.setNotifs(next);
    return next;
  },
  markAllRead(): DroidNotif[] {
    const next = droidStore.getNotifs().map((n) => ({ ...n, read: true }));
    droidStore.setNotifs(next);
    return next;
  },
  dismissNotif(id: string): DroidNotif[] {
    const next = droidStore.getNotifs().filter((n) => n.id !== id);
    droidStore.setNotifs(next);
    return next;
  },
  unreadCount(): number {
    return droidStore.getNotifs().filter((n) => !n.read).length;
  },

  // ---- install prompt memory ----
  installDismissed(): boolean {
    return read<boolean>(K.installDismissed, false) === true;
  },
  dismissInstall(): void {
    write(K.installDismissed, true);
  },
};

export const todayKey = (): string => new Date().toISOString().slice(0, 10);
