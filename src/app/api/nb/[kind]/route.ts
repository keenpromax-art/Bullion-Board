import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { WATCHLIST } from "@/lib/watchlist";
import { NB_FO209 } from "@/lib/nbFo";
import { NB_SECTOR_MAP } from "@/lib/nbSector";
import {
  mean, stdSample, pearson, pctChange, seasonStats, classifySmaCross,
  nbRsiSimple, hvAnn, nbAtr, nbBB, nbStoch, nbZ, nbOptions, nbSignalCount,
  nbBeta, nbMomScore, safetyMetrics, maxSharpeWeights, rankPct,
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

function univOf(u: string | null, cap = 0): string[] {
  const base = (u || "FO").toUpperCase() === "ALL" ? WATCHLIST : NB_FO209;
  return cap > 0 ? base.slice(0, cap) : base;
}

const r2 = (v: number | null) => (v === null || !isFinite(v as number) ? null : Math.round((v as number) * 100) / 100);
const r3 = (v: number | null) => (v === null || !isFinite(v as number) ? null : Math.round((v as number) * 1000) / 1000);

async function kindSeasonality(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const today = new Date();
  const targetMonth = (today.getMonth() + 1) % 12 + 1; // next calendar month (notebook wrap)
  const monthName = today.toLocaleString("en-US", { month: "long", timeZone: "Asia/Kolkata" });
  const rows = await mapPool(univ, 10, async (sym) => {
    try {
      const [m, d] = await Promise.all([
        fetchHistory(sym, "10y", "1mo"),
        fetchHistory(sym, "5d", "1d"),
      ]);
      if (m.length < 30) return null;
      // monthly % from month closes
      const rets: number[] = [];
      for (let i = 1; i < m.length; i++) {
        const p = m[i - 1].close;
        if (p > 0) rets.push((m[i].close / p - 1) * 100);
      }
      // align months: notebook filters by index.month == target
      const filt: number[] = [];
      for (let i = 1; i < m.length; i++) {
        const mo = new Date(m[i].date + "T00:00:00Z").getUTCMonth() + 1;
        if (mo === targetMonth) {
          const p = m[i - 1].close;
          if (p > 0 && isFinite(m[i].close)) filt.push((m[i].close / p - 1) * 100);
        }
      }
      void rets;
      const s = seasonStats(filt);
      if (s.n < 5 || s.sharpe === null || !isFinite(s.sharpe as number)) return null;
      const ltp = d.length ? d[d.length - 1].close : m[m.length - 1].close;
      return {
        sym: sym.replace(".NS", ""), ltp: r2(ltp),
        win: r2(s.win), avg: r2(s.avg), sd: r2(s.sd), sharpe: r3(s.sharpe),
        skew: r3(s.skew), max: r2(s.max), min: r2(s.min), n: s.n,
      };
    } catch { return null; }
  });
  rows.sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity));
  return { targetMonth, monthName, universe: univ.length, count: rows.length, rows };
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
  // pairs: all-pairs negative filter (cell 4, Pearson, ffill-ish via dropna)
  const univ = univOf(sp.get("universe"), 150);
  const series = await mapPool(univ, 12, async (s) => {
    try {
      const bars = await fetchHistory(s, "1y", "1d");
      if (bars.length < 150) return null;
      const closes = bars.map((b) => b.close);
      // ffill limit 3 approx: drop leading NaNs (fetchHistory never emits nulls)
      return { s, rets: pctChange(closes).filter(isFinite) };
    } catch { return null; }
  });
  const pairs: { a: string; b: string; corr: number }[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const c = pearson(series[i].rets, series[j].rets);
      if (isFinite(c) && c < 0) pairs.push({ a: series[i].s.replace(".NS", ""), b: series[j].s.replace(".NS", ""), corr: Math.round(c * 10000) / 10000 });
    }
  }
  pairs.sort((x, y) => x.corr - y.corr);
  return { mode: "pairs", universe: univ.length, kept: series.length, count: pairs.length, rows: pairs.slice(0, 100) };
}

async function kindOptimizer(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const capital = Number(sp.get("capital") || 100000);
  const TH = 0.06, RF = 0.065, SIZE = 10, TOPN = 25;
  type SafetyPer = { sym: string; price: number; closes: number[]; actual1Y: number | null; expAnn: number | null; volAnn: number | null; sharpe: number | null; mdd: number | null };
  const per: SafetyPer[] = await mapPool<string, SafetyPer>(univ, 12, async (sym) => {
    try {
      const bars = await fetchHistory(sym, "2y", "1d");
      if (bars.length < 200) return null;
      const closes = bars.map((b) => b.close);
      const m = safetyMetrics(closes, RF);
      if (m.expAnn === null || m.actual1Y === null || m.sharpe === null || m.mdd === null) return null;
      return { sym, price: closes[closes.length - 1], closes, ...m };
    } catch { return null; }
  });
  // benchmark
  let bm = { exp: null as number | null, vol: null as number | null, sharpe: null as number | null };
  try {
    const b = await fetchHistory("^NSEI", "2y", "1d");
    const bc = b.map((x) => x.close);
    const m = safetyMetrics(bc, RF);
    bm = { exp: m.expAnn, vol: m.volAnn, sharpe: m.sharpe };
  } catch { /* fail-open */ }
  const pass: (SafetyPer & { score: number | null })[] = per
    .filter((p) => (p.actual1Y as number) > 0 && (p.expAnn as number) >= TH)
    .map((p) => ({ ...p, score: null as number | null }));
  const rk = (xs: (number | null)[], asc = true) => rankPct(xs, asc);
  const rExp = rk(pass.map((p) => p.expAnn));
  const rAct = rk(pass.map((p) => p.actual1Y));
  const rSh = rk(pass.map((p) => p.sharpe));
  const rDd = rk(pass.map((p) => (p.mdd as number) * -1));
  pass.forEach((p, i) => {
    const parts = [rExp[i], rAct[i], rSh[i], rDd[i]];
    p.score = parts.every((v) => v !== null) ? (parts[0] as number) * 0.3 + (parts[1] as number) * 0.2 + (parts[2] as number) * 0.3 + (parts[3] as number) * 0.2 : null;
  });
  const elite = pass.filter((p) => p.score !== null).sort((a, b) => (b.score as number) - (a.score as number)).slice(0, TOPN);
  if (elite.length < SIZE) {
    return { universe: univ.length, scanned: per.length, passed: pass.length, elite: [], error: "FEWER THAN 10 PASSED THE 6% FILTER — NO PORTFOLIO (—)" };
  }
  // candidate: top-10 by score, then hill-climb swaps (web replacement for C(25,10) enum)
  const idxOf = new Map(elite.map((e, i) => [e.sym, i]));
  void idxOf;
  const mu = elite.map((e) => e.expAnn as number);
  const retsM = elite.map((e) => pctChange(e.closes).filter(isFinite));
  const n = elite.length;
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = retsM[i], b = retsM[j];
      const m = Math.min(a.length, b.length);
      const aa = a.slice(-m), bb = b.slice(-m);
      const ma = mean(aa), mb = mean(bb);
      let c = 0;
      for (let k = 0; k < m; k++) c += (aa[k] - ma) * (bb[k] - mb);
      cov[i][j] = m > 1 ? (c / (m - 1)) * 252 : 0;
    }
  }
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
    expPct: r2((e.expAnn as number) * 100), sharpe: r3(e.sharpe),
  }));
  const profit = optRet * capital;
  return {
    universe: univ.length, scanned: per.length, passed: pass.length,
    benchmark: { expPct: bm.exp !== null ? r2(bm.exp * 100) : null, sharpe: bm.sharpe !== null ? r3(bm.sharpe) : null },
    opt: {
      expPct: r2(optRet * 100), volPct: r2(optVol * 100), sharpe: r3(optSharpe),
      profit: Math.round(profit), total: Math.round(capital + profit), legs,
    },
    method: "TOP-25 RANK + HILL-CLIMB 10-SELECT + BOUNDED MAX-SHARPE (WEB EQUIV OF C(25,10) ENUM + SLSQP)",
  };
}

async function kindMovers(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const win = (sp.get("win") || "1D").toUpperCase();
  const range = win === "1M" || win === "1W" ? "2mo" : "5d";

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
  const lookback = win === "1W" ? 6 : win === "1M" ? 22 : 2;
  const skips: { sym: string; reason: string }[] = [];
  const quarantined: { sym: string; reason: string; chg: number | null; spanDays: number | null }[] = [];

  const scanned = await mapPool(univ, 10, async (sym) => {
    const bare = sym.replace(".NS", "");
    try {
      const bars = await fetchHistory(sym, range, "1d");
      if (bars.length < lookback) {
        skips.push({ sym: bare, reason: `ONLY ${bars.length} BARS — NEED ${lookback}` });
        return null;
      }
      const lastBar = bars[bars.length - 1];
      const refBar = bars[bars.length - lookback];
      const last = lastBar.close;
      const ref = refBar.close;
      const chg = ref > 0 ? ((last - ref) / ref) * 100 : null;

      // Real elapsed calendar days behind this "1D" number.
      const spanDays = Math.round(
        (Date.parse(lastBar.date) - Date.parse(refBar.date)) / 86400000
      );

      if (chg === null) {
        skips.push({ sym: bare, reason: "ZERO OR MISSING REFERENCE CLOSE" });
        return null;
      }
      if (lastBar.volume === 0) {
        quarantined.push({ sym: bare, reason: "HALTED — NO VOLUME ON THE LAST PRINT", chg: r2(chg), spanDays });
        return null;
      }
      // A normal non-trading stretch is a weekend plus at most a few holidays.
      // 1W and 1M legitimately span longer, so only 1D is gap-checked.
      if (win === "1D" && spanDays > 5) {
        quarantined.push({ sym: bare, reason: `STALE — LAST TWO PRINTS ARE ${spanDays} CALENDAR DAYS APART`, chg: r2(chg), spanDays });
        return null;
      }
      return { sym: bare, price: r2(last), chg: r2(chg), spanDays, prevClose: r2(ref), date: lastBar.date };
    } catch (e: any) {
      skips.push({ sym: bare, reason: `FEED ERROR — ${String(e?.message ?? e).slice(0, 60)}` });
      return null;
    }
  });

  const ok = scanned.filter((r): r is NonNullable<typeof r> => r !== null && r.chg !== null);
  const byChg = [...ok].sort((a, b) => (b.chg as number) - (a.chg as number));
  const top = win === "1D" ? byChg.slice(0, 10) : byChg.slice(0, 5);
  const bottom = win === "1D" ? [...byChg].reverse().slice(0, 10) : [...byChg].reverse().slice(0, 5);

  const skipReasons: Record<string, number> = {};
  const bucket = (r: string) =>
    /^ONLY \d+ BARS/.test(r) ? "INSUFFICIENT BARS"
      : /ZERO OR MISSING/.test(r) ? "ZERO OR MISSING REFERENCE CLOSE"
        : "FEED ERROR";
  for (const s of skips) skipReasons[bucket(s.reason)] = (skipReasons[bucket(s.reason)] ?? 0) + 1;

  return {
    win,
    universe: univ.length,
    count: ok.length,
    top,
    bottom,
    /**
     * Everything the ranking is drawn from, not just the 20 rows on screen, so a
     * download can be audited rather than trusted.
     */
    all: ok,
    skipped: {
      count: skips.length,
      reasons: skipReasons,
      sample: skips.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
    quarantined: {
      count: quarantined.length,
      halted: quarantined.filter((q) => q.reason.startsWith("HALTED")).length,
      stale: quarantined.filter((q) => q.reason.startsWith("STALE")).length,
      sample: quarantined.slice(0, 12).sort((a, b) => a.sym.localeCompare(b.sym)),
    },
  };
}

async function kindSector() {
  const syms = Object.keys(NB_SECTOR_MAP);
  const rets = await mapPool(syms, 12, async (s) => {
    try {
      const bars = await fetchHistory(s, "3mo", "1d");
      if (bars.length < 25) return null;
      const c = bars.map((b) => b.close);
      const sr = (n: number) => (c.length > n && c[c.length - 1 - n] > 0 ? ((c[c.length - 1] / c[c.length - 1 - n]) - 1) * 100 : null);
      return { s, d1: sr(1), w1: sr(5), m1: sr(21) };
    } catch { return null; }
  });
  const bySec = new Map<string, { d: number[]; w: number[]; m: number[]; n: number }>();
  for (const r of rets) {
    const sec = NB_SECTOR_MAP[r.s];
    if (!bySec.has(sec)) bySec.set(sec, { d: [], w: [], m: [], n: 0 });
    const g = bySec.get(sec)!;
    g.n++;
    if (r.d1 !== null && isFinite(r.d1)) g.d.push(r.d1);
    if (r.w1 !== null && isFinite(r.w1)) g.w.push(r.w1);
    if (r.m1 !== null && isFinite(r.m1)) g.m.push(r.m1);
  }
  const sectors = [...bySec.entries()].map(([name, g]) => ({
    name, count: g.n,
    d1: r2(mean(g.d)), w1: r2(mean(g.w)), m1: r2(mean(g.m)),
  })).sort((a, b) => (b.m1 ?? -Infinity) - (a.m1 ?? -Infinity));
  const leaders = rets
    .filter((r) => r.m1 !== null && isFinite(r.m1 as number))
    .sort((a, b) => (b.m1 as number) - (a.m1 as number))
    .slice(0, 10)
    .map((r) => ({ sym: r.s.replace(".NS", ""), sec: NB_SECTOR_MAP[r.s], d1: r2(r.d1), w1: r2(r.w1), m1: r2(r.m1) }));
  return { universe: syms.length, fetched: rets.length, sectors, leaders };
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

async function kindTerminal(sp: URLSearchParams) {
  const univ = univOf(sp.get("universe"));
  const q = (sp.get("q") || "").toUpperCase();
  const secF = sp.get("sector") || "";
  const list = univ.filter((s) => (!q || s.includes(q)) && (!secF || (NB_SECTOR_MAP[s] ?? "Others") === secF));
  // expiry: last Thursday of month
  const now = new Date();
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  let dte = lastDay;
  while (dte.getUTCDay() !== 4) dte = new Date(dte.getTime() - 86400000);
  const daysToExpiry = Math.max(1, Math.round((dte.getTime() - now.getTime()) / 86400000) + 1);
  let niftyRets: number[] = [];
  try {
    const nb = await fetchHistory("^NSEI", "1y", "1d");
    niftyRets = pctChange(nb.map((b) => Math.log(b.close))).filter(isFinite);
  } catch { /* fail-open */ }
  const rows = await mapPool(list.slice(0, 209), 12, async (sym) => {
    try {
      const [d, m] = await Promise.all([
        fetchHistory(sym, "1y", "1d"),
        fetchHistory(sym, "10y", "1mo"),
      ]);
      if (d.length < 60) return null;
      const closes = d.map((b) => b.close);
      const highs = d.map((b) => b.high);
      const lows = d.map((b) => b.low);
      const vols = d.map((b) => b.volume);
      const ltp = closes[closes.length - 1];
      const lr = pctChange(closes).filter(isFinite);
      const logR = pctChange(closes.map((c) => Math.log(Math.max(c, 1e-9)))).filter(isFinite);
      const sr = (n: number) => (closes.length > n && closes[closes.length - 1 - n] > 0 ? ((ltp / closes[closes.length - 1 - n]) - 1) * 100 : null);
      const rsi = nbRsiSimple(closes);
      const hv = hvAnn(logR, 20);
      const atr = nbAtr(highs, lows, closes);
      const bb = nbBB(closes);
      const st = nbStoch(highs, lows, closes);
      const z = nbZ(closes);
      const a50 = closes.length >= 50 ? ltp > mean(closes.slice(-50)) : null;
      const a200 = closes.length >= 200 ? ltp > mean(closes.slice(-200)) : null;
      const s50 = closes.length >= 200 ? mean(closes.slice(-50)) : NaN;
      const s200 = closes.length >= 200 ? mean(closes.slice(-200)) : NaN;
      const golden = isFinite(s50) && isFinite(s200) ? (s50 as number) > (s200 as number) : null;
      // MACD bull via EMA12/26/9
      const ema = (arr: number[], span: number) => {
        const k = 2 / (span + 1);
        let p = arr[0];
        for (let i = 1; i < arr.length; i++) p = arr[i] * k + p * (1 - k);
        return p;
      };
      const e12 = ema(closes, 12), e26 = ema(closes, 26);
      void e12; void e26;
      // macd line/signal approx on closes tail
      const macdLine: number[] = [];
      for (let i = 0; i < closes.length; i++) {
        const seg = closes.slice(0, i + 1);
        if (seg.length < 26) { macdLine.push(NaN); continue; }
        macdLine.push(ema(seg, 12) - ema(seg, 26));
      }
      const ml = macdLine.filter(isFinite);
      const macdSig = ml.length >= 9 ? ema(ml, 9) : NaN;
      const macdBull = isFinite(macdSig) && ml.length ? ml[ml.length - 1] > (macdSig as number) : null;
      const dd = (() => { let pk = -Infinity, cur = 0, mx = 0; for (const p of closes) { if (p > pk) pk = p; if (pk > 0) { cur = ((p - pk) / pk) * 100; mx = Math.min(mx, cur); } } return { cur: r2(cur), max: r2(mx) }; })();
      const ex = lr.map((x) => x - 0.065 / 252);
      const sd = stdSample(ex);
      const sharpe = sd > 0 ? (mean(ex) / sd) * Math.sqrt(252) : null;
      const neg = lr.filter((x) => x < 0);
      const sdn = stdSample(neg.length > 1 ? neg : ex);
      const sortino = sdn > 0 ? (mean(ex) / sdn) * Math.sqrt(252) : null;
      const beta = nbBeta(logR, niftyRets);
      const mom = nbMomScore(sr(21), sr(63), sr(126), closes.length > 252 ? sr(252) : null);
      const opt = nbOptions(ltp, hv, daysToExpiry);
      const sig = nbSignalCount({ rsi, macdBull, a50, a200, golden, stochK: st.k });
      const vr = vols.length >= 22 && mean(vols.slice(-21, -1)) > 0 ? vols[vols.length - 1] / (mean(vols.slice(-21, -1)) as number) : null;
      // next-month seasonality
      const nm = (new Date().getMonth() + 1) % 12 + 1;
      const mf: number[] = [];
      for (let i = 1; i < m.length; i++) {
        if (new Date(m[i].date + "T00:00:00Z").getUTCMonth() + 1 === nm) {
          const p = m[i - 1].close;
          if (p > 0) mf.push(((m[i].close / p) - 1) * 100);
        }
      }
      const sea = mf.length >= 3 ? { avg: r2(mean(mf)), wr: r2((mf.filter((v) => v > 0).length / mf.length) * 100), n: mf.length } : null;
      return {
        sym: sym.replace(".NS", ""), sec: NB_SECTOR_MAP[sym] ?? "Others", ltp: r2(ltp),
        d1: r2(sr(1)), w1: r2(sr(5)), m1: r2(sr(21)), m3: r2(sr(63)), m6: r2(sr(126)),
        rsi: r2(rsi), hv: r2(hv), atr: r2(atr), bbPos: r2(bb.pos), stochK: r2(st.k),
        z: r2(z), a50, a200, golden, macdBull, dd, sharpe: r3(sharpe), sortino: r3(sortino),
        beta: r2(beta), mom: r2(mom), vr: r2(vr), sig,
        straddlePct: r2(opt.straddlePct), emPct: r2(opt.emPct), sea,
      };
    } catch { return null; }
  });
  const ok = rows.filter(Boolean) as NonNullable<(typeof rows)[number]>[];
  const gain = ok.filter((r) => (r.w1 ?? 0) > 0).length;
  return {
    universe: univ.length, count: ok.length, gainers: gain, losers: ok.length - gain,
    daysToExpiry, rows: ok.sort((a, b) => (b.mom ?? -1) - (a.mom ?? -1)),
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
