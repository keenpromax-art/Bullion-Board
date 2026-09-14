"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MODULE_MAP, resolveFuncId } from "@/lib/modules";
import { normalizeTicker } from "@/lib/utils";
import { store } from "@/lib/store";
import CommandLine from "@/components/terminal/CommandLine";
import PanelWorkspace from "@/components/terminal/PanelWorkspace";
import TickerTape from "@/components/terminal/TickerTape";
import FunctionKeyBar from "@/components/terminal/FunctionKeyBar";
import StatusBar from "@/components/terminal/StatusBar";
import WorkspaceSwitcher from "@/components/terminal/WorkspaceSwitcher";
import { panelCode, panelTitle } from "@/components/terminal/Panel";
import {
  loadShell, saveShell, blankDesktop, deskName, splitsFor, defaultSplits, MAX_DESKTOPS,
  uid, fitLayout, capPanels, MAX_PANELS,
  type ActiveState, type PanelSpec, type ShellState, type TilingPreset,
} from "@/lib/terminal/workspaceStore";
import { installShortcuts } from "@/lib/terminal/keyboardShortcuts";
import { FUNCTION_KEY_MAP } from "@/lib/terminal/functionKeyMap";

const LASTFUNC_KEY = "bb.workspace.lastFunc";
const DEFAULT_OVERVIEW = "DIR";

function readLastFunc(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LASTFUNC_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function writeLastFunc(m: Record<string, string>) {
  try { window.localStorage.setItem(LASTFUNC_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

function Inner() {
  const sp = useSearchParams();
  const [shell, setShell] = useState<ShellState | null>(null);
  const [maxId, setMaxId] = useState<string | null>(null);
  const [feedOk, setFeedOk] = useState<boolean | null>(null);
  const [expose, setExpose] = useState(false);
  const cmdRef = useRef<HTMLInputElement>(null);
  const lastFunc = useRef<Record<string, string>>({});
  const exposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellRef = useRef<ShellState | null>(null);
  shellRef.current = shell;

  // Active desktop; every panel/layout/focus mutation below targets it —
  // other desktops sit untouched in shell.desktops until switched to.
  const state: ActiveState | null = shell ? shell.desktops[shell.idx] ?? null : null;

  // setState equivalent scoped to the active desktop.
  const patchActive = useCallback((fn: (prev: ActiveState) => ActiveState) => {
    setShell((prev) => {
      if (!prev) return prev;
      const cur = prev.desktops[prev.idx];
      if (!cur) return prev;
      const next = fn(cur);
      if (next === cur) return prev;
      const desktops = [...prev.desktops];
      desktops[prev.idx] = next;
      return { ...prev, desktops };
    });
  }, []);

  useEffect(() => { lastFunc.current = readLastFunc(); }, []);

  // Initial load: shell (all desktops) from localStorage, migrating the
  // pre-desktop workspace into desk 1; honor ?symbol=&func= deep-add on the
  // active desktop.
  useEffect(() => {
    const sh = loadShell();
    let s = sh.desktops[sh.idx] ?? sh.desktops[0];
    if (!s.focusedId && s.panels.length) s = { ...s, focusedId: s.panels[0].id };
    const qSym = sp.get("symbol");
    const qFunc = sp.get("func");
    if (qSym || qFunc) {
      const sym = qSym ? normalizeTicker(qSym) : (s.panels.find((p) => p.id === s.focusedId)?.symbol ?? store.getTicker());
      const fid = qFunc && (MODULE_MAP[resolveFuncId(qFunc)] || qFunc === "DIR" || qFunc === "NOTE" || qFunc === "SET") ? resolveFuncId(qFunc) : null;
      if (fid || qSym) {
        const np: PanelSpec = { id: uid(), funcId: fid ?? DEFAULT_OVERVIEW, symbol: sym, task: sp.get("task") };
        if (s.panels.length >= MAX_PANELS) {
          // At the 4-panel cap a deep link reuses the focused panel.
          const target = s.focusedId ?? s.panels[0]?.id;
          s = { ...s, panels: s.panels.map((p) => (p.id === target ? { ...p, funcId: np.funcId, symbol: np.symbol, task: np.task } : p)), focusedId: target, dirty: true };
        } else {
          s = { ...s, panels: [...s.panels, np], focusedId: np.id, dirty: true };
        }
      }
    }
    const desktops = [...sh.desktops];
    desktops[sh.idx] = s;
    setShell({ ...sh, desktops });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the whole shell (debounced — resize drags fire many updates;
  // the unmount flush below covers tab-close).
  useEffect(() => {
    if (!shell) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { saveShell(shellRef.current ?? shell); } catch { /* quota — ignore */ }
    }, 250);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try { if (shellRef.current) saveShell(shellRef.current); } catch { /* ignore */ }
    };
  }, [shell]);

  const focused = useMemo(
    () => state?.panels.find((p) => p.id === state.focusedId) ?? state?.panels[0] ?? null,
    [state]
  );

  const focusTicker = useMemo(() => {
    try { return focused?.symbol || store.getTicker(); } catch { return focused?.symbol ?? ""; }
  }, [focused]);

  // NOTE: all hooks must stay above the `if (!state)` early return —
  // adding any hook below it breaks hook order on the first state update.
  const focusTag = useMemo(() => {
    if (!focused) return "";
    const id = MODULE_MAP[focused.funcId] ? focused.funcId : panelCode(focused);
    return `${id} · ${panelTitle(focused)}`.toUpperCase();
  }, [focused]);

  const focusStatus = useMemo(() => {
    if (!focused) return null;
    return `${panelCode(focused)} · ${panelTitle(focused)}`.toUpperCase();
  }, [focused]);

  const focusLabelLong = focused ? `${panelTitle(focused)} ${focused.symbol}` : null;

  function flashExpose() {
    setExpose(true);
    if (exposeTimer.current) clearTimeout(exposeTimer.current);
    exposeTimer.current = setTimeout(() => setExpose(false), 1200);
  }

  // ---- Virtual desktops (Linux-style): each holds ≤ MAX_PANELS panels.
  function switchDesktop(i: number) {
    if (!shell || i === shell.idx || !shell.desktops[i]) return;
    setMaxId(null);
    setShell({ ...shell, idx: i });
  }

  function addDesktop() {
    if (!shell || !state) return;
    if (shell.desktops.length >= MAX_DESKTOPS) { alert(`MAX ${MAX_DESKTOPS} DESKTOPS — RIGHT-CLICK A DESK CHIP TO CLOSE ONE FIRST.`); return; }
    const sym = state.panels.find((p) => p.id === state.focusedId)?.symbol ?? store.getTicker();
    const d = blankDesktop(sym);
    setMaxId(null);
    setShell({ ...shell, desktops: [...shell.desktops, d], names: [...shell.names, deskName(shell.desktops.length)], idx: shell.desktops.length });
  }

  function renameDesktop(i: number) {
    if (!shell || !shell.names[i]) return;
    const n = prompt("RENAME DESKTOP", shell.names[i]);
    if (n === null) return;
    const clean = n.trim().toUpperCase().slice(0, 18) || deskName(i);
    const names = [...shell.names];
    names[i] = clean;
    setShell({ ...shell, names });
  }

  function closeDesktop(i: number) {
    if (!shell) return;
    if (shell.desktops.length <= 1) { alert("AT LEAST ONE DESKTOP STAYS OPEN."); return; }
    const d = shell.desktops[i];
    if (!d) return;
    const pristine = d.panels.length <= 1 && d.panels.every((p) => p.funcId === "DIR");
    if (!pristine && !confirm(`CLOSE ${shell.names[i] ?? deskName(i)} (${d.panels.length} PANEL${d.panels.length === 1 ? "" : "S"})?`)) return;
    const desktops = shell.desktops.filter((_, j) => j !== i);
    const names = shell.names.filter((_, j) => j !== i);
    let idx = shell.idx;
    if (i < idx) idx -= 1;
    else if (i === idx) idx = Math.min(idx, desktops.length - 1);
    setMaxId(null);
    setShell({ ...shell, desktops, names, idx });
  }

  const applyCommand = useCallback((ticker: string | null, funcId: string | null, openNew: boolean) => {
    patchActive((prev) => {
      if (!prev) return prev;
      // Resolve defaults.
      let t = ticker;
      let f = funcId;
      const focusSym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol;
      if (f && !t) t = focusSym ?? store.getTicker();
      if (t && !f) {
        f = lastFunc.current[t] ?? lastFunc.current[t.replace(".NS", "")] ?? DEFAULT_OVERVIEW;
      }
      if (!f) return prev;
      if (!t) t = focusSym ?? store.getTicker();
      const sym = normalizeTicker(t);
      try { store.setTicker(sym); } catch { /* ignore */ }
      lastFunc.current = { ...lastFunc.current, [sym]: f };
      writeLastFunc(lastFunc.current);
      if (openNew) {
        // At the 4-panel cap a "new panel" request reuses the focused panel.
        if (!prev.focusedId) {
          const np: PanelSpec = { id: uid(), funcId: f, symbol: sym };
          return { ...prev, panels: [np], focusedId: np.id, dirty: true };
        }
        if (prev.panels.length >= MAX_PANELS) {
          return {
            ...prev,
            panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: f!, symbol: sym, task: null } : p)),
            dirty: true,
          };
        }
        const np: PanelSpec = { id: uid(), funcId: f, symbol: sym };
        return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
      }
      // Replace focused panel (or create one if none).
      if (!prev.focusedId) {
        const np: PanelSpec = { id: uid(), funcId: f, symbol: sym };
        return { ...prev, panels: [np], focusedId: np.id, dirty: true };
      }
      return {
        ...prev,
        panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: f!, symbol: sym, task: null } : p)),
        dirty: true,
      };
    });
  }, []);

  const triggerFunctionKey = useCallback((key: string) => {
    const def = FUNCTION_KEY_MAP[key];
    if (!def) return;
    patchActive((prev) => {
      if (!prev) return prev;
      const focusSym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
      if (!prev.focusedId) {
        const p: PanelSpec = { id: uid(), funcId: def.funcId, symbol: focusSym };
        return { ...prev, panels: [p], focusedId: p.id, dirty: true };
      }
      return {
        ...prev,
        panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: def.funcId, task: null } : p)),
        dirty: true,
      };
    });
  }, []);

  // Global shortcuts (single app-level listener).
  useEffect(() => {
    const off = installShortcuts({
      focusCommand: () => cmdRef.current?.focus(),
      clearOrBlur: () => {
        const el = document.activeElement as HTMLElement | null;
        const inCmd = el && (el as HTMLElement).dataset?.cmdline === "true";
        if (inCmd) {
          // CommandLine owns Esc-clear; blur here as fallback.
          (el as HTMLInputElement).value = "";
          el.blur();
        } else el?.blur?.();
      },
      closeFocused: () => patchActive((prev) => {
        if (!prev || !prev.focusedId) return prev;
        if (prev.panels.length <= 1) {
          if (!confirm("CLOSE THE LAST PANEL?")) return prev;
          return prev;
        }
        const idx = prev.panels.findIndex((p) => p.id === prev.focusedId);
        const next = prev.panels.filter((p) => p.id !== prev.focusedId);
        const nf = next[Math.max(0, Math.min(idx, next.length - 1))];
        if (maxId && prev.focusedId === maxId) setMaxId(null);
        return { ...prev, panels: next, focusedId: nf.id, layout: fitLayout(next.length), dirty: true };
      }),
      maximizeFocused: () => patchActive((prev) => {
        if (!prev?.focusedId) return prev;
        setMaxId((m) => (m === prev.focusedId ? null : prev.focusedId));
        return prev;
      }),
      focusPanelIndex: (i) => {
        flashExpose();
        patchActive((prev) => {
          if (!prev || !prev.panels[i]) return prev;
          return { ...prev, focusedId: prev.panels[i].id };
        });
      },
      cycleFocus: (dir) => patchActive((prev) => {
        if (!prev || prev.panels.length < 2) return prev;
        const idx = prev.panels.findIndex((p) => p.id === prev.focusedId);
        const n = prev.panels.length;
        const next = prev.panels[(idx + dir + n) % n];
        return { ...prev, focusedId: next.id };
      }),
      triggerFunctionKey,
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerFunctionKey]);

  if (!shell || !state) return <main className="container"><p className="muted">LOADING TERMINAL…</p></main>;

  return (
    <div className="term-root">
      <CommandLine
        focusedLabel={focusTag}
        feedOk={feedOk}
        onSubmit={(t, f, openNew, _raw, special) => {
          if (special === "MENU") {
            // BBG MENU key: back to the function directory (in place,
            // or a new panel with Shift+Enter / trailing NEW).
            patchActive((prev) => {
              if (!prev) return prev;
              const sym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
              if (openNew || !prev.focusedId) {
                if (prev.focusedId && prev.panels.length >= MAX_PANELS) {
                  // At cap — MENU reuses the focused panel instead of adding.
                  return {
                    ...prev,
                    panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: "DIR", task: null } : p)),
                    dirty: true,
                  };
                }
                const np: PanelSpec = { id: uid(), funcId: "DIR", symbol: sym };
                return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
              }
              return {
                ...prev,
                panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: "DIR", task: null } : p)),
                dirty: true,
              };
            });
            return;
          }
          if (special === "CANCEL") {
            // BBG CANCEL key: exit the focused panel's function.
            patchActive((prev) => {
              if (!prev || !prev.focusedId) return prev;
              if (prev.panels.length <= 1) {
                if (!confirm("CLOSE THE LAST PANEL?")) return prev;
                return prev;
              }
              const idx = prev.panels.findIndex((p) => p.id === prev.focusedId);
              const next = prev.panels.filter((p) => p.id !== prev.focusedId);
              const nf = next[Math.max(0, Math.min(idx, next.length - 1))];
              if (maxId && prev.focusedId === maxId) setMaxId(null);
              return { ...prev, panels: next, focusedId: nf.id, dirty: true };
            });
            return;
          }
          applyCommand(t, f, openNew);
        }}
        inputRef={cmdRef}
      />
      <TickerTape
        onPick={(sym) => applyCommand(normalizeTicker(sym), null, false)}
        onFeed={setFeedOk}
        onScore={() => applyCommand(null, "109", false)}
      />
      <div className="term-work">
        <PanelWorkspace
          panels={state.panels}
          layout={state.layout}
          focusedId={state.focusedId}
          maximizedId={maxId}
          showNumbers={expose}
          splits={splitsFor(state, state.layout)}
          onSplits={(s) => patchActive((prev) => ({ ...prev, splits: { ...defaultSplits(), ...prev.splits, [prev.layout]: s }, dirty: true }))}
          onFocus={(id) => patchActive((p) => (p ? { ...p, focusedId: id } : p))}
          onClose={(id) => patchActive((prev) => {
            if (!prev) return prev;
            if (prev.panels.length <= 1) {
              if (!confirm("CLOSE THE LAST PANEL?")) return prev;
              return prev;
            }
            const idx = prev.panels.findIndex((p) => p.id === id);
            const next = prev.panels.filter((p) => p.id !== id);
            const nf = next[Math.max(0, Math.min(idx, next.length - 1))];
            if (maxId === id) setMaxId(null);
            return { ...prev, panels: next, focusedId: prev.focusedId === id ? nf.id : prev.focusedId, layout: fitLayout(next.length), dirty: true };
          })}
          onMaximize={(id) => setMaxId((m) => (m === id ? null : id))}
          onChange={(id, next) => {
            patchActive((prev) => {
              if (!prev) return prev;
              try { if (next.symbol) store.setTicker(next.symbol); } catch { /* ignore */ }
              return { ...prev, panels: prev.panels.map((p) => (p.id === id ? next : p)), dirty: true };
            });
          }}
          onDuplicate={(id) => {
            if (state.panels.length >= MAX_PANELS) { alert("MAX 4 PANELS — CLOSE ONE TO OPEN ANOTHER."); return; }
            patchActive((prev) => {
              if (!prev) return prev;
              const src = prev.panels.find((p) => p.id === id);
              if (!src) return prev;
              const np: PanelSpec = { ...src, id: uid() };
              const idx = prev.panels.findIndex((p) => p.id === id);
              const next = [...prev.panels.slice(0, idx + 1), np, ...prev.panels.slice(idx + 1)];
              return { ...prev, panels: next, focusedId: np.id, dirty: true };
            });
          }}
          onDetach={(id) => {
            if (state.panels.length >= MAX_PANELS) { alert("MAX 4 PANELS — CLOSE ONE TO OPEN ANOTHER."); return; }
            patchActive((prev) => {
              // "Detach" splits content into an additional panel (duplicate +
              // focus the copy) — same visual result without pop-out windows.
              if (!prev) return prev;
              const src = prev.panels.find((p) => p.id === id);
              if (!src) return prev;
              const np: PanelSpec = { ...src, id: uid() };
              return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
            });
          }}
          onOpenNew={(_fromId, funcId, symbol) => {
            if (state.panels.length >= MAX_PANELS) { alert("MAX 4 PANELS — CLOSE ONE TO OPEN ANOTHER."); return; }
            patchActive((prev) => {
              if (!prev) return prev;
              if (prev.panels.length >= MAX_PANELS) return prev;
              const np: PanelSpec = { id: uid(), funcId, symbol };
              try { store.setTicker(symbol); } catch { /* ignore */ }
              return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
            });
          }}
          onReorder={(from, to) => patchActive((prev) => {
            if (!prev) return prev;
            const next = [...prev.panels];
            const [mv] = next.splice(from, 1);
            next.splice(to, 0, mv);
            return { ...prev, panels: next, dirty: true };
          })}
        />
      </div>
      <FunctionKeyBar onTrigger={(fid) => {
        patchActive((prev) => {
          if (!prev) return prev;
          const focusSym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
          if (!prev.focusedId) {
            const p: PanelSpec = { id: uid(), funcId: fid, symbol: focusSym };
            return { ...prev, panels: [p], focusedId: p.id, dirty: true };
          }
          return { ...prev, panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: fid, task: null } : p)), dirty: true };
        });
      }} />
      <StatusBar
        panelCount={state.panels.length}
        workspaceSlot={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="hl">WORKSPACE: </span>
            <WorkspaceSwitcher
              state={state}
              onLoad={(next) => {
                const panels = capPanels(next.panels);
                patchActive(() => ({ ...next, panels, focusedId: panels.some((p) => p.id === next.focusedId) ? next.focusedId : panels[0]?.id ?? null, dirty: false }));
                setMaxId(null);
              }}
              onSaved={(next) => patchActive(() => next)}
            />
          </span>
        }
        layout={state.layout}
        onLayout={(l: TilingPreset) => patchActive((prev) => (prev ? { ...prev, layout: l, dirty: true } : prev))}
        onAdd={() => {
          cmdRef.current?.focus();
          if (state.panels.length >= MAX_PANELS) { alert("MAX 4 PANELS — CLOSE ONE TO OPEN ANOTHER."); return; }
          patchActive((prev) => {
            if (!prev) return prev;
            if (prev.panels.length >= MAX_PANELS) return prev;
            const sym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
            const np: PanelSpec = { id: uid(), funcId: DEFAULT_OVERVIEW, symbol: sym };
            return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
          });
        }}
        addDisabled={state.panels.length >= MAX_PANELS}
        onSettings={() => {
          patchActive((prev) => {
            if (!prev) return prev;
            if (!prev.focusedId) {
              const p: PanelSpec = { id: uid(), funcId: "SET", symbol: "" };
              return { ...prev, panels: [p], focusedId: p.id, dirty: true };
            }
            return {
              ...prev,
              panels: prev.panels.map((p) => (p.id === prev.focusedId ? { ...p, funcId: "SET", task: null } : p)),
              dirty: true,
            };
          });
        }}
        focusLabel={focusStatus}
        ticker={focusTicker}
        desks={shell.names}
        deskIdx={shell.idx}
        onDeskSwitch={switchDesktop}
        onDeskAdd={addDesktop}
        onDeskRename={renameDesktop}
        onDeskClose={closeDesktop}
        deskAddDisabled={shell.desktops.length >= MAX_DESKTOPS}
      />
      <span className="sr-only" aria-live="polite">{focusLabelLong ? `Focused: ${focusLabelLong}` : ""}</span>
    </div>
  );
}

export default function TerminalPage() {
  return (
    <Suspense fallback={<main className="container"><p className="muted">LOADING TERMINAL…</p></main>}>
      <Inner />
    </Suspense>
  );
}
