"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { DEFAULT_MODEL } from "@/lib/ai";
import { useFreeModels } from "@/lib/useFreeModels";

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
  const { models: free, live, loading: modelsLoading } = useFreeModels();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<{ ok: boolean; verdict: string; detail: string } | null>(null);

  async function testKey() {
    setTesting(true); setVerdict(null);
    try {
      const r = await fetch("/api/ai/testkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key, model: customModel.trim() || model }),
      });
      setVerdict(await r.json());
    } catch (e: any) {
      setVerdict({ ok: false, verdict: "UNREACHABLE", detail: e?.message ?? "Request failed." });
    } finally { setTesting(false); }
  }
  const [fserver, setFserver] = useState<{ hasServerKey: boolean } | null>(null);
  const [explTrigger, setExplTrigger] = useState<"hover+click" | "click" | "off">("click");
  const [explAI, setExplAI] = useState(true);
  const [explCacheSize, setExplCacheSize] = useState(0);

  useEffect(() => {
    try {
      const m = store.getORModel();
      setKey(store.getORKey());
      setModel(m);
      if (!free.some((x) => x.id === m)) setCustomModel(m);
      setFkey(store.getFredKey());
      setExplTrigger(store.getExplainTrigger());
      setExplAI(store.getExplainAI());
      setExplCacheSize(store.getExplainCacheSize());
    } catch { /* ignore */ }
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
    // Auto-verify on open, so the panel states a FACT instead of leaving the
    // reader to trust a stored string. A key that expired days after setup is
    // the likeliest reason AI silently stops working.
    fetch("/api/ai/testkey", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: store.getORKey(), model: store.getORModel() }),
    })
      .then((r) => r.json())
      .then(setVerdict)
      .catch(() => {});
    fetch("/api/macro/key").then((r) => r.json()).then(setFserver).catch(() => {});
  }, []);

  function save() {
    const effectiveModel = customModel.trim() || model;
    try {
      store.setORKey(key.trim());
      store.setORModel(effectiveModel.trim() || DEFAULT_MODEL);
      store.setFredKey(fkey.trim());
      store.setExplainTrigger(explTrigger);
      store.setExplainAI(explAI);
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
          className="box" value={key} onChange={(e) => { setKey(e.target.value); setVerdict(null); }}
          placeholder="sk-or-… " type={showKey ? "text" : "password"} spellCheck={false} autoComplete="off"
          aria-label="OpenRouter API key override"
        />
      </label>
      <div className="toolbar" style={{ gap: 6 }}>
        <button className="ghost" onClick={() => setShowKey((v) => !v)} style={{ padding: "3px 8px", fontSize: 10.5 }}>{showKey ? "HIDE" : "SHOW"}</button>
        <button className="ghost" onClick={testKey} disabled={testing} style={{ padding: "3px 8px", fontSize: 10.5 }}>{testing ? "TESTING…" : "TEST KEY"}</button>
      </div>
      {verdict && (
        <p className={verdict.ok ? "pos" : "neg"} style={{ fontSize: 10.5, lineHeight: 1.5 }}>{verdict.verdict} — {verdict.detail}</p>
      )}

      <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
        MODEL
        <select
          className="box" value={free.some((x) => x.id === model) ? model : "__custom"}
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
          {free.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.id}</option>)}
          <option value="__custom">CUSTOM…</option>
        </select>
      </label>
      {(!free.some((x) => x.id === model) || customModel) && (
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
      <div className="faint" style={{ fontSize: 10.5 }}>
        {free.length} FREE MODELS · {live ? "LIVE FROM OPENROUTER" : modelsLoading ? "LOADING CATALOGUE…" : "OFFLINE SNAPSHOT"}
        {live ? " · REFRESHED DAILY" : ""}
      </div>

      <label style={{ display: "grid", gap: 6, fontSize: 11, color: "var(--sub)" }}>
        YOUR FRED KEY (OPTIONAL — MACRO SEARCH + TITLES)
        <input
          className="box" value={fkey} onChange={(e) => setFkey(e.target.value)}
          placeholder="32-char key (BLANK = SERVER DEFAULT)" type="password" spellCheck={false} autoComplete="off"
          aria-label="FRED API key override"
        />
      </label>

      {/* EXPLAIN MODE SETTINGS */}
      <div style={{ borderTop: "1px solid var(--grid)", paddingTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--amber)", letterSpacing: "0.08em", marginBottom: 6 }}>
          EXPLAIN MODE
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--sub)" }}>
            TRIGGER
            <select
              className="box" value={explTrigger}
              onChange={(e) => setExplTrigger(e.target.value as typeof explTrigger)}
              aria-label="Explain trigger mode"
            >
              <option value="click">CLICK — click labels to explain</option>
              <option value="hover+click">HOVER — hover for tooltip, click for full</option>
              <option value="off">OFF — disable explain on labels</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--sub)", cursor: "pointer" }}>
            <input
              type="checkbox" checked={explAI}
              onChange={(e) => setExplAI(e.target.checked)}
              style={{ accentColor: "var(--amber)" }}
            />
            AI EXPLANATIONS (TIER 2) — USES {store.getExplainerModel().split("/").pop()?.toUpperCase() ?? "NEMOTRON"}
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--sub)" }}>
            <span>CACHE: {explCacheSize} ENTRIES</span>
            <button
              className="ghost" style={{ fontSize: 10, padding: "2px 6px" }}
              onClick={() => { store.clearExplainCache(); setExplCacheSize(0); }}
            >
              CLEAR
            </button>
          </div>
        </div>
      </div>

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
