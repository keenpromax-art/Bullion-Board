"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { NotesDesk } from "@/components/NotesDesk";

export default function NotesPage() {
  const [ticker, setTicker] = useState("RELIANCE.NS");

  useEffect(() => {
    setTicker(store.getTicker());
  }, []);

  return (
    <>
      <CommandBar ticker={ticker} onTicker={(t) => { setTicker(t); store.setTicker(t); }} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="NOTE" symbol={ticker} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
            <span className="faint" style={{ fontSize: 11 }}>DEVICE-LOCAL RESEARCH LOG · SAME STORE AS THE TERMINAL PANEL</span>
          </div>
        </div>
        <NotesDesk symbol={ticker} />
      </main>
      <StatusBar ticker={ticker} extra="NOTES" />
    </>
  );
}
