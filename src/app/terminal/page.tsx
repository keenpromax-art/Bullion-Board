"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MODULE_MAP } from "@/lib/modules";
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
  loadActive, saveActive, uid, defaultPanels, fitLayout,
  type ActiveState, type PanelSpec, type TilingPreset,
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
  const [state, setState] = useState<ActiveState | null>(null);
  const [maxId, setMaxId] = useState<string | null>(null);
  const [feedOk, setFeedOk] = useState<boolean | null>(null);
  const [expose, setExpose] = useState(false);
  const cmdRef = useRef<HTMLInputElement>(null);
  const lastFunc = useRef<Record<string, string>>({});
  const exposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { lastFunc.current = readLastFunc(); }, []);

  // Initial load: localStorage or default preset; honor ?symbol=&func= deep-add.
  useEffect(() => {
    let s = loadActive();
    if (!s.panels.length) s = { panels: defaultPanels(), layout: "4-up", focusedId: null, workspaceName: "EQUITY OVERVIEW", dirty: false };
    if (!s.focusedId && s.panels.length) s.focusedId = s.panels[0].id;
    const qSym = sp.get("symbol");
    const qFunc = sp.get("func");
    if (qSym || qFunc) {
      const sym = qSym ? normalizeTicker(qSym) : (s.panels.find((p) => p.id === s.focusedId)?.symbol ?? store.getTicker());
      const fid = qFunc && (MODULE_MAP[qFunc] || qFunc === "DIR" || qFunc === "NOTE") ? qFunc : null;
      if (fid || qSym) {
        const np: PanelSpec = { id: uid(), funcId: fid ?? DEFAULT_OVERVIEW, symbol: sym, task: sp.get("task") };
        s = { ...s, panels: [...s.panels, np], focusedId: np.id, dirty: true };
      }
    }
    setState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state) saveActive(state);
  }, [state]);

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

  const applyCommand = useCallback((ticker: string | null, funcId: string | null, openNew: boolean) => {
    setState((prev) => {
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
    setState((prev) => {
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
      closeFocused: () => setState((prev) => {
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
      maximizeFocused: () => setState((prev) => {
        if (!prev?.focusedId) return prev;
        setMaxId((m) => (m === prev.focusedId ? null : prev.focusedId));
        return prev;
      }),
      focusPanelIndex: (i) => {
        flashExpose();
        setState((prev) => {
          if (!prev || !prev.panels[i]) return prev;
          return { ...prev, focusedId: prev.panels[i].id };
        });
      },
      cycleFocus: (dir) => setState((prev) => {
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

  if (!state) return <main className="container"><p className="muted">LOADING TERMINAL…</p></main>;

  return (
    <div className="term-root">
      <CommandLine
        focusedLabel={focusTag}
        feedOk={feedOk}
        onSubmit={(t, f, openNew, _raw, special) => {
          if (special === "MENU") {
            // BBG MENU key: back to the function directory (in place,
            // or a new panel with Shift+Enter / trailing NEW).
            setState((prev) => {
              if (!prev) return prev;
              const sym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
              if (openNew || !prev.focusedId) {
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
            setState((prev) => {
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
      <TickerTape onPick={(sym) => applyCommand(normalizeTicker(sym), null, false)} onFeed={setFeedOk} />
      <div className="term-work">
        <PanelWorkspace
          panels={state.panels}
          layout={state.layout}
          focusedId={state.focusedId}
          maximizedId={maxId}
          showNumbers={expose}
          onFocus={(id) => setState((p) => (p ? { ...p, focusedId: id } : p))}
          onClose={(id) => setState((prev) => {
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
            setState((prev) => {
              if (!prev) return prev;
              try { if (next.symbol) store.setTicker(next.symbol); } catch { /* ignore */ }
              return { ...prev, panels: prev.panels.map((p) => (p.id === id ? next : p)), dirty: true };
            });
          }}
          onDuplicate={(id) => setState((prev) => {
            if (!prev) return prev;
            const src = prev.panels.find((p) => p.id === id);
            if (!src) return prev;
            const np: PanelSpec = { ...src, id: uid() };
            const idx = prev.panels.findIndex((p) => p.id === id);
            const next = [...prev.panels.slice(0, idx + 1), np, ...prev.panels.slice(idx + 1)];
            return { ...prev, panels: next, focusedId: np.id, dirty: true };
          })}
          onDetach={(id) => setState((prev) => {
            // "Detach" splits content into an additional panel (duplicate +
            // focus the copy) — same visual result without pop-out windows.
            if (!prev) return prev;
            const src = prev.panels.find((p) => p.id === id);
            if (!src) return prev;
            const np: PanelSpec = { ...src, id: uid() };
            return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
          })}
          onReorder={(from, to) => setState((prev) => {
            if (!prev) return prev;
            const next = [...prev.panels];
            const [mv] = next.splice(from, 1);
            next.splice(to, 0, mv);
            return { ...prev, panels: next, dirty: true };
          })}
        />
      </div>
      <FunctionKeyBar onTrigger={(fid) => {
        setState((prev) => {
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
              onLoad={(next) => { setState({ ...next, dirty: false }); setMaxId(null); }}
              onSaved={(next) => setState(next)}
            />
          </span>
        }
        layout={state.layout}
        onLayout={(l: TilingPreset) => setState((prev) => (prev ? { ...prev, layout: l, dirty: true } : prev))}
        onAdd={() => {
          cmdRef.current?.focus();
          setState((prev) => {
            if (!prev) return prev;
            const sym = prev.panels.find((p) => p.id === prev.focusedId)?.symbol ?? store.getTicker();
            const np: PanelSpec = { id: uid(), funcId: DEFAULT_OVERVIEW, symbol: sym };
            return { ...prev, panels: [...prev.panels, np], focusedId: np.id, dirty: true };
          });
        }}
        focusLabel={focusStatus}
        ticker={focusTicker}
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
