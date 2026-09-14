"use client";

import { store } from "@/lib/store";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { CalcDesks } from "@/components/CalcDesks";

export default function CalcPage() {
  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Desk calculators</p>
          <CalcDesks />
        </div>
      </main>
      <StatusBar extra="CALC" />
    </>
  );
}
