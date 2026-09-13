"use client";

// Single-panel host for deep-link routes (/module/[id], /ochain, /macro,
// /notes, /settings, ...). Renders the SAME Panel component used inside the
// workspace, in a full-viewport host wrapped in terminal chrome, plus an
// "Open in workspace ▸" action that adds it to the current/default workspace.

import Panel from "./Panel";
import type { PanelSpec } from "@/lib/terminal/workspaceStore";
import { loadActive, saveActive, uid, MAX_PANELS } from "@/lib/terminal/workspaceStore";
import { useRouter } from "next/navigation";

export default function SinglePanelHost({ spec }: { spec: PanelSpec }) {
  const router = useRouter();
  function openInWorkspace() {
    try {
      const active = loadActive();
      const next: PanelSpec = { ...spec, id: uid() };
      if (active.panels.length >= MAX_PANELS) {
        // At the 4-panel cap reuse the focused panel instead of adding.
        const target = active.focusedId ?? active.panels[0]?.id;
        saveActive({
          ...active,
          panels: active.panels.map((p) => (p.id === target ? next : p)),
          focusedId: target,
          dirty: true,
        });
      } else {
        saveActive({ ...active, panels: [...active.panels, next], focusedId: next.id, dirty: true });
      }
    } catch { /* storage unavailable */ }
    router.push("/terminal");
  }
  return (
    <div className="term-grid" data-layout="1-up">
      <Panel
        spec={spec} index={0} focused maximized={false} showNumber={false}
        onFocus={() => {}}
        onClose={() => router.push("/terminal")}
        onMaximize={() => {}}
        onChange={() => {}}
        onDuplicate={openInWorkspace}
        onDetach={openInWorkspace}
      />
      <div className="panel" style={{ marginTop: 8 }}>
        <button className="btn" onClick={openInWorkspace}>OPEN IN WORKSPACE ▸</button>
        <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>ADDS THIS DESK AS A PANEL IN YOUR TERMINAL WORKSPACE</span>
      </div>
    </div>
  );
}
