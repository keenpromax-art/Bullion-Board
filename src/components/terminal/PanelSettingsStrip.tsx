"use client";

import { useCallback, useEffect, useState } from "react";
import { store } from "@/lib/store";
import SettingsDesk, { SETTINGS_CHANGED_EVENT } from "./SettingsDesk";

function shortModel(m: string): string {
  const tail = m.split("/").pop() ?? m;
  return tail.split(":")[0].toUpperCase().slice(0, 18) || "MODEL";
}

// Collapsible quick-settings strip rendered BELOW every panel body:
// API key + model + FRED without leaving the workspace.
export default function PanelSettingsStrip({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [summary, setSummary] = useState({ model: "", hasKey: false });

  const refresh = useCallback(() => {
    try {
      setSummary({ model: store.getORModel(), hasKey: !!store.getORKey() });
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    function onStorage(e: StorageEvent) {
      if (e.key === "iss.openrouter.key" || e.key === "iss.openrouter.model") refresh();
    }
    function onCustom() { refresh(); }
    window.addEventListener("storage", onStorage);
    window.addEventListener(SETTINGS_CHANGED_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onCustom);
    };
  }, [refresh]);

  return (
    <div className="term-panel-foot">
      <button
        className={`term-settings-toggle${open ? " open" : ""}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-expanded={open}
        aria-label={open ? "Hide panel settings" : "Show panel settings — API key and model"}
        title="QUICK SETTINGS — API KEY · MODEL · FRED (STAYS IN THIS BROWSER)"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        <span aria-hidden>⚙</span>
        <span>SETTINGS</span>
        <span className="term-settings-sum">
          {summary.model ? shortModel(summary.model) : "MODEL"} · {summary.hasKey ? "● KEY" : "○ SRV KEY"}
        </span>
      </button>
      {open && (
        <div className="term-panel-settings">
          <SettingsDesk compact />
        </div>
      )}
    </div>
  );
}
