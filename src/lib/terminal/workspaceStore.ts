// localStorage-backed panel layout + named workspaces.
// Mirrors BBG saved monitor layouts. Panels reference desk+symbol only —
// never math. Keys are namespaced under bb.workspace.*.

export interface PanelSpec {
  id: string; // uuid-ish, stable per panel
  funcId: string; // module id ("70","12","110",...) or pseudo ("DIR","NOTE")
  symbol: string; // ticker or "" for symbol-less desks
  task?: string | null;
}

export interface SavedWorkspace {
  name: string;
  updated: string; // ISO
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
}

export type TilingPreset = "1-up" | "2-up-h" | "2-up-v" | "4-up";

const ACTIVE_KEY = "bb.workspace.active";
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
  // "Equity Overview" preset: directory + chart + fundamentals.
  const now = Date.now().toString(36);
  return [
    { id: `p${now}a`, funcId: "DIR", symbol: "RELIANCE.NS" },
    { id: `p${now}b`, funcId: "2", symbol: "RELIANCE.NS" },
    { id: `p${now}c`, funcId: "12", symbol: "RELIANCE.NS" },
    { id: `p${now}d`, funcId: "70", symbol: "NIFTY" },
  ];
}

export interface ActiveState {
  panels: PanelSpec[];
  layout: TilingPreset;
  focusedId: string | null;
  workspaceName: string | null;
  dirty: boolean;
}

export function loadActive(): ActiveState {
  const fb: ActiveState = {
    panels: defaultPanels(),
    layout: "4-up",
    focusedId: null,
    workspaceName: "EQUITY OVERVIEW",
    dirty: false,
  };
  const saved = read<Partial<ActiveState> | null>(ACTIVE_KEY, null);
  if (!saved || !Array.isArray(saved.panels) || saved.panels.length === 0) return fb;
  const panels = saved.panels.filter(
    (p): p is PanelSpec => !!p && typeof p.funcId === "string" && typeof p.symbol === "string"
  );
  if (panels.length === 0) return fb;
  return {
    panels,
    layout: saved.layout === "1-up" || saved.layout === "2-up-h" || saved.layout === "2-up-v" || saved.layout === "4-up"
      ? saved.layout
      : panels.length >= 4 ? "4-up" : panels.length >= 2 ? "2-up-v" : "1-up",
    focusedId: typeof saved.focusedId === "string" ? saved.focusedId : panels[0].id,
    workspaceName: typeof saved.workspaceName === "string" ? saved.workspaceName : null,
    dirty: !!saved.dirty,
  };
}

export function saveActive(state: ActiveState): void {
  write(ACTIVE_KEY, state);
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
    const panels = (j.panels as PanelSpec[]).filter((p) => p && typeof p.funcId === "string");
    if (!panels.length) return null;
    return {
      panels: panels.map((p) => ({
        id: typeof p.id === "string" ? p.id : uid(),
        funcId: p.funcId,
        symbol: typeof p.symbol === "string" ? p.symbol : "",
        task: typeof p.task === "string" ? p.task : null,
      })),
      layout: j.layout ?? (panels.length >= 4 ? "4-up" : panels.length >= 2 ? "2-up-v" : "1-up"),
      focusedId: typeof j.focusedId === "string" ? j.focusedId : panels[0].id,
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
