// Intraday path engine — the six-hourly-mark projection on module 109 / FNC PRE.
//
// Pure math only; every fetch lives in /api/opening/path. This is the companion
// to `opening.ts`: that file forecasts ONE number (the gap at the bell), this one
// forecasts the SHAPE OF THE DAY AFTER the bell — where the index could be at
// each of the next six hour boundaries, how wide the honest range around that
// mark is, and how likely the mark is to sit above the prior close.
//
// WHY IT IS CONDITIONED AND NOT AVERAGED. "Indices drift +0.08% a session" is
// not a forecast, it is an average of days that resemble nothing. The only
// information a desk actually holds when it asks "where does this go from here"
// is the shape of the move that has ALREADY printed. So every historical session
// is bucketed by its opening gap, and the forward distribution is read only from
// the bucket today's tape falls into. A gap-up morning is conditioned on gap-up
// mornings, never on the whole sample.
//
// WHAT THIS MODEL IS NOT. It is not a prediction of the next hour — no hourly
// drift in any equity index survives the hour. It is a CONDITIONAL MEDIAN plus
// the empirical p10/p90 around it, published so the reader can see how little of
// the session is actually knowable at any given mark. The median is the point
// estimate; the FAN is the honest part. `gradePath` scores the median out of
// sample against a naive always-up baseline and the verdict says out loud when
// the conditioning has beaten it and when it has not.
//
// ALIGNMENT, and why it is index-based rather than clock-based. Each session is
// reduced to its COMPLETED hourly bars, indexed 0..capacity-1 from the venue's
// own open. Today's elapsed count `h` then selects, in every historical session,
// the same point in the same session — so the forward return being averaged is
// always "over the next j hours FROM WHERE WE ACTUALLY ARE", never "from the
// open" applied to a mid-session price. That off-by-one is the whole model: get
// it wrong and you publish the morning's drift as the afternoon's.
//
// NO LOOK-AHEAD. Today's own session is excluded from every distribution and
// from the grade split. The forward returns being averaged are all strictly
// later prints than the anchor they are measured from.

import { istHHMMFromUnix } from "./opening";

// ---- published constants ---------------------------------------------------

/** Hourly marks projected from now to the bell. The desk's fixed track length. */
export const PATH_MARKS = 6;

/**
 * |gap| inside this is a no-edge session, so it gets its own bucket rather than
 * being forced into a direction. Matches FLAT_BAND_PCT on the pre-open side.
 */
export const PATH_FLAT_PCT = 0.15;

/** Below this a conditional bucket is not quoted; the pooled sample is used. */
export const PATH_MIN_BUCKET_N = 20;

/** Below this the whole history is too thin to grade or to publish. */
export const PATH_MIN_SAMPLE = 40;

const HOUR_S = 3600;

// ---- venue clock (pure, DST resolved by the platform's own tz database) -----

interface ZonedParts { y: number; mo: number; d: number; h: number; mi: number }

function zonedParts(ts: number, tz: string): ZonedParts | null {
  try {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(ts * 1000));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
    let h = g("hour");
    if (!isFinite(h) || h === 24) h = 0;
    const out: ZonedParts = { y: g("year"), mo: g("month"), d: g("day"), h, mi: g("minute") };
    return [out.y, out.mo, out.d, out.h, out.mi].every((v) => isFinite(v)) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Calendar date in the VENUE's zone, not IST. A US cash session runs 19:00 IST
 * to 02:30 IST and would be torn in half by IST-date grouping; the venue's own
 * date is the only key under which it is one session.
 */
export function zonedDate(ts: number, tz: string): string | null {
  const p = zonedParts(ts, tz);
  return p ? `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
}

export function zonedHHMM(ts: number, tz: string): string | null {
  const p = zonedParts(ts, tz);
  return p ? `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}` : null;
}

export function zonedMinuteOfDay(ts: number, tz: string): number | null {
  const p = zonedParts(ts, tz);
  return p ? p.h * 60 + p.mi : null;
}

/** `"09:15"` -> 555. NaN on anything that is not a wall clock. */
export function parseHHMM(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return NaN;
  const h = Number(m[1]), mi = Number(m[2]);
  return isFinite(h) && isFinite(mi) ? h * 60 + mi : NaN;
}

// ---- session reconstruction ------------------------------------------------

export interface HourBar { ts: number; open: number; high: number; low: number; close: number }

export interface PathSession {
  /** Venue-local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Completed bars only, ascending. Index 0 is the venue's opening hour. */
  bars: HourBar[];
  /** Last close of the previous reconstructed session. */
  priorClose: number | null;
  open: number | null;
  close: number | null;
  /** (open / priorClose - 1) in percent, or null when the reference is missing. */
  gapPct: number | null;
}

/**
 * Group raw hourly bars into sessions on the VENUE's calendar, keeping only bars
 * that sit inside the venue's own trading window. The window filter is what
 * makes slot 0 the opening hour: an index feed often carries a pre-open or a
 * post-close print, and treating either as slot 0 shifts every later slot.
 *
 * A session needs at least two bars and a prior close to be usable — with one
 * bar there is no open AND no close, so it can neither define the gap nor serve
 * as the reference for the next session.
 */
export function buildSessions(
  bars: HourBar[],
  tz: string,
  openHHMM: string,
  closeHHMM: string
): PathSession[] {
  const openMin = parseHHMM(openHHMM);
  const closeMin = parseHHMM(closeHHMM);
  if (!isFinite(openMin) || !isFinite(closeMin)) return [];

  const byDate = new Map<string, HourBar[]>();
  for (const b of bars) {
    if (!isFinite(b.ts) || !isFinite(b.close) || b.close <= 0) continue;
    const date = zonedDate(b.ts, tz);
    const m = zonedMinuteOfDay(b.ts, tz);
    if (!date || m === null) continue;
    if (m < openMin || m >= closeMin) continue;
    const g = byDate.get(date);
    if (g) g.push(b);
    else byDate.set(date, [b]);
  }

  const dates = [...byDate.keys()].sort();
  const out: PathSession[] = [];
  let priorClose: number | null = null;
  for (const date of dates) {
    const bs = byDate.get(date)!.sort((a, b) => a.ts - b.ts);
    if (bs.length < 2) continue;
    const open = isFinite(bs[0]!.open) && bs[0]!.open > 0 ? bs[0]!.open : bs[0]!.close;
    const close = bs[bs.length - 1]!.close;
    const gap = priorClose && priorClose > 0 ? (open / priorClose - 1) * 100 : null;
    out.push({ date, bars: bs, priorClose, open, close, gapPct: gap });
    priorClose = close;
  }
  return out;
}

/**
 * The most common completed-bar count across usable sessions — how many hourly
 * slots a full session on this venue prints. Taken from HISTORY only: today's
 * session is partial by definition and would drag the mode down mid-session and
 * publish a truncated track as if it were the whole day.
 */
export function modalBarCount(sessions: PathSession[]): number {
  const counts = new Map<number, number>();
  for (const s of sessions) counts.set(s.bars.length, (counts.get(s.bars.length) ?? 0) + 1);
  let best = 0, bestN = 0;
  for (const [len, n] of counts) if (n > bestN) { best = len; bestN = n; }
  return best;
}

// ---- gap conditioning ------------------------------------------------------

export type PathBucket = "GAP_UP" | "FLAT" | "GAP_DOWN" | "NO_GAP";

export function pathBucket(gapPct: number | null): PathBucket | null {
  if (gapPct === null || !isFinite(gapPct)) return null;
  if (gapPct >= PATH_FLAT_PCT) return "GAP_UP";
  if (gapPct <= -PATH_FLAT_PCT) return "GAP_DOWN";
  return "FLAT";
}

export const PATH_BUCKET_LABEL: Record<PathBucket, string> = {
  GAP_UP: `GAP-UP SESSIONS (OPEN ≥ +${PATH_FLAT_PCT.toFixed(2)}%)`,
  FLAT: `NO-EDGE SESSIONS (|OPEN| < ${PATH_FLAT_PCT.toFixed(2)}%)`,
  GAP_DOWN: `GAP-DOWN SESSIONS (OPEN ≤ -${PATH_FLAT_PCT.toFixed(2)}%)`,
  NO_GAP: "NO GAP PRINTED YET — THE BELL HAS NOT RUNG",
};

// ---- distribution ----------------------------------------------------------

function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0]!;
  const i = (n - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5);

/** One forward observation: the move from the anchor to a later mark, in percent. */
export interface ForwardObs {
  /** target / anchor - 1, percent. */
  fwd: number;
  /** target / priorClose - 1, percent. */
  vsPrior: number;
}

const round2 = (v: number) => (isFinite(v) ? Math.round(v * 100) / 100 : NaN);
const round3 = (v: number) => (isFinite(v) ? Math.round(v * 1000) / 1000 : NaN);

/**
 * Every historical observation of "from elapsed `h`, what happened over the next
 * `j` hours", taken only from sessions that printed the bar. A session too short
 * to reach the mark contributes nothing — it is not counted as a flat one.
 */
function forwardObs(sessions: PathSession[], h: number, j: number): ForwardObs[] {
  const target = h + j - 1;
  if (target < 0) return [];
  const out: ForwardObs[] = [];
  for (const s of sessions) {
    if (s.priorClose === null || s.priorClose <= 0) continue;
    const anchorBar = h === 0 ? null : s.bars[h - 1];
    const anchor = h === 0 ? s.priorClose : anchorBar ? anchorBar.close : null;
    const targetBar = s.bars[target];
    if (anchor === null || anchor <= 0 || !targetBar) continue;
    out.push({ fwd: (targetBar.close / anchor - 1) * 100, vsPrior: (targetBar.close / s.priorClose - 1) * 100 });
  }
  return out;
}

// ---- marks -----------------------------------------------------------------

export type MarkState = "PROJECTED" | "BEYOND_BELL" | "NO_SAMPLE";

export interface PathMark {
  /** 1..PATH_MARKS. */
  j: number;
  /** Index of the session's hourly bar this mark reads. -1 when unavailable. */
  slot: number;
  /** IST wall clock of the hour boundary this mark closes on. */
  ist: string;
  /** Venue-local wall clock of the same boundary. */
  local: string;
  /** True when this mark is the session's closing print. */
  close: boolean;
  state: MarkState;
  /** Projected level, and its empirical p10/p90 fan. */
  level: number | null;
  lo: number | null;
  hi: number | null;
  /** Projected move vs the anchor we are already at, percent. */
  pctFromAnchor: number | null;
  /** Projected move vs the prior close, percent — the number a P&L is struck on. */
  pctFromPrior: number | null;
  /** P(mark above the prior close) and P(mark above where we are now). */
  pAbovePrior: number | null;
  pUp: number | null;
  /** Sessions behind this mark. */
  n: number;
}

export interface PathBucketInfo {
  key: PathBucket;
  label: string;
  n: number;
  pooled: boolean;
  /** Total usable sessions behind the published bucket. */
  total: number;
  note: string;
}

export interface PathGrade {
  split: string;
  /** Scored (mark, session) pairs. */
  n: number;
  /** Out-of-sample sign accuracy of the conditional median. */
  hitPct: number | null;
  /** Out-of-sample mean absolute error, percent of the anchor. */
  maePct: number | null;
  /** Naive always-up baseline on the same scored pairs. */
  baseHitPct: number | null;
  /** hitPct - baseHitPct. Zero means the conditioning bought nothing. */
  edgePts: number | null;
  verdict: string;
  note: string;
}

export interface PathBuildInput {
  /** Ascending by date. MAY include today — today is excluded internally. */
  sessions: PathSession[];
  /** Venue-local date of the session being forecast. */
  todayDate: string;
  /** Modal completed-bar count, from history. */
  capacity: number;
  /** Completed hourly bars in today's session, 0 pre-open. */
  elapsed: number;
  /** Live level now; null pre-open, when the anchor is the prior close. */
  anchorLevel: number | null;
  prevClose: number | null;
  /** Today's realised opening gap, percent. Null before the bell. */
  todayGapPct: number | null;
  tz: string;
  /** IST label of the session close, supplied by the route's own session clock. */
  closeIST: string;
  closeLocal: string;
}

export interface PathBuild {
  marks: PathMark[];
  bucket: PathBucketInfo;
  grade: PathGrade | null;
  caveats: string[];
}

/** Modal timestamp per slot, so a mark is labelled by the hour it actually reads. */
function modalSlotTs(sessions: PathSession[], capacity: number): number[] {
  const out: number[] = new Array(capacity).fill(NaN);
  for (let s = 0; s < capacity; s++) {
    const ts: number[] = [];
    for (const sess of sessions) {
      if (sess.bars.length === capacity && sess.bars[s]) ts.push(sess.bars[s]!.ts);
    }
    if (!ts.length) continue;
    const counts = new Map<number, number>();
    for (const t of ts) counts.set(t, (counts.get(t) ?? 0) + 1);
    let best = ts[0]!, bestN = 0;
    for (const [t, n] of counts) if (n > bestN) { best = t; bestN = n; }
    out[s] = best;
  }
  return out;
}

/**
 * The six marks, the bucket they were read from, and the out-of-sample grade of
 * that bucket. NaN-safe throughout: an unmeasurable mark is published as null
 * with a reason, never as a number.
 */
export function buildPath(input: PathBuildInput): PathBuild {
  const { sessions, todayDate, capacity, elapsed, tz, closeIST, closeLocal } = input;
  const caveats: string[] = [];

  // Today is never in its own history. `todayDate` is dropped from every
  // distribution and from the grade split, so nothing here is fitted on the
  // session being forecast.
  const history = sessions.filter((s) => s.date !== todayDate && s.bars.length >= 2);
  const pool = history.filter((s) => s.priorClose !== null && s.priorClose! > 0);

  const slotTs = modalSlotTs(history, capacity);

  const bucket = pathBucket(input.todayGapPct);
  let used = bucket && pool.length >= PATH_MIN_SAMPLE
    ? pool.filter((s) => pathBucket(s.gapPct) === bucket)
    : [];
  let pooled = false;
  if (used.length < PATH_MIN_BUCKET_N) {
    used = pool;
    pooled = true;
  }
  const info: PathBucketInfo = {
    key: bucket ?? "NO_GAP",
    label: PATH_BUCKET_LABEL[bucket ?? "NO_GAP"],
    n: used.length,
    pooled,
    total: pool.length,
    note: pooled
      ? bucket
        ? `ONLY ${pool.filter((s) => pathBucket(s.gapPct) === bucket).length} ${PATH_BUCKET_LABEL[bucket]} IN ${pool.length} SESSIONS — BELOW THE ${PATH_MIN_BUCKET_N}-SESSION FLOOR, SO THE MARK IS READ FROM EVERY SESSION INSTEAD. THE GAP CONDITION IS NOT IN THE NUMBER.`
        : `THE BELL HAS NOT RUNG, SO THERE IS NO GAP TO CONDITION ON. EVERY MARK IS READ FROM ALL ${pool.length} SESSIONS.`
      : `READ FROM ${used.length} OF ${pool.length} SESSIONS WHOSE OPEN GAP FELL IN THE SAME BAND AS TODAY'S.`,
  };
  if (pool.length < PATH_MIN_SAMPLE) {
    caveats.push(`ONLY ${pool.length} RECONSTRUCTED SESSIONS — BELOW THE ${PATH_MIN_SAMPLE}-SESSION FLOOR. THE MARKS ARE PUBLISHED AS A SHAPE, NOT A FIT.`);
  }

  // The anchor: the live level once the session is running, the prior close
  // before the bell. `elapsed === 0` is exactly the pre-open case, and history is
  // anchored the same way there, so the two are measured the same way.
  const anchor = input.anchorLevel ?? input.prevClose ?? null;
  if (anchor === null || anchor <= 0) {
    return {
      marks: Array.from({ length: PATH_MARKS }, (_, i) => ({
        j: i + 1, slot: -1, ist: "—", local: "—", close: false,
        state: "NO_SAMPLE" as MarkState, level: null, lo: null, hi: null, actual: null,
        pctFromAnchor: null, pctFromPrior: null, pAbovePrior: null, pUp: null, n: 0,
      })),
      bucket: info,
      grade: null,
      caveats: [...caveats, "NO ANCHOR — NEITHER A LIVE LEVEL NOR A PRIOR CLOSE CAME BACK, SO THERE IS NOTHING TO PROJECT FROM."],
    };
  }

  // WHICH SIX HOURS. The marks run forward one hour at a time from where the
  // session actually is, and the LAST mark is always the closing print rather
  // than "one hour before the bell". On a 09:15-15:30 venue that is 10:15,
  // 11:15, 12:15, 13:15, 14:15 and then the 15:30 close — which is the only set
  // of six that is genuinely one-per-hour AND ends on the bell. Ending at 15:15
  // would have published a number nobody trades against. When the session is far
  // enough along that the close is already inside the run, the sixth mark falls
  // past the bell and is published as BEYOND_BELL rather than invented.
  const lastSlot = capacity - 1;
  const lead = elapsed + PATH_MARKS - 2;
  const slots: number[] = [];
  for (let j = 1; j < PATH_MARKS; j++) slots.push(elapsed + j - 1);
  slots.push(lead < lastSlot ? lastSlot : elapsed + PATH_MARKS - 1);

  const marks: PathMark[] = [];
  for (let j = 1; j <= PATH_MARKS; j++) {
    const slot = slots[j - 1]!;
    const isLast = slot === lastSlot;
    // Yahoo stamps an hourly bar at its START, so the print this mark reads sits
    // one interval AFTER the stamp. Labelling a mark with the bar's own stamp
    // would print 09:15 for the level that exists at 10:15.
    const labelTs = slot >= 0 && slot < capacity ? slotTs[slot] : NaN;
    const ist = !isFinite(labelTs) ? "—" : isLast ? closeIST : istHHMMFromUnix(labelTs + HOUR_S);
    const local = !isFinite(labelTs) ? "—" : isLast ? closeLocal : zonedHHMM(labelTs + HOUR_S, tz) ?? "—";

    if (slot < 0 || slot >= capacity) {
      marks.push({
        j, slot: -1, ist, local, close: false, state: "BEYOND_BELL",
        level: null, lo: null, hi: null, pctFromAnchor: null, pctFromPrior: null,
        pAbovePrior: null, pUp: null, n: 0,
      });
      continue;
    }

    const obs = forwardObs(used, elapsed, slot - elapsed + 1);
    if (!obs.length) {
      marks.push({
        j, slot, ist, local, close: isLast, state: "NO_SAMPLE",
        level: null, lo: null, hi: null, pctFromAnchor: null, pctFromPrior: null,
        pAbovePrior: null, pUp: null, n: 0,
      });
      continue;
    }

    const fwd = obs.map((o) => o.fwd).sort((a, b) => a - b);
    const med = median(fwd);
    const p10 = quantile(fwd, 0.1);
    const p90 = quantile(fwd, 0.9);
    const level = anchor * (1 + med / 100);
    marks.push({
      j, slot, ist, local, close: isLast, state: "PROJECTED",
      level: round2(level),
      lo: round2(anchor * (1 + p10 / 100)),
      hi: round2(anchor * (1 + p90 / 100)),
      pctFromAnchor: round2(med),
      pctFromPrior: input.prevClose ? round2(((level / input.prevClose) - 1) * 100) : null,
      pAbovePrior: round3(obs.filter((o) => o.vsPrior > 0).length / obs.length),
      pUp: round3(obs.filter((o) => o.fwd > 0).length / obs.length),
      n: obs.length,
    });
  }

  const grade = gradePath(used, elapsed, capacity);  if (grade && grade.edgePts !== null && grade.edgePts < 2) {
    caveats.push("THE CONDITIONAL MEDIAN BEATS A NAIVE ALWAYS-UP BASELINE BY LESS THAN 2 POINTS OUT OF SAMPLE — READ THE FAN, NOT THE LINE.");
  }
  if (pooled && grade) {
    grade.note = `${grade.note} THE GRADE BELOW IS FOR THE POOLED SAMPLE, NOT FOR THE GAP CONDITION.`;
  }

  return { marks, bucket: info, grade, caveats };
}

/**
 * Walk-forward grade: the conditional median is measured on the EARLIER half of
 * the bucket and scored on the LATER half, so every scored mark is a forecast
 * made without having seen that session. Scored against an always-up baseline,
 * because a median that only says "up" scores 50% on an index and that is not
 * skill — it is the base rate wearing a suit.
 */
export function gradePath(sessions: PathSession[], elapsed: number, capacity: number): PathGrade | null {
  const usable = sessions.filter((s) => s.bars.length >= 2);
  if (usable.length < PATH_MIN_BUCKET_N) return null;

  const split = Math.floor(usable.length / 2);
  if (split < 5) return null;
  const fit = usable.slice(0, split);
  const test = usable.slice(split);

  let hit = 0, scored = 0, err = 0, base = 0;
  for (let j = 1; elapsed + j - 1 < capacity; j++) {
    const fitObs = forwardObs(fit, elapsed, j);
    if (fitObs.length < 5) continue;
    const med = median(fitObs.map((o) => o.fwd));
    if (!isFinite(med) || Math.abs(med) < 1e-9) continue;
    for (const o of forwardObs(test, elapsed, j)) {
      scored++;
      // MAE accumulates on every scored pair, not only on the misses — dividing
      // the miss-only error by the full count would report a flattering number.
      err += Math.abs(o.fwd - med);
      if (Math.sign(o.fwd) === Math.sign(med)) hit++;
      if (o.fwd > 0) base++;
    }
  }
  if (!scored) return null;

  const hitPct = round2((hit / scored) * 100);
  const baseHitPct = round2((base / scored) * 100);
  const maePct = round2(err / scored);
  const edgePts = round2(hitPct - baseHitPct);
  const verdict =
    edgePts >= 5 ? "MEASURED EDGE"
      : edgePts > 0 ? "MARGINAL EDGE"
        : "NO EDGE OVER THE BASE RATE";
  return {
    split: `${split} FIT / ${test.length} SCORED SESSIONS, CHRONOLOGICAL`,
    n: scored,
    hitPct, maePct, baseHitPct, edgePts, verdict,
    note: `THE MEDIAN IS FIT ON THE EARLIER HALF OF THE BUCKET AND SCORED ON THE LATER HALF, SO EVERY MARK IS A FORECAST THAT NEVER SAW ITS SESSION. THE BASELINE IS "IT ALWAYS GOES UP" ON THE SAME PAIRS.`,
  };
}
