"use client";

import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { store } from "@/lib/store";
import UniverseDesk from "@/components/UniverseDesks";

export default function UniversePage() {
  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="116" symbol={store.getTicker()} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
          </div>
        </div>
        <UniverseDesk />
      </main>
      <StatusBar extra="WLD" />
    </>
  );
}
