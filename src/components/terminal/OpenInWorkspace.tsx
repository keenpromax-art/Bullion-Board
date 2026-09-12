"use client";

import { useRouter } from "next/navigation";
import { loadActive, saveActive, uid } from "@/lib/terminal/workspaceStore";

// Lightweight "Open in workspace ▸" action for deep-link routes.
// Adds the current desk as a panel to the saved workspace, then jumps to /terminal.
export default function OpenInWorkspace({ funcId, symbol, task }: { funcId: string; symbol: string; task?: string | null }) {
  const router = useRouter();
  function open() {
    try {
      const active = loadActive();
      saveActive({
        ...active,
        panels: [...active.panels, { id: uid(), funcId, symbol, task: task ?? null }],
        focusedId: active.panels.length ? active.focusedId : null,
        dirty: true,
      });
      // Ensure focus lands on the newly added panel after navigation.
      try {
        const cur = loadActive();
        const last = cur.panels[cur.panels.length - 1];
        if (last) saveActive({ ...cur, focusedId: last.id });
      } catch { /* ignore */ }
    } catch { /* storage unavailable — still navigate */ }
    router.push(`/terminal?symbol=${encodeURIComponent(symbol)}&func=${encodeURIComponent(funcId)}${task ? `&task=${encodeURIComponent(task)}` : ""}`);
  }
  return (
    <button className="btn" onClick={open} title="Add this desk to your terminal workspace">
      OPEN IN WORKSPACE ▸
    </button>
  );
}
