"use client";

// AI (spec §S6) — full-screen chat. Sessions live in `iss.ai.sessions` (shared
// with the desktop AI panel), the context chip reflects the market right now,
// and every prompt carries NO_INVENT.

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, useQuotes } from "../lib/quotes";
import type { BreadthRow, MarketRow } from "../lib/types";
import { chg, istStamp, num } from "../lib/format";
import { Badge, ErrorState, H, Note, Skeleton } from "../ui/Pills";
import AIChatPanel from "../ui/AIChatPanel";

interface BreadthResp {
  adv: number;
  dec: number;
  count: number;
  universe: number;
  pctAbove20: number;
  top: BreadthRow[];
  bottom: BreadthRow[];
}

const WATCH = ["^NSEI", "^NSEBANK", "^BSESN"];

export default function AIScreen() {
  const params = useSearchParams();
  const initial = params.get("q") ?? undefined;

  const market = useApi<{ rows: MarketRow[] }>("/api/market");
  const breadth = useApi<BreadthResp>("/api/breadth");
  const quotes = useQuotes(WATCH);

  const context = useMemo(() => {
    const rows = market.data?.rows ?? [];
    const pick = (s: string) => rows.find((r) => r.sym === s);
    const line = WATCH.map((s) => {
      const r = pick(s);
      return r && isFinite(r.price) ? `${r.label} ${r.price.toFixed(0)} (${r.chgPct.toFixed(2)}%)` : `${s} GAP`;
    }).join(" · ");
    const b = breadth.data;
    const movers = [...(b?.top ?? []), ...(b?.bottom ?? [])].slice(0, 3)
      .map((m) => `${m.symbol.replace(/\.(NS|BO)$/, "")} ${chg(m.dayChgPct)}`)
      .join(", ");
    return [
      line || "INDICES: DATA GAP",
      b ? `BREADTH ${b.adv}/${b.dec} · ${b.pctAbove20}% ABOVE 20D (${b.count}/${b.universe} SCANNED)` : "BREADTH: DATA GAP",
      movers ? `MOVERS: ${movers}` : "MOVERS: DATA GAP",
      `AS OF ${istStamp()}`,
    ].join(" · ");
  }, [market.data, breadth.data]);

  return (
    <div>
      <H right={<span className="dx-faint" style={{ fontSize: 10 }}>{istStamp()}</span>}>ASK BULLION DROID</H>

      <div className="dx-inline" style={{ marginBottom: 10 }}>
        <Badge kind="fnc">CONTEXT: LIVE TAPE</Badge>
        <Badge kind="mute">NO_INVENT</Badge>
        <span className="dx-spacer" />
        <button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={() => { market.refresh(); breadth.refresh(); }}>
          ⟳ TAPE
        </button>
      </div>

      <div className="dx-card" style={{ marginBottom: 10 }}>
        <div className="p-head">CONTEXT CHIP</div>
        {market.loading && breadth.loading ? (
          <Skeleton rows={1} height={40} />
        ) : market.error && !market.data && breadth.error && !breadth.data ? (
          <ErrorState what="CONTEXT TAPE" retry={() => { market.refresh(); breadth.refresh(); }} />
        ) : (
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "var(--dx-sub)" }}>{context}</div>
        )}
        <div className="dx-note" style={{ marginTop: 6 }}>
          THE CHIP IS ATTACHED TO EVERY PROMPT SO THE MODEL ANSWERS FROM TODAY&apos;S PRINTS, NOT FROM MEMORY.
        </div>
      </div>

      <AIChatPanel
        context={context}
        desk="AI HOME"
        symbol={null}
        initialQuery={initial}
        placeholder="ASK ABOUT THE MARKET, A DESK, OR A STRATEGY…"
        sessionTitle="AI HOME"
      />

      <Note>
        ANSWERS ARE GENERATED WITH THE `NO_INVENT` GUARDRAIL: IF A NUMBER IS NOT IN THE CONTEXT ABOVE
        THE MODEL MUST CALL IT A GAP. NOTHING HERE IS INVESTMENT ADVICE.
      </Note>

      <div className="dx-inline">
        <span className="dx-faint" style={{ fontSize: 10 }}>
          NIFTY {num(quotes.data?.["^NSEI"]?.regularMarketPrice, 0)} · SENSEX {num(quotes.data?.["^BSESN"]?.regularMarketPrice, 0)} · BANK {num(quotes.data?.["^NSEBANK"]?.regularMarketPrice, 0)}
        </span>
        <span className="dx-spacer" />
        <span className={`dx-faint ${breadth.data && breadth.data.adv >= breadth.data.dec ? "dx-up" : breadth.data ? "dx-down" : ""}`} style={{ fontSize: 10 }}>
          {breadth.data ? `ADV/DEC ${breadth.data.adv}/${breadth.data.dec}` : "BREADTH —"}
        </span>
      </div>
    </div>
  );
}
