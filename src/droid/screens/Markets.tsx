"use client";

// MARKET PULSE (spec §S2) — indices, breadth, movers, sector heat (Nifty-50
// proxy), commodities/FX. FII/DII has no feed yet → honest "—" caveat.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HBars } from "@/components/charts";
import { sectorOf, SECTORS } from "@/lib/sectors";
import { droidStore } from "../lib/droidStore";
import { useApi } from "../lib/quotes";
import type { BreadthRow, MarketRow } from "../lib/types";
import { chg, dir, num } from "../lib/format";
import { ErrorState, H, Note, Pills, Skeleton, EmptyState } from "../ui/Pills";
import { ListRow, Verdict } from "../ui/Cards";

interface BreadthResp {
  adv: number;
  dec: number;
  unch: number;
  count: number;
  universe: number;
  pctAbove20: number;
  top: BreadthRow[];
  bottom: BreadthRow[];
  shockers: BreadthRow[];
  gaps: BreadthRow[];
}

const MOVER_TABS = [
  { id: "gainers", label: "GAINERS" },
  { id: "losers", label: "LOSERS" },
  { id: "volume", label: "VOLUME" },
];

export default function Markets() {
  const router = useRouter();
  const market = useApi<{ rows: MarketRow[] }>("/api/market");
  const breadth = useApi<BreadthResp>("/api/breadth");
  const [tab, setTab] = useState("gainers");

  const rows = market.data?.rows ?? [];
  const indices = rows.filter((r) => r.sym.startsWith("^"));
  const commodities = rows.filter((r) => ["GC=F", "SI=F", "CL=F", "NG=F", "USDINR=X"].includes(r.sym));
  const globals = rows.filter((r) => ["^GSPC", "^FTSE", "^N225", "BTC-USD", "ETH-USD"].includes(r.sym));

  const sectorHeat = useMemo(() => {
    const b = breadth.data;
    if (!b) return null;
    const buckets = new Map<string, { sum: number; n: number; name: string }>();
    const universe: BreadthRow[] = [...b.top, ...(b.bottom ?? [])];
    // top+bottom only cover 16 names; recompute from what we have, honestly labelled.
    for (const r of universe) {
      const key = sectorOf(r.symbol) ?? "OTHER";
      const cur = buckets.get(key) ?? { sum: 0, n: 0, name: SECTORS[key]?.name ?? key };
      cur.sum += r.dayChgPct;
      cur.n += 1;
      buckets.set(key, cur);
    }
    return [...buckets.entries()]
      .map(([k, v]) => ({ key: k, name: v.name, avg: v.n ? v.sum / v.n : NaN, n: v.n }))
      .filter((x) => isFinite(x.avg))
      .sort((a, b2) => b2.avg - a.avg);
  }, [breadth.data]);

  const movers = useMemo(() => {
    const b = breadth.data;
    if (!b) return [];
    if (tab === "gainers") return b.top;
    if (tab === "losers") return b.bottom;
    return b.shockers;
  }, [breadth.data, tab]);

  const go = (sym: string) => {
    droidStore.pushRecent(sym);
    router.push(`/s/${encodeURIComponent(sym)}`);
  };

  const loading = market.loading && breadth.loading;
  const failed = !!market.error && !!breadth.error;

  return (
    <div>
      {failed ? (
        <ErrorState what="MARKET TAPE" retry={() => { market.refresh(); breadth.refresh(); }} />
      ) : null}

      <H right={market.error ? <span style={{ fontSize: 10, color: "var(--dx-red)" }}>TAPE OFF</span> : undefined}>
        INDICES
      </H>
      {loading ? (
        <Skeleton rows={2} height={54} />
      ) : (
        <div className="dx-grid2">
          {indices.map((i) => (
            <button key={i.sym} className="dx-cell dx-tap" onClick={() => go(i.sym)} type="button">
              <span className="dx-l">{i.label}</span>
              <span className="dx-v">{num(i.price, 0)}</span>
              <span className={`dx-l ${dir(i.chgPct)}`}>{chg(i.chgPct)}</span>
            </button>
          ))}
        </div>
      )}
      {!loading && !indices.length && !market.error ? <EmptyState title="NO INDEX TAPE" /> : null}

      <H right={<Link href="/d/107" style={{ fontSize: 10 }}>FULL BOARD →</Link>}>BREADTH</H>
      {breadth.loading ? (
        <Skeleton rows={2} height={64} />
      ) : breadth.error ? (
        <ErrorState what="BREADTH SCAN" retry={breadth.refresh} detail={breadth.error} />
      ) : breadth.data ? (
        <div className="dx-card">
          <div className="dx-grid3">
            <div className="dx-cell">
              <span className="dx-l">ADVANCE</span>
              <span className="dx-v dx-up">{num(breadth.data.adv, 0)}</span>
            </div>
            <div className="dx-cell">
              <span className="dx-l">DECLINE</span>
              <span className="dx-v dx-down">{num(breadth.data.dec, 0)}</span>
            </div>
            <div className="dx-cell">
              <span className="dx-l">UNCH</span>
              <span className="dx-v">{num(breadth.data.unch, 0)}</span>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="dx-metric">
              <span className="dx-ml">% ABOVE 20-DAY LINE</span>
              <span className="dx-mv">{num(breadth.data.pctAbove20, 1)}%</span>
            </div>
            <div className="dx-metric">
              <span className="dx-ml">GAP SCREAMERS (≥1.5%)</span>
              <span className="dx-mv">{num(breadth.data.gaps?.length ?? 0, 0)}</span>
            </div>
            <div className="dx-metric">
              <span className="dx-ml">FII / DII FLOW</span>
              <span className="dx-mv dx-faint">—</span>
            </div>
          </div>
          <div className="dx-note">
            FII/DII TAPE OFF — NO FLOW FEED WIRED YET, SO NO NUMBER IS SHOWN.
            SCANNED {breadth.data.count}/{breadth.data.universe} OF THE NIFTY-50 PROXY.
          </div>
        </div>
      ) : null}

      <H>MOVERS</H>
      <Pills items={MOVER_TABS} value={tab} onChange={setTab} ariaLabel="Mover filter" />
      <div className="dx-list" style={{ marginTop: 8 }}>
        {breadth.loading ? (
          <Skeleton rows={4} height={52} />
        ) : movers.length ? (
          movers.map((r) => (
            <ListRow
              key={r.symbol}
              symbol={r.symbol.replace(".NS", "")}
              right={num(r.price, 2)}
              rightSub={
                <span className={dir(r.dayChgPct)}>
                  {tab === "volume" ? `${num(r.volRatio, 2)}× AVG VOL` : chg(r.dayChgPct)}
                </span>
              }
              onClick={() => go(r.symbol)}
            />
          ))
        ) : (
          <EmptyState title="NO MOVERS ON THIS TAPE" />
        )}
      </div>

      <H>SECTOR HEAT — NIFTY-50 PROXY</H>
      {sectorHeat && sectorHeat.length ? (
        <div className="dx-card">
          <HBars
            height={sectorHeat.length * 24}
            rows={sectorHeat.map((s) => ({
              label: s.name.split(" ")[0].toUpperCase(),
              value: s.avg,
              display: `${s.avg > 0 ? "+" : ""}${s.avg.toFixed(2)}%`,
              color: s.avg >= 0 ? "var(--green)" : "var(--red)",
            }))}
          />
          <Note>MEAN 1-DAY MOVE OF THE {sectorHeat.reduce((a, s) => a + s.n, 0)} PROXY NAMES THAT MAP TO A SECTOR.</Note>
        </div>
      ) : (
        <Skeleton rows={2} height={70} />
      )}

      <H right={<Link href="/d/111" style={{ fontSize: 10 }}>MACRO →</Link>}>COMMODITIES &amp; FX</H>
      <div className="dx-grid2">
        {commodities.map((c) => (
          <button key={c.sym} className="dx-cell dx-tap" onClick={() => go(c.sym)} type="button">
            <span className="dx-l">{c.label}</span>
            <span className="dx-v">{num(c.price, 2)}</span>
            <span className={`dx-l ${dir(c.chgPct)}`}>{chg(c.chgPct)}</span>
          </button>
        ))}
      </div>

      <H>GLOBAL</H>
      <div className="dx-grid2">
        {globals.map((c) => (
          <button key={c.sym} className="dx-cell dx-tap" onClick={() => go(c.sym)} type="button">
            <span className="dx-l">{c.label}</span>
            <span className="dx-v">{num(c.price, 0)}</span>
            <span className={`dx-l ${dir(c.chgPct)}`}>{chg(c.chgPct)}</span>
          </button>
        ))}
      </div>

      {breadth.data ? (
        <Verdict>
          {breadth.data.adv > breadth.data.dec
            ? `ADVANCES LEAD ${breadth.data.adv}:${breadth.data.dec}`
            : breadth.data.dec > breadth.data.adv
              ? `DECLINES LEAD ${breadth.data.dec}:${breadth.data.adv}`
              : "BREADTH IS BALANCED"}{" "}
          ACROSS THE PROXY UNIVERSE — {breadth.data.pctAbove20}% ABOVE THE 20-DAY LINE.
        </Verdict>
      ) : null}
    </div>
  );
}
