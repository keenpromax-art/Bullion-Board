"use client";

// "Add Bullion Droid to your home screen" card (spec §9).
// Honors beforeinstallprompt, remembers dismissal.

import { useEffect, useState } from "react";
import { droidStore } from "../lib/droidStore";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let dismissed = true;
    try {
      dismissed = droidStore.installDismissed();
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    const onBIP = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  if (!visible || done) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 10,
        right: 10,
        bottom: "calc(var(--dx-nav) + var(--dx-safe-b) + 10px)",
        zIndex: 80,
        background: "var(--dx-panel)",
        border: "1px solid var(--dx-amber)",
        borderRadius: 3,
        padding: "12px 12px 10px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
      }}
      role="dialog"
      aria-label="Install Bullion Droid"
    >
      <div className="dx-sheet-title" style={{ marginBottom: 6 }}>
        ◈ INSTALL BULLION DROID
      </div>
      <div style={{ fontSize: 12, color: "var(--dx-sub)", lineHeight: 1.6, marginBottom: 10 }}>
        ADD THE TERMINAL TO YOUR HOME SCREEN — WATCHLIST, RESEARCH AND ALERTS
        ONE TAP AWAY. LIVE TAPE STILL NEEDS A NETWORK.
      </div>
      <div className="dx-inline">
        <button
          className="dx-btn"
          onClick={async () => {
            if (evt) {
              try {
                await evt.prompt();
                const res = await evt.userChoice;
                if (res.outcome === "accepted") setDone(true);
              } catch {
                /* prompt already consumed */
              }
            }
            setVisible(false);
          }}
        >
          INSTALL
        </button>
        <button
          className="dx-btn dx-ghost"
          onClick={() => {
            try {
              droidStore.dismissInstall();
            } catch {
              /* ignore */
            }
            setVisible(false);
          }}
        >
          NOT NOW
        </button>
      </div>
    </div>
  );
}
