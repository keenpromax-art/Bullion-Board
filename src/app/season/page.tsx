"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { SeasonDesks } from "@/components/SeasonDesks";

export default function SeasonPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  const askAI = async () => {
    setAiLoading(true); setAiOut("");
    try {
      const r = await chatComplete([
        { role: "system", content: aiSystem.seasonality() },
        { role: "user", content: `${NO_INVENT}\n\nSYMBOL=${symbol} PROVIDE 10Y SEASONALITY ANALYSIS.` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(r);
    } catch { setAiOut("AI UNAVAILABLE."); }
    setAiLoading(false);
  };

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
        {aiOut && (
          <div className="panel"><p className="p-head">AI analyst</p><p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p></div>
        )}
        {!aiOut && (
          <div className="panel"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "ANALYSING…" : "RUN AI"}</button></div>
        )}
      </main>
      <StatusBar ticker={symbol} extra="SEAS" />
    </>
  );
}
