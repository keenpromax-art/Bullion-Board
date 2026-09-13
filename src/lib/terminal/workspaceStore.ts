// localStorage-backed panel layout + named workspaces.
// Mirrors BBG saved monitor layouts. Panels reference desk+symbol only —
// never math. Keys are namespaced under bb.workspace.*.

export interface PanelSpec {
  id: string; // uuid-ish, stable per panel
  funcId: string; // module id ("70","12","110",...) or pseudo ("DIR","NOTE")
  symbol: string; // ticker or "" for symbol-less desks
  task?: string | null;
  zoomMode?: "fit" | "full"; // fit = scale-to-fit, no scroll (default); full = 1:1 with scroll
}

export interface SavedWorkspace {
  name: string;
  updated: string; // ISO
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
}

export type TilingPreset = "1-up" | "2-up-h" | "2-up-v" | "4-up" | "3-up-r" | "3-up-l";

// Hard cap: the grid only defines layouts up to 4-up (2x2) inside a fixed
// viewport shell — a 5th panel would overflow invisibly. Every add-path
// (command NEW, +PANEL, duplicate, detach, deep link, workspace load)
// enforces this: new-panel requests at cap reuse the focused panel or
// are blocked.
export const MAX_PANELS = 4;

export function capPanels(panels: PanelSpec[]): PanelSpec[] {
  return panels.length > MAX_PANELS ? panels.slice(0, MAX_PANELS) : panels;
}

// Auto-reshuffle: closing a panel reflows survivors into the tightest
// preset that fits them — the workspace itself never empties (the last
// panel requires confirm and is kept on cancel).
export function fitLayout(n: number): TilingPreset {
  if (n <= 1) return "1-up";
  if (n === 2) return "2-up-v";
  if (n === 3) return "3-up-r";
  return "4-up";
}

const ACTIVE_KEY = "bb.workspace.active.v2";
const NAMES_KEY = "bb.workspace.saved";
const LEGACY_NOTE = "bb.workspace.legacyWarned";

export function uid(): string {
  return `p${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

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

export function defaultPanels(): PanelSpec[] {
  // "Equity Overview" preset: four compact summary panels that fit the
  // viewport with no scrolling (watchlist + strat mini + funda mini + AI).
  // task MINI selects the summary view; FULL DESK in-panel opens the desk.
  const now = Date.now().toString(36);
  return [
    { id: `p${now}a`, funcId: "70", symbol: "RELIANCE.NS", task: "MINI" },
    { id: `p${now}b`, funcId: "DIR", symbol: "RELIANCE.NS", task: "MINI" },
    { id: `p${now}c`, funcId: "12", symbol: "RELIANCE.NS", task: "MINI" },
    { id: `p${now}d`, funcId: "66", symbol: "RELIANCE.NS", task: "MINI" },
  ];
}

export interface ActiveState {
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
  workspaceName: string | null;
  dirty: boolean;
  splits?: Record<TilingPreset, PanelSplits>;
}

// Drag-resize state: fraction of the width (col) owned by the left
// column; fraction of each column's height (row = left, row2 = right)
// owned by the top panel. A single full-width/height divider can't size
// 4 quadrants independently (any 4-rectangle tiling has one full cut),
// so 4-up nests: shared col + independent rowL/rowR. Always clamp [0.2,0.8].
export interface PanelSplits {
  col: number;
  row: number;
  row2?: number;
}

export function defaultSplits(): Record<TilingPreset, PanelSplits> {
  return {
    // 4-up mirrors the stylesheet default (1.3fr 1fr rails).
    "1-up": { col: 0.5, row: 0.5 },
    "2-up-v": { col: 0.5, row: 0.5 },
    "2-up-h": { col: 0.5, row: 0.5 },
    "4-up": { col: 1.3 / 2.3, row: 0.5 },
    // Spanning 3-panel layouts share the 4-up rails (left stack + tall side).
    "3-up-r": { col: 1.3 / 2.3, row: 0.5 },
    "3-up-l": { col: 1.3 / 2.3, row: 0.5 },
  };
}

function clampSplit(v: unknown): number {
  const n = typeof v === "number" && isFinite(v) ? v : 0.5;
  return Math.min(0.8, Math.max(0.2, n));
}

export function splitsFor(state: ActiveState, layout: TilingPreset = state.layout): PanelSplits {
  const fb = defaultSplits()[layout];
  const s = state.splits?.[layout];
  if (!s) return { ...fb };
  const row = clampSplit(s.row);
  return { col: clampSplit(s.col), row, row2: clampSplit(s.row2 ?? row) };
}

function withSplits(state: ActiveState): ActiveState {
  const d = defaultSplits();
  const out: Record<TilingPreset, PanelSplits> = { ...d };
  (Object.keys(d) as TilingPreset[]).forEach((k) => {
    const s = state.splits?.[k];
    if (!s) { out[k] = { ...d[k] }; return; }
    const row = clampSplit(s.row);
    out[k] = { col: clampSplit(s.col), row, row2: clampSplit(s.row2 ?? row) };
  });
  return { ...state, splits: out };
}

// ---- Virtual desktops (Linux-style). Each desktop is a full workspace
// (≤ MAX_PANELS panels); the strip in the status bar flips between them.
// Persisted as one shell so every desktop survives reloads.
export const MAX_DESKTOPS = 6;

export interface ShellState {
  desktops: ActiveState[];
  idx: number;
  names: string[];
}

const SHELL_KEY = "bb.workspace.shell.v1";

export function deskName(i: number): string {
  return `DESK ${i + 1}`;
}

export function blankDesktop(symbol: string): ActiveState {
  const p: PanelSpec = { id: uid(), funcId: "DIR", symbol, task: null };
  return { panels: [p], layout: "1-up", focusedId: p.id, workspaceName: null, dirty: false, splits: defaultSplits() };
}

function normalizeDesktop(raw: Partial<ActiveState> | null | undefined): ActiveState | null {
  if (!raw || !Array.isArray(raw.panels) || raw.panels.length === 0) return null;
  const panels = capPanels(raw.panels.filter(
    (p): p is PanelSpec => !!p && typeof p.funcId === "string" && typeof p.symbol === "string"
  ));
  if (panels.length === 0) return null;
  const focusedId = panels.some((p) => p.id === raw.focusedId) ? (raw.focusedId as string) : panels[0].id;
  const layout = raw.layout === "1-up" || raw.layout === "2-up-h" || raw.layout === "2-up-v" || raw.layout === "4-up" || raw.layout === "3-up-r" || raw.layout === "3-up-l"
    ? raw.layout
    : panels.length >= 4 ? "4-up" : panels.length === 3 ? "3-up-r" : panels.length >= 2 ? "2-up-v" : "1-up";
  return withSplits({
    panels,
    layout,
    focusedId,
    workspaceName: typeof raw.workspaceName === "string" ? raw.workspaceName : null,
    dirty: !!raw.dirty,
    splits: (raw as ActiveState).splits,
  });
}

function fallbackShell(): ShellState {
  const d = normalizeDesktop({
    panels: defaultPanels(),
    layout: "4-up",
    focusedId: null,
    workspaceName: "EQUITY OVERVIEW",
    dirty: false,
  })!;
  return { desktops: [d], idx: 0, names: [deskName(0)] };
}

export function loadShell(): ShellState {
  const saved = read<{ desktops?: Partial<ActiveState>[]; idx?: unknown; names?: unknown } | null>(SHELL_KEY, null);
  if (saved && Array.isArray(saved.desktops) && saved.desktops.length > 0) {
    const desktops = capDesktops(saved.desktops.map(normalizeDesktop).filter((d): d is ActiveState => !!d));
    if (desktops.length > 0) {
      const idx = typeof saved.idx === "number" && isFinite(saved.idx)
        ? Math.min(Math.max(0, Math.floor(saved.idx)), desktops.length - 1)
        : 0;
      const names = desktops.map((_, i) =>
        Array.isArray(saved.names) && typeof (saved.names as unknown[])[i] === "string" && ((saved.names as string[])[i].trim())
          ? (saved.names as string[])[i].trim().toUpperCase().slice(0, 18)
          : deskName(i));
      return { desktops, idx, names };
    }
  }
  // Migrate the pre-desktop workspace (v2 key) into desktop 1.
  const legacy = read<Partial<ActiveState> | null>(ACTIVE_KEY, null);
  const migrated = normalizeDesktop(legacy);
  if (migrated) return { desktops: [migrated], idx: 0, names: [deskName(0)] };
  return fallbackShell();
}

export function saveShell(shell: ShellState): void {
  const desktops = capDesktops(shell.desktops).map((d) => withSplits({ ...d, panels: capPanels(d.panels) }));
  if (desktops.length === 0) return;
  const idx = Math.min(Math.max(0, shell.idx | 0), desktops.length - 1);
  const names = desktops.map((_, i) =>
    typeof shell.names[i] === "string" && shell.names[i].trim()
      ? shell.names[i].trim().toUpperCase().slice(0, 18)
      : deskName(i));
  write(SHELL_KEY, { desktops, idx, names });
}

export function capDesktops(desktops: ActiveState[]): ActiveState[] {
  return desktops.length > MAX_DESKTOPS ? desktops.slice(0, MAX_DESKTOPS) : desktops;
}

export function loadActive(): ActiveState {
  const sh = loadShell();
  return sh.desktops[sh.idx] ?? fallbackShell().desktops[0];
}

export function saveActive(state: ActiveState): void {
  let sh: ShellState;
  try {
    sh = loadShell();
  } catch {
    sh = fallbackShell();
  }
  const next = normalizeDesktop(state) ?? fallbackShell().desktops[0];
  const desktops = [...sh.desktops];
  desktops[Math.min(sh.idx, desktops.length - 1)] = next;
  saveShell({ ...sh, desktops });
}

export function listWorkspaces(): SavedWorkspace[] {
  return read<SavedWorkspace[]>(NAMES_KEY, []);
}

export function saveWorkspaceSnapshot(name: string, state: ActiveState): SavedWorkspace[] {
  const clean = name.trim().toUpperCase().slice(0, 40) || "UNSAVED";
  const all = listWorkspaces();
  const snap: SavedWorkspace = {
    name: clean,
    updated: new Date().toISOString(),
    panels: state.panels,
    layout: state.layout,
    focusedId: state.focusedId,
  };
  const idx = all.findIndex((w) => w.name === clean);
  if (idx >= 0) all[idx] = snap;
  else all.push(snap);
  write(NAMES_KEY, all);
  return all;
}

export function deleteWorkspace(name: string): SavedWorkspace[] {
  const all = listWorkspaces().filter((w) => w.name !== name);
  write(NAMES_KEY, all);
  return all;
}

export function renameWorkspace(oldName: string, newName: string): SavedWorkspace[] {
  const clean = newName.trim().toUpperCase().slice(0, 40);
  if (!clean) return listWorkspaces();
  const all = listWorkspaces().map((w) => (w.name === oldName ? { ...w, name: clean } : w));
  write(NAMES_KEY, all);
  return all;
}

export function exportWorkspace(state: ActiveState): string {
  return JSON.stringify(
    { app: "bullion-board", kind: "workspace", version: 1, ...state },
    null,
    2
  );
}

export function importWorkspace(json: string): ActiveState | null {
  try {
    const j = JSON.parse(json);
    if (!j || !Array.isArray(j.panels)) return null;
    const panels = capPanels(
      (j.panels as PanelSpec[]).filter((p) => p && typeof p.funcId === "string").map((p) => ({
        id: typeof p.id === "string" ? p.id : uid(),
        funcId: p.funcId,
        symbol: typeof p.symbol === "string" ? p.symbol : "",
        task: typeof p.task === "string" ? p.task : null,
      }))
    );
    if (!panels.length) return null;
    return {
      panels,
      layout: j.layout ?? (panels.length >= 4 ? "4-up" : panels.length === 3 ? "3-up-r" : panels.length >= 2 ? "2-up-v" : "1-up"),
      focusedId: typeof j.focusedId === "string" && panels.some((p) => p.id === j.focusedId) ? j.focusedId : panels[0].id,
      workspaceName: null,
      dirty: true,
    };
  } catch {
    return null;
  }
}

export function legacyWarned(): boolean {
  return read<boolean>(LEGACY_NOTE, false);
}

export function markLegacyWarned(): void {
  write(LEGACY_NOTE, true);
}
