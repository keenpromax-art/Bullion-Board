import { NextRequest, NextResponse } from "next/server";
import { yahooFetch } from "@/lib/yahoo";
import {
  CAPTURE_SLOTS, DECISION_MIN, MODEL_PROVENANCE, OPENING_UNIVERSE,
  PRE_OPEN_LEGS, REGIME_MEASURED, STALE_SHARE_WARN, TARGET_SESSION_LABEL, VIX_THRESHOLD,
  buildConfirm, buildLegVote, buildScore, gapBand, gapState, istDateFromUnix, istHHMMFromUnix,
  istMinutes, istNow, istStamp, nearestSlot, openingTarget, breadthKeyForTarget,
  pctChange, readMode, round2, sessionPhase, targetLegOverlap, targetSession,
  vixCondition, vixRegime,
} from "@/lib/opening";
import type { GapState, LegSpec, LegVote, OpeningTarget, SessionPhase } from "@/lib/opening";

// Live pre-market snapshot for module 109 / FNC PRE.
//
// Every leg is fetched INDEPENDENTLY and in parallel. A leg that fails returns
// null, drops out of the weighted average and lowers COVERAGE — it is never
// silently replaced by a zero vote, because "no tape" and "flat tape" are very
// different pieces of information and conflating them manufactures conviction.
//
// HOW A LEG IS READ is decided by its market's own trading hours, not by one
// rule applied to everything:
//   24h instruments (ES/NQ/YM/OIL/AU/DXY/INR)  -> live price vs settlement
//   Asian indices inside their session (N225, HSI, STI) -> live mid-session print
//   US cash, already shut (SPX/NDX/DJI/VIX/UST) -> the last COMPLETED US session
// Getting this wrong is what made the previous scorecard describe a model
// nobody runs: it rebuilt every leg from the prior daily close, which is ~23h
// stale for the overnight futures and ~22h stale for Asia, while the live desk
// was reading all of them fresh.
//
// WHICH MARKET. `?market=` picks the index whose opening gap is being called and
// whose own tape, session clock and breadth are shown. The fifteen legs and
// their 09:00 IST reading rules are the SAME for every choice — they are an
// overnight information set, not an index — so switching markets changes the
// target, not the engine. What does change is whether the fitted band applies,
// which the wire states per market instead of assuming it: see OPENING_TARGETS
// for why a global market is served as a tape check rather than a call.

// ---- how each leg's % change is derived ----
type RefMode =
  /** meta.regularMarketPrice vs meta.previousClose (24h instruments) */
  | "META"
  /** last COMPLETED daily session — drops a bar stamped on/after today */
  | "COMPLETE_SESSION"
  /** last two daily closes as-is (24h FX: the newest bar IS the level) */
  | "LAST_BAR";

interface LegFetchPlan {
  symbol: string;
  interval: "60m" | "1d";
  range: string;
  mode: RefMode;
}

const STALE_MIN = 90;
const NSE_BUDGET_MS = 9000;

const PLANS: Record<string, LegFetchPlan> = {
  // 24h futures: they keep repricing through the IST morning, which is the
  // entire reason they outrank the stale cash closes.
  ES: { symbol: "ES=F", interval: "60m", range: "5d", mode: "META" },
  NQ: { symbol: "NQ=F", interval: "60m", range: "5d", mode: "META" },
  YM: { symbol: "YM=F", interval: "60m", range: "5d", mode: "META" },
  // Asia. All three are mid-session at 08:45-09:14 IST — this is the leg set
  // that measured strongest, and the one the old backtest could not see.
  N225: { symbol: "^N225", interval: "60m", range: "5d", mode: "META" },
  HSI: { symbol: "^HSI", interval: "60m", range: "5d", mode: "META" },
  STI: { symbol: "^STI", interval: "60m", range: "5d", mode: "META" },
  // US cash shut at the bell: only the last completed session is admissible.
  SPX: { symbol: "^GSPC", interval: "1d", range: "10d", mode: "COMPLETE_SESSION" },
  NDX: { symbol: "^IXIC", interval: "1d", range: "10d", mode: "COMPLETE_SESSION" },
  DJI: { symbol: "^DJI", interval: "1d", range: "10d", mode: "COMPLETE_SESSION" },
  // FX reports meta.previousClose === the live price on this feed, which would
  // pin the change at a permanent 0.00%. Daily closes are the only trustworthy
  // reference.
  USDINR: { symbol: "INR=X", interval: "1d", range: "10d", mode: "LAST_BAR" },
  CRUDE: { symbol: "CL=F", interval: "60m", range: "5d", mode: "META" },
  GOLD: { symbol: "GC=F", interval: "60m", range: "5d", mode: "META" },
  DXY: { symbol: "DX-Y.NYB", interval: "60m", range: "5d", mode: "META" },
  UST10Y: { symbol: "^TNX", interval: "1d", range: "10d", mode: "COMPLETE_SESSION" },
  USVIX: { symbol: "^VIX", interval: "1d", range: "10d", mode: "COMPLETE_SESSION" },
  INDIAVIX: { symbol: "^INDIAVIX", interval: "1d", range: "10d", mode: "LAST_BAR" },
};

// ---- raw chart plumbing ----
interface RawChart {
  meta: Record<string, any>;
  ts: number[];
  o: Array<number | null>;
  h: Array<number | null>;
  l: Array<number | null>;
  c: Array<number | null>;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) ? v : null;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

function lastNonNull(arr: Array<number | null>): number | null {
  for (let i = arr.length - 1; i >= 0; i--) if (num(arr[i]) !== null) return arr[i] as number;
  return null;
}

async function fetchChart(symbol: string, range: string, interval: "60m" | "1d"): Promise<RawChart | null> {
  try {
    const r = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
      { next: { revalidate: 60 } }
    );
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const q = res.indicators?.quote?.[0] ?? {};
    return {
      meta: res.meta ?? {},
      ts: res.timestamp ?? [],
      o: q.open ?? [], h: q.high ?? [], l: q.low ?? [], c: q.close ?? [],
    };
  } catch {
    return null;
  }
}

interface Reading {
  last: number | null;
  chg: number | null;
  barDate: string | null;
  tickAgeMin: number | null;
  /** true when the leg should be printing right now but the tape is old. */
  stale: boolean;
  /** the leg's market was shut at the decision minute; prior close used. */
  priorOnly: boolean;
  /** |move| past the leg's plausibility band. */
  tail: boolean;
  /** set when the leg or its reference could not be trusted */
  issue: string | null;
}

const NO_READING: Reading = {
  last: null, chg: null, barDate: null, tickAgeMin: null,
  stale: false, priorOnly: false, tail: false, issue: "NO TAPE",
};

/**
 * Only a tick-level reading can go STALE. A leg read from a daily close is
 * hours old by construction — flagging it would mark a perfectly healthy FX
 * tape dead and quarter its weight every single morning.
 */
const staleEligible = (plan: LegFetchPlan) => plan.mode === "META";

/** META: live price vs meta.previousClose, guarded against a broken reference. */
function metaReading(raw: RawChart, nowSec: number, plausible: number): Reading {
  const last = num(raw.meta.regularMarketPrice) ?? lastNonNull(raw.c);
  if (last === null) return { ...NO_READING, issue: "NO PRICE" };
  const tick = num(raw.meta.regularMarketTime);
  const ts = tick ?? (raw.ts.length ? raw.ts[raw.ts.length - 1] : null);
  const base: Reading = {
    last, chg: null,
    barDate: ts !== null ? istDateFromUnix(ts) : null,
    tickAgeMin: ts !== null ? Math.max(0, Math.round((nowSec - ts) / 60)) : null,
    stale: false, priorOnly: false, tail: false, issue: null,
  };
  const ref = num(raw.meta.previousClose);
  if (ref === null || ref <= 0) return { ...base, issue: "NO PRIOR CLOSE" };
  const chg = pctChange(last, ref);
  if (chg === null) return { ...base, issue: "BAD REFERENCE CLOSE" };
  if (Math.abs(chg) > plausible) return { ...base, tail: true, issue: `MOVE ${chg.toFixed(1)}% PAST PLAUSIBILITY BAND` };
  return { ...base, chg };
}

/**
 * Daily-closes based reference.
 *   COMPLETE_SESSION — keep the last session stamped STRICTLY BEFORE today.
 *     That is the last US session to have closed, and it is the only reading a
 *     pre-open decision may use. The previous build used an age < 20h test,
 *     which silently discarded the freshest US close of every single morning.
 *   LAST_BAR — 24h instrument, the newest bar is the live level.
 */
function dailyReading(
  raw: RawChart,
  mode: "COMPLETE_SESSION" | "LAST_BAR",
  nowSec: number,
  todayIST: string,
  plausible: number
): Reading {
  const pts: Array<{ date: string; close: number; ts: number }> = [];
  for (let i = 0; i < raw.ts.length; i++) {
    const c = num(raw.c[i]);
    if (c === null) continue;
    pts.push({ date: istDateFromUnix(raw.ts[i]), close: c, ts: raw.ts[i] });
  }
  if (!pts.length) return { ...NO_READING, issue: "NO DAILY CLOSES" };
  let series = pts;
  if (mode === "COMPLETE_SESSION") {
    while (series.length > 2 && series[series.length - 1].date >= todayIST) series = series.slice(0, -1);
  }
  if (series.length < 2) return { ...NO_READING, issue: "NO COMPLETED SESSIONS" };
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const chg = pctChange(last.close, prev.close);
  const base: Reading = {
    last: last.close, chg: null, barDate: last.date,
    tickAgeMin: Math.max(0, Math.round((nowSec - last.ts) / 60)),
    stale: false, priorOnly: mode === "COMPLETE_SESSION", tail: false, issue: null,
  };
  if (chg === null) return { ...base, issue: "BAD REFERENCE CLOSE" };
  if (Math.abs(chg) > plausible) return { ...base, tail: true, issue: `MOVE ${chg.toFixed(1)}% PAST PLAUSIBILITY BAND` };
  return { ...base, chg };
}

async function readLeg(spec: LegSpec, nowSec: number, nowMin: number, todayIST: string): Promise<Reading> {
  const plan = PLANS[spec.key];
  if (!plan) return { ...NO_READING, issue: "NO FETCH PLAN" };
  const raw = await fetchChart(plan.symbol, plan.range, plan.interval);
  if (!raw) return { ...NO_READING, issue: `${plan.symbol} FEED DOWN` };
  const r = plan.mode === "META"
    ? metaReading(raw, nowSec, spec.plausiblePct)
    : dailyReading(raw, plan.mode, nowSec, todayIST, spec.plausiblePct);
  // A leg that should be printing right now but whose last print is old is
  // marked stale, which quarters its weight rather than counting it in full.
  if (staleEligible(plan) && readMode(spec, nowMin) === "LIVE" && !r.stale && !r.priorOnly)
    return { ...r, stale: (r.tickAgeMin ?? 0) > STALE_MIN };
  return r;
}

// ---- NSE official breadth (nseindia advance-decline scrape) ----
const NSE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface BreadthRow {
  symbol: string; last: number; chgPct: number;
  volume: number; valueCr: number;
  status: "Advance" | "Decline" | "Unchanged";
}

type Triple = [number, number, number];
export interface BreadthFeed {
  adv: number; dec: number; unc: number;
  rows: BreadthRow[];
  matrix: Record<string, Triple>;
  source: "NSE" | "YAHOO";
}

async function nseBreadth(): Promise<BreadthFeed> {
  const base = {
    "User-Agent": NSE_UA, Accept: "*/*", "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.nseindia.com/market-data/advance",
  };
  const home = await fetch("https://www.nseindia.com", { headers: base, signal: AbortSignal.timeout(7000) });
  if (!home.ok) throw new Error(`nse home ${home.status}`);
  const rawCookies: string[] =
    typeof (home.headers as any).getSetCookie === "function"
      ? (home.headers as any).getSetCookie()
      : (home.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=[^;,]+;)/);
  const cookie = rawCookies.map((c) => c.split(";")[0]).join("; ");
  const get = async (path: string) => {
    const r = await fetch(`https://www.nseindia.com${path}`, {
      headers: { ...base, Cookie: cookie }, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`nse ${path} ${r.status}`);
    return r.json();
  };
  const j500 = await get("/api/equity-stock-indices?index=NIFTY%20500");
  const data500: any[] = j500?.data ?? [];
  const rows: BreadthRow[] = data500
    .filter((d) => d.symbol && !String(d.symbol).startsWith("NIFTY"))
    .map((d) => {
      const chg = Number(d.pChange ?? 0);
      return {
        symbol: String(d.symbol),
        last: Number(d.lastPrice ?? 0),
        chgPct: chg,
        volume: Number(d.totalTradedVolume ?? 0),
        valueCr: Math.round((Number(d.totalTradedValue ?? 0) / 1e7) * 100) / 100,
        status: chg > 0 ? "Advance" : chg < 0 ? "Decline" : "Unchanged",
      };
    });
  const jAll = await get("/api/allIndices");
  const pick = (name: string): Triple => {
    const f = (jAll?.data ?? []).find((d: any) => d.index === name);
    return [Number(f?.advances ?? 0), Number(f?.declines ?? 0), Number(f?.unchanged ?? 0)];
  };
  // Every segment the market selector can ask for, in one scrape. The headline
  // A/D is the SELECTED target's own segment — showing NIFTY 50 breadth while
  // the desk is calling NIFTY BANK is a mismatch dressed as a measurement.
  const matrix = {
    nifty50: pick("NIFTY 50"), n500: pick("NIFTY 500"),
    midcap: pick("NIFTY MIDCAP 150"), smallcap: pick("NIFTY SMALLCAP 250"),
    total: pick("NIFTY TOTAL MARKET"),
    bank: pick("NIFTY BANK"), it: pick("NIFTY IT"),
    pharma: pick("NIFTY PHARMA"), auto: pick("NIFTY AUTO"),
    sensex: pick("SENSEX"),
  };
  let [a50, d50, u50] = matrix.nifty50;
  if (!a50 && !d50 && rows.length) {
    const first50 = rows.slice(0, 50);
    a50 = first50.filter((r) => r.status === "Advance").length;
    d50 = first50.filter((r) => r.status === "Decline").length;
    u50 = first50.filter((r) => r.status === "Unchanged").length;
  }
  return { adv: a50, dec: d50, unc: u50, rows, matrix, source: "NSE" };
}

/** Yahoo fallback so the desk never renders an empty breadth panel. */
async function fallbackBreadth(nowSec: number, todayIST: string): Promise<BreadthFeed> {
  const out: Array<BreadthRow | null> = new Array(OPENING_UNIVERSE.length).fill(null);
  let i = 0;
  async function worker() {
    while (i < OPENING_UNIVERSE.length) {
      const k = i++;
      const raw = await fetchChart(OPENING_UNIVERSE[k], "5d", "1d");
      if (!raw) continue;
      // Indian equities: the newest daily bar IS the latest session, forming or
      // settled — never drop it for staleness.
      const r = dailyReading(raw, "LAST_BAR", nowSec, todayIST, 25);
      if (r.chg === null || r.last === null) continue;
      out[k] = {
        symbol: OPENING_UNIVERSE[k].replace(".NS", ""), last: r.last,
        chgPct: Math.round(r.chg * 100) / 100, volume: 0, valueCr: 0,
        status: r.chg > 0 ? "Advance" : r.chg < 0 ? "Decline" : "Unchanged",
      };
    }
  }
  await Promise.all(Array.from({ length: Math.min(12, OPENING_UNIVERSE.length) }, worker));
  const rows = out.filter((r): r is BreadthRow => r !== null);
  const adv = rows.filter((r) => r.status === "Advance").length;
  const dec = rows.filter((r) => r.status === "Decline").length;
  const unc = rows.filter((r) => r.status === "Unchanged").length;
  const z: Triple = [0, 0, 0];
  return {
    adv, dec, unc, rows, source: "YAHOO",
    matrix: { nifty50: [adv, dec, unc], n500: z, midcap: z, smallcap: z, total: z, bank: z, it: z, pharma: z, auto: z, sensex: z },
  };
}

/** NSE first (official), Yahoo universe second. Both fail open to null. */
async function breadthLeg(nowSec: number, todayIST: string): Promise<BreadthFeed | null> {
  try {
    const nse = await withTimeout(nseBreadth(), NSE_BUDGET_MS, null);
    if (nse) return nse;
  } catch {
    /* fall through to the Yahoo proxy */
  }
  try {
    return await withTimeout(fallbackBreadth(nowSec, todayIST), 10000, null);
  } catch {
    return null;
  }
}

const PHASE_LABEL: Record<SessionPhase, string> = {
  OVERNIGHT: "OVERNIGHT — FUTURES LIVE, ASIA NOT YET OPEN",
  PRE_OPEN: "PRE-OPEN — OVERNIGHT FUTURES + ASIA LEAD LIVE",
  OPENING_WINDOW: "OPENING WINDOW — FINAL CALL BEFORE THE 09:15 BELL",
  CASH_OPEN: "CASH OPEN — FIRST 15M, GAP FORMING",
  MIDDAY: "MIDDAY SESSION — INTRADAY OBSERVATION",
  CLOSE: "CLOSING SESSION — INTRADAY OBSERVATION",
  POST_CLOSE: "POST-CLOSE — INDIAN CASH SETTLED, TAPES ARE LAST-PRINT",
};

/** Which cash session the published call is actually about. */
function predictionTarget(
  phase: SessionPhase,
  t: OpeningTarget,
  sess: ReturnType<typeof targetSession>
): string {
  if (t.mode === "TAPE_CHECK") {
    // A global market has no 09:15 IST bell. Naming one would be the desk
    // claiming to call an open it has never measured.
    return sess.state === "WEEKEND"
      ? `${t.label} — SHUT FOR THE WEEKEND`
      : `${t.label} — OWN SESSION ${sess.istLabel}`;
  }
  const when = phase === "OVERNIGHT" || phase === "PRE_OPEN" || phase === "OPENING_WINDOW"
    ? "TODAY 09:15 IST OPEN"
    : "NEXT SESSION 09:15 IST OPEN";
  return `${t.label} — ${when}`;
}

export async function GET(req: NextRequest) {
  // ?summary=1 is the 5-minute ticker chip: call + forecast + regime only.
  // Skips the NSE scrape, the intraday path and the per-stock rows entirely.
  const lite = req.nextUrl.searchParams.get("summary") === "1";
  // Which market the desk is being read for. An unknown key falls back to the
  // fitted index and says so, rather than silently serving a different market.
  const asked = (req.nextUrl.searchParams.get("market") ?? req.nextUrl.searchParams.get("target") ?? "").trim().toUpperCase();
  const t = openingTarget(asked);
  const unknownMarket = !!asked && t.key !== asked;
  const sess = targetSession(t);
  const now = istNow();
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMin = istMinutes(now);
  const phase = sessionPhase(now);
  const todayIST = istDateFromUnix(nowSec);
  // A tape check never renders the confirm/gap model, so it never pays for the
  // NSE breadth scrape either.
  const wantBreadth = !lite && t.mode === "GAP_CALL";

  try {
    // All of this runs concurrently: every leg tape + the target index + VIX +
    // the breadth scrape. The scrape used to run AFTER the Yahoo legs, putting
    // its full 25s worst case on the critical path for a panel that only needs
    // A/D.
    const [legReads, idxRaw, vixRaw, breadth] = await Promise.all([
      Promise.all(PRE_OPEN_LEGS.map((s) => readLeg(s, nowSec, nowMin, todayIST))),
      fetchChart(t.symbol, "5d", "60m"),
      fetchChart(PLANS.INDIAVIX.symbol, PLANS.INDIAVIX.range, "1d"),
      wantBreadth ? breadthLeg(nowSec, todayIST) : Promise.resolve(null),
    ]);

    const legs: LegVote[] = PRE_OPEN_LEGS.map((spec, i) =>
      buildLegVote(spec, {
        chg: legReads[i].chg,
        last: legReads[i].last,
        barDate: legReads[i].barDate,
        stale: legReads[i].stale,
        priorOnly: legReads[i].priorOnly,
      })
    );

    // leg-level integrity notes -> visible caveats, never silent drops
    const caveats: string[] = [];
    if (unknownMarket) caveats.push(`UNKNOWN MARKET "${asked}" — ${t.label} SERVED INSTEAD`);
    // Which index the model was fitted on, stated once for every other choice.
    if (!t.calibrated) {
      caveats.push(t.mode === "TAPE_CHECK"
        ? `NO CALL PUBLISHED FOR ${t.label} — TAPE CHECK ONLY. THE GAP BAND, THE GATE AND THE LEG WINDOWS BELOW ARE THE 09:00 IST INDIAN DESK'S, NOT ${t.label}'S.`
        : `GAP BAND + PUBLISH GATE ARE THE NIFTY 50 FIT APPLIED TO ${t.label} — DIRECTION CARRIES, MAGNITUDE IS NOT MEASURED ON THIS INDEX.`);
    }
    const overlap = targetLegOverlap(t);
    if (overlap) caveats.push(`${t.label} IS ALSO THE \`${overlap}\` LEG IN THIS ENGINE — THE OVERNIGHT READ IS NOT INDEPENDENT OF IT`);
    if (!t.breadthIndex && t.mode === "GAP_CALL") {
      caveats.push(`NO ${t.label} ADVANCE/DECLINE FEED — NSE PUBLISHES A/D PER INDIAN INDEX ONLY`);
    } else if (t.breadthNote) {
      caveats.push(`BREADTH SEGMENT IS "${t.breadthIndex}" — ${t.breadthNote}`);
    }
    PRE_OPEN_LEGS.forEach((spec, i) => {
      const r = legReads[i];
      if (r.issue) caveats.push(`${spec.short} NO VOTE — ${r.issue}`);
      else if (r.stale) caveats.push(`${spec.short} TAPE STALE ${r.tickAgeMin ?? "?"}M — WEIGHT QUARTERED`);
      else if (r.chg !== null && Math.abs(r.chg) <= spec.deadband)
        caveats.push(`${spec.short} INSIDE DEADBAND ±${spec.deadband.toFixed(2)}% — VOTES 0`);
    });
    const shut = PRE_OPEN_LEGS.filter((s, i) => legReads[i].priorOnly);
    if (shut.length) caveats.push(`${shut.map((s) => s.short).join(", ")} READ AT THE LAST COMPLETED CLOSE — ${shut.length === 1 ? "ITS MARKET IS" : "THEIR MARKETS ARE"} SHUT AT THE BELL`);

    // ---- India VIX: level + session change, both from daily closes ----
    let vixLast: number | null = null, vixChg: number | null = null, vixDate: string | null = null;
    if (vixRaw) {
      const r = dailyReading(vixRaw, "LAST_BAR", nowSec, todayIST, 60);
      vixLast = r.last; vixChg = r.chg; vixDate = r.barDate;
      if (r.chg === null) caveats.push(`INDIA VIX LEVEL ${vixLast?.toFixed(2) ?? "—"} — NO PRIOR CLOSE, REGIME FROM LEVEL ONLY`);
    } else {
      caveats.push("INDIA VIX TAPE OFF — EDGE GATE DEFAULTS TO NORMAL REGIME");
    }
    const regime = vixRegime(vixLast);

    // ---- target index: live price, prior close, today's open, intraday path ----
    let nLast: number | null = null, nPrev: number | null = null, nOpen: number | null = null;
    let nHigh: number | null = null, nLow: number | null = null;
    let intraday: Array<{ time: string; open: number; high: number; low: number; close: number }> = [];
    if (idxRaw) {
      nLast = num(idxRaw.meta.regularMarketPrice) ?? lastNonNull(idxRaw.c);
      nPrev = num(idxRaw.meta.previousClose);
      const today: typeof intraday = [];
      for (let k = 0; k < idxRaw.ts.length; k++) {
        const c = num(idxRaw.c[k]);
        if (c === null || istDateFromUnix(idxRaw.ts[k]) !== todayIST) continue;
        today.push({
          time: istHHMMFromUnix(idxRaw.ts[k]),
          open: num(idxRaw.o[k]) ?? c, high: num(idxRaw.h[k]) ?? c,
          low: num(idxRaw.l[k]) ?? c, close: c,
        });
      }
      if (today.length) {
        nOpen = today[0].open;
        nHigh = Math.max(...today.map((b) => b.high));
        nLow = Math.min(...today.map((b) => b.low));
        if (!lite) intraday = today;
      }
      if (nLast === null || nPrev === null) caveats.push(`${t.label} TAPE PARTIAL — THE GAP CANNOT BE MEASURED`);
      else if (!today.length && sess.state !== "WEEKEND") {
        caveats.push(`${t.label} HAS NOT OPENED TODAY ON THIS CLOCK — IT OPENS ${sess.istLabel}. GAP AND CONFIRM STAY DASHED UNTIL THEN.`);
      }
    } else {
      caveats.push(`${t.label} TAPE OFF — GAP AND CONFIRM MODEL UNAVAILABLE`);
    }
    const gap: GapState = gapState(nOpen, nPrev, nLast);

    // ---- the pre-open model ----
    const predict = buildScore(legs, regime);
    const egapPct = predict.expectedGapPct;
    // Points are only published for a market the call is actually about: the
    // percent is a NIFTY 50 fit, so turning it into another index's points
    // would be inventing a number in that index's own units.
    const egapPts = t.mode === "GAP_CALL" && egapPct !== null && nPrev ? (egapPct / 100) * nPrev : null;
    const scope = t.mode === "GAP_CALL" ? "" : "INDIAN OPEN: ";
    if (predict.verdict === "NO_DATA")
      caveats.push(`${scope}LEG COVERAGE ${(predict.coverage * 100).toFixed(0)}% BELOW FLOOR — NO DIRECTION PUBLISHED`);
    else if (predict.verdict === "FLAT")
      caveats.push(`${scope}FORECAST GAP ${egapPct === null ? "—" : `${egapPct >= 0 ? "+" : ""}${egapPct.toFixed(2)}%`} DOES NOT CLEAR THE ±${predict.gate.toFixed(2)}% PUBLISH GATE — STAND ASIDE`);
    if (predict.staleShare >= STALE_SHARE_WARN)
      caveats.push(`${(predict.staleShare * 100).toFixed(0)}% OF REPORTING WEIGHT IS STALE — CONFIDENCE SCALED DOWN`);
    if (egapPct !== null && Math.abs(egapPct) < 0.15)
      caveats.push(`${scope}FORECAST GAP ${egapPct >= 0 ? "+" : ""}${egapPct.toFixed(2)}% IS INSIDE THE ±0.15% NO-EDGE BAND`);

    // ---- breadth, and whether it is even admissible ----
    const sessionFresh = !!breadth?.rows.length && !!nOpen;
    let breadthOut: Record<string, unknown> | null = null;
    let breadthProxy = false;
    if (breadth) {
      // The headline A/D is the SELECTED index's own segment when NSE prints
      // one. Falling back to NIFTY 50 is allowed but labelled, because a
      // NIFTY-50 breadth number next to a NIFTY BANK call is a mismatch.
      const bKey = breadthKeyForTarget(t);
      const own = bKey ? breadth.matrix[bKey] : undefined;
      const ownUsable = !!own && own[0] + own[1] + own[2] > 0;
      const head: Triple = ownUsable ? own! : [breadth.adv, breadth.dec, breadth.unc];
      const headLabel = ownUsable ? t.breadthIndex! : "NIFTY 50";
      const proxy = !ownUsable && !!t.breadthIndex;
      breadthProxy = proxy;
      const total = head[0] + head[1] + head[2];
      const sorted = [...breadth.rows].sort((a, c) => c.chgPct - a.chgPct);
      breadthOut = {
        adv: head[0], dec: head[1], unc: head[2], total,
        pct: total ? Math.round(((head[0] - head[1]) / total) * 10000) / 100 : null,
        sentiment: total ? (head[0] > head[1] ? "BULLISH" : head[1] > head[0] ? "BEARISH" : "NEUTRAL") : null,
        matrix: breadth.matrix, source: breadth.source,
        label: headLabel, proxy, note: proxy ? `NSE PRINTED NO A/D FOR "${t.breadthIndex}" — NIFTY 50 IS SHOWN AS A PROXY, NOT AS ${t.label} BREADTH` : t.breadthNote ?? null,
        sessionFresh, universe: breadth.rows.length,
        gainers: lite ? [] : sorted.slice(0, 5),
        losers: lite ? [] : sorted.slice(-5).reverse(),
        rows: lite ? [] : breadth.rows,
      };
      if (proxy) caveats.push(`NO ${t.breadthIndex} ADVANCE/DECLINE IN THE FEED — NIFTY 50 A/D SHOWN AS A PROXY`);
      if (!sessionFresh) caveats.push("BREADTH IS FROM THE LAST COMPLETED SESSION — A 09:00 IST A/D SNAPSHOT IS NOT RECONSTRUCTABLE, SO IT IS EXCLUDED FROM THE CALL");
    } else if (!lite && t.mode === "GAP_CALL") {
      caveats.push("NSE BREADTH FEED OFF — CONFIRM MODEL RUNS ON THE GAP ALONE");
    }
    // A proxy A/D must not grade the call it is standing in for, and a tape
    // check has no call to grade — so the confirm model is not merely hidden in
    // the UI, it is never computed for those cases.
    const confirm = t.mode !== "GAP_CALL"
      ? null
      : buildConfirm(
          gap,
          breadth && !breadthProxy ? { adv: breadth.adv, dec: breadth.dec, unc: breadth.unc } : null,
          egapPct
        );

    return NextResponse.json({
      fetchedAtIST: istStamp(),
      phase, phaseLabel: PHASE_LABEL[phase], target: predictionTarget(phase, t, sess),
      currentSlot: nearestSlot(), slots: CAPTURE_SLOTS,
      decisionMinuteIST: `${String(Math.floor(DECISION_MIN / 60)).padStart(2, "0")}:${String(DECISION_MIN % 60).padStart(2, "0")}`,
      market: {
        key: t.key, label: t.label, symbol: t.symbol, venue: t.venue, group: t.group,
        mode: t.mode, calibrated: t.calibrated, alsoLeg: t.alsoLeg,
        legOverlap: targetLegOverlap(t),
        profile: t.profile, instrument: t.instrument, read: t.read,
        breadthIndex: t.breadthIndex ?? null, breadthNote: t.breadthNote ?? null,
        session: {
          state: sess.state, label: TARGET_SESSION_LABEL[sess.state],
          istWindow: sess.istLabel, toOpenMin: sess.toOpen,
          localWindow: `${t.openHHMM}–${t.closeHHMM} ${t.tz}`,
        },
      },
      index: {
        label: t.label, symbol: t.symbol,
        last: nLast, prevClose: nPrev, open: nOpen, high: nHigh, low: nLow,
        chg: pctChange(nLast, nPrev), session: sessionFresh,
        range: nHigh !== null && nLow !== null ? nHigh - nLow : null,
        date: todayIST, bars: intraday.length,
      },
      gap,
      vix: { last: vixLast, chg: vixChg, date: vixDate, regime, cond: vixCondition(vixLast), threshold: VIX_THRESHOLD },
      breadth: breadthOut,
      predict,
      forecast: {
        expectedGapPct: egapPct,
        expectedGapPts: egapPts === null ? null : round2(egapPts),
        probUp: t.mode === "GAP_CALL" ? predict.probUp : null,
        probDirectional: t.mode === "GAP_CALL" ? predict.probDirectional : null,
        band: predict.band,
        bandLabel: gapBand(regime).label,
        slopePctPerEdge: gapBand(regime).slope,
        interceptPct: gapBand(regime).intercept,
        residualSdPct: gapBand(regime).residSd,
        gate: predict.gate,
        calibrated: t.calibrated,
        note: "GAP = BAND INTERCEPT + BAND SLOPE x EDGE, AND THE PUBLISH GATE IS IN THESE SAME UNITS. THE SLOPE IS THE WALK-FORWARD FOLD MEDIAN FOR THAT REGIME, NOT THE IN-SAMPLE FIT.",
      },
      model: MODEL_PROVENANCE,
      regimeMeasured: REGIME_MEASURED,
      confirm,
      intraday,
      caveats,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "snapshot failed" },
      { status: 502 }
    );
  }
}
