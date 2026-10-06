"use client";

// TODAY (spec §S1) — the default home screen: market snapshot, watchlist,
// what changed, AI brief (generated on tap, never pre-written), quick actions.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";
import { droidStore, todayKey } from "../lib/droidStore";
import { useApi, useApiPoll, useQuotes } from "../lib/quotes";
import type { BreadthRow, BriefCache, MarketRow } from "../lib/types";
import { ago, chg, dir, istClock, istDate, num, partOfDay, pct, signed } from "../lib/format";
import { H, ErrorState, Note, Skeleton, EmptyState, Badge } from "../ui/Pills";
import { ListRow, SignalRow, Verdict } from "../ui/Cards";

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
  count: number;
  bull: number;
  bear: number;
  items?: Array<{ id: string; title: string; link: string; source: string; ago: string; label: "BULL" | "BEAR" | "NEUT" }>;
}

// /api/opening — pre-open call card (module 109 engine, src/lib/opening.ts).
// The engine returns a weight-normalised EDGE in [-1,+1] and a gated verdict,
// not a +/-1 vote count. Both are surfaced; the gate is what decides the call.
interface OpeningLeg {
  key: string;
  short: string;
  group: string;
  chg: number | null;
  vote: number | null;
  deadbanded: boolean;
  stale: boolean;
}
interface OpeningScore {
  edge?: number | null;
  verdict?: string;
  confidence?: number;
  coverage?: number;
  legsUsed?: number;
  legCount?: number;
  probUp?: number | null;
  regime?: string | null;
  legs?: OpeningLeg[];
}
interface OpeningResp {
  fetchedAtIST?: string;
  currentSlot?: string;
  target?: string;
  phaseLabel?: string;
  vix?: { last?: number | null; regime?: string | null } | null;
  gap?: { gapPct?: number | null } | null;
  caveats?: string[];
  predict?: OpeningScore;
}

export default function Home() {
  const router = useRouter();
  const market = useApi<{ rows: MarketRow[] }>("/api/market");
  const breadth = useApi<BreadthResp>("/api/breadth");
  const news = useApiPoll<NewsResp>("/api/news?feed=wire");
  const opening = useApi<OpeningResp>("/api/opening");
  const lists = useMemo(() => droidStore.getLists(), []);
  const watch = useMemo(() => (lists[0]?.symbols ?? []).slice(0, 6), [lists]);
  const quotes = useQuotes(watch);
  const [brief, setBrief] = useState<BriefCache | null>(() => droidStore.getBrief());
  const [gen, setGen] = useState(false);
  const [genErr, setGenErr] = useState("");

  const indices = useMemo(() => {
    const rows = market.data?.rows ?? [];
    const want = ["^NSEI", "^NSEBANK", "^BSESN"];
    const picked = want.map((s) => rows.find((r) => r.sym === s)).filter(Boolean) as MarketRow[];
    return picked.length ? picked : rows.slice(0, 3);
  }, [market.data]);

  const alerts = useMemo(() => {
    try {
      const a = store.getAlerts();
      return {
        armed: a.filter((x) => x.active && !x.triggered).length,
        hit: a.filter((x) => x.triggered).length,
      };
    } catch {
      return { armed: 0, hit: 0 };
    }
  }, []);

  const movers = useMemo(() => {
    const rows = [...(breadth.data?.top ?? []), ...(breadth.data?.bottom ?? [])];
    return rows.filter((r) => Math.abs(r.dayChgPct) >= 3).length;
  }, [breadth.data]);

  // opening call (module 109): edge in [-1,+1] gated into a verdict by regime
  const op = opening.data?.predict;
  const opVerdict = op?.verdict ?? "NO_DATA";
  const opColor =
    opVerdict === "GREEN" ? "var(--dx-green)"
    : opVerdict === "RED" ? "var(--dx-red)"
    : "var(--dx-sub)";
  const CALL_TEXT: Record<string, string> = {
    GREEN: "GAP UP",
    RED: "GAP DOWN",
    FLAT: "STAND ASIDE",
    NO_DATA: "NO CALL",
  };
  const opEdgeText =
    op?.edge === null || op?.edge === undefined ? "—" : signed(op.edge, 2);

  const briefToday = brief && brief.date === todayKey() ? brief : null;

  const generateBrief = useCallback(async () => {
    setGen(true);
    setGenErr("");
    try {
      const snap = indices
        .map((i) => `${i.label} ${isFinite(i.price) ? i.price.toFixed(0) : "?"} (${isFinite(i.chgPct) ? i.chgPct.toFixed(2) : "?"}%)`)
        .join(", ");
      const b = breadth.data;
      const wl = (lists[0]?.symbols ?? []).slice(0, 8).join(", ");
      const text = await chatComplete(
        [
          {
            role: "system",
            content: `${aiSystem.deskChat("MARKET WRAP / MORNING BRIEF")} ${NO_INVENT}`,
          },
          {
            role: "user",
            content:
              `WRITE TODAY'S INDIA MARKET BRIEF. USE ONLY THESE NUMBERS, MARK GAPS AS GAPS.\n` +
              `INDICES: ${snap || "DATA GAP"}\n` +
              `BREADTH (NIFTY-50 PROXY): ADV ${b?.adv ?? "?"} / DEC ${b?.dec ?? "?"} / % ABOVE 20D ${b?.pctAbove20 ?? "?"}\n` +
              `WATCHLIST: ${wl || "DATA GAP"}\n` +
              `WIRE HEADLINES: ${news.data?.count ?? "?"} items, ${news.data?.bull ?? "?"} bull / ${news.data?.bear ?? "?"} bear.\n` +
              `FORMAT: 3 SHORT SECTIONS — WHAT MATTERS / WHY / WHAT TO WATCH. MAX 130 WORDS.`,
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
  }, [indices, breadth.data, news.data, lists]);

  const allLoading = market.loading && breadth.loading;
  const anyError = market.error && breadth.error;

  return (
    <div>
      <div className="dx-sec-top" style={{ marginBottom: 4 }}>
        <div>
          <div className="dx-sec-meta">{istDate()}</div>
          <div className="dx-sec-name" style={{ fontSize: 17, color: "var(--dx-text)", fontWeight: 700 }}>
            GOOD {partOfDay()}
          </div>
        </div>
        <div className="dx-sec-meta">IST {istClock()}</div>
      </div>

      {anyError ? (
        <ErrorState what="MARKET TAPE" retry={() => { market.refresh(); breadth.refresh(); news.refresh(); }} />
      ) : null}

      <H right={<Link href="/markets" style={{ fontSize: 10 }}>ALL →</Link>}>MARKET SNAPSHOT</H>
      {allLoading ? (
        <Skeleton rows={1} height={64} />
      ) : indices.length ? (
        <div className="dx-grid3">
          {indices.map((i) => (
            <Link key={i.sym} href={`/s/${encodeURIComponent(i.sym)}`} className="dx-cell dx-tap" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="dx-l">{i.label}</span>
              <span className="dx-v">{num(i.price, 0)}</span>
              <span className={`dx-l ${dir(i.chgPct)}`}>{chg(i.chgPct)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="NO INDEX TAPE" desc="THE INDEX BOARD DID NOT ANSWER." />
      )}

      <H
        right={
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="dx-btn dx-ghost"
              style={{ minHeight: 26, fontSize: 10, padding: "0 8px" }}
              onClick={opening.refresh}
              disabled={opening.loading}
              aria-label="Refresh opening score"
            >
              {opening.loading ? "…" : "⟳"}
            </button>
            <Link href="/d/109" style={{ fontSize: 10 }}>FULL DESK →</Link>
          </span>
        }
      >
        OPENING SCORE
      </H>
      {opening.loading && !opening.data ? (
        <Skeleton rows={1} height={92} />
      ) : opening.error && !opening.data ? (
        <ErrorState what="OPENING SCORE" retry={opening.refresh} detail={opening.error} />
      ) : opening.data ? (
        <div className="dx-card">
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 86, flex: "0 0 auto" }}>
              <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: opColor }} className="dx-mono-num">
                {opEdgeText}
              </div>
              <div
                style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", marginTop: 5, color: opColor }}
              >
                {CALL_TEXT[opVerdict] ?? opVerdict}
              </div>
              <div className="dx-faint" style={{ fontSize: 9.5, marginTop: 6, letterSpacing: "0.06em" }}>
                EDGE −1…+1 · {op?.legsUsed ?? 0}/{op?.legCount ?? 0} LEGS
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {(op?.legs ?? []).map((l) => (
                <SignalRow
                  key={l.key}
                  label={l.short}
                  value={l.chg === null || l.chg === undefined ? "—" : pct(l.chg, 2, true)}
                  tone={l.vote === null || l.vote === undefined ? null : l.vote}
                  detail={
                    l.chg === null || l.chg === undefined
                      ? "NO TAPE"
                      : l.stale
                        ? "STALE"
                        : l.deadbanded
                          ? "0"
                          : l.vote === null || l.vote === undefined
                            ? "—"
                            : signed(l.vote, 2)
                  }
                />
              ))}
              {!op?.legs?.length ? (
                <div className="dx-note" style={{ marginTop: 0 }}>
                  NO LEGS RETURNED — THE CALL SHOWS GAPS.
                </div>
              ) : null}
            </div>
          </div>
          <div className="dx-note">
            {opening.data.target ?? "—"} · SLOT {opening.data.currentSlot ?? "—"} · REGIME {op?.regime ?? "—"} ·
            CONF {pct((op?.confidence ?? 0) * 100, 0)} · COVERAGE {pct((op?.coverage ?? 0) * 100, 0)}
          </div>
          {opening.data.vix?.last != null && (
            <div className="dx-note">INDIA VIX {num(opening.data.vix.last, 2)}</div>
          )}
          {opening.data.gap?.gapPct != null && (
            <div className="dx-note">REALISED OPEN GAP {signed(opening.data.gap.gapPct, 2)}%</div>
          )}
          {opVerdict === "NO_DATA" ? (
            <div className="dx-note" style={{ color: "var(--dx-sub)" }}>
              COVERAGE BELOW THE FLOOR — NO DIRECTION PUBLISHED, NOTHING INVENTED.
            </div>
          ) : opVerdict === "FLAT" ? (
            <div className="dx-note" style={{ color: "var(--dx-sub)" }}>
              EDGE INSIDE THE GATE — A FLAT VERDICT MEANS NO POSITION.
            </div>
          ) : null}
          {!!opening.data.caveats?.length && (
            <div className="dx-note" style={{ color: "var(--dx-sub)" }}>
              {opening.data.caveats.length} DATA CAVEAT{opening.data.caveats.length === 1 ? "" : "S"} — {opening.data.caveats[0]}
            </div>
          )}
        </div>
      ) : null}

      <H right={<Link href="/watchlist" style={{ fontSize: 10 }}>WATCHLIST →</Link>}>YOUR WATCHLIST</H>
      {quotes.loading ? (
        <Skeleton rows={3} height={52} />
      ) : quotes.error ? (
        <ErrorState what="WATCHLIST QUOTES" retry={quotes.refresh} detail={quotes.error} />
      ) : watch.length === 0 ? (
        <EmptyState
          title="EMPTY WATCHLIST"
          desc="ADD A SYMBOL FROM ANY SECURITY PAGE."
          action={<Link className="dx-btn" href="/search">FIND A SYMBOL</Link>}
        />
      ) : (
        <div className="dx-list">
          {watch.map((s) => {
            const q = quotes.data?.[s];
            return (
              <ListRow
                key={s}
                symbol={s.replace(/\.(NS|BO)$/, "")}
                name={q?.shortName}
                right={q ? num(q.regularMarketPrice, 2) : "—"}
                rightSub={<span className={dir(q?.regularMarketChangePercent)}>{q ? chg(q.regularMarketChangePercent) : "—"}</span>}
                onClick={() => {
                  droidStore.pushRecent(s);
                  router.push(`/s/${encodeURIComponent(s)}`);
                }}
              />
            );
          })}
        </div>
      )}

      <H>WHAT CHANGED</H>
      <div className="dx-grid2">
        <div className="dx-cell">
          <span className="dx-l">STOCKS MOVED &gt;3%</span>
          <span className="dx-v">{breadth.loading ? "…" : breadth.error ? "—" : String(movers)}</span>
          <span className="dx-l" style={{ color: "var(--dx-faint)" }}>NIFTY-50 PROXY</span>
        </div>
        <div className="dx-cell">
          <span className="dx-l">ADV / DEC</span>
          <span className="dx-v">
            {breadth.loading ? "…" : breadth.error ? "—" : `${num(breadth.data?.adv, 0)} / ${num(breadth.data?.dec, 0)}`}
          </span>
          <span className="dx-l" style={{ color: "var(--dx-faint)" }}>
            {breadth.data ? `${breadth.data.count}/${breadth.data.universe} SCANNED` : "SCANNING…"}
          </span>
        </div>
        <div className="dx-cell">
          <span className="dx-l">NEWS ON THE WIRE</span>
          <span className="dx-v">{news.loading ? "…" : news.error ? "—" : String(news.data?.count ?? "—")}</span>
          <span className="dx-l" style={{ color: "var(--dx-faint)" }}>
            {news.data ? `${news.data.bull} BULL / ${news.data.bear} BEAR` : "WIRE OFF"}
          </span>
        </div>
        <div className="dx-cell">
          <span className="dx-l">ALERTS ARMED / HIT</span>
          <span className="dx-v">{alerts.armed} / {alerts.hit}</span>
          <span className="dx-l" style={{ color: "var(--dx-faint)" }}>
            {alerts.hit > 0 ? <Badge kind="fnc">{alerts.hit} TRIGGERED</Badge> : "NONE TRIGGERED"}
          </span>
        </div>
      </div>
      <Note>EVERY COUNT IS COMPUTED FROM THE LIVE TAPE — A MISSING LEG SHOWS “—”, NEVER A GUESS.</Note>

      <H right={<Link href="/brief" style={{ fontSize: 10 }}>OPEN →</Link>}>AI MARKET BRIEF</H>
      <div className="dx-card">
        {briefToday ? (
          <>
            <div className="dx-inline" style={{ marginBottom: 8 }}>
              <Badge kind="fnc">AI</Badge>
              <span className="dx-faint" style={{ fontSize: 10 }}>
                GENERATED {new Date(briefToday.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} IST
              </span>
              <span className="dx-spacer" />
              <button className="dx-btn dx-ghost" style={{ minHeight: 34, fontSize: 11 }} onClick={generateBrief} disabled={gen}>
                {gen ? "WRITING…" : "REGENERATE"}
              </button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{briefToday.text}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.65, color: "var(--dx-sub)", marginBottom: 10 }}>
              {gen
                ? "READING TODAY'S TAPE…"
                : "GENERATE A WRAPPED BRIEF FROM TODAY'S INDICES, BREADTH, WATCHLIST AND WIRE."}
            </div>
            <button className="dx-btn" onClick={generateBrief} disabled={gen}>
              {gen ? "WRITING…" : genErr ? "RETRY" : "GENERATE BRIEF ✦"}
            </button>
            {genErr ? <div className="dx-note" style={{ color: "var(--dx-red)" }}>{genErr}</div> : null}
          </>
        )}
      </div>

      <H>QUICK ACTIONS</H>
      <div className="dx-inline">
        <Link className="dx-pill" href="/search">⌕ SEARCH</Link>
        <Link className="dx-pill" href="/d/67">◎ SCREENER</Link>
        <Link className="dx-pill" href="/d/109">◐ OPENING</Link>
        <Link className="dx-pill" href="/d/110">◈ OPTION CHAIN</Link>
        <Link className="dx-pill" href="/d/111">▤ MACRO</Link>
        <Link className="dx-pill" href="/brief">☀ BRIEF</Link>
        <Link className="dx-pill" href="/more">☰ ALL DESKS</Link>
      </div>

      {breadth.data ? (
        <Verdict>
          BREADTH {breadth.data.adv >= breadth.data.dec ? "POSITIVE" : "SOFT"} —{" "}
          {breadth.data.pctAbove20}% OF THE PROXY UNIVERSE IS ABOVE ITS 20-DAY LINE.
          {breadth.data.count < breadth.data.universe ? ` (${breadth.data.count}/${breadth.data.universe} SCANNED)` : ""}
        </Verdict>
      ) : null}

      <div className="dx-note" style={{ marginTop: 14 }}>
        TAPE REFRESHED {market.ts ? ago(market.ts) : "—"} · QUOTES POLL EVERY 15S · DATA: YAHOO + RSS (BETA)
      </div>
    </div>
  );
}
