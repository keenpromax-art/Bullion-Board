"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { SeasonDesks } from "@/components/SeasonDesks";

export default function SeasonPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("symbol");
    setSymbol(normalizeTicker(q || store.getTicker()));
  }, []);

  return (
    <>
      <CommandBar ticker={symbol} onTicker={setSymbol} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="105" symbol={symbol} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
          </div>
        </div>
        <div className="panel panel-glow">
          <p className="p-head">Seasonality — {symbol} · 10Y monthly</p>
          <SeasonDesks symbol={symbol} showInput />
        </div>
      </main>
      <StatusBar ticker={symbol} extra="SEAS" />
    </>
  );
}
