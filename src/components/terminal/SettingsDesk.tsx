"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { DEFAULT_MODEL, FREE_MODELS } from "@/lib/ai";

export const SETTINGS_CHANGED_EVENT = "iss:settings-changed";

export function notifySettingsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
}

// Compact settings desk — renders inside a terminal panel (SET) and is
// also reused by the global status-bar drop-up. Same backing store as
// /settings (localStorage overrides, server key stays default).
export default function SettingsDesk({ compact = false }: { compact?: boolean }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [customModel, setCustomModel] = useState("");
  const [fkey, setFkey] = useState("");
  const [saved, setSaved] = useState("");
  const [server, setServer] = useState<{ hasServerKey: boolean; model: string } | null>(null);
  const [fserver, setFserver] = useState<{ hasServerKey: boolean } | null>(null);

  useEffect(() => {
    try {
      const m = store.getORModel();
      setKey(store.getORKey());
      setModel(m);
      if (!FREE_MODELS.some((x) => x.id === m)) setCustomModel(m);
      setFkey(store.getFredKey());
    } catch { /* ignore */ }
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
    fetch("/api/macro/key").then((r) => r.json()).then(setFserver).catch(() => {});
  }, []);

  function save() {
    const effectiveModel = customModel.trim() || model;
    try {
      store.setORKey(key.trim());
      store.setORModel(effectiveModel.trim() || DEFAULT_MODEL);
      store.setFredKey(fkey.trim());
      setSaved("SAVED ✓ — APPLIES TO ALL PANELS");
      notifySettingsChanged();
    } catch {
      setSaved("SAVE FAILED — STORAGE BLOCKED");
    }
  }

  function clearKeys() {
    try {
      store.setORKey("");
      store.setFredKey("");
      setKey("");
      setFkey("");
      setSaved("CLEARED — SERVER DEFAULT ACTIVE");
      notifySettingsChanged();
    } catch { /* ignore */ }
  }

  return (
    <div className="grid term-settings" style={{ gap: compact ? 8 : 10 }}>
      <div className="cells">
        <div className="cell">
          <div className="lbl">Server key</div>
          <div className={`val ${server?.hasServerKey ? "pos" : "neg"}`} style={{ fontSize: 14 }}>
            {server ? (server.hasServerKey ? "● ACTIVE" : "○ ABSENT") : "…"}
          </div>
          <div className="sub">owner default</div>
        </div>
        <div className="cell">
          <div className="lbl">Your override</div>
          <div className={`val ${key ? "pos" : ""}`} style={{ fontSize: 14 }}>{key ? "● SET" : "○ SERVER"}</div>
          <div className="sub">this browser wins</div>
        </div>
        <div className="cell">
          <div className="lbl">FRED</div>
          <div className={`val ${fkey || fserver?.hasServerKey ? "pos" : ""}`} style={{ fontSize: 14 }}>
            {fkey ? "● SET" : fserver?.hasServerKey ? "● SRV" : "○ OFF"}
          </div>
          <div className="sub">macro upgrade</div>
        </div>
      </div>

      <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
        YOUR OPENROUTER KEY (OPTIONAL — BLANK = SERVER DEFAULT)
        <input
          className="box" value={key} onChange={(e) => setKey(e.target.value)}
          placeholder="sk-or-… " type="password" spellCheck={false} autoComplete="off"
          aria-label="OpenRouter API key override"
        />
      </label>

      <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
        MODEL
        <select
          className="box" value={FREE_MODELS.some((x) => x.id === model) ? model : "__custom"}
          onChange={(e) => {
            if (e.target.value === "__custom") {
              setModel(customModel.trim() || DEFAULT_MODEL);
            } else {
              setModel(e.target.value);
              setCustomModel("");
            }
          }}
          aria-label="Model"
        >
          {FREE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}
          <option value="__custom">CUSTOM…</option>
        </select>
      </label>
      {(!FREE_MODELS.some((x) => x.id === model) || customModel) && (
        <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
          CUSTOM MODEL ID
          <input
            className="box" value={customModel} onChange={(e) => { setCustomModel(e.target.value); if (e.target.value.trim()) setModel(e.target.value.trim()); }}
            placeholder="e.g. openai/gpt-4o-mini" spellCheck={false} autoComplete="off"
            aria-label="Custom model id"
          />
        </label>
      )}
      <div className="muted" style={{ fontSize: 11 }}>
        EFFECTIVE: <span style={{ color: "var(--text)" }}>{(customModel.trim() || model).toUpperCase()}</span>
      </div>

      <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
        YOUR FRED KEY (OPTIONAL — MACRO SEARCH + TITLES)
        <input
          className="box" value={fkey} onChange={(e) => setFkey(e.target.value)}
          placeholder="32-char key (BLANK = SERVER DEFAULT)" type="password" spellCheck={false} autoComplete="off"
          aria-label="FRED API key override"
        />
      </label>

      <div className="toolbar">
        <button className="btn" onClick={save}>SAVE</button>
        <button className="ghost" onClick={clearKeys}>USE SERVER DEFAULT</button>
        {saved && <span className="pos" style={{ fontSize: 11 }}>{saved}</span>}
      </div>
      {!compact && (
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          KEYS STAY IN THIS BROWSER ONLY — NOTHING LEAVES YOUR MACHINE EXCEPT PER-REQUEST TO OPENROUTER.
          FULL PAGE: <a href="/settings">/SETTINGS</a>
        </p>
      )}
    </div>
  );
}
