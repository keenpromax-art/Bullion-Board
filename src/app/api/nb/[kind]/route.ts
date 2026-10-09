import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { WATCHLIST } from "@/lib/watchlist";
import { NB_FO209 } from "@/lib/nbFo";
import { NB_SECTOR_MAP } from "@/lib/nbSector";
import {
  mean, stdSample, pearson, pctChange, seasonStats, classifySmaCross,
  nbRsiSimple, hvAnn, nbAtr, nbBB, nbStoch, nbZ, nbOptions, nbSignalCount,
  safetyMetrics, maxSharpeWeights, rankPct,
} from "@/lib/notebook";

// Notebook scan APIs — one dynamic route backing desks 76-84.
// Port of Stocks_Final.ipynb cells 1-15. Live Yahoo tape, fail-open legs,
// server-side batching (browser never fans out 2000+ fetches).
// kind: seasonality | sma | corr | optimizer | movers | sector | ipo | terminal
// universe: FO (209 curated, default) | ALL (full NSE watchlist)

export const maxDuration = 120;

async function mapPool<T, R>(arr: T[], n: number, fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: (R | null)[] = new Array(arr.length).fill(null);
  let i = 0;
  async function w() {
    while (i < arr.length) {
      const k = i++;
      try { out[k] = await fn(arr[k]); } catch { out[k] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, w));
  return out.filter((x): x is R => x !== null);
}

/**
 * NO CAP. The notebook scans its whole UNIVERSE - every name in the list - and a
 * screener that quietly truncates the list cannot honestly report what it
 * covered.
 *
 * The pairs mode of the correlation scanner used to take `univOf(u, 150)`,
 * scanning 150 of the 209 and calling the result "universe: 150". That number
 * then became the denominator of every rate the desk showed, so 150 unnamed
 * names looked like 59 names that simply had no negative correlation. The cap
 * is gone; the argument is kept so a call site cannot reintroduce one silently,
 * and it now THROWS rather than returning a short list.
 */
function univOf(u: string | null, cap = 0): string[] {
  const base = (u || "FO").toUpperCase() === "ALL" ? WATCHLIST : NB_FO209;
  if (cap > 0 && base.length > cap) {
    throw new Error(`UNIVERSE CAP REJECTED: ${base.length} REQUESTED, CAP ${cap} — EVERY DESK SCANS THE WHOLE LIST`);
  }
  return base;
}

const r2 = (v: number | null) => (v === null || !isFinite(v as number) ? null : Math.round((v as number) * 100) / 100);
const r3 = (v: number | null) => (v === null || !isFinite(v as number) ? null : Math.round((v as number) * 1000) / 1000);

async function kindSeasonality(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const today = new Date();
  const targetMonth = (today.getMonth() + 1) % 12 + 1; // next calendar month (notebook wrap)
  // The name must come from targetMonth, not from today — otherwise the header
  // labels one month while the returns are scored for the next. Matches
  // calendar.month_name[target_month] in the notebook.
  const monthName = new Date(Date.UTC(2024, targetMonth - 1, 1)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const settled = await mapPool<string, { sym: string; reason: string } | { row: SeasonRow }>(
    univ, 10, async (sym) => {
    try {
      const [m, d] = await Promise.all([
        fetchHistory(sym, "10y", "1mo"),
        fetchHistory(sym, "5d", "1d"),
      ]);
      if (m.length < 30) return { sym, reason: `MONTHLY TAPE SHORT — ${m.length} BARS` };
      // Notebook: returns[ticker][returns.index.month == target].dropna(),
      // pct_change across month-end closes. NaN months are dropped, not zeroed.
      const filt: number[] = [];
      for (let i = 1; i < m.length; i++) {
        const mo = new Date(m[i].date + "T00:00:00Z").getUTCMonth() + 1;
        if (mo === targetMonth) {
          const p = m[i - 1].close;
          if (p > 0 && isFinite(m[i].close)) filt.push((m[i].close / p - 1) * 100);
        }
      }
      const s = seasonStats(filt);
      // MIN_YEARS = 5: the notebook skips the ticker outright before it reaches
      // the DataFrame, and drops any row whose Sharpe came back NaN.
      if (s.n < 5) return { sym, reason: `UNDER MIN_YEARS=5 — ${s.n} OBSERVATIONS OF MONTH ${targetMonth}` };
      if (s.sharpe === null || !isFinite(s.sharpe)) return { sym, reason: `STD DEV = 0 — SHARPE UNDEFINED` };
      if (s.n < 5 || s.sharpe === null || !isFinite(s.sharpe as number)) return null;
      // Notebook LTP comes from a 5d daily pull, not the monthly bar, so the two can
      // disagree by a day. Falling back to the monthly close would silently
      // substitute a different price.
      const ltp = d.length ? d[d.length - 1].close : null;
      if (ltp === null || !isFinite(ltp)) return { sym, reason: "NO DAILY LTP" };
      return {
        row: {
          sym: sym.replace(".NS", ""), ltp: r2(ltp),
          win: r2(s.win), avg: r2(s.avg), sd: r2(s.sd), sharpe: r3(s.sharpe),
          skew: r3(s.skew), max: r2(s.max), min: r2(s.min), n: s.n,
        },
      };
    } catch { return { sym, reason: "TAPE UNAVAILABLE — FETCH FAILED" }; }
  });
  const misses = settled.filter((s): s is { sym: string; reason: string } => "reason" in s);
  const rows = settled.filter((s): s is { row: SeasonRow } => "row" in s).map((s) => s.row);
  rows.sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity));
  const reasons: Record<string, number> = {};
  for (const x of misses) {
    const k = x.reason.replace(/—.*$/, "").trim().replace(/\s+\d+.*$/, "").trim();
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
  return {
    targetMonth, monthName, universe: univ.length, requested: univ.length,
    count: rows.length,
    skipped: {
      count: misses.length,
      reasons,
      sample: misses.slice(0, 12).map((x) => ({ sym: x.sym.replace(".NS", ""), reason: x.reason })),
    },
    rows,
  };
}

async function kindSma(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  /**
   * Skips are COUNTED AND NAMED, not swallowed.
   *
   * The notebook's SECTION 5 prints a SKIPPED TICKERS block with an error
   * breakdown, precisely because a scan that quietly drops failures turns
   * "44 actionable of 209" into a statement about 209 symbols when it is only
   * ever a statement about however many happened to answer. mapPool drops an
   * errored symbol into `null` and the old code had no way to tell that apart
   * from a symbol that legitimately had no cross — so the two used to vanish
   * into the same silence. On the FO universe nothing is currently failing,
   * which is exactly why this needed fixing: the bug is invisible until the
   * day Yahoo rate-limits a burst and a real number quietly becomes a fake one.
   */
  const skips: { sym: string; reason: string }[] = [];
  const all = await mapPool(univ, 8, async (sym) => {
    const bare = sym.replace(".NS", "");
    try {
      const bars = await fetchHistory(sym, "2y", "1d");
      if (bars.length < 200) {
        skips.push({ sym: bare, reason: bars.length ? `ONLY ${bars.length} BARS — NEED 200 FOR SMA200` : "NO BARS RETURNED" });
        return null;
      }
      const closes = bars.map((b) => b.close);
      const c = classifySmaCross(closes);
      if (c.status === "SKIPPED") {
        skips.push({ sym: bare, reason: "NO VALID SMA PAIR — 200-BAR WINDOW NOT FILLED" });
        return null;
      }
      return {
        sym: bare, price: r2(closes[closes.length - 1]),
        s50: r2(c.s50), s200: r2(c.s200), diffPct: r2(c.diffPct),
        daysSince: c.daysSince, status: c.status, signal: c.signal,
      };
    } catch (e: any) {
      skips.push({ sym: bare, reason: `FEED ERROR — ${String(e?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });

  const rows = all as Array<{ sym: string; status: string; diffPct: number | null }>;
  const actionable = rows.filter((r) => r.status !== "NEUTRAL");
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  actionable.sort((a, b) => Math.abs(b.diffPct ?? 0) - Math.abs(a.diffPct ?? 0));

  const skipReasons: Record<string, number> = {};
  /**
   * Bucketed, not verbatim.
   *
   * The raw message is kept per-symbol in `sample`, but the COUNTS are grouped
   * into a handful of causes. Emitting the message as-is produced 35 buckets on
   * the full-NSE run — one for every distinct bar count — because "ONLY 152
   * BARS" and "ONLY 181 BARS" are the same problem wearing different numbers.
   * A breakdown table with 35 rows and 1 row each tells the reader nothing they
   * can act on; three rows that name the three real causes tells them the
   * screener is fine and the universe needs cleaning.
   */
  for (const s of skips) {
    const bucket = /^ONLY \d+ BARS/.test(s.reason)
      ? "INSUFFICIENT HISTORY — UNDER 200 DAILY BARS"
      : /UNKNOWN TICKER|NO YAHOO TAPE/i.test(s.reason)
        ? "NOT ON THE YAHOO TAPE — DELISTED, RENAMED OR WRONG SUFFIX"
        : /^NO BARS RETURNED/.test(s.reason)
          ? "NO BARS RETURNED"
          : /^NO VALID SMA PAIR/.test(s.reason)
            ? "SMA200 WINDOW NEVER FILLED"
            : "FEED ERROR";
    skipReasons[bucket] = (skipReasons[bucket] ?? 0) + 1;
  }

  return {
    universe: univ.length,
    count: rows.length,
    actionableCount: actionable.length,
    counts,
    /**
     * EVERY symbol that produced a reading, neutral included, because the
     * notebook exports df_results rather than df_actions and a screener whose
     * export is filtered to the interesting rows is not a screener you can
     * audit. The desk still displays actionable only; the CSV takes everything.
     */
    all: rows,
    rows: actionable,
    skipped: {
      count: skips.length,
      reasons: skipReasons,
      sample: skips.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
  };
}

async function kindCorr(sp: URLSearchParams) {
  const mode = (sp.get("mode") || "pairs").toLowerCase();
  const target = (sp.get("target") || "ITC.NS").toUpperCase();
  const tSym = target.includes(".") ? target : target + ".NS";
  if (mode === "single") {
    const univ = univOf(sp.get("universe"));
    const all = Array.from(new Set([...univ, tSym]));
    const series = await mapPool(all, 12, async (s) => {
      try {
        const bars = await fetchHistory(s, "1y", "1d");
        if (bars.length < 60) return null;
        return { s, rets: pctChange(bars.map((b) => b.close)).filter(isFinite) };
      } catch { return null; }
    });
    const t = series.find((x) => x.s === tSym);
    if (!t) return { mode, target: tSym, rows: [], error: "TARGET FETCH FAILED" };
    const rows = series
      .filter((x) => x.s !== tSym)
      .map((x) => ({ sym: x.s.replace(".NS", ""), corr: r3(pearson(t.rets, x.rets)) }))
      .filter((r) => r.corr !== null)
      .sort((a, b) => (a.corr as number) - (b.corr as number))
      .slice(0, 25);
    return { mode, target: tSym, count: rows.length, rows };
  }
  /**
   * ALL 209, AND EVERY PAIR OF THEM.
   *
   * `pearson` here is positional, so it has the same defect the optimizer's
   * covariance had: two tickers with different gaps in their tape are compared
   * on row offsets rather than on shared dates. For a NEGATIVE-correlation
   * screen that is the dangerous direction - misalignment mixes two different
   * market sessions and can manufacture a negative number that never happened.
   * Pairing on shared dates, with a minimum overlap, and reporting the pairs
   * that had too little in common rather than scoring them.
   *
   * C(209,2) = 21,661 pairs, all computed. The 100-row display cap stays, the
   * full sorted set is counted, and the pair overlap floor is reported.
   */
  const univ = univOf(sp.get("universe"));
  const skipped: { sym: string; reason: string }[] = [];
  const keyed = await mapPool<string, { s: string; byDate: Map<string, number> } | null>(univ, 12, async (s) => {
    const bare = s.replace(".NS", "");
    try {
      const bars = await fetchHistory(s, "1y", "1d");
      if (bars.length < 60) {
        skipped.push({ sym: bare, reason: bars.length ? `ONLY ${bars.length} BARS - NEED 60` : "NO BARS RETURNED" });
        return null;
      }
      const byDate = new Map<string, number>();
      for (let i = 1; i < bars.length; i++) {
        const p = bars[i - 1].close, c = bars[i].close;
        if (p > 0 && isFinite(c)) byDate.set(bars[i].date, c / p - 1);
      }
      return { s, byDate };
    } catch (e: unknown) {
      skipped.push({ sym: bare, reason: `FEED ERROR - ${String((e as Error)?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });
  const series = keyed.filter(Boolean) as Array<{ s: string; byDate: Map<string, number> }>;
  const MIN_OVERLAP = 60;
  const pairs: { a: string; b: string; corr: number; n: number }[] = [];
  let tooThin = 0;
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const a: number[] = [], b: number[] = [];
      for (const [d, v] of series[i].byDate) {
        const w = series[j].byDate.get(d);
        if (w !== undefined) { a.push(v); b.push(w); }
      }
      if (a.length < MIN_OVERLAP) { tooThin += 1; continue; }
      const c = pearson(a, b);
      if (c !== null && isFinite(c) && c < 0) {
        pairs.push({ a: series[i].s.replace(".NS", ""), b: series[j].s.replace(".NS", ""), corr: Math.round(c * 10000) / 10000, n: a.length });
      }
    }
  }
  pairs.sort((x, y) => x.corr - y.corr);
  return {
    mode: "pairs", universe: univ.length, requested: univ.length, kept: series.length,
    pairsTested: (series.length * (series.length - 1)) / 2, tooThin, minOverlap: MIN_OVERLAP,
    count: pairs.length, rows: pairs.slice(0, 100),
    skipped: {
      count: skipped.length,
      reasons: skipped.reduce<Record<string, number>>((acc, s) => {
        const k = /^ONLY \d+ BARS/.test(s.reason) ? "INSUFFICIENT HISTORY - UNDER 60 DAILY BARS"
          : /^NO BARS/.test(s.reason) ? "NO BARS RETURNED" : "FEED ERROR";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      sample: skipped.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
  };
}

async function kindOptimizer(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const capital = Number(sp.get("capital") || 100000);
  const TH = 0.06, RF = 0.065, SIZE = 10, TOPN = 25;
  type SafetyPer = { sym: string; price: number; closes: number[]; bars: Array<{ date: string; close: number }>; actual1Y: number; expAnn: number; volAnn: number | null; sortino: number | null; sharpe: number; mdd: number; score?: number | null; pass?: boolean };
  const skipped: { sym: string; reason: string }[] = [];
  const per: SafetyPer[] = await mapPool<string, SafetyPer>(univ, 12, async (sym) => {
    try {
      const bars = await fetchHistory(sym, "2y", "1d");
      const bare = sym.replace(".NS", "");
      // A ticker that cannot produce all four scored metrics is not ranked. The
      // notebook drops these inside `dropna`; saying which ones and why is the
      // only way a reader can tell a 209-name scan from a 190-name one.
      if (bars.length < 200) {
        skipped.push({ sym: bare, reason: bars.length ? `ONLY ${bars.length} BARS - NEED 200` : "NO BARS RETURNED" });
        return null;
      }
      const closes = bars.map((b) => b.close);
      const m = safetyMetrics(closes, RF);
      if (m.expAnn === null || m.actual1Y === null || m.sharpe === null || m.mdd === null) {
        skipped.push({ sym: bare, reason: "METRIC UNAVAILABLE - PRICE OR RETURN SERIES INCOMPLETE" });
        return null;
      }
      return { sym, price: closes[closes.length - 1], closes, bars, ...m } as SafetyPer;
    } catch (e: unknown) {
      skipped.push({ sym: sym.replace(".NS", ""), reason: `FEED ERROR - ${String((e as Error)?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });
  // benchmark
  let bm = { exp: null as number | null, vol: null as number | null, sharpe: null as number | null };
  try {
    const b = await fetchHistory("^NSEI", "2y", "1d");
    const bc = b.map((x) => x.close);
    const m = safetyMetrics(bc, RF);
    bm = { exp: m.expAnn, vol: m.volAnn, sharpe: m.sharpe };
  } catch { /* fail-open */ }
  /**
   * THE RANKING POPULATION IS THE WHOLE UNIVERSE, NOT THE SURVIVORS.
   *
   * The notebook ranks inside the score expression itself:
   *
   *   score = 0.30 * exp_ret.rank(pct=True) + 0.20 * actual_ret.rank(pct=True)
   *         + 0.30 * sharpe.rank(pct=True)    + 0.20 * (-mdd).rank(pct=True)
   *   elite = score[hard_pass].nlargest(TOP_N)
   *
   * `rank(pct=True)` runs over the FULL cleaned frame - all valid tickers - and
   * only afterwards does `hard_pass` select which of those scores may compete.
   * This port filtered hard_pass FIRST and ranked what survived, which makes
   * every surviving name a percentile rank among survivors: the worst performer
   * that clears the 6% gate scores 1.0 on every factor instead of something low,
   * so the composite cannot distinguish a merely-qualifying name from an
   * outstanding one. It inflated the elite list into the top of the passed
   * cohort rather than the top of the market.
   *
   * Ranking first and gating second reproduces the notebook: the cohort is
   * filtered on pass/fail, but the SCORE that orders it is measured against
   * everyone who produced a reading.
   */
  const scored = per.map((p) => ({ ...p, score: null as number | null, pass: false }));
  const rk = (xs: (number | null)[], asc = true) => rankPct(xs, asc);
  const rExp = rk(scored.map((p) => p.expAnn));
  const rAct = rk(scored.map((p) => p.actual1Y));
  const rSh = rk(scored.map((p) => p.sharpe));
  const rDd = rk(scored.map((p) => (p.mdd as number) * -1));
  scored.forEach((p, i) => {
    const parts = [rExp[i], rAct[i], rSh[i], rDd[i]];
    p.score = parts.every((v) => v !== null)
      ? (parts[0] as number) * 0.3 + (parts[1] as number) * 0.2 + (parts[2] as number) * 0.3 + (parts[3] as number) * 0.2
      : null;
    p.pass = (p.actual1Y as number) > 0 && (p.expAnn as number) >= TH;
  });
  const pass = scored.filter((p) => p.pass);
  const elite = pass.filter((p) => p.score !== null).sort((a, b) => (b.score as number) - (a.score as number)).slice(0, TOPN);
  if (elite.length < SIZE) {
    return { universe: univ.length, scanned: per.length, passed: pass.length, elite: [], error: "FEWER THAN 10 PASSED THE 6% FILTER — NO PORTFOLIO (—)" };
  }
  // candidate: top-10 by score, then hill-climb swaps (web replacement for C(25,10) enum)
  const idxOf = new Map(elite.map((e, i) => [e.sym, i]));
  void idxOf;
  const mu = elite.map((e) => e.expAnn as number);
  const n = elite.length;
  /**
   * COVARIANCE PAIRED ON THE SAME TRADING DAY, NOT ON THE SAME ROW OFFSET.
   *
   * The notebook builds one wide frame - `cleaned.pct_change().dropna()` - and
   * calls `.cov()`, so every pair is measured on the dates both tickers traded.
   *
   * This port held one return array per ticker and sliced each pair's TAIL to a
   * common length: `a.slice(-m)` against `b.slice(-m)`. Two tickers can have
   * different gaps in their tape - a halt, a listing date, a missing session -
   * so row k of A and row k of B are frequently different calendar days. The
   * correlation is then computed across mismatched days, which both shrinks
   * measured covariance and adds noise, and the whole 10-name portfolio Sharpe
   * is built from that matrix. A correlation that never existed is a real risk
   * number printed as if it were measured.
   *
   * Pairing is now by date. A pair with too few overlapping sessions to be
   * meaningful is left at 0 covariance and the pair is excluded from selection,
   * rather than being given a fabricated number.
   */
  // Build each ticker's return keyed by the date OF the return (today's bar).
  const keyed = elite.map((e) => {
    const closes = new Map<string, number>();
    for (const b of e.bars) closes.set(b.date, b.close);
    const out: Array<[string, number]> = [];
    for (let i = 1; i < e.bars.length; i++) {
      const p = closes.get(e.bars[i - 1].date);
      const c = e.bars[i].close;
      if (p !== undefined && p > 0 && c > 0 && isFinite(c)) out.push([e.bars[i].date, c / p - 1]);
    }
    return out;
  });
  const overlap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const mi = new Map(keyed[i]);
    for (let j = i; j < n; j++) {
      const mj = new Map(keyed[j]);
      const pairs: number[] = [];
      for (const [d, v] of keyed[i]) {
        const w = mj.get(d);
        if (w !== undefined) pairs.push(v, w);
      }
      const cnt = pairs.length / 2;
      overlap[i][j] = cnt;
      overlap[j][i] = cnt;
      if (cnt < 30) { cov[i][j] = 0; cov[j][i] = 0; continue; }
      const a: number[] = [], b: number[] = [];
      for (let k = 0; k < pairs.length; k += 2) { a.push(pairs[k]); b.push(pairs[k + 1]); }
      const ma = mean(a), mb = mean(b);
      let c = 0;
      for (let k = 0; k < a.length; k++) c += (a[k] - ma) * (b[k] - mb);
      const v = (c / (a.length - 1)) * 252;
      cov[i][j] = v;
      cov[j][i] = v;
    }
  }
  const flatOverlap = overlap.flat().filter((v) => v > 0);
  const minOverlap = flatOverlap.length ? Math.min(...flatOverlap) : 0;
  let best = elite.map((_, i) => i).slice(0, SIZE);
  const eqSharpe = (sel: number[]) => {
    const w = 1 / sel.length;
    const ret = sel.reduce((a, i) => a + mu[i] * w, 0);
    let v = 0;
    for (const i of sel) for (const j of sel) v += w * w * cov[i][j];
    const vol = Math.sqrt(Math.max(v, 1e-12));
    return (ret - RF) / vol;
  };
  let bestS = eqSharpe(best);
  for (let it = 0; it < 4000; it++) {
    const out = best[Math.floor(Math.random() * best.length)];
    const candPool = elite.map((_, i) => i).filter((i) => !best.includes(i));
    const inn = candPool[Math.floor(Math.random() * candPool.length)];
    const trial = best.map((x) => (x === out ? inn : x));
    const s = eqSharpe(trial);
    if (s > bestS) { best = trial; bestS = s; }
  }
  best.sort((a, b2) => mu[b2] - mu[a]);
  const selMu = best.map((i) => mu[i]);
  const selCov = best.map((i) => best.map((j) => cov[i][j]));
  const w = maxSharpeWeights(selMu, selCov, RF, 0.05, 0.25);
  const names = best.map((i) => elite[i]);
  const optRet = w.reduce((a, wi, k) => a + wi * selMu[k], 0);
  let ov = 0;
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++) ov += w[i] * w[j] * selCov[i][j];
  const optVol = Math.sqrt(Math.max(ov, 1e-12));
  const optSharpe = (optRet - RF) / optVol;
  const legs = names.map((e, k) => ({
    sym: e.sym.replace(".NS", ""), wPct: r2(w[k] * 100), amt: Math.round(w[k] * capital),
    expPct: r2((e.expAnn as number) * 100), sharpe: r3(e.sharpe), sortino: r3(e.sortino),
    mddPct: r2((e.mdd as number) * 100), actualPct: r2((e.actual1Y as number) * 100),
    score: r3(e.score), bars: e.bars.length,
  }));
  const profit = optRet * capital;
  return {
    universe: univ.length, requested: univ.length, scanned: per.length, passed: pass.length,
    eliteCount: elite.length, minCovOverlap: minOverlap,
    skipped: {
      count: skipped.length,
      reasons: skipped.reduce<Record<string, number>>((acc, s) => {
        const k = /^ONLY \d+ BARS/.test(s.reason) ? "INSUFFICIENT HISTORY - UNDER 200 DAILY BARS"
          : /^NO BARS/.test(s.reason) ? "NO BARS RETURNED"
            : /^METRIC UNAVAILABLE/.test(s.reason) ? "METRIC UNAVAILABLE"
              : "FEED ERROR";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
      sample: skipped.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
    legs: pass
      .filter((p) => p.score !== null)
      .sort((a, b) => (b.score as number) - (a.score as number))
      .slice(0, TOPN)
      .map((p) => ({
        sym: p.sym.replace(".NS", ""), score: r3(p.score), actualPct: r2(p.actual1Y * 100),
        expPct: r2(p.expAnn * 100), volPct: p.volAnn !== null ? r2(p.volAnn * 100) : null,
        sharpe: r3(p.sharpe), sortino: r3(p.sortino), mddPct: r2(p.mdd * 100), bars: p.bars.length,
      })),
    benchmark: {
      expPct: bm.exp !== null ? r2(bm.exp * 100) : null,
      volPct: bm.vol !== null ? r2(bm.vol * 100) : null,
      sharpe: bm.sharpe !== null ? r3(bm.sharpe) : null,
    },
    opt: {
      expPct: r2(optRet * 100), volPct: r2(optVol * 100), sharpe: r3(optSharpe),
      profit: Math.round(profit), total: Math.round(capital + profit), legs,
    },
    method: "RANK OVER FULL UNIVERSE + HARD-PASS GATE + TOP-25 + HILL-CLIMB 10-SELECT + DATE-ALIGNED COVARIANCE + BOUNDED MAX-SHARPE",
  };
}

async function kindMovers(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));

  /**
   * THE HALT GAP — the one place this port was quietly wrong, and the reason the
   * notebook forward-fills.
   *
   * The notebook calls `yf.download(tickers, period="5d")`, which returns a frame
   * indexed on the UNION of every ticker's dates, then `.ffill()`. A stock halted
   * for two sessions therefore gets its last real price carried across the
   * missing rows and reads 0.00% — so it can never appear in a top-10 gainers
   * list. That ffill is load-bearing.
   *
   * This desk fetches PER SYMBOL, so there is no union and nothing to fill. If
   * Yahoo returns Monday then Friday for a halted name, `bars[last-1]` against
   * `bars[last-2]` is a FOUR-DAY move wearing a one-day label, and it sorts into
   * the top 10 exactly like a genuine mover. Two of those in a list of ten is a
   * screener lying about what it measured.
   *
   * Both cases are now detected rather than assumed away:
   *   - a calendar gap wider than a normal non-trading stretch is STALE, and the
   *     real span in days is reported so the row is auditable
   *   - a zero-volume print is HALTED
   * Stale and halted names are excluded from the ranking — the same effect
   * ffill had, by giving them a truthful 0% — but they are COUNTED and SHOWN
   * rather than vanishing, because "why is this name missing" is a question the
   * desk should answer before it is asked.
   */
  /**
   * 1D IS THE NOTEBOOK'S CELL: top 10 and bottom 10 of `period="5d"` moves.
   *
   * The notebook's own universe is the same 209 and its window is exactly the
   * last two closes on a 5d pull, so `lookback: 2` matches it. The 1W and 1M
   * rows the desk also offers are NOT in this cell - they came from the
   * neighbouring windows cells - so they stay available but the 1D board is the
   * one that can be checked line for line against what the notebook prints.
   *
   * EVERY WINDOW PRINTS TEN. The notebook's week/month cells trim to 5, which
   * left the desk with a "TOP 10" heading over five rows — the panel promised a
   * depth the payload never delivered. Ten deep on both sides of every window is
   * the desk's own contract, and the full ranking is already in `all` behind the
   * CSV.
   */
  const WINDOWS = {
    "1D": { lookback: 2, topN: 10 },
    "1W": { lookback: 6, topN: 10 },
    "1M": { lookback: 22, topN: 10 },
  } as const;
  type Win = keyof typeof WINDOWS;

  const requested = (sp.get("win") || "1D").toUpperCase();
  const wants: Win[] = requested === "BOTH" ? ["1W", "1M"] : requested in WINDOWS ? [requested as Win] : ["1D"];
  const maxLookback = Math.max(...wants.map((w) => WINDOWS[w].lookback));
  // The notebook downloads 2mo ONCE and derives a week and a month from it. That
  // is worth keeping: the old desk re-scanned the entire universe every time the
  // window pill changed, so asking for both cost two full passes where one
  // serves.
  //
  // Range is chosen in CALENDAR terms, not bar terms — and getting that wrong is
  // silent. `range=5d` is five CALENDAR days, which yields roughly three trading
  // bars, so keying it off `lookback > 6` gave a 6-bar window a 5-day window and
  // every single name failed the length check. The desk came back empty and said
  // nothing about why. Roughly six trading bars need a calendar month; roughly
  // twenty-two need two.
  const range = maxLookback <= 2 ? "5d" : maxLookback <= 6 ? "1mo" : "2mo";

  /**
   * MINIMUM BARS FOLLOWS THE WINDOW, AND THE WINDOW CELLS SHARE ONE FLOOR.
   *
   * The 1W/1M cell gates on 22 bars regardless of which of its two tables you
   * read: it reads `iloc[-22]` for every ticker even when only the week table is
   * displayed, and it downloads a flat `period="2mo"` for all of them. So within
   * that cell a 1W view is a narrower slice of the SAME 22-bar floor, not a
   * looser one - this port used to gate on the requested window instead, which
   * let a 1W request admit names the cell would have dropped.
   *
   * The 1D board is a different cell with a different pull: `period="5d"`, last
   * two closes, no month reference. It needs 2 bars and nothing else. Applying 22
   * there rejected all 209 names, because a five-calendar-day pull returns about
   * three trading bars - which is the same trap documented at the range choice
   * above, in the opposite direction.
   */
  const minBars = maxLookback <= 2 ? 2 : 22;

  const skips: { sym: string; reason: string }[] = [];
  const halted: { sym: string; spanDays: number | null }[] = [];

  // One fetch per symbol. Every requested window is derived from the same bars.
  const scanned = await mapPool(univ, 10, async (sym) => {
    const bare = sym.replace(".NS", "");
    try {
      const bars = await fetchHistory(sym, range, "1d");
      if (bars.length < minBars) {
        skips.push({ sym: bare, reason: `ONLY ${bars.length} BARS — NEED ${minBars}` });
        return null;
      }
      const lastBar = bars[bars.length - 1];
      // Zero volume on the newest print means the name is halted. Its "move" is
      // an artefact of the halt, not a trade, for every window at once — so it
      // is recorded once here and excluded everywhere below.
      if (lastBar.volume === 0) {
        halted.push({ sym: bare, spanDays: null });
        return null;
      }
      const per: Partial<Record<Win, { chg: number; spanDays: number; ref: number }>> = {};
      for (const w of wants) {
        const refBar = bars[bars.length - WINDOWS[w].lookback];
        const ref = refBar.close;
        if (!(ref > 0)) continue;
        per[w] = {
          chg: ((lastBar.close - ref) / ref) * 100,
          spanDays: Math.round((Date.parse(lastBar.date) - Date.parse(refBar.date)) / 86400000),
          ref,
        };
      }
      return { sym: bare, price: r2(lastBar.close), date: lastBar.date, per };
    } catch (e: any) {
      skips.push({ sym: bare, reason: `FEED ERROR — ${String(e?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });

  const ok = scanned.filter((r): r is NonNullable<typeof r> => r !== null);

  /** Rank one window, holding back anything whose span is out of line. */
  function rank(w: Win) {
    const cfg = WINDOWS[w];
    const candidates = ok.filter((r) => r.per[w] !== undefined);
    // MEDIAN span, not a hardcoded one. The obvious threshold is wrong in both
    // directions: too tight and a Diwali week flags half the market, too loose and
    // a name halted for a fortnight still ranks. The median is the span the
    // exchange calendar actually produced today, so it absorbs holidays by
    // construction, and only a name materially longer than its peers is held.
    const spans = candidates.map((r) => r.per[w]!.spanDays).sort((a, b) => a - b);
    const median = spans.length ? spans[Math.floor(spans.length / 2)]! : 0;
    const limit = Math.ceil(median * 1.5) + 2;

    const kept: typeof candidates = [];
    const stale: Array<{ sym: string; reason: string; chg: number | null; spanDays: number | null }> = [];
    for (const r of candidates) {
      const e = r.per[w]!;
      if (e.spanDays > limit) {
        stale.push({
          sym: r.sym,
          reason: `STALE FOR ${w} — ${e.spanDays} CALENDAR DAYS BEHIND A ${median}-DAY MEDIAN`,
          chg: r2(e.chg),
          spanDays: e.spanDays,
        });
      } else {
        kept.push(r);
      }
    }
    const byChg = [...kept].sort((a, b) => b.per[w]!.chg - a.per[w]!.chg);
    const asc = [...byChg].reverse();
    // Flattened to the window's own numbers rather than handing callers the
    // nested `per` map. One shape for every consumer, and the CSV and the desk
    // read the same fields the single-window response always did.
    const flat = (r: (typeof kept)[number]) => ({
      sym: r.sym,
      price: r.price,
      chg: r2(r.per[w]!.chg),
      spanDays: r.per[w]!.spanDays,
      prevClose: r2(r.per[w]!.ref),
      date: r.date,
    });
    return {
      win: w,
      medianSpan: median,
      spanLimit: limit,
      ranked: byChg.length,
      staleCount: stale.length,
      top: byChg.slice(0, cfg.topN).map(flat),
      bottom: asc.slice(0, cfg.topN).map(flat),
      all: byChg.map(flat),
      stale: stale.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    };
  }

  const windows = wants.map(rank);
  const primary = windows[0]!;

  const skipReasons: Record<string, number> = {};
  const bucket = (r: string) =>
    /^ONLY \d+ BARS/.test(r) ? "INSUFFICIENT BARS"
      : /ZERO OR MISSING/.test(r) ? "ZERO OR MISSING REFERENCE CLOSE"
        : "FEED ERROR";
  for (const s of skips) skipReasons[bucket(s.reason)] = (skipReasons[bucket(s.reason)] ?? 0) + 1;

  return {
    win: requested,
    /** One entry per requested window. BOTH returns two, from a single scan. */
    windows,
    universe: univ.length,
    count: ok.length,
    top: primary.top,
    bottom: primary.bottom,
    all: primary.all,
    stale: primary.stale,
    skipped: {
      count: skips.length,
      reasons: skipReasons,
      sample: skips.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
    quarantined: {
      count: halted.length + primary.staleCount,
      halted: halted.length,
      stale: primary.staleCount,
      haltedSample: halted.slice(0, 12).map((h) => h.sym).sort(),
    },
  };
}

async function kindSector() {
  const syms = Object.keys(NB_SECTOR_MAP);
  const skipped: { sym: string; reason: string }[] = [];
  const rets = await mapPool(syms, 12, async (s) => {
    const bare = s.replace(".NS", "");
    try {
      const bars = await fetchHistory(s, "3mo", "1d");
      if (!bars.length) {
        skipped.push({ sym: bare, reason: "NO BARS RETURNED" });
        return null;
      }
      const c = bars.map((b) => b.close);
      /**
       * NO WHOLE-TICKER BAR GATE. The notebook gates PER WINDOW and never drops a
       * ticker from the frame:
       *
       *   def safe_ret(series, n):
       *     c = series.dropna()
       *     if len(c) < n + 1: return np.nan
       *     return ((c.iloc[-1] / c.iloc[-1 - n]) - 1) * 100
       *
       * `records` is built for every column of `close`, so a short history still
       * becomes a row - and still counts toward `groupby(...).count()`, even
       * where all three of its returns are NaN. Only the per-window values go
       * missing.
       *
       * This port dropped any ticker with under 25 bars from the frame entirely.
       * That shrank the sector Count AND removed those names from the mean,
       * while the notebook reports the count over all names mapped to the sector
       * and averages over whatever has data. A sector could therefore show a
       * confident mean drawn from a handful of names beside a Count implying a
       * much larger membership.
       */
      const sr = (n: number) => (c.length > n && c[c.length - 1 - n] > 0 ? ((c[c.length - 1] / c[c.length - 1 - n]) - 1) * 100 : null);
      return { s, d1: sr(1), w1: sr(5), m1: sr(21), bars: c.length, price: c[c.length - 1] };
    } catch (e: unknown) {
      skipped.push({ sym: bare, reason: `FEED ERROR - ${String((e as Error)?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });
  const bySec = new Map<string, { d: number[]; w: number[]; m: number[]; n: number; thin: number }>();
  for (const r of rets) {
    const sec = NB_SECTOR_MAP[r.s];
    if (!bySec.has(sec)) bySec.set(sec, { d: [], w: [], m: [], n: 0, thin: 0 });
    const g = bySec.get(sec)!;
    // Count is over EVERY name mapped to the sector, exactly as the notebook's
    // groupby().count() is - it does not mean "names with a usable reading".
    g.n += 1;
    if (r.d1 !== null && isFinite(r.d1)) g.d.push(r.d1);
    if (r.w1 !== null && isFinite(r.w1)) g.w.push(r.w1);
    if (r.m1 !== null && isFinite(r.m1)) g.m.push(r.m1);
    // A name that cannot produce the 1M reading is the one most likely to distort
    // the month figure, so it is counted separately rather than averaged away.
    if (r.m1 === null || !isFinite(r.m1)) g.thin += 1;
  }
  const sectors = [...bySec.entries()].map(([name, g]) => ({
    name, count: g.n,
    // The denominator behind each mean. Count is membership; this is evidence.
    n1d: g.d.length, n1w: g.w.length, n1m: g.m.length, thin: g.thin,
    d1: r2(mean(g.d)), w1: r2(mean(g.w)), m1: r2(mean(g.m)),
  })).sort((a, b) => (b.m1 ?? -Infinity) - (a.m1 ?? -Infinity));
  const leaders = rets
    .filter((r) => r.m1 !== null && isFinite(r.m1 as number))
    .sort((a, b) => (b.m1 as number) - (a.m1 as number))
    .slice(0, 10)
    .map((r) => ({ sym: r.s.replace(".NS", ""), sec: NB_SECTOR_MAP[r.s], d1: r2(r.d1), w1: r2(r.w1), m1: r2(r.m1), price: r2(r.price) }));
  return {
    universe: syms.length, requested: syms.length, sectorsTotal: syms.length,
    fetched: rets.length, sectorCount: sectors.length, sectors, leaders,
    skipped: {
      count: skipped.length,
      reasons: skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1;
        return acc;
      }, {}),
      sample: skipped.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
  };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim();
}

async function kindIpo() {
  const urls = [
    { key: "upcoming", label: "UPCOMING & ACTIVE", url: "https://www.screener.in/ipo/" },
    { key: "recent", label: "RECENTLY LISTED", url: "https://www.screener.in/ipo/recent/" },
    { key: "below", label: "BELOW ISSUE PRICE", url: "https://www.screener.in/ipo/below-price/" },
  ];
  const out: Record<string, { label: string; cols: string[]; rows: string[][]; error?: string }> = {};
  for (const u of urls) {
    try {
      const r = await fetch(u.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", Accept: "text/html" },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const html = await r.text();
      const tm = html.match(/<table[\s\S]*?<\/table>/i);
      if (!tm) throw new Error("NO TABLE");
      const table = tm[0];
      const head = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
      const bodyRows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1])))
        .filter((r2) => r2.length > 0)
        .slice(0, 60);
      out[u.key] = { label: u.label, cols: head.slice(0, 8), rows: bodyRows.map((r2) => r2.slice(0, 8)) };
    } catch (e: unknown) {
      out[u.key] = { label: u.label, cols: [], rows: [], error: e instanceof Error ? e.message : "SCRAPE FAILED" };
    }
  }
  return { source: "SCREENER.IN VIA SERVER PROXY · 1H CACHE", boards: out };
}

type SeasonRow = { sym: string; ltp: number | null } & ReturnType<typeof seasonStats>;

type TermRow = {
  sym: string; sec: string; ltp: number | null;
  d1: number | null; w1: number | null; m1: number | null; m3: number | null; m6: number | null;
  y1: number | null;
  rsi: number | null; hv: number | null; atr: number | null;
  bbPos: number | null; bbWidth: number | null;
  stochK: number | null; stochD: number | null; z: number | null;
  a20: boolean | null; a50: boolean | null; a200: boolean | null;
  golden: boolean | null; macdBull: boolean | null; macdHist: number | null;
  h52: number | null; l52: number | null;
  dd: { cur: number | null; max: number | null };
  sharpe: number | null; sortino: number | null; calmar: number | null; beta: number | null;
  mom: number | null; vr: number | null; sig: number; bars: number;
  straddlePct: number | null; emPct: number | null;
  sea: {
    avg: number | null; wr: number | null; sharpe: number | null;
    max: number | null; min: number | null; n: number;
  } | null;
};

const TERM_SECTOR_MAP = buildTerminalSectorMap();

/**
 * THE TERMINAL CARRIES ITS OWN SECTOR MAP, AND IT IS NOT THE SECTOR DESK'S.
 *
 * v5's `SECTOR_MAP` has 209 keys against the sector cell's 208, and uses short
 * labels: NBFC not "NBFC & Fin Services", IT not "IT & Technology", Auto not
 * "Automobiles", Durables not "Consumer Durables", Others not "Miscellaneous".
 * Membership differs by exactly one name - ETERNAL is "Others" here and absent
 * from the sector cell entirely - which is why module 82 legitimately scans 208
 * while this board scans 209.
 *
 * The port had both desks reading one shared map, so this board silently showed
 * 208 names in "Miscellaneous" style buckets and dropped ETERNAL from the
 * sector view of a universe that is otherwise all 209.
 */
function buildTerminalSectorMap(): Record<string, string> {
  const SHORT: Record<string, string> = {
    "NBFC & Fin Services": "NBFC", "Capital Markets": "Capital Mkts",
    "IT & Technology": "IT", "Oil Gas & Petrochem": "Oil & Gas",
    "Metals & Mining": "Metals", "Power & Renewables": "Power",
    "Infra & Construction": "Infra", "Defence & Aerospace": "Defence",
    "Pharma & Healthcare": "Pharma", "Automobiles": "Auto",
    "FMCG & Consumer": "FMCG", "Cement & Building Mat": "Cement",
    "Consumer Durables": "Durables", "Travel & Hospitality": "Travel",
    "Miscellaneous": "Others",
  };
  const out: Record<string, string> = {};
  for (const [sym, sec] of Object.entries(NB_SECTOR_MAP)) out[sym] = SHORT[sec] ?? sec;
  // ETERNAL.NS is in the F&O universe and mapped to "Others" in v5.
  if (NB_FO209.includes("ETERNAL.NS") && !out["ETERNAL.NS"]) out["ETERNAL.NS"] = "Others";
  return out;
}

async function kindTerminal(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const q = (sp.get("q") || "").toUpperCase();
  const secF = sp.get("sector") || "";
  const list = univ.filter((s) => (!q || s.includes(q)) && (!secF || (TERM_SECTOR_MAP[s] ?? "Others") === secF));
  // expiry: last Thursday of month
  const now = new Date();
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  let dte = lastDay;
  while (dte.getUTCDay() !== 4) dte = new Date(dte.getTime() - 86400000);
  const daysToExpiry = Math.max(1, Math.round((dte.getTime() - now.getTime()) / 86400000) + 1);
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const nextMonthIdx = (new Date().getUTCMonth() + 1) % 12;
  let niftyRets = new Map<string, number>();
  try {
    const nb = await fetchHistory("^NSEI", "1y", "1d");
    const cl = nb.map((b) => b.close);
    for (let i = 1; i < nb.length; i++) {
      if (cl[i - 1] > 0 && isFinite(cl[i])) niftyRets.set(nb[i].date, Math.log(cl[i] / cl[i - 1]));
    }
  } catch { /* fail-open */ }
  // Beta is only meaningful against a live NIFTY tape. When this is false every
  // BETA cell is a missing reading, not a low beta, and the desk must say so.
  const betaTape = niftyRets.size >= 30;
  // The whole filtered list. It was `.slice(0, 209)`, which was harmless while the
  // FO list held exactly 209 but would silently drop names the moment the
  // universe grew - and would drop them without saying so, since the count came
  // from the truncated list.
  const requested = list;
  const settled = await mapPool<string, { sym: string; reason: string } | { row: TermRow }>(
    requested, 10, async (sym) => {
    try {
      const [d, m] = await Promise.all([
        fetchHistory(sym, "1y", "1d"),
        fetchHistory(sym, "10y", "1mo"),
      ]);
      if (d.length < 60) return { sym, reason: "HISTORY < 60 BARS" };
      // A tape whose final bar is over 12 calendar days old is not live — that is
      // wider than a long holiday, so it catches delisted and dead feeds without
      // quarantining real names over Diwali.
      const lastBar = d[d.length - 1].date;
      const ageDays = (now.getTime() - new Date(`${lastBar}T00:00:00Z`).getTime()) / 86400000;
      if (ageDays > 12) return { sym, reason: `STALE TAPE — LAST BAR ${lastBar}` };
      const closes = d.map((b) => b.close);
      const highs = d.map((b) => b.high);
      const lows = d.map((b) => b.low);
      const vols = d.map((b) => b.volume);
      const ltp = closes[closes.length - 1];
      const lr = pctChange(closes).filter(isFinite);
      const logR = pctChange(closes.map((c) => Math.log(Math.max(c, 1e-9)))).filter(isFinite);
      // Date-keyed log returns, for pairing beta against NIFTY on shared days.
      const lrByDate = new Map<string, number>();
      for (let i = 1; i < d.length; i++) {
        if (d[i - 1].close > 0 && isFinite(d[i].close)) lrByDate.set(d[i].date, Math.log(d[i].close / d[i - 1].close));
      }
      const sr = (n: number) => (closes.length > n && closes[closes.length - 1 - n] > 0 ? ((ltp / closes[closes.length - 1 - n]) - 1) * 100 : null);
      const rsi = nbRsiSimple(closes);
      const hv = hvAnn(logR, 20);
      const atr = nbAtr(highs, lows, closes);
      const bb = nbBB(closes);
      const st = nbStoch(highs, lows, closes);
      const z = nbZ(closes);
      const a50 = closes.length >= 50 ? ltp > mean(closes.slice(-50)) : null;
      const a200 = closes.length >= 200 ? ltp > mean(closes.slice(-200)) : null;
      const a20 = closes.length >= 20 ? ltp > mean(closes.slice(-20)) : null;
      const s50 = closes.length >= 200 ? mean(closes.slice(-50)) : NaN;
      const s200 = closes.length >= 200 ? mean(closes.slice(-200)) : NaN;
      const golden = isFinite(s50) && isFinite(s200) ? (s50 as number) > (s200 as number) : null;
      // MACD bull via EMA12/26/9
      const ema = (arr: number[], span: number): number[] => {
        const k = 2 / (span + 1);
        let p = arr[0];
        const out = [p];
        for (let i = 1; i < arr.length; i++) { p = arr[i] * k + p * (1 - k); out.push(p); }
        return out;
      };
      // MACD(12,26,9) in one O(n) pass over both EMA legs.
      const e12s = ema(closes, 12), e26s = ema(closes, 26);
      const macdTail = closes.map((_, i) => e12s[i] - e26s[i]).slice(25);
      const sigTail = ema(macdTail, 9);
      const macdBull = macdTail.length >= 9 && sigTail.length >= 9
        ? macdTail[macdTail.length - 1] > sigTail[sigTail.length - 1] : null;
      const macdHist = macdTail.length >= 9 && sigTail.length >= 9
        ? macdTail[macdTail.length - 1] - sigTail[sigTail.length - 1] : null;
      // 52-week high/low distance. `min(len(s),252)` with min_periods=20, so a
      // short history still produces a reading rather than going blank.
      const w52 = Math.min(closes.length, 252);
      const seg52 = closes.slice(-w52);
      const h52 = seg52.length >= 20 ? Math.max(...seg52) : null;
      const l52 = seg52.length >= 20 ? Math.min(...seg52) : null;
      const dd = (() => { let pk = -Infinity, cur = 0, mx = 0; for (const p of closes) { if (p > pk) pk = p; if (pk > 0) { cur = ((p - pk) / pk) * 100; mx = Math.min(mx, cur); } } return { cur: r2(cur), max: r2(mx) }; })();
      const ex = lr.map((x) => x - 0.065 / 252);
      const sd = stdSample(ex);
      const sharpe = sd > 0 ? (mean(ex) / sd) * Math.sqrt(252) : null;
      const neg = lr.filter((x) => x < 0);
      const sdn = neg.length > 1 ? stdSample(neg) : null;
      // The notebook computes downside deviation over negative returns ONLY and
      // returns NaN when there are none. This port fell back to total volatility,
      // which manufactures a Sortino for a name that never fell - reported as a
      // real reading off a definition that does not hold.
      const sortino = sdn !== null && sdn > 0 ? (mean(ex) / sdn) * Math.sqrt(252) : null;
      // Calmar: annualised return over max drawdown, same as the notebook.
      const calmar = (() => {
        if (closes.length < 20) return null;
        const ann = Math.pow(closes[closes.length - 1] / closes[0], 252 / closes.length) - 1;
        const mddAbs = Math.abs((dd.max as number) ?? 0);
        return mddAbs > 0 ? ann / mddAbs : null;
      })();
      const beta = (() => {
        if (!betaTape) return null;
        // Paired ON THE SAME TRADING DAY, as the notebook's `pd.concat([sr, nifty],
        // join="inner")` does. The previous port tail-aligned two return ARRAYS,
        // so wherever one tape had a gap, row k of the stock and row k of NIFTY
        // were different calendar days - the same misalignment corrected in the
        // optimizer and correlation scans.
        const pairs: number[] = [];
        for (const [d, v] of lrByDate) {
          const nv = niftyRets.get(d);
          if (nv !== undefined && isFinite(nv)) pairs.push(v, nv);
        }
        const m = pairs.length / 2;
        if (m < 30) return null;
        const xs: number[] = [], ys: number[] = [];
        for (let i = 0; i < pairs.length; i += 2) { xs.push(pairs[i]); ys.push(pairs[i + 1]); }
        const mx = mean(xs), my = mean(ys);
        let cov = 0, vy = 0;
        for (let i = 0; i < m; i++) { cov += (xs[i] - mx) * (ys[i] - my); vy += (ys[i] - my) ** 2; }
        return vy > 0 ? cov / (m - 1) / (vy / (m - 1)) : null;
      })();
      // MomScore is NOT computed here. It is a cross-sectional rank sum over the
      // m1/m3/m6/y1 columns and needs every row to exist first, so it is built
      // after the scan, below.
      const opt = nbOptions(ltp, hv, daysToExpiry);
      const sig = nbSignalCount({ rsi, macdBull, a50, a200, golden, stochK: st.k });
      const vr = vols.length >= 22 && mean(vols.slice(-21, -1)) > 0 ? vols[vols.length - 1] / (mean(vols.slice(-21, -1)) as number) : null;
      // Seasonality is scored against NEXT calendar month — the month this board
      // is actually traded into, not the one already closing.
      const mf: number[] = [];
      for (let i = 1; i < m.length; i++) {
        if (new Date(m[i].date + "T00:00:00Z").getUTCMonth() === nextMonthIdx) {
          const p = m[i - 1].close;
          if (p > 0) mf.push(((m[i].close / p) - 1) * 100);
        }
      }
      const sea = mf.length >= 3
        ? {
          avg: r2(mean(mf)),
          wr: r2((mf.filter((v) => v > 0).length / mf.length) * 100),
          sharpe: (() => {
            const s = stdSample(mf);
            return s !== null && s > 0 ? r3(mean(mf) / s) : null;
          })(),
          max: r2(Math.max(...mf)), min: r2(Math.min(...mf)), n: mf.length,
        }
        : null;
      return {
        row: {
          sym: sym.replace(".NS", ""), sec: TERM_SECTOR_MAP[sym] ?? "Others", ltp: r2(ltp),
          d1: r2(sr(1)), w1: r2(sr(5)), m1: r2(sr(21)), m3: r2(sr(63)), m6: r2(sr(126)),
          y1: r2(sr(252)),
          rsi: r2(rsi), hv: r2(hv), atr: r2(atr),
          bbPos: r2(bb.pos), bbWidth: r2(bb.width),
          stochK: r2(st.k), stochD: r2(st.dval), z: r2(z),
          a20, a50, a200, golden, macdBull, macdHist: r3(macdHist),
          h52: h52 !== null && ltp > 0 ? r2(((ltp - h52) / h52) * 100) : null,
          l52: l52 !== null && ltp > 0 ? r2(((ltp - l52) / l52) * 100) : null,
          dd, sharpe: r3(sharpe), sortino: r3(sortino), calmar: r3(calmar), beta: r2(beta),
          mom: null as number | null, vr: r2(vr), sig, bars: d.length,
          straddlePct: r2(opt.straddlePct), emPct: r2(opt.emPct), sea,
        },
      };
    } catch { return { sym, reason: "TAPE UNAVAILABLE — FETCH FAILED" }; }
  });
  const misses = settled.filter((s): s is { sym: string; reason: string } => "reason" in s);
  const ok = settled.filter((s): s is { row: TermRow } => "row" in s).map((s) => s.row);
  /**
   * MOMSCORE IS A RANK SUM OVER THE RETURN COLUMNS, NOT A RANK OF A SCORE.
   *
   *   for col, w in [("1M%",.20),("3M%",.30),("6M%",.35),("1Y%",.15)]:
   *       df[f"_r_{col}"] = df[col].rank(pct=True, na_option="bottom") * 100 * w
   *   df["MomScore"] = df[["_r_1M%","_r_3M%","_r_6M%","_r_1Y%"]].sum(axis=1).round(1)
   *
   * Each horizon is percentile-ranked on its own, then weighted and summed. The
   * weights land on RANKED horizons, not on raw returns.
   *
   * This port scored each ticker from its raw returns and then ranked that
   * composite - two different operations, and the ordering differs. Ranking raw
   * returns first is what makes the score cross-sectional and scale-free: a name
   * whose 6M return is the best in the universe scores the full 0.35 regardless
   * of whether that return is 40% or 4%.
   *
   * `na_option="bottom"` puts a missing horizon at percentile 0, so it
   * contributes nothing rather than counting as neutral. A ticker without a 1Y
   * reading simply loses the 0.15 - it is not penalised, and it is not excused.
   */
  const MOM_W: Array<[keyof TermRow, number]> = [["m1", 0.2], ["m3", 0.3], ["m6", 0.35], ["y1", 0.15]];
  const momOf = (key: keyof TermRow) =>
    ok.map((r) => {
      const v = r[key];
      return typeof v === "number" ? v : null;
    });
  // Percentile 0 for a missing reading, matching na_option="bottom".
  const pctRankBottom = (xs: Array<number | null>): number[] => {
    const pts = xs.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
    const out = xs.map(() => 0);
    if (pts.length < 2) return out;
    pts.sort((a, b) => a.v - b.v);
    pts.forEach((p, r) => { out[p.i] = (r / (pts.length - 1)) * 100; });
    return out;
  };
  const ranksBy = MOM_W.map(([k]) => pctRankBottom(momOf(k)));
  ok.forEach((r, i) => {
    // pctRankBottom already returns 0-100, matching pandas' rank(pct=True)*100.
    // The notebook's `*100*w` therefore scales by the weight only here - the
    // second *100 in the sum would have pushed the ceiling to 10,000, which is
    // how this first landed reporting a "momentum score" of 9,918.
    let sum = 0;
    for (let k = 0; k < MOM_W.length; k++) sum += ranksBy[k][i] * MOM_W[k][1];
    r.mom = r2(sum);
  });
  const gain = ok.filter((r) => (r.w1 ?? 0) > 0).length;
  const reasons: Record<string, number> = {};
  for (const x of misses) reasons[x.reason.split("—")[0].trim()] = (reasons[x.reason.split("—")[0].trim()] ?? 0) + 1;
  return {
    universe: univ.length, requested: requested.length, count: ok.length,
    gainers: gain, losers: ok.length - gain, daysToExpiry, betaTape,
    momBase: ok.length,
    seaMonth: nextMonthIdx + 1, seaName: MON[nextMonthIdx],
    skipped: {
      count: misses.length,
      reasons,
      sample: misses.slice(0, 12).map((x) => ({ sym: x.sym.replace(".NS", ""), reason: x.reason })),
    },
    rows: ok.sort((a, b) => (b.mom ?? -1) - (a.mom ?? -1)),
  };
}

export async function GET(req: NextRequest, { params }: { params: { kind: string } }) {
  const kind = (params.kind || "").toLowerCase();
  const sp = req.nextUrl.searchParams;
  try {
    if (kind === "seasonality") return NextResponse.json(await kindSeasonality(sp));
    if (kind === "sma") return NextResponse.json(await kindSma(sp));
    if (kind === "corr") return NextResponse.json(await kindCorr(sp));
    if (kind === "optimizer") return NextResponse.json(await kindOptimizer(sp));
    if (kind === "movers") return NextResponse.json(await kindMovers(sp));
    if (kind === "sector") return NextResponse.json(await kindSector());
    if (kind === "ipo") return NextResponse.json(await kindIpo());
    if (kind === "terminal") return NextResponse.json(await kindTerminal(sp));
    return NextResponse.json({ error: `UNKNOWN NB KIND ${kind}` }, { status: 404 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "nb scan failed", kind }, { status: 502 });
  }
}
