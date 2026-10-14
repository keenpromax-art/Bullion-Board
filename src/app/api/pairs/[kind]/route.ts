// Pairs / stat-arb desk (functions PR 27 and ARB 48) — one endpoint, three kinds.
//
//   radar     screen the universe on the formation window, run walk-forward
//             out-of-sample on the survivors, return the live signal table,
//             the portfolio basket and the per-pair out-of-sample book.
//   pair      one pair in full: walk-forward vs the static v1 baseline, the
//             z / spread / hedge tapes and the equity curves.
//   sectors   the same radar restricted to one sector — the desk's universe
//             pill calls this so a scan is not always the whole book.
//
// Honesty contract, same as every other route here: a leg that cannot be read
// comes back as a named UPPERCASE reason, never as an empty table that reads
// like "no pairs passed". In-sample figures are labelled IN-SAMPLE wherever
// they appear, because the whole point of the split is that the reader knows
// which side of it a number is on.

import { NextRequest, NextResponse } from "next/server";
import { fetchHistoryTick } from "@/lib/yahoo";
import type { LiveTick } from "@/lib/yahoo";
import { normalizeTicker } from "@/lib/utils";
import {
  bare,
  buildUniverse,
  CURATED_PAIRS,
  findDatedJumps,
  istDate,
  PAIR_SECTORS,
  P,
  sessionWindowOpen,
  toNS,
} from "@/lib/pairs";
import {
  analysePair,
  buildPortfolio,
  screenUniverse,
  signalFor,
  universeTickers,
  type PairDetail,
  type PriceBars,
} from "@/lib/pairsResearch";
import type { WFResult } from "@/lib/pairs";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const HISTORY = "5y";
/** Yahoo will not answer a hundred simultaneous chart requests. */
const FETCH_CONCURRENCY = 8;
/**
 * Per-symbol ceiling. A ticker that has not answered by now is dropped and
 * reported in `failedSymbols` instead of consuming the route's whole budget —
 * one hung request must not turn the scan into a truncated response.
 */
const SYMBOL_TIMEOUT_MS = 12000;
/**
 * Radar results are cached briefly so a desk refresh (or two panels open at
 * once) does not re-pull the whole universe from Yahoo. 60s matches the
 * terminal's own quote cadence: the selection cannot change inside it, and the
 * live z-scores stay current.
 */
const RADAR_TTL_MS = 60_000;
const RADAR_CACHE = new Map<string, { ts: number; body: unknown }>();

function fail(kind: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, kind, error, ...extra }, { status: 200 });
}

/**
 * Bounded-concurrency fetch. A slow ticker must not stall the whole scan.
 *
 * Each symbol's chart response carries the exchange's last print in `meta`, so
 * the live tick is captured here on the way past — the desk needs today's bar
 * and there is no reason to spend a second Yahoo request per symbol getting it.
 */
async function loadCloses(
  symbols: string[]
): Promise<{
  bars: Map<string, PriceBars>;
  ticks: Map<string, LiveTick>;
  failed: Array<{ symbol: string; why: string }>;
}> {
  const bars = new Map<string, PriceBars>();
  const ticks = new Map<string, LiveTick>();
  const failed: Array<{ symbol: string; why: string }> = [];
  const queue = [...symbols];
  const worker = async () => {
    for (;;) {
      const sym = queue.shift();
      if (!sym) return;
      try {
        const got = await Promise.race([
          fetchHistoryTick(sym, HISTORY, "1d"),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`NO RESPONSE IN ${SYMBOL_TIMEOUT_MS / 1000}s`)), SYMBOL_TIMEOUT_MS)
          ),
        ]);
        // Adjusted close, not raw close: a pairs spread is meaningless across a
        // split or a bonus issue, and Yahoo carries both.
        const clean: PriceBars = got.bars
          .filter((b) => Number.isFinite(b.close) && b.close > 0)
          .map((b) => ({ date: b.date, close: typeof b.adjClose === "number" && b.adjClose > 0 ? b.adjClose : b.close }));
        if (clean.length) bars.set(sym, clean);
        else failed.push({ symbol: sym, why: "NO BARS RETURNED" });
        if (got.tick) ticks.set(sym, got.tick);
      } catch (e) {
        failed.push({ symbol: sym, why: e instanceof Error ? e.message.toUpperCase() : "FETCH FAILED" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, symbols.length) }, worker));
  return { bars, ticks, failed };
}

export interface LiveOverlayReport {
  /** True when at least one leg now carries today's session. */
  applied: boolean;
  /** ISO date of the newest bar in the series, or null. */
  sessionDate: string | null;
  /** True when the exchange is inside its session, so today's bar is incomplete. */
  partial: boolean;
  /** Legs whose series now ends on today's session. */
  symbolsUpdated: number;
  /** Of those, how many Yahoo's published daily row did not yet carry. */
  symbolsRewritten: number;
  symbolsTotal: number;
  /** Legs Yahoo gave no last-price timestamp for. */
  noTickLegs: number;
  note: string;
}

/**
 * Same as `overlayLiveSession`, but never throws.
 *
 * The live tick is an enhancement on top of a scan that already works. If the
 * batched quote call fails, the correct outcome is a desk showing last-settled
 * figures with a stated reason — not a 500 that loses the whole radar.
 */
async function overlaySafe(
  series: Map<string, PriceBars>,
  ticks: Map<string, LiveTick>
): Promise<LiveOverlayReport> {
  try {
    return overlayLiveSession(series, ticks);
  } catch (e) {
    return {
      applied: false,
      sessionDate: null,
      partial: false,
      symbolsUpdated: 0,
      symbolsRewritten: 0,
      symbolsTotal: series.size,
      noTickLegs: series.size,
      note: `TODAY'S SESSION COULD NOT BE CHECKED (${e instanceof Error ? e.message.toUpperCase() : "CHART FEED FAILED"}) — EVERY FIGURE IS THE LAST DAILY BAR ON FILE.`,
    };
  }
}

/** A leg whose last print is older than this is not really tracking the tape. */
const STALE_LEG_MIN = 20;

/**
 * Fold today's session into each series.
 *
 * Yahoo publishes a daily bar for today only once it has something to publish,
 * and it lags by a row for a while after the open. Meanwhile the same chart
 * response's `meta` always carries `regularMarketTime` / `regularMarketPrice` —
 * the exchange's most recent print, updated through the session. So when a print
 * exists for today the bar is written in (overwriting Yahoo's own row if it is
 * already there, since that row is the one going stale).
 *
 * "Print exists but bar missing" is exactly the case that made the desk read a
 * day behind while the market was open.
 *
 * An in-progress session is a PARTIAL bar, so this reports `partial` and the
 * desk labels every affected figure provisional — silently pairing a live price
 * with yesterday's z is the worse failure.
 */
function overlayLiveSession(
  series: Map<string, PriceBars>,
  ticks: Map<string, LiveTick>
): LiveOverlayReport {
  const nowSec = Math.floor(Date.now() / 1000);
  // Compare against the IST date, not the UTC one: between 00:00 and 05:30 IST
  // the two disagree, and "today" for a NSE instrument is always the IST one.
  const today = istDate(nowSec);
  // Is the exchange inside its session right now? This, not the print timestamp,
  // is what decides whether today's bar is final: a closing-auction print is
  // stamped seconds BEFORE the bell, so "print time < close" would leave every
  // settled close flagged as running all evening.
  const windowOpen = sessionWindowOpen(nowSec);
  let written = 0;
  let carried = 0;
  let lastDate: string | null = null;
  let stale = 0;
  let noTick = 0;

  for (const [sym, bars] of series) {
    const t = ticks.get(sym);
    const tail = bars[bars.length - 1];
    if (tail && (!lastDate || tail.date > lastDate)) lastDate = tail.date;
    if (!t) {
      noTick++;
      continue;
    }
    const d = istDate(t.epoch);
    if (d !== today) continue;                           // last print is an older session
    const px = t.price;
    if (tail && tail.date === today) {
      if (tail.close === px) {
        carried++;                                      // already on today's print
      } else {
        bars[bars.length - 1] = { date: today, close: px };
        carried++;
        written++;
      }
    } else {
      bars.push({ date: today, close: px });
      carried++;
      written++;
    }
    lastDate = today;
    if ((nowSec - t.epoch) / 60 > STALE_LEG_MIN) stale++;
  }

  const applied = carried > 0;
  const partial = applied && windowOpen;
  // Only meaningful while the tape is running. Once the exchange has closed, a
  // print that is hours old IS the close — reporting it as a lag would be noise.
  const caveat =
    partial && stale ? ` ${stale} LEG(S) HAVE NOT PRINTED IN OVER ${STALE_LEG_MIN} MINUTES — THEIR PRICE MAY LAG THE TAPE.` : "";
  return {
    applied,
    sessionDate: lastDate,
    partial,
    symbolsUpdated: carried,
    symbolsRewritten: written,
    symbolsTotal: series.size,
    noTickLegs: noTick,
    note: applied
      ? partial
        ? `TODAY'S SESSION (${lastDate}) IS INCLUDED AND STILL RUNNING — EVERY Z, TRIGGER PRICE AND TICKET ON THIS SCREEN IS PROVISIONAL AND WILL MOVE UNTIL THE CLOSE.${caveat}`
        : `TODAY'S CLOSE (${lastDate}) IS INCLUDED AND IS FINAL.${noTick ? ` ${noTick} LEG(S) PUBLISHED NO LAST-PRICE TIMESTAMP AND CARRY THEIR LAST DAILY BAR.` : ""}`
      : `NO PRINT YET FOR TODAY — THE LAST BAR ON FILE IS ${lastDate ?? "UNKNOWN"}, SO EVERY FIGURE IS THE LAST SETTLED CLOSE. THE DESK PICKS UP TODAY'S SESSION AUTOMATICALLY AS SOON AS IT OPENS.`,
  };
}

/** Build the pair list for a sector slice, or the whole curated universe. */
function pairsFor(sector: string | null): Array<[string, string]> {
  if (!sector || sector === "ALL") return buildUniverse();
  const names = PAIR_SECTORS[sector];
  if (!names) return buildUniverse();
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < names.length; i++) out.push([toNS(names[i]), toNS(names[i + 1])]);
  for (const [a, b] of CURATED_PAIRS) {
    if (names.includes(a) && names.includes(b)) {
      const k = `${toNS(a)}|${toNS(b)}`;
      if (!out.some(([x, y]) => `${x}|${y}` === k)) out.push([toNS(a), toNS(b)]);
    }
  }
  return out;
}

const SECTOR_KEYS = Object.keys(PAIR_SECTORS);

/**
 * Canonicalise the sector. The desk's pills carry the mixed-case keys ("Banks")
 * but a hand-typed URL uppercases, so matching case-insensitively and returning
 * the CANONICAL key is what keeps the pill rail highlighted.
 */
function canonicalSector(raw: string | null): string | null {
  const v = (raw ?? "ALL").trim().toUpperCase();
  if (v === "ALL") return "ALL";
  return SECTOR_KEYS.find((k) => k.toUpperCase() === v) ?? null;
}

// ------------------------------------------------------- data-integrity scan

export interface DataQualityReport {
  /** Symbols requested, read, and dropped for want of history. */
  symbolsRequested: number;
  symbolsRead: number;
  /** Symbols Yahoo refused, with the reason. */
  failedSymbols: Array<{ symbol: string; why: string }>;
  /** Pairs with too few shared bars to split into formation and out-of-sample. */
  droppedPairs: Array<{ pair: string; why: string }>;
  /**
   * One-bar moves at or beyond `P.JUMP_PCT`. Each is a probable split, bonus
   * issue or demerger rather than a trading day, and any pair whose spread spans
   * one has a z-score history made of a single step.
   */
  jumps: Array<{ symbol: string; date: string; pct: number; pairs: string[] }>;
  /** Newest bar date across every symbol that returned data. */
  lastBar: string | null;
  /** Shortest and longest series in the universe. */
  barRange: [number, number] | null;
}

/**
 * Scan the universe for data that would quietly poison the statistics.
 *
 * A split or demerger rewrites the price level without changing the business, and
 * a spread built across one is not a spread — it is a step function. The failure
 * mode is nasty because it flatters: a pair straddling an unhealed jump looks
 * superbly cointegrated, mean-reverting to nothing. Yahoo's adjusted close heals
 * ordinary splits but usually not demergers, which is exactly why this scan runs
 * rather than trusting the adjustment.
 *
 * Jumps are reported, not silently dropped. Hiding them would make the universe
 * look clean while quietly making it smaller than the desk claims.
 */
function scanQuality(
  bars: Map<string, PriceBars>,
  pairs: Array<[string, string]>,
  failed: Array<{ symbol: string; why: string }>,
  symbolsRequested: number,
  droppedPairs: Array<{ pair: string; why: string }>
): DataQualityReport {
  const byJump = new Map<string, Array<{ date: string; pct: number }>>();
  let lastBar: string | null = null;
  let shortest = Infinity;
  let longest = 0;

  for (const [sym, series] of bars) {
    const closes = series.map((b) => b.close);
    shortest = Math.min(shortest, closes.length);
    longest = Math.max(longest, closes.length);
    const tail = series[series.length - 1];
    if (tail && (!lastBar || tail.date > lastBar)) lastBar = tail.date;
    for (const j of findDatedJumps(
      series.map((b) => b.date),
      closes
    )) {
      if (!Number.isFinite(j.pct)) continue;             // length mismatch, not a jump
      const list = byJump.get(sym);
      if (list) list.push({ date: j.date, pct: j.pct });
      else byJump.set(sym, [{ date: j.date, pct: j.pct }]);
    }
  }

  // Name the pairs each jumped symbol actually contaminates, so the warning is
  // actionable rather than decorative.
  const pairsBySymbol = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    for (const s of [a, b]) {
      if (!byJump.has(s)) continue;
      const list = pairsBySymbol.get(s);
      const label = `${bare(a)}/${bare(b)}`;
      if (list) list.push(label);
      else pairsBySymbol.set(s, [label]);
    }
  }

  const jumps = [...byJump.entries()]
    .flatMap(([symbol, list]) =>
      list.map((j) => ({
        symbol: bare(symbol),
        date: j.date,
        pct: j.pct,
        pairs: pairsBySymbol.get(symbol) ?? [],
      }))
    )
    .sort((x, y) => Math.abs(y.pct) - Math.abs(x.pct));

  return {
    symbolsRequested,
    symbolsRead: bars.size,
    failedSymbols: failed.slice(0, 20),
    droppedPairs: droppedPairs.slice(0, 20),
    jumps: jumps.slice(0, 40),
    lastBar,
    barRange: Number.isFinite(shortest) ? [shortest, longest] : null,
  };
}

export async function GET(req: NextRequest, ctx: { params: { kind: string } }) {
  const kind = (ctx.params.kind || "").toLowerCase();
  const sp = req.nextUrl.searchParams;
  const sector = canonicalSector(sp.get("sector"));
  if (!sector) {
    return fail(kind, `UNKNOWN SECTOR "${sp.get("sector") ?? ""}". VALID: ALL, ${SECTOR_KEYS.join(", ")}.`);
  }

  // ------------------------------------------------------------- pair (one)
  if (kind === "pair") {
    const a = normalizeTicker(sp.get("a") ?? "");
    const b = normalizeTicker(sp.get("b") ?? "");
    if (!a || !b || a === b) return fail(kind, "TWO DIFFERENT SYMBOLS ARE NEEDED — THIS DESK TRADES A PAIR, NOT A SINGLE NAME.");
    const { bars, ticks, failed } = await loadCloses([a, b]);
    if (!bars.get(a) || !bars.get(b)) {
      return fail(
        kind,
        `PRICE HISTORY UNREADABLE — ${[a, b].filter((s) => !bars.get(s)).map((s) => `${s} (${failed.find((f) => f.symbol === s)?.why ?? "NO DATA"})`).join(" · ")}`,
        { a, b }
      );
    }
    const live = await overlaySafe(bars, ticks);
    const detail = analysePair(bars, a, b);
    if (!detail) {
      return fail(
        kind,
        `${bare(a)} vs ${bare(b)} DOES NOT HAVE ENOUGH SHARED HISTORY TO SPLIT INTO A FORMATION WINDOW AND AN OUT-OF-SAMPLE WINDOW (NEED >${P.MIN_OBS} SHARED BARS).`,
        { a, b }
      );
    }
    return NextResponse.json({ ok: true, kind, a, b, detail, params: P, live });
  }

  // ------------------------------------------------------- radar / sectors
  if (kind === "radar" || kind === "sectors") {
    const cacheKey = `${kind}:${sector}`;
    const hit = RADAR_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.ts < RADAR_TTL_MS) {
      return NextResponse.json({ ...(hit.body as Record<string, unknown>), cached: true });
    }
    const pairs = pairsFor(sector);
    const symbols = universeTickers(pairs);
    const { bars, ticks, failed } = await loadCloses(symbols);
    // Fold today's session in BEFORE screening. Selection, the formation cut
    // and the live z all read the same series, so overlaying afterwards would
    // leave the last z a day stale — which is exactly what the desk showed.
    const live = await overlaySafe(bars, ticks);
    const research = screenUniverse(bars, pairs);
    if (!research.rows.length) {
      return fail(
        kind,
        `NO PAIR REACHED ${P.MIN_OBS} SHARED BARS. ${failed.length} OF ${symbols.length} SYMBOL(S) FAILED TO LOAD${failed.length ? ` (${failed.slice(0, 4).map((f) => `${f.symbol}: ${f.why}`).join(" · ")})` : ""}.`,
        { sector, failed: failed.slice(0, 20), pairsTested: pairs.length }
      );
    }

    // Walk-forward is the expensive part; it runs only on pairs that survived
    // selection, never on the whole universe.
    // Walk-forward runs across the WHOLE universe, not just the basket.
    //
    // This used to run only on selected pairs, on the assumption it was the
    // expensive part. Measured, it is ~41ms per pair — about 3.7s for all 88,
    // which fits the budget comfortably. Restricting it left the out-of-sample
    // ranking panel able to show only pairs already chosen into the basket, so
    // the one table meant to reveal what a z-score screen missed was structurally
    // incapable of showing a miss.
    const basketKeys = new Set(research.selected.map(([a, b]) => `${a}|${b}`));
    const walked: Array<{ key: [string, string]; walk: WFResult; detail: PairDetail }> = [];
    const detailByKey = new Map<string, PairDetail>();
    for (const row of research.rows) {
      const key = `${row.a}|${row.b}`;
      const detail = analysePair(bars, row.a, row.b);
      if (!detail) continue;
      row.oos = detail.adaptiveOos;
      detailByKey.set(key, detail);
      if (basketKeys.has(key)) walked.push({ key: [row.a, row.b], walk: detail.walk, detail });
    }

    // Data-integrity scan runs on the raw bars, before any statistic is derived
    // from them, so a corporate action is reported rather than quietly baked
    // into a spread.
    const quality = scanQuality(
      bars,
      pairs,
      failed,
      symbols.length,
      research.dropped.map((d) => ({ pair: d.pair, why: d.bars ? `${d.bars} SHARED BARS < ${P.MIN_OBS}` : "NO DATA" }))
    );

    // Live radar over every pair that produced a usable model — including the
    // ones that failed selection, so the desk can show the near misses.
    const signals = research.rows
      .map((row) => {
        const d = detailByKey.get(`${row.a}|${row.b}`);
        const pa = bars.get(row.a);
        const pb = bars.get(row.b);
        if (!pa || !pb) return null;
        return signalFor(row.a, row.b, pa.map((b) => b.close), pb.map((b) => b.close), row, row.oos);
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((x, y) => Math.abs(y.z) - Math.abs(x.z));

    const portfolio = buildPortfolio(walked);

    // Partition by DECISION, not by data shape. The four buckets are the ones a
    // trader acts on, and the second one is the important one: pairs that tripped
    // the entry threshold and were still refused. Listing those is the difference
    // between a desk and a screen — they are precisely the trades a z-score-only
    // model would have taken.
    const triggered = signals.filter((s) => s.stage === "TRIGGERED");
    const board = {
      passed: triggered.filter((s) => s.actionable),
      rejected: triggered.filter((s) => !s.actionable),
      onDeck: signals.filter((s) => s.onDeck).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
      stretched: signals
        .filter((s) => s.stage === "BEYOND STOP" || s.hard.includes("NO-ROOM-TO-STOP") || s.hard.includes("BEYOND-STOP"))
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z)),
    };

    // Shared legs across actionable signals: two pairs on one stock are partly
    // the same bet and must be sized as one.
    const legCount = new Map<string, number>();
    for (const s of signals.filter((x) => x.actionable)) {
      legCount.set(s.a, (legCount.get(s.a) ?? 0) + 1);
      legCount.set(s.b, (legCount.get(s.b) ?? 0) + 1);
    }
    const overlaps = [...legCount.entries()].filter(([, n]) => n > 1).map(([s, n]) => ({ symbol: s, signals: n }));

    const body = {
      ok: true,
      kind,
      cached: false,
      sector,
      live,
      quality,
      sectors: SECTOR_KEYS,
      params: P,
      formationDate: research.formationDate,
      selected: research.selected.map(([a, b]) => `${bare(a)}/${bare(b)}`),
      relaxed: research.relaxed,
      notes: research.notes,
      dropped: research.dropped.slice(0, 20),
      failedSymbols: failed.slice(0, 20),
      pairsTested: pairs.length,
      symbolsRequested: symbols.length,
      symbolsRead: bars.size,
      rows: research.rows
        .map((r) => ({ ...r, a: bare(r.a), b: bare(r.b) }))
        .sort((x, y) => (y.qForm || 1) - (x.qForm || 1)),
      signals,
      actionable: board.passed,
      onDeck: board.onDeck,
      board,
      overlaps,
      portfolio: portfolio
        ? {
            dates: portfolio.dates,
            ret: portfolio.ret.map((v) => Math.round(v * 1e6) / 1e6),
            active: portfolio.active,
            stats: portfolio.stats,
            ci: portfolio.ci,
            probNegative: portfolio.probNegative,
            stress: portfolio.stress,
            tradeCount: portfolio.trades.length,
          }
        : null,
      walkParams: walked.map((w) => ({ pair: `${bare(w.key[0])}/${bare(w.key[1])}`, ...w.walk.liveParams })),
    };
    RADAR_CACHE.set(cacheKey, { ts: Date.now(), body });
    return NextResponse.json(body);
  }

  return fail(kind, `UNKNOWN KIND "${kind.toUpperCase()}". VALID: RADAR, SECTORS, PAIR.`);
}
