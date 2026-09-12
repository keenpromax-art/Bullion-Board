"use client";

import { MODULES } from "@/lib/modules";
import { useClock } from "@/components/TerminalChrome";

export default function StatusBar({
  panelCount,
  workspaceName,
  dirty,
  focusLabel,
  ticker,
}: {
  panelCount: number;
  workspaceName: string | null;
  dirty: boolean;
  focusLabel: string | null;
  ticker?: string;
}) {
  const clock = useClock();
  return (
    <div className="statusbar term-status" role="status" aria-label="Terminal status">
      <span><span className="feed-dot" />YAHOO FEED</span>
      <span>{MODULES.length} FUNC</span>
      <span>{panelCount} PANEL{panelCount === 1 ? "" : "S"}</span>
      <span title="Loaded workspace">{workspaceName ?? "UNSAVED"}{dirty ? "*" : ""}</span>
      {focusLabel && <span title="Focused panel">FOCUS ▸ {focusLabel}</span>}
      {ticker && <span className="sec">{ticker}</span>}
      <span style={{ marginLeft: "auto" }}>{clock}</span>
    </div>
  );
}
