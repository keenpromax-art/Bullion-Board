"use client";

// MORNING BRIEF (spec §S8) — snap-scroll sections, every leg carries source +
// time + caveat. The AI SUMMARY is generated ON DEMAND from today's numbers
// and cached per day (bb.droid.brief.v1). Nothing here is pre-written prose.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";
import { droidStore, todayKey } from "../lib/droidStore";
import { useApi, useQuotes } from "../lib/quotes";
import type { BreadthRow, BriefCache, MarketRow } from "../lib/types";
import { ago, chg, dir, istClock, num } from "../lib/format";
import { Badge, ErrorState, H, Note, Skeleton, EmptyState } from "../ui/Pills";
import { ListRow, StatStrip, Verdict } from "../ui/Cards";

interface BreadthResp {
  adv: number;
  dec: number;
  unch: number;
  count: number;
  universe: number;
  pctAbove20: number;
  top: BreadthRow[];
  bottom: BreadthRow[];
}

interface NewsResp {
  count?: number;
  bull?: number;
  bear?: number;
  items?: Array<{ id?: string | number; title: string; link?: string; source?: string; ago?: string; label?: "BULL" | "BEAR" | "NEUT" }>;
}

const INDIA = ["^NSEI", "^NSEBANK", "^BSESN", "^INDIAVIX", "^CNXIT"];
const GLOBAL = ["^GSPC", "^FTSE", "^N225", "USDINR=X", "BTC-USD"];
const COMMOD = ["GC=F", "SI=F", "CL=F", "NG=F", "ETH-USD"];

function Section({ title, source, ts, children, caveat }: {
  title: string;
  source: string;
  ts?: number;
  children: React.ReactNode;
  caveat?: string;
}) {
  return (
    <section className="dx-card" style={{ scrollSnapAlign: "start" }}>
      <div className="p-head">
        {title} <span className="faint">- {source}</span>
      </div>
      {children}
      <div className="dx-note" style={{ marginTop: 8 }}>
        {caveat ?? "LIVE FEED."} {ts ? `UPDATED ${ago(ts)}.` : ""}
      </div>
    </section>
  );
}

export default function Brief() {
  const market = useApi<{ rows: MarketRow[]; count: number }>("/api/market");
  const breadth = useApi<BreadthResp>("/api/breadth");
  const news = useApi<NewsResp>("/api/news?feed=wire");

  const lists = useMemo(() => droidStore.getLists?.() ?? [], []);
  const wl = useMemo(() => (lists[0]?.symbols ?? []).slice(0, 8), [lists]);
  const quotes = useQuotes(wl);

  const [brief, setBrief] = useState<BriefCache | null>(() => droidStore.getBrief());
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState("");

  const rows = market.data?.rows ?? [];
  const pick = (syms: string[]) => syms.map((s) => rows.find((r) => r.sym === s)).filter((r): r is MarketRow => !!r);
  const india = pick(INDIA);
  const global = pick(GLOBAL);
  const commod = pick(COMMOD);
  const briefToday = brief && brief.date === todayKey() ? brief : null;

  const generate = useCallback(async () => {
    setGen(true);
    setGenErr("");
    try {
      const line = (rs: MarketRow[]) =>
        rs.map((r) => `${r.label} ${isFinite(r.price) ? r.price.toFixed(1) : "?"} (${isFinite(r.chgPct) ? r.chgPct.toFixed(2) : "?"}%)`).join(", ") || "DATA GAP";
      const b = breadth.data;
      const wlLine = wl
        .map((s) => {
          const q = quotes.data?.[s];
          return q ? `${s.replace(/\.(NS|BO)$/, "")} ${q.regularMarketPrice.toFixed(1)} (${q.regularMarketChangePercent.toFixed(2)}%)` : `${s} GAP`;
        })
        .join(", ");
      const text = await chatComplete(
        [
          { role: "system", content: `${aiSystem.deskChat("MORNING BRIEF")} ${NO_INVENT}` },
          {
            role: "user",
            content:
              `WRITE TODAY'S INDIA MARKET BRIEF FROM THESE NUMBERS ONLY. MARK GAPS AS GAPS.\n` +
              `INDIA: ${line(india)}\nGLOBAL: ${line(global)}\nCOMMODITIES/FX/CRYPTO: ${line(commod)}\n` +
              `BREADTH: ADV ${b?.adv ?? "?"} / DEC ${b?.dec ?? "?"} / % ABOVE 20D ${b?.pctAbove20 ?? "?"}\n` +
              `WATCHLIST: ${wlLine || "DATA GAP"}\nWIRE: ${news.data?.count ?? "?"} items (${news.data?.bull ?? "?"} bull / ${news.data?.bear ?? "?"} bear)\n` +
              `FORMAT: 4 SHORT LINES — INDIA / GLOBAL / COMMODITIES / WHAT TO WATCH. MAX 110 WORDS. NO ADVICE, NO PRICE TARGETS.`,
          },
        ],
        { model: store.getORModel(), apiKey: store.getORKey() }
      );
      const cache: BriefCache = { date: todayKey(), text, ts: Date.now() };
      droidStore.setBrief(cache);
      setBrief(cache);
    } catch (e: unknown) {
      setGenErr(e instanceof Error ? e.message.slice(0, 160) : "AI OFFLINE — ADD A KEY IN SETTINGS");
    } finally {
      setGen(false);
    }
  }, [india, global, commod, breadth.data, wl, quotes.data, news.data]);

  return (
    <div>
      <H right={<span className="dx-faint" style={{ fontSize: 10 }}>IST {istClock()}</span>}>MORNING BRIEF</H>
      <Note>SCROLL SECTIONS HORIZONTALLY OR TAP — EACH CARRIES ITS OWN SOURCE AND CAVEAT.</Note>

      <div className="dx-rprog" style={{ marginBottom: 10 }} aria-hidden>
        <span className="dx-on" />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="dx-snap">
        <Section title="INDIA" source="/api/market" ts={market.ts} caveat="INDEX BOARD — NSE/BSE LAST TRADED.">
          {market.loading && !market.data ? (
            <Skeleton rows={2} height={56} />
          ) : india.length ? (
            <div className="dx-grid2">
              {india.map((r) => (
                <Link key={r.sym} href={`/s/${encodeURIComponent(r.sym)}`} className="dx-cell dx-tap" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="dx-l">{r.label}</span>
                  <span className="dx-v">{num(r.price, 1)}</span>
                  <span className={`dx-l ${dir(r.chgPct)}`}>{chg(r.chgPct)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="NIFTY TAPE OFF" desc="THE INDEX BOARD DID NOT ANSWER — NO NUMBERS INVENTED." />
          )}
        </Section>

        <Section title="GLOBAL" source="/api/market" ts={market.ts} caveat="OVERNIGHT / CROSS-ASSET PRINTS.">
          {global.length ? (
            <div className="dx-grid2">
              {global.map((r) => (
                <Link key={r.sym} href={`/s/${encodeURIComponent(r.sym)}`} className="dx-cell dx-tap" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="dx-l">{r.label}</span>
                  <span className="dx-v">{num(r.price, 1)}</span>
                  <span className={`dx-l ${dir(r.chgPct)}`}>{chg(r.chgPct)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="GLOBAL TAPE OFF" desc="NO GLOBAL ROWS ANSWERED." />
          )}
        </Section>

        <Section
          title="FII / DII"
          source="NO FEED"
          caveat="FII/DII TAPE OFF — BETA SHOWS GAPS."
        >
          <StatStrip
            cells={[
              { label: "FII NET", value: "—", sub: "NO INSTITUTIONAL FLOW FEED" },
              { label: "DII NET", value: "—", sub: "NO INSTITUTIONAL FLOW FEED" },
              { label: "STALENESS", value: "n/a", sub: "WE WILL NOT PRINT A NUMBER WE DO NOT HAVE" },
            ]}
          />
        </Section>

        <Section title="COMMODITIES & FX" source="/api/market" ts={market.ts} caveat="FUTURES / FX LAST TRADED — NOT ADVICE.">
          {commod.length ? (
            <div className="dx-grid2">
              {commod.map((r) => (
                <Link key={r.sym} href={`/s/${encodeURIComponent(r.sym)}`} className="dx-cell dx-tap" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="dx-l">{r.label}</span>
                  <span className="dx-v">{num(r.price, 1)}</span>
                  <span className={`dx-l ${dir(r.chgPct)}`}>{chg(r.chgPct)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="COMMODITY TAPE OFF" desc="NO COMMODITY ROWS ANSWERED." />
          )}
        </Section>

        <Section title="TOP MOVERS" source="/api/breadth" ts={breadth.ts} caveat={`${breadth.data?.count ?? 0}/${breadth.data?.universe ?? 0} SCANNED — PROXY UNIVERSE.`}>
          {breadth.loading && !breadth.data ? (
            <Skeleton rows={3} height={48} />
          ) : breadth.error && !breadth.data ? (
            <ErrorState what="BREADTH" retry={breadth.refresh} detail={breadth.error} />
          ) : (
            <>
              {[...(breadth.data?.top ?? []).slice(0, 4), ...(breadth.data?.bottom ?? []).slice(0, 4)].map((m) => (
                <ListRow
                  key={m.symbol}
                  symbol={m.symbol.replace(/\.(NS|BO)$/, "")}
                  right={num(m.price, 2)}
                  rightSub={<span className={dir(m.dayChgPct)}>{chg(m.dayChgPct)}</span>}
                  onClick={() => (window.location.href = `/s/${encodeURIComponent(m.symbol)}`)}
                />
              ))}
              {!breadth.data?.top?.length && !breadth.data?.bottom?.length ? (
                <EmptyState title="NO MOVERS" desc="THE SCAN RETURNED NOTHING TODAY." />
              ) : null}
            </>
          )}
        </Section>

        <Section title="EVENTS & ALERTS" source="LOCAL + /api/events" caveat="ARMED ALERTS EVALUATE WHILE THE APP IS OPEN.">
          <ListRow
            symbol="ARMED ALERTS"
            name="TAP TO MANAGE"
            right={String((() => { try { return store.getAlerts().filter((a) => a.active).length; } catch { return 0; } })())}
            onClick={() => (window.location.href = "/notifications")}
          />
          <ListRow
            symbol="CORPORATE ACTIONS"
            name="DIVIDENDS & SPLITS (12M)"
            onClick={() => (window.location.href = "/notifications")}
          />
        </Section>

        <Section title="WATCHLIST" source="LOCAL LIST + /api/quote" ts={quotes.ts} caveat="YOUR FIRST LIST, TOP 8.">
          {quotes.loading && !quotes.data ? (
            <Skeleton rows={4} height={48} />
          ) : wl.length ? (
            wl.map((s) => {
              const q = quotes.data?.[s];
              return (
                <ListRow
                  key={s}
                  symbol={s.replace(/\.(NS|BO)$/, "")}
                  name={q?.shortName}
                  right={q ? num(q.regularMarketPrice, 2) : "—"}
                  rightSub={<span className={dir(q?.regularMarketChangePercent)}>{q ? chg(q.regularMarketChangePercent) : "—"}</span>}
                  onClick={() => (window.location.href = `/s/${encodeURIComponent(s)}`)}
                />
              );
            })
          ) : (
            <EmptyState title="EMPTY LIST" desc="ADD SYMBOLS TO YOUR FIRST WATCHLIST." action={<Link className="dx-btn" href="/watchlist">OPEN WATCHLIST</Link>} />
          )}
        </Section>

        <Section title="AI SUMMARY" source="OPENROUTER · NO_INVENT" ts={briefToday?.ts} caveat="GENERATED ON DEMAND FROM TODAY'S NUMBERS ONLY.">
          {briefToday ? (
            <>
              <div className="dx-inline" style={{ marginBottom: 8 }}>
                <Badge kind="fnc">GENERATED {new Date(briefToday.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Badge>
                <span className="dx-spacer" />
                <button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={generate} disabled={gen}>
                  {gen ? "WRITING…" : "REGENERATE"}
                </button>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{briefToday.text}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--dx-sub)", marginBottom: 10 }}>
                {gen ? "READING TODAY'S TAPE…" : "TAP TO WRITE TODAY'S SUMMARY FROM THE LIVE NUMBERS ABOVE."}
              </div>
              <button className="dx-btn" onClick={generate} disabled={gen}>
                {gen ? "WRITING…" : genErr ? "RETRY" : "GENERATE ✦"}
              </button>
              {genErr ? <div className="dx-note" style={{ color: "var(--dx-red)" }}>{genErr}</div> : null}
            </>
          )}
        </Section>
      </div>

      {breadth.data ? (
        <Verdict icon="☀">
          BREADTH {breadth.data.adv >= breadth.data.dec ? "POSITIVE" : "SOFT"} — {breadth.data.pctAbove20}% ABOVE
          THE 20-DAY LINE. {news.data?.count ?? 0} STORIES ON THE WIRE.
        </Verdict>
      ) : null}

      <Note>
        NOTHING ON THIS SCREEN IS ADVICE, AND NOTHING IS ESTIMATED: IF A FEED IS DOWN ITS SECTION
        SAYS SO. {market.ts ? `TAPE REFRESHED ${ago(market.ts)}.` : ""}
      </Note>
      <div className="dx-inline">
        <Link className="dx-pill" href="/home">⌂ TODAY</Link>
        <Link className="dx-pill" href="/markets">▤ MARKETS</Link>
        <Link className="dx-pill" href="/ai">✦ ASK AI</Link>
      </div>
    </div>
  );
}
