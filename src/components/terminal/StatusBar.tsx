"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODULES } from "@/lib/modules";
import { useClock } from "@/components/TerminalChrome";
import { store } from "@/lib/store";
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
      <span><span className="feed-dot" />YAHOO FEED · LIVE</span>
      <span className="dot hide-sm">|</span>
      <span className="hide-sm">{MODULES.length} FUNC</span>
      <span className="dot">|</span>
      <span>{panelCount} PANEL{panelCount === 1 ? "" : "S"} OPEN</span>
      <span className="dot">|</span>
      {workspaceSlot}
      <span className="dot">|</span>
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
          <span className="dot hide-sm">|</span>
          <span className="hide-sm">FOCUS: {focusLabel}</span>
        </>
      )}
      {ticker && <span className="sec hide-sm">{ticker}</span>}
      <span style={{ flex: 1 }} />
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
      >+ PANEL</button>
      {onSettings && (
        <button
          className="add-btn" onClick={onSettings}
          title="Open settings desk (SET) — API key · model · FRED"
          aria-label="Open settings"
        >⚙ SET</button>
      )}
      <span className="set-wrap" ref={setWrapRef}>
        <button
          className="add-btn" onClick={() => setSetOpen((v) => !v)}
          title="Global settings — API key · model · FRED (applies to ALL panels)"
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
        >? TOUR</button>
      )}
      <span>{clock} IST</span>
    </div>
  );
}
