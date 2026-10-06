import { NextRequest, NextResponse } from "next/server";
import { yahooFetch } from "@/lib/yahoo";
import {
  DECISION_MIN, EGAP_MIN, FLAT_BAND_PCT, GAP_B, GAP_BANDS, GAP_RESID_SD, MODEL_PROVENANCE,
  PRE_OPEN_LEGS, REGIME_MEASURED, RIDGE_LAMBDAS, FIT_SHRINK, normCdf,
  buildLegVote, buildScore, buildSeries, edgeFrom, linfit, residualSd, gapBandByKey,
  gradePrediction, istDateFromUnix, istUnix, pctChange, readMode, ridgeFit,
  round2, round3, vixRegime,
} from "@/lib/opening";
import type { Bar, Outcome, PriorIndex, Regime, Score, Verdict } from "@/lib/opening";
import { OPENING_TARGETS, STALE_SHARE_WARN } from "@/lib/opening";

// Zero-lookahead audit of the LIVE model.
//
// This route is not a second model. It rebuilds the engine in
// /api/opening/route.ts session by session, from the same PRE_OPEN_LEGS and
// the same buildScore, and publishes what it measures. Three things make the
// number trustworthy:
//
//   1. WINDOW-AWARE RECONSTRUCTION. Each leg is rebuilt from the last print
//      that its OWN market had produced at 09:00 IST on the decision date.
//      Hourly bars settle at their stamp + 1h, and only a fully settled bar is
//      readable, so there is no look-ahead. The previous build read every leg
//      from the prior DAILY close — ~23h stale for the overnight futures and
//      ~22h for Asia, while the live desk read both fresh. It was grading a
//      model nobody ran. If hourly history is unavailable for a symbol the
//      route degrades to the prior daily close and says so per leg.
//
//   2. THE TARGET IS THE GAP. An "opening" desk predicts the open vs the prior
//      close, so that is what is graded. The close-to-close day return is
//      reported alongside as a secondary, never substituted for the target.
//
//   3. NOTHING LEAVES THE DENOMINATOR, AND THE BENCHMARK IS LIKE-FOR-LIKE.
//      Every session with a usable gap counts, including the FLAT verdicts that
//      missed. The directional headline is struck against the best single
//      always-call on exactly the sessions the model called — not a different
//      sample, not a flattering average.
//
// WALK-FORWARD, NOT IN-SAMPLE. The weights are re-fitted on 60-session folds
// and each fold is scored only on strictly later sessions. The in-sample
// numbers are published too, explicitly labelled, because a fitted model that
// only reports its own training fit is a press release.
//
// HONEST LIMITS, stated on the payload and rendered on the desk:
//   - Hourly reconstruction costs up to 60 min of staleness on the 24h legs
//     versus the live tick, so live accuracy is a lower bound on the sign
//     agreement and a fair comparison on the magnitude.
//   - Breadth has no clean historical snapshot at 09:00 IST, so it is NOT in
//     this model. The live prediction excludes it too — only the separately
//     labelled CONFIRM model uses it.
//   - 494 sessions is a short sample for a 16-parameter fit. That is exactly
//     why the shipped weights are shrunk 30% toward the hand prior and why the
//     gate is published as a sweep rather than a single number.

const BAR_S = 3600;
// Warm-up before the first scored fold, in sessions. Long enough that every
// fold fits the ridge AND both magnitude bands on a full year of data — an
// early fold trained on 120 sessions produced band slopes that swung 0.38-0.58
// and dragged the published median down with them.
const WARMUP = 240;
const BLOCK = 60;

interface HourBar { ts: number; close: number }

interface Series2 { bars: Bar[]; rets: Map<string, number>; prior: PriorIndex }

async function dailySeries(symbol: string, years = 3): Promise<Series2 | null> {
  try {
    const r = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${years}y&interval=1d`,
      { next: { revalidate: 3600 } }
    );
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const q = res?.indicators?.quote?.[0] ?? {};
    const bars: Bar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = q.close?.[i];
      if (close === null || close === undefined || !isFinite(close)) continue;
      bars.push({
        date: istDateFromUnix(ts[i]),
        close,
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
      });
    }
    return buildSeries(bars);
  } catch {
    return null;
  }
}

/** ~2y of hourly bars. Yahoo caps 1h history at 730 days. */
async function hourlySeries(symbol: string): Promise<HourBar[] | null> {
  try {
    const r = await yahooFetch(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=730d&interval=1h`,
      { next: { revalidate: 3600 } }
    );
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp ?? [];
    const c = res?.indicators?.quote?.[0]?.close ?? [];
    const out: HourBar[] = [];
    for (let i = 0; i < ts.length; i++) {
      const close = c[i];
      if (close === null || close === undefined || !isFinite(close)) continue;
      out.push({ ts: ts[i], close });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/**
 * The leg reading available for a decision made at DECISION_MIN IST on `date`.
 * Yahoo stamps hourly bars at their START, so a bar stamped t covers
 * [t, t+3600). Requiring `ts + 3600 <= T` means the bar had fully settled
 * before the decision — strictly zero look-ahead.
 */
function legReading(
  date: string,
  spec: typeof PRE_OPEN_LEGS[number],
  daily: Series2 | null,
  hourly: HourBar[] | null
): { chg: number | null; last: number | null; barDate: string | null; how: string } {
  if (!daily) return { chg: null, last: null, barDate: null, how: "NO_TAPE" };
  const refKey = daily.prior.floor(date);
  if (refKey === null) return { chg: null, last: null, barDate: null, how: "NO_TAPE" };
  const refClose = daily.rets.get(refKey) !== undefined
    ? daily.bars[daily.prior.floorIndex(refKey)].close
    : null;
  if (refClose === null) return { chg: null, last: null, barDate: refKey, how: "NO_REF" };

  const mode = readMode(spec, DECISION_MIN);
  if (mode === "LIVE" && hourly) {
    const T = istUnix(date, `${String(Math.floor(DECISION_MIN / 60)).padStart(2, "0")}:${String(DECISION_MIN % 60).padStart(2, "0")}`);
    let lo = 0, hi = hourly.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (hourly[mid].ts + BAR_S <= T) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans >= 0) {
      const chg = pctChange(hourly[ans].close, refClose);
      if (chg !== null && Math.abs(chg) <= spec.plausiblePct)
        return { chg, last: hourly[ans].close, barDate: refKey, how: "LIVE_1H" };
    }
  }
  // PRIOR: the last completed session that had closed by the decision minute.
  const priorKey = daily.prior.floor(date);
  if (priorKey === null) return { chg: null, last: null, barDate: null, how: "NO_TAPE" };
  const chg = daily.rets.get(priorKey) ?? null;
  if (chg === null || Math.abs(chg) > spec.plausiblePct)
    return { chg: null, last: null, barDate: priorKey, how: "TAIL" };
  return {
    chg,
    last: daily.bars[daily.prior.floorIndex(priorKey)].close,
    barDate: priorKey,
    how: hourly ? "PRIOR_CLOSE" : "PRIOR_CLOSE_NO_HOURLY",
  };
}

const hitPct = (xs: number[]) => (xs.length ? round2((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : null);
const avg = (xs: number[]) => (xs.length ? round3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

interface Row {
  date: string; edge: number | null; egap: number | null; coverage: number; staleShare: number; verdict: Verdict;
  regime: Regime | null; conflict: boolean;
  /** Live-engine confidence at this session, and the factor disagreement that fed it. */
  confidence: number; disagreement: number | null;
  gapPct: number | null; dayPct: number | null;
  gapOutcome: Outcome; dayOutcome: Outcome;
}

/**
 * The live confidence formula, reproduced exactly so the scorecard can grade
 * the number the desk actually publishes. Copied rather than imported because
 * `buildScore` takes the whole leg vote array; here we have the already-folded
 * edge and the session's tape quality, which is all the formula consumes.
 *
 * Any change to the formula in lib/opening.ts must be mirrored here or the
 * calibration table grades a confidence the desk does not print.
 */
function confidenceOf(
  verdict: Verdict, egap: number | null, coverage: number,
  staleShare: number, disagreement: number | null, conflict: boolean
): number {
  if (verdict === "NO_DATA" || egap === null) return 0;
  const gate = conflict ? EGAP_MIN * 1.5 : EGAP_MIN;
  const mag = Math.abs(egap);
  const margin = verdict === "FLAT" ? 0 : Math.min(1, (mag - gate) / gate);
  const fresh = 1 - Math.min(1, staleShare / STALE_SHARE_WARN);
  const agree = disagreement === null ? 1 : Math.max(0.55, 1 - Math.min(1, disagreement / 0.45) * 0.45);
  return round3(coverage * fresh * agree * (0.45 + 0.55 * Math.max(margin, 0)));
}

/** The like-for-like headline. Model and benchmark on the SAME sessions. */
function headline(rows: Row[]) {
  const graded = rows.filter((r) => r.gapOutcome !== "NO_DATA");
  const dirCall = graded.filter((r) => r.verdict === "GREEN" || r.verdict === "RED");
  const dirSet = dirCall.filter((r) => Math.abs(r.gapPct ?? 0) > FLAT_BAND_PCT);
  const up = dirSet.filter((r) => (r.gapPct ?? 0) > 0).length;
  const dn = dirSet.length - up;
  const agree = dirSet.filter((r) => (r.gapPct ?? 0) > 0 === (r.verdict === "GREEN")).length;
  const g = dirCall.filter((r) => r.verdict === "GREEN").map((r) => r.gapPct!).filter((v): v is number => v !== null);
  const rd = dirCall.filter((r) => r.verdict === "RED").map((r) => r.gapPct!).filter((v): v is number => v !== null);
  const flat = graded.filter((r) => r.verdict === "FLAT");
  const sd = (a: number[]) => (a.length > 2 ? Math.sqrt(a.reduce((s, v) => s + (v - avg(a)!) ** 2, 0) / (a.length - 1)) : null);
  const greenMean = avg(g), redMean = avg(rd);
  const spreadT = (() => {
    const s1 = sd(g), s2 = sd(rd);
    if (s1 === null || s2 === null || greenMean === null || redMean === null) return null;
    const den = Math.sqrt((s1 * s1) / g.length + (s2 * s2) / rd.length);
    return den > 0 ? round2((greenMean - redMean) / den) : null;
  })();
  /**
   * PRECISION — the share of the total |gap| the model selected that it called
   * in the right direction. This is the metric that is actually comparable
   * across gates with different call counts: sign agreement moves with which
   * sessions a gate happens to select, precision does not reward that.
   */
  const picked = dirCall.reduce((s, r) => s + Math.abs(r.gapPct ?? 0), 0);
  const right = dirCall.filter((r) => (r.gapPct ?? 0) > 0 === (r.verdict === "GREEN")).reduce((s, r) => s + Math.abs(r.gapPct ?? 0), 0);
  const xs = rows.filter((r) => r.edge !== null).map((r) => r.edge as number);
  const ys = rows.filter((r) => r.edge !== null).map((r) => r.gapPct as number);
  const fit = linfit(xs, ys);
  return {
    graded: graded.length,
    dirCalls: dirCall.length,
    dirN: dirSet.length,
    dirSignPct: dirSet.length ? round2((agree / dirSet.length) * 100) : null,
    dirBasePct: dirSet.length ? round2((Math.max(up, dn) / dirSet.length) * 100) : null,
    greenMean, redMean,
    spreadPct: greenMean !== null && redMean !== null ? round3(greenMean - redMean) : null,
    spreadT,
    precisionPct: picked > 0 ? round2((right / picked) * 100) : null,
    flatCalls: flat.length,
    flatHitPct: flat.length ? round2((flat.filter((x) => Math.abs(x.gapPct ?? 0) <= FLAT_BAND_PCT).length / flat.length) * 100) : null,
    slope: fit ? round3(fit.b) : null,
    corr: fit ? round3(fit.r) : null,
  };
}

/** Brier score on the published P(gap up). Lower is better; 0.25 = a coin. */
function brier(rows: Row[], probs: Array<number | null>): number | null {
  const xs: number[] = [], ys: number[] = [];
  rows.forEach((r, i) => {
    const p = probs[i];
    if (p === null || r.gapPct === null) return;
    xs.push(p);
    ys.push(r.gapPct > 0 ? 1 : 0);
  });
  if (xs.length < 20) return null;
  return round3(xs.reduce((a, p, i) => a + (p - ys[i]) ** 2, 0) / xs.length);
}

export async function GET(req: NextRequest) {
  // Capped at 800 because the hourly reconstruction tops out at Yahoo's 730-day
  // limit; asking for more would silently grade sessions the legs cannot see.
  const days = Math.max(60, Math.min(800, parseInt(req.nextUrl.searchParams.get("days") || "800", 10) || 800));
  // The rebuild follows whatever index the live desk is showing. A scorecard
  // that always grades NIFTY 50 while the desk is on NIFTY BANK is a scorecard
  // about a different security than the one on screen.
  const key = (req.nextUrl.searchParams.get("market") || "NIFTY").toUpperCase();
  const target = OPENING_TARGETS.find((m) => m.key === key) ?? OPENING_TARGETS[0]!;
  const identity = {
    key: target.key, label: target.label, symbol: target.symbol, venue: target.venue,
    group: target.group, mode: target.mode,
    /** TRUE only for the index the engine's constants were fitted on. */
    fitted: target.calibrated,
    /** TRUE when this index is also one of the engine's own legs. */
    alsoLeg: target.alsoLeg,
    /** Why a non-fitted index is graded against fitted constants. */
    transfer: target.calibrated
      ? "MEASURED ON THIS INDEX — EVERY BAND AND THE GATE WERE FITTED HERE."
      : `THE BAND SLOPES AND GATE BELOW WERE FITTED ON NIFTY 50. THIS REBUILD MEASURES THEM ON ${target.label} SO THE DRIFT ROW SHOWS HOW WRONG THE TRANSFER IS — DIRECTION CARRIES, MAGNITUDE IS A TRANSFER.`,
  };
  const cacheKey = `rb:${target.symbol}:${days}`;
  const cached = cacheGet(cacheKey);
  if (cached) return NextResponse.json(cached);
  try {
    // A TAPE_CHECK market has no published verdict, by design: the legs print at
    // 09:00 IST and a New York or Tokyo open has no validated session mapping.
    // There is no prediction here, so there is nothing to grade. Saying so beats
    // manufacturing a scorecard for a call the desk never makes.
    if (target.mode === "TAPE_CHECK") {
      const body = { days, band: 0, gapGraded: 0, sessions: 0, upGaps: 0, dnGaps: 0, flatGaps: 0, gapHitPct: 0, graded: false, target: identity, items: [] };
      cacheSet(cacheKey, body);
      return skip(`${target.label} IS A TAPE CHECK, NOT A CALL. THE ENGINE'S LEGS ARE READ AT 09:00 IST AND THIS INDEX OPENS AT ${target.openHHMM} ${target.venue === "NYSE" || target.venue === "NASDAQ" ? "ET" : "LOCAL"}, SO THE LIVE DESK PUBLISHES NO VERDICT, NO GAP FORECAST AND NO PROBABILITY FOR IT. THERE IS NO PREDICTION TO SCORE — GRADING THE ENGINE'S INTERNAL NUMBER ANYWAY WOULD BE EXACTLY THE "SCORING A MODEL NOBODY RAN" ERROR THIS PANEL EXISTS TO REFUSE.`, days, identity);
    }
    const [series, vix, legDaily, legHourly] = await Promise.all([
      dailySeries(target.symbol),
      dailySeries("^INDIAVIX"),
      Promise.all(PRE_OPEN_LEGS.map((l) => dailySeries(l.symbol))),
      Promise.all(PRE_OPEN_LEGS.map((l) => hourlySeries(l.symbol))),
    ]);
    // Yahoo serves as little as a single bar for some indices (^CNXAUTO is the
    // live example). A 60-session rebuild is impossible on one bar, and a 502
    // for an index the desk happily offers in its own rail reads as a crash
    // rather than as a missing measurement. So it is reported as one.
    if (!series || series.bars.length < 60) {
      const have = series?.bars.length ?? 0;
      cacheSet(cacheKey, { graded: false });
      return skip(
        `NO REBUILDABLE HISTORY FOR ${target.label} (${target.symbol}). THE PRICE FEED RETURNS ${have} DAILY ${have === 1 ? "BAR" : "BARS"}, AND A WALK-FORWARD REBUILD NEEDS AT LEAST 60. THE LIVE DESK STILL QUOTES THIS INDEX — IT IS THE *SCORECARD* THAT CANNOT BE BUILT, NOT THE MARKET.`,
        days, identity,
      );
    }
    const missing = PRE_OPEN_LEGS.filter((_, i) => !legDaily[i]).map((l) => l.short);
    const noHourly = PRE_OPEN_LEGS.filter((_, i) => !legHourly[i]).map((l) => l.short);

    const vixClose = new Map((vix?.bars ?? []).map((b) => [b.date, b.close]));
    const niftyIdx = new Map(series.bars.map((b, i) => [b.date, i]));
    const dates = series.bars.map((b) => b.date).slice(-days);

    // ---- one pass: readings, live engine output, and the vote matrix ----
    const rows: Row[] = [];
    const X: Array<Array<number | null>> = [];
    const probsLive: Array<number | null> = [];
    const howMix: Record<string, Record<string, number>> = {};

    for (const date of dates) {
const i = niftyIdx.get(date)!;
      const session = series.bars[i];
      const prevBar = i > 0 ? series.bars[i - 1] : null;

      const reads = PRE_OPEN_LEGS.map((spec, k) => legReading(date, spec, legDaily[k], legHourly[k]));
      PRE_OPEN_LEGS.forEach((spec, k) => {
        howMix[spec.short] ??= {};
        howMix[spec.short][reads[k].how] = (howMix[spec.short][reads[k].how] ?? 0) + 1;
      });
      const votes = PRE_OPEN_LEGS.map((spec, k) =>
        buildLegVote(spec, { chg: reads[k].chg, last: reads[k].last, barDate: reads[k].barDate, priorOnly: reads[k].how.startsWith("PRIOR") })
      );
      const vixKey = vix?.prior.floor(date) ?? null;
      const score: Score = buildScore(votes, vixRegime(vixKey ? vixClose.get(vixKey) ?? null : null));

      // The gap is what this desk predicts: today's open vs the prior close.
      const gapPct =
        session.open !== null && session.open !== undefined && prevBar
          ? pctChange(session.open, prevBar.close)
          : null;
      const dayPct = pctChange(session.close, prevBar ? prevBar.close : null);
      const { gap, day } = gradePrediction(score.verdict, gapPct, dayPct, FLAT_BAND_PCT);

rows.push({
        date, edge: score.edge, coverage: score.coverage, staleShare: score.staleShare,
        verdict: score.verdict, regime: score.regime, conflict: score.conflict, egap: score.expectedGapPct,
        confidence: score.confidence, disagreement: score.disagreement,
        gapPct: gapPct === null ? null : round2(gapPct),
        dayPct: dayPct === null ? null : round2(dayPct),
        gapOutcome: gap, dayOutcome: day,
      });
      probsLive.push(score.probUp);
      X.push(votes.map((v) => v.vote));
    }

    const Y = rows.map((r) => r.gapPct ?? 0);
    const prior: Record<string, number> = Object.fromEntries(PRE_OPEN_LEGS.map((l) => [l.key, l.priorWeight]));

    // ---- WALK-FORWARD: refit on strictly-earlier rows, score the next block --
    const oos: Row[] = [];
    const oosProbs: Array<number | null> = [];
    const foldInfo: Array<{ from: string; to: string; lam: number; rmse: number }> = [];
    // Per-band fold coefficients. The forecast is regime-dependent, so the
    // bands are what the shipped constants have to match.
    const bandSlopes: Record<string, number[]> = { CALM: [], REST: [] };
    const bandInts: Record<string, number[]> = { CALM: [], REST: [] };
    const bandResid: Record<string, number[]> = { CALM: [], REST: [] };
    const globalSlopes: number[] = [];
    const globalResid: number[] = [];
    const oosPred: Array<number | null> = [];
    const oosBand: string[] = [];
    const first = Math.min(WARMUP, Math.max(block0(rows.length), 1));
    for (let start = first; start < rows.length; start += BLOCK) {
      const trainIdx = Array.from({ length: start }, (_, i) => i);
      const fit = ridgeFit(X, Y, trainIdx, prior, RIDGE_LAMBDAS, FIT_SHRINK);
      // magnitude model fitted on the training window only, per band
      const bandTrain: Record<string, Array<{ x: number; y: number }>> = { CALM: [], REST: [] };
      for (const i of trainIdx) {
        const e = edgeFrom(X, i, fit.w);
        if (e === null || rows[i]!.gapPct === null) continue;
        (rows[i]!.regime === "CALM" ? bandTrain.CALM : bandTrain.REST).push({ x: e, y: rows[i]!.gapPct as number });
      }
      const bandFits: Record<string, { a: number; b: number; r: number } | null> = { CALM: null, REST: null };
      for (const bk of ["CALM", "REST"] as const) {
        const f = linfit(bandTrain[bk].map((p) => p.x), bandTrain[bk].map((p) => p.y));
        if (f) {
          bandFits[bk] = { a: f.a, b: f.b, r: residualSd(bandTrain[bk].map((p) => p.x), bandTrain[bk].map((p) => p.y), f) };
          bandSlopes[bk]!.push(f.b);
          bandInts[bk]!.push(f.a);
          bandResid[bk]!.push(bandFits[bk]!.r);
        }
      }
      const allTrain = [...bandTrain.CALM, ...bandTrain.REST];
      const gf = linfit(allTrain.map((p) => p.x), allTrain.map((p) => p.y));
      if (gf) {
        globalSlopes.push(gf.b);
        globalResid.push(residualSd(allTrain.map((p) => p.x), allTrain.map((p) => p.y), gf));
      }
      const to = Math.min(start + BLOCK, rows.length);
      for (let i = start; i < to; i++) {
        const e = edgeFrom(X, i, fit.w);
        const rg = rows[i]!.regime;
        const bk: "CALM" | "REST" = rg === "CALM" ? "CALM" : "REST";
        const bf = bandFits[bk] ?? bandFits.REST ?? bandFits.CALM ?? (gf ? { a: gf.a, b: gf.b, r: GAP_RESID_SD } : null);
        const eg = bf && e !== null ? bf.a + bf.b * e : null;
        const rs = bf ? bf.r : null;
        const gate = rows[i]!.conflict ? EGAP_MIN * 1.5 : EGAP_MIN;
        // The publish decision is made on the FORECAST, in forecast units.
        const verdict: Verdict = eg === null ? "NO_DATA" : Math.abs(eg) >= gate ? (eg > 0 ? "GREEN" : "RED") : "FLAT";
        const g = rows[i]!.gapPct;
        const { gap, day } = gradePrediction(verdict, g, rows[i]!.dayPct, FLAT_BAND_PCT);
        // Confidence is recomputed on the FOLD's own forecast, not carried over
        // from the full-sample score: grading the in-sample confidence against an
        // out-of-sample outcome is exactly the leak this scorecard exists to
        // refuse.
        const conf = confidenceOf(verdict, eg, rows[i]!.coverage, rows[i]!.staleShare, rows[i]!.disagreement, rows[i]!.conflict);
        oos.push({ ...rows[i]!, edge: e === null ? null : round3(e), egap: eg === null ? null : round3(eg), verdict, confidence: conf, gapOutcome: gap, dayOutcome: day });
        oosProbs.push(eg !== null && rs ? round3(normCdf(eg / rs)) : null);
        oosPred.push(eg);
        oosBand.push(bk);
      }
      foldInfo.push({ from: rows[start]!.date, to: rows[to - 1]!.date, lam: fit.lam, rmse: round3(fit.valRmse) });
    }

    const fullFit = ridgeFit(X, Y, rows.map((_, i) => i), prior, RIDGE_LAMBDAS, FIT_SHRINK);

    // ---- magnitude forecast accuracy, OOS ----
    const oosRows = oos.filter((r, i) => oosPred[i] !== null && r.gapPct !== null);
    const oosPredVals = oosPred.filter((v): v is number => v !== null);
    const oosGapVals = oosRows.map((r) => r.gapPct as number);
    const baseMean = avg(oosGapVals) ?? 0;
    const rmseModel = Math.sqrt(avg(oosRows.map((r, i) => (oosPredVals[i] - (r.gapPct as number)) ** 2)) ?? 0);
    const rmseBase = Math.sqrt(avg(oosRows.map((r) => (baseMean - (r.gapPct as number)) ** 2)) ?? 0);

    // ---- drift guard: the live route runs on published constants. If what is
    // measured here no longer matches what the desk is publishing, the desk
    // says so out loud instead of quietly forecasting with a stale number.
    const median = (a: number[]) => (a.length ? round3(a[a.length >> 1]!) : null);
    const rng = (a: number[]) => {
      if (!a.length) return [null, null] as [number | null, number | null];
      const s = [...a].sort((x, y) => x - y);
      return [round3(s[0]!), round3(s[s.length - 1]!)] as [number, number];
    };
    const bandsOut = GAP_BANDS.map((b) => {
      const mi = median(bandInts[b.key] ?? []);
      const mr = median(bandResid[b.key] ?? []);
      const [lo, hi] = rng(bandSlopes[b.key] ?? []);
      const sm = median(bandSlopes[b.key] ?? []);
      return {
        key: b.key, label: b.label,
        folds: (bandSlopes[b.key] ?? []).length,
        slopeShipped: b.slope, slopeMeasured: sm, slopeRange: [lo, hi],
        slopeDriftPct: sm === null ? null : round2(((sm - b.slope) / Math.abs(b.slope)) * 100),
        interceptShipped: b.intercept, interceptMeasured: mi,
        residSdShipped: b.residSd, residSdMeasured: mr,
      };
    });
    const drift = {
      bands: bandsOut,
      globalSlopeMed: median(globalSlopes),
      globalResidSdMed: median(globalResid),
      stale: bandsOut.some((b) => b.slopeDriftPct !== null && Math.abs(b.slopeDriftPct) > 20),
      note: "IF A MEASURED BAND SLOPE DRIFTS >20% FROM THE PUBLISHED ONE, THE PUBLISHED CONSTANTS ARE STALE AND THE LIVE FORECAST IS OVER- OR UNDER-STATING EVERY CALL IN THAT REGIME.",
    };

    // ---- per-leg evidence, on the whole sample, clearly labelled -----------
    const legEvidence = PRE_OPEN_LEGS.map((spec, a) => {
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < rows.length; i++) {
        const v = X[i][a];
        if (v === null || rows[i].gapPct === null) continue;
        pts.push({ x: v, y: rows[i].gapPct as number });
      }
      const fit = linfit(pts.map((p) => p.x), pts.map((p) => p.y));
      const dirSet = pts.filter((p) => Math.abs(p.y) > FLAT_BAND_PCT);
      const agree = dirSet.filter((p) => (p.y > 0) === (p.x > 0)).length;
      return {
        key: spec.key, short: spec.short, group: spec.group, symbol: spec.symbol,
        n: pts.length,
        r: fit ? round3(fit.r) : null,
        signAgree: dirSet.length ? round2((agree / dirSet.length) * 100) : null,
        weight: round3(spec.weight), priorWeight: round3(spec.priorWeight),
        fittedWeight: round3(fullFit.w[spec.key] ?? 0),
        how: howMix[spec.short] ?? {},
        note: spec.note,
      };
    });

    // ---- calibration: measured outcome per edge bucket -------------------
    const buckets: Array<{ key: string; label: string; test: (e: number) => boolean }> = [
      { key: "STRONG_UP", label: "EDGE ≥ +0.60", test: (e) => e >= 0.6 },
      { key: "UP", label: "+0.30 ≤ EDGE < +0.60", test: (e) => e >= 0.3 && e < 0.6 },
      { key: "MILD_UP", label: "0 < EDGE < +0.30", test: (e) => e > 0 && e < 0.3 },
      { key: "FLAT", label: "INSIDE GATE (|EDGE| < 0.30)", test: (e) => Math.abs(e) < 0.3 },
      { key: "MILD_DN", label: "−0.30 < EDGE < 0", test: (e) => e < 0 && e > -0.3 },
      { key: "DN", label: "−0.60 ≤ EDGE < −0.30", test: (e) => e >= -0.6 && e < -0.3 },
      { key: "STRONG_DN", label: "EDGE ≤ −0.60", test: (e) => e <= -0.6 },
    ];
    const calibration = buckets.map((b) => {
      const inB = oos.filter((r) => r.edge !== null && b.test(r.edge));
      const dg = inB.filter((r) => Math.abs(r.gapPct ?? 0) > FLAT_BAND_PCT && r.verdict !== "FLAT");
      return {
        key: b.key, label: b.label, n: inB.length,
        gapHitPct: hitPct(inB.map((r) => (r.gapOutcome === "HIT" || r.gapOutcome === "FLAT_HIT") ? 1 : 0)),
        avgGapPct: avg(inB.map((r) => r.gapPct).filter((v): v is number => v !== null)),
        dirN: dg.length,
        dirSignPct: dg.length ? hitPct(dg.map((r) => (((r.gapPct as number) > 0) === (r.verdict === "GREEN") ? 1 : 0))) : null,
      };
    });

    // ---- confidence calibration --------------------------------------------
    // The question the scorecard exists to answer: when the desk says "60%
    // confident", how often is it right, and how much move did being right
    // actually capture? Edge buckets answer a different question (is the signal
    // big), which is why both tables exist.
    //
    // Bins are on the PUBLISHED confidence, not on an edge proxy, so a reader
    // can look at a live call, see its confidence, and find the matching row.
    const CONF_BANDS: Array<{ key: string; label: string; lo: number; hi: number }> = [
      { key: "C70", label: "≥ 70%", lo: 0.7, hi: 1.01 },
      { key: "C60", label: "60 – 70%", lo: 0.6, hi: 0.7 },
      { key: "C50", label: "50 – 60%", lo: 0.5, hi: 0.6 },
      { key: "C40", label: "40 – 50%", lo: 0.4, hi: 0.5 },
      { key: "C30", label: "30 – 40%", lo: 0.3, hi: 0.4 },
      { key: "C20", label: "20 – 30%", lo: 0.2, hi: 0.3 },
      { key: "C00", label: "< 20%", lo: 0, hi: 0.2 },
    ];
    const confBands = CONF_BANDS.map((b) => {
      const inB = oos.filter((r) => r.confidence >= b.lo && r.confidence < b.hi && r.gapPct !== null);
      // A band is graded only on calls the desk actually made. FLAT calls get a
      // confidence (the formula floors at 0.45 × tape quality) but "was the
      // direction right" is not a question about them.
      const calls = inB.filter((r) => r.verdict === "GREEN" || r.verdict === "RED");
      const dirSet = calls.filter((r) => Math.abs(r.gapPct as number) > FLAT_BAND_PCT);
      const right = dirSet.filter((r) => (r.gapPct as number) > 0 === (r.verdict === "GREEN"));
      const wrong = dirSet.filter((r) => !right.includes(r));
      const hitRate = dirSet.length ? round2((right.length / dirSet.length) * 100) : null;
      const stated = avg(inB.map((r) => r.confidence));
      const rightGap = right.map((r) => Math.abs(r.gapPct as number));
      const wrongGap = wrong.map((r) => Math.abs(r.gapPct as number));
      const avgRight = avg(rightGap), avgWrong = avg(wrongGap);
      return {
        key: b.key, label: b.label,
        lo: b.lo, hi: Math.min(1, b.hi),
        n: inB.length,
        calls: calls.length,
        dirN: dirSet.length,
        right: right.length,
        wrong: wrong.length,
        hitPct: hitRate,
        /** Mean confidence the desk printed for these sessions, in percent. */
        statedPct: stated === null ? null : round2(stated * 100),
        /** hitPct − statedPct. Negative means the desk over-promises here. */
        calibPts: hitRate !== null && stated !== null ? round2(hitRate - stated * 100) : null,
        /** Move captured on the calls it got right, in forecast percent. */
        ptsRight: round2(rightGap.reduce((s, v) => s + v, 0)),
        /** Move it walked into on the calls it got wrong. */
        ptsWrong: round2(wrongGap.reduce((s, v) => s + v, 0)),
        avgGapRight: avgRight,
        avgGapWrong: avgWrong,
        /** Did being right actually pay? Positive = the right calls moved more. */
        spreadPct: avgRight !== null && avgWrong !== null ? round3(avgRight - avgWrong) : null,
      };
    });
    // Monotonicity is the real test of whether confidence means anything: if a
    // higher band is not more accurate, the number is decoration.
    const graded = confBands.filter((b) => b.hitPct !== null);
    const monotone = graded.length >= 3
      ? graded.every((b, i) => i === 0 || b.hitPct! <= graded[i - 1]!.hitPct! + 2)
      : null;
    const topBand = graded[0] ?? null;
    const confCalibration = {
      bands: confBands,
      monotone,
      /** What a reader should do with the whole table. */
      verdict: monotone === null
        ? "TOO FEW BANDS TO JUDGE — PRINTED, NOT HIDDEN"
        : monotone
          ? "HIGHER CONFIDENCE BANDS ARE MORE ACCURATE — THE NUMBER CARRIES INFORMATION"
          : "CONFIDENCE DOES NOT ORDER ACCURACY — TREAT IT AS A DISPLAY NUMBER, NOT A PROBABILITY",
      topBandKey: topBand?.key ?? null,
      minN: 12,
    };

    // ---- regime split, with the measured spread behind each multiplier ----
    const regimeSplit = (["CALM", "NORMAL", "STRESS"] as Regime[]).map((rg) => {
      const inR = oos.filter((r) => r.regime === rg && r.verdict !== "FLAT");
      const s = headline(inR);
      const band = rg === "CALM" ? "CALM" : "REST";
      return {
        regime: rg,
        band,
        bandSlope: gapBandByKey(band).slope,
        bandResidSd: gapBandByKey(band).residSd,
        measured: REGIME_MEASURED[rg],
        calls: inR.length,
        n: s.dirN,
        hitPct: s.dirSignPct,
        basePct: s.dirBasePct,
        deltaPts: s.dirSignPct !== null && s.dirBasePct !== null ? round2(s.dirSignPct - s.dirBasePct) : null,
        spreadPct: s.spreadPct,
        precisionPct: s.precisionPct,
        greenMean: s.greenMean,
        redMean: s.redMean,
      };
    });

    // ---- operating curve: the publish gate is a CHOICE, so publish the curve
    // rather than one hidden number. Precision (not sign agreement) is the
    // column that compares fairly across thresholds, because a looser gate
    // picks sessions that were going to be up more often anyway.
    const gateSweep = [0.15, 0.20, 0.22, 0.25, 0.28, 0.30, 0.35, 0.40, 0.50].map((g) => {
      const rs = oos.map((r) => {
        const eg = r.egap;
        const gate = r.conflict ? g * 1.5 : g;
        const v: Verdict = eg === null ? "NO_DATA" : Math.abs(eg) >= gate ? (eg > 0 ? "GREEN" : "RED") : "FLAT";
        return { ...r, verdict: v };
      });
      return { egapMin: g, legacy: false, ...headline(rs) };
    });
    // The gate this desk used to run, struck on the SAME rows so the two are
    // directly comparable. Kept in the payload because "what changed and by how
    // much" is the first question anyone should ask of a new gate.
    const legacyMult: Record<Regime, number> = { CALM: 1.25, NORMAL: 1.0, STRESS: 0.85 };
    const legacy = headline(oos.map((r) => {
      const e = r.edge;
      const thr = 0.30 * (r.regime ? legacyMult[r.regime] : 1);
      const eff = r.conflict ? thr * 1.5 : thr;
      const v: Verdict = e === null ? "NO_DATA" : e >= eff ? "GREEN" : e <= -eff ? "RED" : "FLAT";
      return { ...r, verdict: v };
    }));

    const confRows = oos.filter((r) => r.conflict && r.verdict !== "FLAT");
    const cleanRows = oos.filter((r) => !r.conflict && r.verdict !== "FLAT");
    const confusion = {
      greenHit: oos.filter((r) => r.verdict === "GREEN" && r.gapOutcome === "HIT").length,
      greenMiss: oos.filter((r) => r.verdict === "GREEN" && (r.gapOutcome === "MISS" || r.gapOutcome === "FLAT_MISS")).length,
      redHit: oos.filter((r) => r.verdict === "RED" && r.gapOutcome === "HIT").length,
      redMiss: oos.filter((r) => r.verdict === "RED" && (r.gapOutcome === "MISS" || r.gapOutcome === "FLAT_MISS")).length,
    };

    const liveAll = headline(rows);
const gapGraded = rows.filter((r) => r.gapOutcome !== "NO_DATA");
    const vixLast = vix?.bars.length ? vix.bars[vix.bars.length - 1] : null;

    const body = {
      days: rows.length,
      band: FLAT_BAND_PCT,
      sessions: rows.length,
      gapGraded: gapGraded.length,
      upGaps: gapGraded.filter((r) => (r.gapPct ?? 0) > FLAT_BAND_PCT).length,
      dnGaps: gapGraded.filter((r) => (r.gapPct ?? 0) < -FLAT_BAND_PCT).length,
      flatGaps: gapGraded.filter((r) => Math.abs(r.gapPct ?? 0) <= FLAT_BAND_PCT).length,
      gapHitPct: gapGraded.length
        ? round2((gapGraded.filter((r) => r.gapOutcome === "HIT" || r.gapOutcome === "FLAT_HIT").length / gapGraded.length) * 100)
        : 0,

      // THE HEADLINE — out-of-sample, like-for-like.
      oos: {
        folds: foldInfo.length,
        ...headline(oos),
        brier: brier(oos, oosProbs),
        rmseModel: round3(rmseModel),
        rmseBase: round3(rmseBase),
        rmseGainPct: rmseBase ? round2(((rmseBase - rmseModel) / rmseBase) * 100) : null,
      },

      // The same engine scored in-sample. Published so the gap between the two
      // is visible rather than implied.
      inSample: liveAll,

      slope: liveAll.slope,
      corr: liveAll.corr,
      edgeToGapBps: liveAll.slope === null ? null : Math.round(liveAll.slope * 100),
      slopeByFold: {
        min: globalSlopes.length ? round3(Math.min(...globalSlopes)) : null,
        median: drift.globalSlopeMed,
        max: globalSlopes.length ? round3(Math.max(...globalSlopes)) : null,
        published: GAP_B,
        note: "THE SHIPPED SLOPE IS THE PER-BAND FOLD MEDIAN, NOT THE GLOBAL ONE AND NOT THE IN-SAMPLE FIT.",
      },
      drift,

      weights: legEvidence,
      calibration,
    confCalibration,
      regimeSplit,
      gateSweep,
      legacyGate: { edgeMin: 0.30, regimeMult: legacyMult, ...legacy },
      egapMin: EGAP_MIN,
      confusion,
      conflict: {
        n: confRows.length,
        directionalGraded: confRows.length,
        hitPct: confRows.length ? round2((confRows.filter((r) => r.gapOutcome === "HIT").length / confRows.length) * 100) : null,
        cleanHitPct: cleanRows.length ? round2((cleanRows.filter((r) => r.gapOutcome === "HIT").length / cleanRows.length) * 100) : null,
      },
      coverageAvg: avg(rows.map((r) => r.coverage)),

      vixLast: vixLast ? round2(vixLast.close) : null,
      vixDate: vixLast?.date ?? null,
      legCount: PRE_OPEN_LEGS.length,
      missingLegs: missing,
      noHourlyLegs: noHourly,
rows: oos.slice().reverse().slice(0, 400),
      graded: true,
      target: identity,
      _meta: {
        target: `${target.label} (${target.symbol}, ${target.venue}) — GAP = OPEN vs PRIOR CLOSE`,
        engine: "SAME LEG SPECS + VOTE MATH + GATE + MAGNITUDE MODEL AS /api/opening",
        model: MODEL_PROVENANCE,
        limits: [
          ...(target.calibrated ? [] : [
            `THIS REBUILD MEASURED ${target.label}; EVERY PUBLISHED CONSTANT WAS FITTED ON NIFTY 50. THE BANDS ROW SHOWS THE SIZE OF THAT TRANSFER — A LARGE DRIFT MEANS THE LIVE MAGNITUDE IS WRONG FOR THIS INDEX`,
          ]),
          "HOURLY RECONSTRUCTION COSTS UP TO 60 MIN OF STALENESS ON THE 24H LEGS VS THE LIVE TICK",
          "NO BREADTH LEG IN THIS MODEL — HISTORICAL 09:00 IST A/D IS NOT RECONSTRUCTABLE, AND THE LIVE PREDICTION EXCLUDES IT TOO",
          "DAY RETURN IS REPORTED AS A SECONDARY COLUMN, NEVER AS THE PREDICTION TARGET",
          "738 SESSIONS IS STILL SHORT FOR A 15-PARAMETER FIT — WEIGHTS ARE SHRUNK 30% TOWARD THE HAND PRIOR FOR THAT REASON",
          "THE PUBLISH GATE IS APPLIED TO A FORECAST WHOSE BAND COEFFICIENTS WERE FITTED ON THE WHOLE HISTORY, SO THE LIVE GATE IS MARGINALLY OPTIMISTIC; THE BIAS IS FOUR NUMBERS ON 738 POINTS AND IS NOT ADJUSTED FOR",
          "INTRADAY PATH / MOMENTUM FEATURES WERE TESTED AND REJECTED — THE 09:00 LEVEL ALREADY CONTAINS THEM",
          "CROSS-FACTOR DISAGREEMENT PREDICTS THE RESIDUAL ONLY WEAKLY (r=0.17) SO IT HAIRCUTS CONFIDENCE AND NEVER MOVES THE FORECAST",
...(noHourly.length ? [`NO HOURLY HISTORY FOR ${noHourly.join(", ")} — THESE FELL BACK TO THE PRIOR DAILY CLOSE AND ARE UNDERSTATED`] : []),
        ],
      },
    };
    cacheSet(cacheKey, body);
    return NextResponse.json(body);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "history failed" }, { status: 502 });
  }
}

/**
 * A rebuild is deterministic for a given index and window, and it costs 1-3s of
 * upstream series. React mounts twice in dev and the desk re-renders on market
 * and day changes, so without this the same 738 sessions get rebuilt several
 * times per visit. Keyed by symbol+window and held briefly: long enough to
 * absorb a double-mount, short enough that a new session's prints land.
 */
const REBUILD_TTL = 15 * 60_000;
const rebuildCache = new Map<string, { at: number; body: unknown }>();

function cacheGet(key: string): unknown | undefined {
  const hit = rebuildCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > REBUILD_TTL) { rebuildCache.delete(key); return undefined; }
  return hit.body;
}
function cacheSet(key: string, body: unknown) {
  if (rebuildCache.size > 24) rebuildCache.clear();
  rebuildCache.set(key, { at: Date.now(), body });
}

/** First scored fold must leave room for the ridge's inner validation split. */
function block0(n: number): number {
  return Math.floor(n * 0.25);
}

/**
 * The "there is nothing to grade, and here is why" payload. Deliberately a
 * normal 200 with `graded: false` rather than an error: the desk is reporting a
 * measurement it cannot make, which is information, not a fault. The client
 * renders the reason in the panel so a missing scorecard never reads as a
 * missing market.
 */
function skip(reason: string, days: number, target: unknown) {
  return NextResponse.json({
    days, band: 0, gapGraded: 0, sessions: 0,
    upGaps: 0, dnGaps: 0, flatGaps: 0, gapHitPct: 0,
    graded: false,
    skipReason: reason,
    target,
    items: [],
  });
}


