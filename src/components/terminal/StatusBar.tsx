"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODULES } from "@/lib/modules";
import { useClock } from "@/components/TerminalChrome";
import { store } from "@/lib/store";
import { useExplain } from "@/components/Explain";
import SettingsDesk, { SETTINGS_CHANGED_EVENT } from "./SettingsDesk";
import type { TilingPreset } from "@/lib/terminal/workspaceStore";

const LAYOUTS: Array<{ id: TilingPreset; label: string }> = [
  { id: "1-up", label: "1-UP" },
  { id: "2-up-v", label: "2-UP" },
  { id: "2-up-h", label: "2-H" },
  { id: "3-up-r", label: "3-R" },
  { id: "3-up-l", label: "3-L" },
  { id: "4-up", label: "4-UP" },
];

export default function StatusBar({
  panelCount,
  workspaceSlot,
  layout,
  onLayout,
  onAdd,
  focusLabel,
  ticker,
  addDisabled,
  desks,
  deskIdx,
  onDeskSwitch,
  onDeskAdd,
  onDeskRename,
  onDeskClose,
  deskAddDisabled,
  onSettings,
  onTour,
}: {
  panelCount: number;
  workspaceSlot: React.ReactNode;
  layout: TilingPreset;
  onLayout: (l: TilingPreset) => void;
  onAdd: () => void;
  focusLabel: string | null;
  ticker?: string;
  addDisabled?: boolean;
  desks: string[];
  deskIdx: number;
  onDeskSwitch: (i: number) => void;
  onDeskAdd: () => void;
  onDeskRename: (i: number) => void;
  onDeskClose: (i: number) => void;
  deskAddDisabled?: boolean;
  onSettings?: () => void;
  onTour?: () => void;
}) {
  const clock = useClock();
  const { mode: explainMode, toggleMode: toggleExplain } = useExplain();
  // Global settings: one control for every panel (key/model/FRED live in
  // one browser store — this drop-up edits the same values everywhere).
  const [setOpen, setSetOpen] = useState(false);
  const [summary, setSummary] = useState({ model: "", hasKey: false });
  const setWrapRef = useRef<HTMLSpanElement>(null);

  const refreshSummary = useCallback(() => {
    try {
      setSummary({ model: store.getORModel(), hasKey: !!store.getORKey() });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshSummary();
    function onStorage(e: StorageEvent) {
      if (e.key === "iss.openrouter.key" || e.key === "iss.openrouter.model") refreshSummary();
    }
    function onCustom() { refreshSummary(); }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SETTINGS_CHANGED_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onCustom);
    };
  }, [refreshSummary]);

  useEffect(() => {
    if (!setOpen) return;
    function onDoc(e: MouseEvent) {
      if (setWrapRef.current && !setWrapRef.current.contains(e.target as Node)) setSetOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setSetOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [setOpen]);

  const shortModel = (() => {
    const tail = summary.model.split("/").pop() ?? summary.model;
    return tail.split(":")[0].toUpperCase().slice(0, 14) || "MODEL";
  })();
  return (
    <div className="statusbar term-status" role="status" aria-label="Terminal status">
      {/* hide-sm = below 1024px, hide-md = below 1400px. The bar scrolls with a
          hidden scrollbar, so anything past ~1400px of content is simply gone
          with no affordance. The low-value read-outs yield first; the desk
          switcher and the action cluster never do. */}
      <span><span className="feed-dot" />YAHOO FEED · LIVE</span>
      <span className="dot hide-sm">|</span>
      <span className="hide-sm">{MODULES.length} FUNC</span>
      <span className="dot">|</span>
      <span>{panelCount} PANEL{panelCount === 1 ? "" : "S"} OPEN</span>
      <span className="dot">|</span>
      {workspaceSlot}
      <span className="dot hide-md">|</span>
      <span className="hl hide-sm">DESKS:</span>
      <span className="desk-chips" role="tablist" aria-label="Virtual desktops">
        {desks.map((n, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === deskIdx}
            className={`desk-chip${i === deskIdx ? " active" : ""}`}
            onClick={() => onDeskSwitch(i)}
            onDoubleClick={() => onDeskRename(i)}
            onContextMenu={(e) => { e.preventDefault(); onDeskClose(i); }}
            title={`${n} — CLICK TO SWITCH · DOUBLE-CLICK TO RENAME · RIGHT-CLICK TO CLOSE`}
          >{n}</button>
        ))}
        <button
          className="add-btn" onClick={onDeskAdd} disabled={deskAddDisabled}
          title={deskAddDisabled ? "Max desktops reached" : "New desktop"}
          aria-label="New desktop"
        >+</button>
      </span>
      {focusLabel && (
        <>
          <span className="dot hide-md">|</span>
          <span className="hide-md">FOCUS: {focusLabel}</span>
        </>
      )}
      {/* The ticker repeats the cmd bar's ticker field verbatim, so it is the
          first thing to go when the bar runs out of room. */}
      {ticker && <span className="sec hide-lg">{ticker}</span>}
      <span className="term-status-spacer" />
      <select
        className="lay-sel"
        value={layout}
        onChange={(e) => onLayout(e.target.value as TilingPreset)}
        title="Tile layout"
        aria-label="Tile layout"
      >
        {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <button
        className="add-btn" onClick={onAdd} disabled={addDisabled}
        title={addDisabled ? "Max 4 panels — close one to add another" : "Add panel"}
      >+ <span className="hide-md">PANEL</span></button>
      <a
        className="add-btn" href="/home"
        title="Bullion Droid — the mobile-first surface"
        aria-label="Open Bullion Droid"
      >◧ <span className="hide-md">DROID</span></a>
      {onSettings && (
        <button
          className="add-btn" onClick={onSettings}
          title="Open settings desk (SET) — API key · model · FRED"
          aria-label="Open settings"
        >⚙ <span className="hide-md">SET</span></button>
      )}
      <span className="set-wrap" ref={setWrapRef}>
        <button
          className="add-btn" onClick={() => setSetOpen((v) => !v)}
          title={`Global settings — ${shortModel} · ${summary.hasKey ? "key stored" : "no key"} (applies to ALL panels)`}
          aria-label="Global settings"
          aria-expanded={setOpen}
        >⚙ <span className="hide-sm">{shortModel} · {summary.hasKey ? "● KEY" : "○ SRV"}</span><span className="sr-only">Global settings</span></button>
        {setOpen && (
          <div className="set-drop" role="dialog" aria-label="Global settings">
            <p className="p-head">Global settings — applies to all panels</p>
            <SettingsDesk compact />
          </div>
        )}
      </span>
      {onTour && (
        <button
          className="add-btn" onClick={onTour}
title="Replay the first-run guided tour"
        aria-label="Replay guided tour"
      >? <span className="hide-md">TOUR</span></button>
      )}
      <button
        className="add-btn"
        onClick={toggleExplain}
        style={explainMode ? { color: "#ffa028", borderColor: "#ffa028" } : undefined}
        title="Toggle EXPLAIN MODE — every label becomes explainable (Alt+E)"
        aria-label="Toggle explain mode"
        aria-pressed={explainMode}
      ><span className="hide-md">EXPLAIN</span><span className="sr-only">Toggle explain mode</span>{explainMode ? " ● ON" : ""}</button>
      <span className="hide-sm">{clock} IST</span>
    </div>
  );
}
