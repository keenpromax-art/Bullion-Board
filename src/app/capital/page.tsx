"use client";

import { useEffect, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { CastDesk } from "@/components/CapitalDesks";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";

export default function CapitalPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("symbol");
    setSymbol(normalizeTicker(q || store.getTicker()));
  }, []);
  return (
    <>
      <CommandBar ticker={symbol} funcId="CAST" onTicker={setSymbol} />
      <main className="container grid">
        <CastDesk symbol={symbol} />
      </main>
      <StatusBar ticker={symbol} extra="CAST CAPITAL STRUCTURE" />
    </>
  );
}
