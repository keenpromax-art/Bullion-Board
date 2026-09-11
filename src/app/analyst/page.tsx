"use client";

import { useEffect, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { ANRDesk } from "@/components/CapitalDesks";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";

export default function AnalystPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("symbol");
    setSymbol(normalizeTicker(q || store.getTicker()));
  }, []);
  return (
    <>
      <CommandBar ticker={symbol} funcId="ANR" onTicker={setSymbol} />
      <main className="container grid">
        <ANRDesk symbol={symbol} />
      </main>
      <StatusBar ticker={symbol} extra="ANR ANALYST RATINGS" />
    </>
  );
}
