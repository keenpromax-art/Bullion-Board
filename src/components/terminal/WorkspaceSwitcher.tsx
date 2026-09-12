"use client";

import { useState } from "react";
import type { ActiveState } from "@/lib/terminal/workspaceStore";
import { listWorkspaces, saveWorkspaceSnapshot, deleteWorkspace, renameWorkspace, exportWorkspace, importWorkspace } from "@/lib/terminal/workspaceStore";

export default function WorkspaceSwitcher({
  state,
  onLoad,
  onSaved,
}: {
  state: ActiveState;
  onLoad: (next: ActiveState, name: string | null) => void;
  onSaved: (next: ActiveState, name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(listWorkspaces());
  const [msg, setMsg] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  function refresh() { setSaved(listWorkspaces()); }

  function doSave() {
    const n = name.trim().toUpperCase() || state.workspaceName || "MY LAYOUT";
    const all = saveWorkspaceSnapshot(n, { ...state, dirty: false });
    setSaved(all);
    setName("");
    setMsg(`SAVED “${n}” ✓`);
    onSaved({ ...state, workspaceName: n, dirty: false }, n);
  }

  function doLoad(wsName: string) {
    const w = listWorkspaces().find((x) => x.name === wsName);
    if (!w) return;
    onLoad({ panels: w.panels, layout: w.layout, focusedId: w.focusedId, workspaceName: w.name, dirty: false }, w.name);
    setOpen(false);
  }

  return (
    <div className="ws-switch">
      <button className="ghost ws-btn" onClick={() => { refresh(); setOpen((v) => !v); }} aria-expanded={open} title="Save / load workspaces">
        ▤ {state.workspaceName ?? "UNSAVED"}{state.dirty ? "*" : ""} ▾
      </button>
      {open && (
        <div className="ws-drop" role="dialog" aria-label="Workspaces">
          <div className="sug-head">SAVE CURRENT LAYOUT</div>
          <div className="toolbar" style={{ padding: "0 12px" }}>
            <input className="box" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder={state.workspaceName ?? "NAME… (E.G. EARNINGS)"} style={{ flex: 1 }} />
            <button className="btn" style={{ padding: "8px 12px" }} onClick={doSave}>SAVE</button>
          </div>
          <div className="sug-head">SAVED WORKSPACES ({saved.length})</div>
          {saved.map((w) => (
            <div key={w.name} className="sug-row ws-row">
              <button className="ws-load" onClick={() => doLoad(w.name)} title={`Load ${w.name}`}>
                <span className="sug-sym">{w.name}</span>
                <span className="sug-meta">{w.panels.length}P · {w.layout}</span>
              </button>
              {renaming === w.name ? (
                <span className="ws-rename">
                  <input className="box" value={renameTo} onChange={(e) => setRenameTo(e.target.value.toUpperCase())} style={{ width: 110 }} />
                  <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => { setSaved(renameWorkspace(w.name, renameTo || w.name)); setRenaming(null); }}>✓</button>
                </span>
              ) : (
                <span className="ws-ops">
                  <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => { setRenaming(w.name); setRenameTo(w.name); }}>REN</button>
                  <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => { setSaved(deleteWorkspace(w.name)); setMsg(`DELETED “${w.name}”`); }}>DEL</button>
                  <button className="ghost" style={{ padding: "4px 8px" }} onClick={() => {
                    const blob = new Blob([JSON.stringify(w, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `workspace-${w.name}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                  }}>↓</button>
                </span>
              )}
            </div>
          ))}
          {saved.length === 0 && <div className="sug-row"><span className="sug-meta">NO SAVED LAYOUTS — NAME + SAVE ABOVE.</span></div>}
          <div className="sug-head">EXPORT / IMPORT JSON</div>
          <div className="toolbar" style={{ padding: "0 12px 12px 12px" }}>
            <button className="ghost" onClick={() => {
              const blob = new Blob([exportWorkspace(state)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "workspace.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}>↓ EXPORT</button>
            <label className="ghost" style={{ padding: "8px 12px", cursor: "pointer" }}>↑ IMPORT
              <input type="file" accept="application/json" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const txt = await f.text();
                const next = importWorkspace(txt);
                if (next) { onLoad(next, null); setMsg("IMPORTED ✓"); }
                else setMsg("IMPORT FAILED — BAD FILE");
              }} />
            </label>
            {msg && <span className="pos" style={{ fontSize: 11 }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
