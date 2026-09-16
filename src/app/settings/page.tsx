"use client";

import { useEffect, useRef, useState } from "react";
import { store } from "@/lib/store";
import { DEFAULT_MODEL } from "@/lib/ai";
import { downloadBackup, parseBackup, restoreBackup } from "@/lib/backup";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";

export default function SettingsPage() {
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [saved, setSaved] = useState("");
  const [server, setServer] = useState<{ hasServerKey: boolean; model: string } | null>(null);
  const [fkey, setFkey] = useState("");
  const [fsaved, setFsaved] = useState("");
  const [fserver, setFserver] = useState<{ hasServerKey: boolean } | null>(null);
  const [explainerModel, setExplainerModel] = useState("nvidia/nemotron-3-super-120b-a12b:free");
  const [esaved, setEsaved] = useState("");
  const [withKeys, setWithKeys] = useState(true);
  const [bmsg, setBmsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setKey(store.getORKey());
    setModel(store.getORModel());
    fetch("/api/ai/status").then((r) => r.json()).then(setServer).catch(() => {});
    setFkey(store.getFredKey());
    fetch("/api/macro/key").then((r) => r.json()).then(setFserver).catch(() => {});
    setExplainerModel(store.getExplainerModel());
  }, []);

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
            <span className="muted" style={{ fontSize: 12 }}>SETTINGS STAYS A FULL PAGE — KEY NEVER LEAVES THIS BROWSER</span>
          </div>
        </div>
        <div className="panel">
          <p className="p-head">Config — model access</p>
          <div className="cells" style={{ marginBottom: 12 }}>
            <div className="cell">
              <div className="lbl">Server default key</div>
              <div className={`val ${server?.hasServerKey ? "pos" : "neg"}`} style={{ fontSize: 16 }}>
                {server ? (server.hasServerKey ? "● ACTIVE" : "○ ABSENT") : "…"}
              </div>
              <div className="sub">owner reference key</div>
            </div>
            <div className="cell">
              <div className="lbl">Your override</div>
              <div className={`val ${key ? "pos" : ""}`} style={{ fontSize: 16 }}>{key ? "● SET" : "○ SERVER DEFAULT"}</div>
              <div className="sub">this browser wins</div>
            </div>
            <div className="cell">
              <div className="lbl">Model</div>
              <div className="val" style={{ fontSize: 13 }}>{(key ? model : server?.model) || model}</div>
              <div className="sub">effective</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            AI WORKS OUT OF THE BOX ON THE SERVER KEY. PASTE YOUR OWN KEY BELOW TO OVERRIDE IT
            IN THIS BROWSER ONLY — NOTHING YOU TYPE HERE LEAVES YOUR MACHINE EXCEPT PER-REQUEST TO OPENROUTER.
          </p>
          <div className="grid" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>YOUR OPENROUTER KEY (OPTIONAL OVERRIDE)
              <input className="box" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-… (BLANK = USE SERVER DEFAULT)" type="password" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>MODEL
              <input className="box" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <div className="toolbar">
              <button className="btn" onClick={() => { store.setORKey(key); store.setORModel(model); setSaved("SAVED ✓"); }}>SAVE OVERRIDE</button>
              <button className="ghost" onClick={() => { store.setORKey(""); setKey(""); setSaved("CLEARED — SERVER DEFAULT ACTIVE"); }}>USE SERVER DEFAULT</button>
              <span className="pos">{saved}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <p className="p-head">FRED key — macro data upgrade</p>
          <div className="cells" style={{ marginBottom: 12 }}>
            <div className="cell">
              <div className="lbl">Server default key</div>
              <div className={`val ${fserver?.hasServerKey ? "pos" : "neg"}`} style={{ fontSize: 16 }}>
                {fserver ? (fserver.hasServerKey ? "● ACTIVE" : "○ ABSENT") : "…"}
              </div>
              <div className="sub">FRED_API_KEY env</div>
            </div>
            <div className="cell">
              <div className="lbl">Your override</div>
              <div className={`val ${fkey ? "pos" : ""}`} style={{ fontSize: 16 }}>{fkey ? "● SET" : "○ SERVER DEFAULT"}</div>
              <div className="sub">this browser wins</div>
            </div>
            <div className="cell">
              <div className="lbl">Unlocks</div>
              <div className="val" style={{ fontSize: 13 }}>SEARCH + META</div>
              <div className="sub">series finder, titles</div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            FREE KEY, NO CARD: FRED.STLOUISFED.ORG → MY ACCOUNT → API KEYS.
            VALUES ALREADY FLOW KEYLESS — THE KEY ADDS SERIES SEARCH (E.G. FIND ISM PMI)
            AND OFFICIAL TITLES/UNITS ON THE MACRO DESK.
          </p>
          <div className="grid" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>YOUR FRED KEY (OPTIONAL OVERRIDE)
              <input className="box" value={fkey} onChange={(e) => setFkey(e.target.value)} placeholder="32-char key (BLANK = USE SERVER DEFAULT)" type="password" />
            </label>
            <div className="toolbar">
              <button className="btn" onClick={() => { store.setFredKey(fkey); setFsaved("SAVED ✓"); }}>SAVE OVERRIDE</button>
              <button className="ghost" onClick={() => { store.setFredKey(""); setFkey(""); setFsaved("CLEARED — SERVER DEFAULT ACTIVE"); }}>USE SERVER DEFAULT</button>
              <span className="pos">{fsaved}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <p className="p-head">Line-item explainer — AI model for statement tooltips</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            WHEN YOU CLICK A LINE ITEM IN THE FINANCIAL STATEMENTS, AN AI EXPLAINS WHAT IT MEANS.
            SET THE MODEL BELOW. FREE TIER MODELS HAVE NO COST.
          </p>
          <div className="grid" style={{ marginTop: 10 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>EXPLAINER MODEL
              <input className="box" value={explainerModel} onChange={(e) => setExplainerModel(e.target.value)} />
            </label>
            <div className="toolbar">
              <button className="btn" onClick={() => { store.setExplainerModel(explainerModel); setEsaved("SAVED ✓"); }}>SAVE</button>
              <button className="ghost" onClick={() => { const d = "nvidia/nemotron-3-super-120b-a12b:free"; store.setExplainerModel(d); setExplainerModel(d); setEsaved("RESET TO DEFAULT"); }}>RESET</button>
              <span className="pos">{esaved}</span>
            </div>
          </div>
        </div>
        <div className="panel">
          <p className="p-head">Backup & restore — move devices</p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            NO ACCOUNTS HERE — WATCHLISTS, WORKSPACES, PORTFOLIO, ALERTS, NOTES,
            CHAT SESSIONS AND KEYS LIVE IN THIS BROWSER ONLY. EXPORT A BACKUP FILE
            AND IMPORT IT ON YOUR OTHER DEVICE TO CARRY EVERYTHING OVER.
          </p>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <label className="muted" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} />
              INCLUDE API KEYS
            </label>
            <button className="btn" onClick={() => {
              try {
                const n = downloadBackup(withKeys);
                setBmsg(`EXPORTED ${n} KEYS ✓`);
              } catch (e: unknown) { setBmsg(e instanceof Error ? e.message : "EXPORT FAILED"); }
            }}>↓ EXPORT BACKUP</button>
            <button className="ghost" onClick={() => fileRef.current?.click()}>↑ IMPORT BACKUP</button>
            <input
              ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (!confirm("REPLACE THIS BROWSER'S STATE WITH THE BACKUP FILE?")) return;
                f.text().then((t) => {
                  try {
                    const n = restoreBackup(parseBackup(t));
                    setBmsg(`RESTORED ${n} KEYS ✓ — RELOADING…`);
                    setTimeout(() => window.location.reload(), 800);
                  } catch (err: unknown) { setBmsg(err instanceof Error ? err.message : "IMPORT FAILED"); }
                }).catch(() => setBmsg("COULD NOT READ FILE"));
              }}
            />
            {bmsg && <span className="pos" style={{ fontSize: 12 }}>{bmsg}</span>}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
            BACKUP FILES WITH KEYS CONTAIN SECRETS — STORE THEM LIKE A PASSWORD.
          </p>
        </div>
      </main>
      <StatusBar extra="CONFIG" />
    </>
  );
}
