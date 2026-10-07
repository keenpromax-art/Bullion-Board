"use client";

// Pre-Market Opening Desk (module 109 / FNC PRE) — presentation layer.
//
// The desk is a command centre, not a stack of identical panels. It is laid out
// as: a MASTHEAD that says what is being read, a live MARKET RAIL where every
// index shows its own price so the choice is informed, a sticky SECTION RAIL
// that lets you move around the whole desk, one DECISION HERO that answers the
// question, and then numbered sections, each with an instrument built for its
// own job — a gap gauge, a deduction stepper, a leg table, a factor chart, a
// deadband axis per tape card, breadth heat cells, a confirmation timeline and
// a position spec sheet.
//
// ONE COMPOSITION FOR BOTH SURFACES. `DeskLive` is the whole desk; the
// standalone page (density="full") and the terminal workspace panel
// (density="compact") both render it, so the two can never drift apart. Every
// figure on it is read off the published wire — nothing is re-derived or
// rounded for display, and an unmeasured market is shown as unmeasured rather
// than dressed up with a transferred number.
//
// Shared presentational pieces live here rather than in the two hosts so the
// page and the panel stay in sync. Pure math stays in @/lib/opening; fetches
// stay in /api/opening/*.

import {
  Fragment,
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { HoverTip, useHoverIndex } from "./charts";
import {
  COVERAGE_MIN, DEFAULT_TARGET_KEY, EGAP_MIN, FLAT_BAND_PCT, LEG_BY_KEY,
  MARKET_GROUP_NOTE, OPENING_TARGETS, PRE_OPEN_LEGS, breadthKeyForTarget, gapBand,
} from "@/lib/opening";
import type { LegGroup, LegVote, Score, Verdict } from "@/lib/opening";

// ---------------------------------------------------------------------------
// wire types — the shapes /api/opening and /api/opening/history publish
// ---------------------------------------------------------------------------

export interface OpeningLeg extends LegVote {}
export interface OpeningScore extends Omit<Score, "legs"> { legs: OpeningLeg[] }

export interface GapWire {
  open: number | null; prevClose: number | null; last: number | null;
  gapPct: number | null; livePct: number | null; retracePct: number | null;
  filled: boolean | null; flat: boolean | null;
}
export interface ConfirmWire {
  active: boolean; state: string; headline: string; verdict: Verdict;
  gapPct: number | null; retracePct: number | null; filled: boolean | null;
  breadthPct: number | null;
  forecastErrPct: number | null; forecastErrPts: number | null;
}
export interface ForecastWire {
  expectedGapPct: number | null; expectedGapPts: number | null;
  probUp: number | null; probDirectional: number | null;
  band: string; bandLabel: string;
  slopePctPerEdge: number; interceptPct: number; residualSdPct: number; gate: number;
  calibrated?: boolean;
  note: string;
}
export interface ModelWire {
  sample: string; sessions: number; method: string; validation: string;
  slopeRange: [number, number, number];
  oosSignAgreement: number; oosBenchmark: number; oosPrecision: number; oosSpreadPct: number;
  oosBrier: number; oosRmseGainPct: number;
  ensembleNote: string;
}
export interface IndexWire {
  label?: string; symbol?: string;
  last?: number | null; prevClose?: number | null; open?: number | null;
  high?: number | null; low?: number | null; chg?: number | null;
  range?: number | null; date?: string | null; bars?: number; session?: boolean;
}
export interface MarketWire {
  key: string; label: string; symbol: string; venue: string;
  group: "INDIA" | "GLOBAL"; mode: "GAP_CALL" | "TAPE_CHECK";
  calibrated: boolean; alsoLeg: boolean; legOverlap: string | null;
  profile: string; instrument: string; read: string;
  breadthIndex: string | null; breadthNote: string | null;
  session: {
    state: "PRE_OPEN" | "OPEN" | "CLOSED" | "WEEKEND" | "UNKNOWN";
    label: string; istWindow: string; toOpenMin: number | null; localWindow: string;
  };
}
export interface OpeningSnap {
  fetchedAtIST?: string; phase?: string; phaseLabel?: string; target?: string;
  currentSlot?: string; slots?: string[]; decisionMinuteIST?: string;
  market?: MarketWire;
  index?: IndexWire;
  gap?: GapWire;
  vix?: { last: number | null; chg: number | null; date: string | null; regime: string | null; cond: string | null; threshold: number };
  breadth?: {
    adv: number; dec: number; unc: number; total: number; pct: number | null; sentiment: string | null;
    matrix?: Record<string, [number, number, number]>;
    source: string; sessionFresh: boolean; universe: number;
    label?: string; proxy?: boolean; note?: string | null;
    gainers: any[]; losers: any[]; rows: any[];
  } | null;
  predict?: OpeningScore;
  forecast?: ForecastWire;
  model?: ModelWire;
  regimeMeasured?: Record<string, { deltaPts: number; spreadPct: number; n: number }>;
  confirm?: ConfirmWire | null;
  intraday?: Array<{ time: string; open: number; high: number; low: number; close: number }>;
  caveats?: string[];
}

/** One live row per market the rail offers (/api/opening/board). */
export interface BoardRow {
  key: string; label: string; symbol: string; venue: string;
  group: "INDIA" | "GLOBAL"; mode: "GAP_CALL" | "TAPE_CHECK";
  calibrated: boolean; alsoLeg: boolean;
  session: { state: string; label: string; istWindow: string };
  last: number | null; prevClose: number | null; chg: number | null; ok: boolean;
}
export interface BoardWire {
  fetchedAtIST?: string;
  defaultKey?: string;
  rows: BoardRow[];
}

// scorecard wire shapes — unchanged, kept so /api/opening/history consumers type
export interface CalibBucketWire {
  key: string; label: string; n: number; dirN: number;
  gapHitPct: number | null; avgGapPct: number | null; dirSignPct: number | null; avgDayPct?: number | null;
}
export interface LegEvidenceWire {
  key: string; short: string; group: string; symbol: string; n: number;
  r: number | null; signAgree: number | null;
  weight: number; priorWeight: number; fittedWeight: number;
  how: Record<string, number>; note: string;
}
export interface HeadlineWire {
  graded: number; dirCalls: number; dirN: number;
  dirSignPct: number | null; dirBasePct: number | null;
  greenMean: number | null; redMean: number | null; spreadPct: number | null; spreadT: number | null;
  precisionPct: number | null;
  flatCalls: number; flatHitPct: number | null; slope: number | null; corr: number | null;
  brier: number | null;
  rmseModel: number | null; rmseBase: number | null; rmseGainPct: number | null;
  folds: number;
}
export interface HistoryWire {
  /** FALSE when the desk publishes no verdict for this index — nothing to grade. */
  graded: boolean;
  /** Why the rebuild was refused, when `graded` is false. */
  skipReason?: string;
  /** Which index this rebuild graded, and whether it is the fitted one. */
  target: {
    key: string; label: string; symbol: string; venue: string;
    group: string; mode: string;
    fitted: boolean; alsoLeg: boolean;
    transfer: string;
  };
  days: number; band: number; gapGraded: number; sessions: number;
  upGaps: number; dnGaps: number; flatGaps: number; gapHitPct: number;
  oos: HeadlineWire;
  inSample: HeadlineWire;
  slopeByFold: { min: number | null; median: number | null; max: number | null; published: number; note: string };
  interceptByFold: { min: number | null; median: number | null; max: number | null; published: number };
  drift: {
    stale: boolean | null;
    globalSlopeMed: number | null;
    globalResidSdMed: number | null;
    note: string;
    bands: Array<{
      key: string; label: string; folds: number;
      slopeShipped: number; slopeMeasured: number | null;
      slopeRange: [number | null, number | null]; slopeDriftPct: number | null;
      interceptShipped: number; interceptMeasured: number | null;
      residSdShipped: number; residSdMeasured: number | null;
    }>;
  };
  weights: LegEvidenceWire[];
  egapMin: number;
  gateSweep: Array<HeadlineWire & { egapMin: number; legacy: boolean }>;
  legacyGate: HeadlineWire & { edgeMin: number; regimeMult: Record<string, number> };
  calibration: CalibBucketWire[];
  /**
   * Grading the desk's own published confidence number, out-of-sample. Edge
   * buckets say "is the signal big"; this says "when we said 60%, were we
   * right, and did being right capture more move than being wrong cost".
   */
  confCalibration: {
    bands: Array<{
      key: string; label: string; lo: number; hi: number;
      n: number; calls: number; dirN: number; right: number; wrong: number;
      hitPct: number | null;
      statedPct: number | null;
      calibPts: number | null;
      ptsRight: number; ptsWrong: number;
      avgGapRight: number | null; avgGapWrong: number | null;
      spreadPct: number | null;
    }>;
    /** Do higher bands actually measure more accurate? null = too few to judge. */
    monotone: boolean | null;
    verdict: string;
    topBandKey: string | null;
    minN: number;
  };
  regimeSplit: Array<{
    regime: string; band: string; bandSlope: number; bandResidSd: number;
    calls: number; n: number;
    hitPct: number | null; basePct: number | null; deltaPts: number | null;
    precisionPct: number | null;
    spreadPct: number | null; greenMean: number | null; redMean: number | null;
    measured: { deltaPts: number; spreadPct: number; n: number };
  }>;
  confusion: { greenHit: number; greenMiss: number; redHit: number; redMiss: number };
  conflict: { n: number; directionalGraded: number; hitPct: number | null; cleanHitPct: number | null };
  vixLast: number | null; vixDate: string | null;
  legCount: number; missingLegs: string[]; noHourlyLegs: string[]; coverageAvg: number | null;
  slope: number | null; corr: number | null; edgeToGapBps: number | null;
  rows: Array<{
    date: string; edge: number | null; egap?: number | null; coverage: number; staleShare?: number; verdict: Verdict;
    regime: string | null; conflict: boolean;
    gapPct: number | null; dayPct: number | null;
    gapOutcome: string; dayOutcome: string;
  }>;
  _meta: { target: string; engine: string; limits: string[]; model: ModelWire };
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export const f2 = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
export const f3 = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
export const fpct = (v: number | null | undefined, suffix = "%") =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v.toFixed(1)}${suffix}`;
/** Index levels get thousands separators; percentages and votes do not. */
export const fprice = (v: number | null | undefined, dp = 1) =>
  v === null || v === undefined || !isFinite(v)
    ? "—"
    : v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp === 0 ? 0 : undefined });
export const fpts = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)} PTS`;

export function toneClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "";
  return v > 0 ? "pos" : v < 0 ? "neg" : "";
}
/**
 * Direction colour. A flat reading used to return the old var(--faint), which is
 * also a FONT colour here (the tape cards print the change in the line itself)
 * and was therefore unreadable. A flat value is neutral, not absent, so it takes
 * the dimmest readable text tier instead of the old invisible grey.
 */
export const toneHex = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) || v === 0 ? "var(--faint)" : v > 0 ? "var(--green)" : "var(--red)";

export const VERDICT_TEXT: Record<Verdict, string> = {
  GREEN: "GAP UP", RED: "GAP DOWN", FLAT: "STAND ASIDE", NO_DATA: "NO CALL",
};
export const VERDICT_DOT: Record<Verdict, string> = {
  GREEN: "●", RED: "●", FLAT: "○", NO_DATA: "◌",
};
export const VERDICT_CLS: Record<Verdict, string> = {
  GREEN: "pos", RED: "neg", FLAT: "neutral", NO_DATA: "neutral",
};
/** One line of tradeable meaning per verdict. */
export const VERDICT_MEANING: Record<Verdict, string> = {
  GREEN: "The overnight information set leans gap-up. It had to clear the regime-gated forecast to be published at all — this is a forecast of the first print, not of the day.",
  RED: "The overnight information set leans gap-down. It had to clear the regime-gated forecast to be published at all — this is a forecast of the first print, not of the day.",
  FLAT: "The forecast gap sits inside the publish gate. The honest output is no position, not a coin flip and not a weak tilt.",
  NO_DATA: "Too few legs reporting to publish a direction. Coverage floor not met, so no direction is claimed.",
};

/** What the verdict means as a position. Same text on both surfaces. */
export const ACTION_BY_VERDICT: Record<Verdict, { head: string; short: string; body: string }> = {
  GREEN: {
    head: "GAP-UP BIAS INTO THE OPEN",
    short: "LONG BIAS",
    body: "The desk expects this index to open above its prior close by at least the gate. That is a view on the first print at the bell, and on nothing after it.",
  },
  RED: {
    head: "GAP-DOWN BIAS INTO THE OPEN",
    short: "SHORT BIAS",
    body: "The desk expects this index to open below its prior close by at least the gate. That is a view on the first print at the bell, and on nothing after it.",
  },
  FLAT: {
    head: "NO POSITION",
    short: "NO POSITION",
    body: "The forecast gap is inside the gate, which is the desk saying the overnight tape contains no gap big enough to trade. It is not a weak tilt and not a call to go in flat.",
  },
  NO_DATA: {
    head: "NO CALL",
    short: "NO CALL",
    body: "Too little of the overnight tape reported to clear the coverage floor. With no call there is nothing to size, and a call built on missing legs would be a guess with a number on it.",
  },
};

export const SESSION_DOT: Record<string, string> = {
  OPEN: "open", PRE_OPEN: "pre", CLOSED: "closed", WEEKEND: "weekend", UNKNOWN: "closed",
};

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

export function Cell({ lbl, val, sub, cls }: { lbl: string; val: string; sub?: string; cls?: string }) {
  return (
    <div className="cell">
      <div className="lbl">{lbl}</div>
      <div className={`val ${cls ?? ""}`}>{val}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function downloadCSV(name: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Diverging bar around a centre-zero rule. `max` is the full-scale half width.
 * The fill is rounded to 2dp before it reaches the DOM: these are votes in
 * [-1,+1], so the raw fraction put 16-digit widths into every leg row.
 */
function DivBar({ v, max = 1, title }: { v: number | null; max?: number; title?: string }) {
  if (v === null || !isFinite(v)) return <span className="faint">—</span>;
  if (Math.abs(v) < 1e-9) return <span className="pre-bar" title={title}><i className="flat" /></span>;
  const w = (Math.min(Math.abs(v), max) / max) * 50;
  return (
    <span className="pre-bar" title={title}>
      <i
        className={v > 0 ? "pos" : "neg"}
        style={v > 0 ? { left: "50%", width: `${w.toFixed(2)}%` } : { right: "50%", width: `${w.toFixed(2)}%` }}
      />
    </span>
  );
}

/** A labelled 0..1 meter with an optional threshold tick. */
function Meter({ label, value, display, tone, tick, foot }: {
  label: string; value: number | null; display: string; tone?: "ok" | "bad"; tick?: number; foot?: string;
}) {
  // Width is clamped AND rounded before it reaches the DOM: an unrounded
  // 0..1 fraction put 17-digit floats into the style attribute, which is noise
  // in the markup and can overflow the bar on a rounding edge.
  const pct = value === null || !isFinite(value) ? null : Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="pre-meter">
      <div className="pre-meter-top">
        <span className="pre-meter-l">{label}</span>
        <span className="pre-meter-v">{display}</span>
      </div>
      <div
        className="pre-meter-bar"
        role="img"
        aria-label={`${label}: ${display}${foot ? `. ${foot}` : ""}`}
      >
        {pct !== null && (
          <span className={`pre-meter-fill${tone ? ` ${tone}` : ""}`} style={{ width: `${pct.toFixed(1)}%` }} />
        )}
        {tick !== undefined && <span className="pre-meter-ghost" style={{ left: `${(tick * 100).toFixed(1)}%` }} />}
      </div>
      {foot && <div className="pre-meter-l" style={{ marginTop: 4, letterSpacing: "0.04em" }}>{foot}</div>}
    </div>
  );
}

/**
 * Section header. Deliberately carries NO number: the sticky rail directly above
 * already numbers every section and follows the reader as they scroll, so a
 * second number here read as an "01 / 01" echo (which is exactly what the first
 * render showed — the rail's "01 CALL" immediately above the head's "01 THE
 * CALL"). The title and rule alone give the section an anchor.
 */
function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="pre-sec-head">
      <span className="pre-sec-t">{title}</span>
      <span className="pre-sec-rule" />
      {meta && <span className="pre-sec-meta">{meta}</span>}
    </div>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return (
    <section className="pre-sec" id={`pre-sec-${id}`} data-sec={id} aria-label={id.toUpperCase()}>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// market rail — choose which market the desk is read for
// ---------------------------------------------------------------------------

export function MarketRail({ rows, value, onChange, note }: {
  rows: BoardRow[]; value: string; onChange: (key: string) => void; note?: ReactNode;
}) {
  const sel = rows.find((r) => r.key === value) ?? rows.find((r) => r.key === DEFAULT_TARGET_KEY) ?? rows[0];
  const group = sel?.group ?? "INDIA";
  const list = rows.filter((r) => r.group === group);
  return (
    <div className="pre-rail">
      <div className="pre-rail-top">
        <span className="pre-rail-label">Market</span>
        <span className="pre-seg" role="group" aria-label="Market group">
          {(["INDIA", "GLOBAL"] as const).map((g) => (
            <button
              key={g}
              className={group === g ? "on" : ""}
              aria-pressed={group === g}
              onClick={() => {
                const first = rows.find((r) => r.group === g);
                if (first) onChange(first.key);
              }}
            >
              {g === "INDIA" ? "◉ Indian market" : "◌ Global market"}
            </button>
          ))}
        </span>
        <span className="pre-rail-label" style={{ letterSpacing: "0.08em" }}>
          {group === "INDIA" ? "NSE / BSE cash · 09:15 IST bell" : "Other venues · tape check only"}
        </span>
        {note && <span className="pre-rail-label" style={{ marginLeft: "auto" }}>{note}</span>}
      </div>

      <div className="pre-rail-track">
        {list.map((r) => {
          const on = r.key === sel?.key;
          const dot = SESSION_DOT[r.session.state] ?? "closed";
          return (
            <button
              key={r.key}
              className={`pre-chip${on ? " on" : ""}${r.ok ? "" : " dead"}`}
              onClick={() => onChange(r.key)}
              aria-pressed={on}
              title={`${r.label} · ${r.venue} · ${r.symbol} · session ${r.session.istWindow}`}
            >
              <span className="pre-chip-top">
                <span className={`pre-dot ${dot}`} aria-hidden />
                <span className="pre-chip-name">{r.label}</span>
              </span>
              <span className="pre-chip-px">{r.ok ? fprice(r.last) : "—"}</span>
              <span className="pre-chip-sub">
                <span className={r.ok ? toneClass(r.chg) : "faint"}>{r.ok ? f2(r.chg, "%") : "NO TAPE"}</span>
                <span>{r.session.label}</span>
              </span>
              <span className="pre-chip-tags">
                {r.calibrated && <span className="pre-tag fit">FITTED</span>}
                {r.mode === "TAPE_CHECK" && <span className="pre-tag tape">TAPE CHECK</span>}
                {r.alsoLeg && <span className="pre-tag leg">IS A LEG</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="pre-rail-note">{MARKET_GROUP_NOTE[group]}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// masthead
// ---------------------------------------------------------------------------

export function Masthead({ snap, board, density, actions }: {
  snap: OpeningSnap; board: BoardWire | null; density: Density;
  actions?: { refresh?: () => void; log?: () => void; refreshLabel?: string; busy?: boolean };
}) {
  const m = snap.market;
  const i = snap.index ?? {};
  const p = snap.predict;
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const v: Verdict = p?.verdict ?? "NO_DATA";
  const dot = SESSION_DOT[m?.session.state ?? "UNKNOWN"] ?? "closed";
  const row = board?.rows.find((r) => r.key === (m?.key ?? DEFAULT_TARGET_KEY));
  const small = density === "compact";
  return (
    <header className="pre-mast">
      <div style={{ minWidth: 0 }}>
        <div className="pre-func">
          <span className="pre-fn-tag">109 · FNC PRE</span>
          <span className="pre-fn-desk">Pre-Market Opening Desk</span>
          {m && (
            <span className={`badge ${m.calibrated ? "ok" : tapeCheck ? "fnc" : "bad"}`}>
              {m.calibrated ? "FITTED ON THIS INDEX" : tapeCheck ? "TAPE CHECK · NO CALL" : "TRANSFERRED FIT"}
            </span>
          )}
        </div>

        <div className="pre-title">
          <span className="pre-title-name">{m?.label ?? "—"}</span>
          <span className="pre-title-sym">{m?.symbol ?? ""}</span>
          <span className="pre-title-venue">{m?.venue ?? "—"}</span>
        </div>

        <div className="pre-mast-meta">
          <span>
            <span className={`pre-dot ${dot}`} aria-hidden />
            <b>{m?.session.label ?? "—"}</b>
            <span>{m?.session.istWindow}</span>
          </span>
          <span className="pre-sep">/</span>
          <span>PRIOR CLOSE <b>{fprice(i.prevClose, 2)}</b></span>
          <span className="pre-sep">/</span>
          <span>OPEN <b>{fprice(i.open, 2)}</b></span>
          <span className="pre-sep">/</span>
          <span>OPEN GAP <b className={toneClass(snap.gap?.gapPct)}>{f2(snap.gap?.gapPct ?? null, "%")}</b></span>
          <span className="pre-sep">/</span>
          <span>SLOT <b>{snap.currentSlot ?? "—"}</b></span>
          <span className="pre-sep">/</span>
          <span>LOADED <b>{snap.fetchedAtIST ?? "—"}</b></span>
        </div>
        <p className="pre-foot" style={{ marginTop: 6 }}>{snap.phaseLabel ?? snap.phase ?? "—"}</p>
      </div>

      <div className="pre-mast-right">
        <div className="pre-mast-call">
          <span className="lbl">{tapeCheck ? "Overnight read · context only" : "Pre-open call"}</span>
          <span className={`val ${tapeCheck ? "" : VERDICT_CLS[v]}`}>
            {tapeCheck ? `NO CALL FOR ${m?.label ?? "THIS MARKET"}` : `${VERDICT_DOT[v]} ${VERDICT_TEXT[v]}`}
          </span>
          <span className="sub">
            {tapeCheck
              ? `EDGE ${f3(p?.edge ?? null)} · 09:00 IST INDIAN SESSION`
              : `GAP ${f2(snap.forecast?.expectedGapPct ?? null, "%")} · ${fpts(snap.forecast?.expectedGapPts)}`}
          </span>
          {!small && row && (
            <span className="sub">
              RAIL LAST {fprice(row.last, 2)} <span className={toneClass(row.chg)}>{f2(row.chg, "%")}</span>
            </span>
          )}
        </div>
        <div className="pre-mast-actions">
          {actions?.log && (
            <button className="ghost" onClick={actions.log} title="Store this slot's call in the local ledger">
              ⌸ Log slot
            </button>
          )}
          {actions?.refresh && (
            <button className="ghost" onClick={actions.refresh} disabled={actions.busy}>
              {actions.busy ? "Loading…" : "↻ Refresh"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// decision hero — the answer, then the instrument that produced it
// ---------------------------------------------------------------------------

/**
 * The gap gauge. One axis, one unit: expected gap in percent, with the no-trade
 * gate drawn in the SAME units as the number it gates, and — once the bell has
 * rung — the realised open as a hollow marker on the same axis, so "did the
 * forecast land" is a distance you can see rather than a subtraction.
 */
export function GapGauge({ egap, gate, realised, span = 1.0 }: {
  egap: number | null; gate: number; realised?: number | null; span?: number;
}) {
  // Geometry: 34pt of headroom above the axis for the marker + its label, 14pt
  // of track, 16pt below for the axis captions. The value label sits at
  // AX-18, which must stay positive or the SVG clips the number that matters.
  const W = 320, H = 62, AX = 34;
  // px: percent on the gauge -> x in the viewBox. x1: an x already converted,
  // rounded for the DOM. One conversion, one rounding — passing raw floats into
  // SVG attributes produced 17-digit coordinates and a triangle stretched
  // across the axis when an offset was fed through px() by mistake.
  const px = (v: number) => ((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * W;
  const x1 = (v: number) => v.toFixed(1);
  const colour = toneHex(egap);
  const showReal = realised !== null && realised !== undefined && isFinite(realised) && Math.abs(realised) > 0.001;
  return (
    <div className="pre-gauge">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Expected gap ${egap === null ? "unavailable" : `${egap.toFixed(2)} percent`} against a no-trade gate of plus or minus ${gate.toFixed(2)} percent`}
      >
        <rect x="0" y={AX - 7} width={W} height="14" fill="#000" stroke="var(--grid)" />
        <rect x={x1(px(-gate))} y={AX - 7} width={Math.max(1, px(gate) - px(-gate)).toFixed(1)} height="14" fill="color-mix(in srgb, var(--amber) 10%, transparent)" />
        <line x1={x1(px(-gate))} y1={AX - 7} x2={x1(px(-gate))} y2={AX + 7} stroke="color-mix(in srgb, var(--amber) 45%, transparent)" />
        <line x1={x1(px(gate))} y1={AX - 7} x2={x1(px(gate))} y2={AX + 7} stroke="color-mix(in srgb, var(--amber) 45%, transparent)" />
        <line x1={x1(px(0))} y1={AX - 9} x2={x1(px(0))} y2={AX + 9} stroke="var(--faint)" />
        {[-0.5, 0.5].map((t) => (
          <line key={t} x1={x1(px(t))} y1={AX - 5} x2={x1(px(t))} y2={AX + 5} stroke="var(--grid)" />
        ))}
        {egap !== null && isFinite(egap) && (
          <>
{/* Arrow head is a fixed 10pt span either side of the mark — what the eye
            reads as "the pointer". Deriving it from the value made it 40pt wide
            on a weak edge and invisible on a strong one. */}
            <rect
              x={Math.min(px(0), px(egap)).toFixed(1)} y={AX - 5}
              width={Math.max(2, Math.abs(px(egap) - px(0))).toFixed(1)} height="10"
              fill={colour}
            />
            {/* Triangle is drawn around the mark in SCREEN units (±5), not by
                converting ±5 through px() — px() takes a percent, so feeding it
                a pixel offset produced a head stretched across the whole axis. */}
            <polygon
              points={`${x1(px(egap))},${AX - 8} ${(px(egap) - 5).toFixed(1)},${AX - 14} ${(px(egap) + 5).toFixed(1)},${AX - 14}`}
              fill={colour}
            />
            <text x={x1(Math.max(24, Math.min(W - 24, px(egap))))} y={AX - 17} textAnchor="middle" fill={colour} fontSize="12" fontWeight="700">
              {`${egap >= 0 ? "+" : ""}${egap.toFixed(2)}%`}
            </text>
          </>
        )}
        {showReal && (
          <line x1={x1(px(realised!))} y1={AX - 9} x2={x1(px(realised!))} y2={AX + 9} stroke="var(--text)" strokeWidth="1.5" />
        )}
        {/* The realised marker can land near either end, so its caption is
            clamped inside the viewBox the same way the forecast label is. */}
        {showReal && (
          <text x={x1(Math.max(36, Math.min(W - 36, px(realised!))))} y={AX + 20} textAnchor="middle" fill="var(--text)" fontSize="9">
            {`REALISED ${realised! >= 0 ? "+" : ""}${realised!.toFixed(2)}%`}
          </text>
        )}
        <text x={x1(px(0))} y={AX + 20} textAnchor="middle" fill="var(--faint)" fontSize="9">
          {`NO TRADE ±${gate.toFixed(2)}%`}
        </text>
        <text x={W} y={AX - 11} textAnchor="end" fill="var(--faint)" fontSize="9">GAP UP +1.00%</text>
        <text x="0" y={AX - 11} fill="var(--faint)" fontSize="9">−1.00% GAP DOWN</text>
      </svg>
      <div className="pre-gauge-ax">
        <span>FORECAST IN % OF PRIOR CLOSE</span>
        <span>{showReal ? "MARKER = REALISED OPEN" : "NO REALISED OPEN YET"}</span>
      </div>
    </div>
  );
}

export function DecisionPanel({ snap, density }: { snap: OpeningSnap; density: Density }) {
  const p = snap.predict;
  const m = snap.market;
  const f = snap.forecast;
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const v: Verdict = p?.verdict ?? "NO_DATA";
  const small = density === "compact";
  const band = gapBand(p?.regime ?? null);
  const disagreement = p?.disagreement ?? null;
  const act = tapeCheck
    ? { head: "NOTHING TO TAKE FROM THIS DESK", short: "TAPE CHECK", body: `${m?.label ?? "This market"} is shown, not called. The desk publishes no gap, no probability and no position for another venue's open, so the honest answer to "where does the money go" is nowhere — until a model measured on that market exists.` }
    : ACTION_BY_VERDICT[v];

  const meters = (
    <div className="pre-meters">
      <Meter
        label="Confidence" value={p?.confidence ?? null} display={fpct((p?.confidence ?? 0) * 100)}
        tone={(p?.confidence ?? 0) >= 0.5 ? "ok" : (p?.confidence ?? 0) < 0.25 ? "bad" : undefined}
        foot="SCALE-FREE: HOW FAR PAST THE GATE"
      />
      <Meter
        label="Coverage" value={p?.coverage ?? null} display={fpct((p?.coverage ?? 0) * 100)}
        tone={(p?.coverage ?? 0) >= COVERAGE_MIN ? "ok" : "bad"}
        tick={COVERAGE_MIN}
        foot={`FLOOR ${fpct(COVERAGE_MIN * 100)}`}
      />
      <Meter
        label="Legs reporting" value={p?.legCount ? (p?.legsUsed ?? 0) / p.legCount : null}
        display={`${p?.legsUsed ?? 0}/${p?.legCount ?? 0}`}
        tone={(p?.staleShare ?? 0) > 0.34 ? "bad" : "ok"}
        foot={`${fpct((p?.staleShare ?? 0) * 100)} OF REPORTING WEIGHT STALE`}
      />
      {/* Deliberately shows the MEASURED dispersion in edge units, not a
          derived "agreement" score: the engine haircuts confidence by up to
          45% on this and never lets it move the forecast, so a meter reading
          "27% agreement" would overstate a warning the engine only mildly
          applies. The bar fills with disagreement. */}
      <Meter
        label="Factor spread" value={disagreement === null ? null : Math.min(1, disagreement / 0.45)}
        display={disagreement === null ? "—" : `${f3(disagreement)} EDGE`}
        tone={disagreement === null ? "bad" : disagreement <= 0.2 ? "ok" : disagreement > 0.34 ? "bad" : undefined}
        foot="HAIRCUTS CONFIDENCE BY UP TO 45% · NEVER MOVES THE FORECAST"
      />
    </div>
  );

  if (tapeCheck) {
    return (
      <div className="pre-hero">
        <div className="pre-hero-l">
          <div className="pre-kicker">
            <span>Overnight read</span><span>·</span>
            <span>{snap.target ?? "—"}</span>
          </div>
          <div className={`pre-verdict${small ? " sm" : ""}`}>○ NO CALL FOR {m?.label ?? "THIS MARKET"}</div>
          <p className="pre-verdict-sub">
            The edge below is the 09:00 IST Indian-session overnight read. It describes the NIFTY 50 open, not{" "}
            {m?.label}&apos;s. No gap, no probability and no points are published for {m?.label} because the fit,
            the gate and the leg windows are the Indian desk&apos;s
            {m?.legOverlap ? `, and ${m.label} is also the \`${m.legOverlap}\` leg inside them` : ""}.
          </p>
          <div className="pre-act">
            <span className="pre-act-t">{act.head}</span>
          </div>
          <p className="pre-verdict-sub">{act.body}</p>
          {meters}
        </div>
        <div className="pre-hero-r">
          <div className="pre-kicker"><span>Tape check</span></div>
          <SessionPanel snap={snap} />
        </div>
      </div>
    );
  }

  const hasForecast = f?.expectedGapPct !== null && f?.expectedGapPct !== undefined;
  return (
    <div className="pre-hero">
      <div className="pre-hero-l">
        <div className="pre-kicker">
          <span>{snap.target ?? "—"}</span>
          <span>·</span>
          <span>DECISION STRIKE {snap.decisionMinuteIST ?? "09:00"} IST</span>
          {p?.conflict && <span className="badge bad">⚠ LEGS CONFLICT · GATE ×1.5</span>}
        </div>

        {/* Verdict and size read as ONE answer, side by side. Putting the
            forecast number on its own row below made it compete with the
            verdict instead of completing it.

            The `auto` column is sized from CONTENT, and a long stats line
            (+96 PTS · P(UP) 80.1% · P(DIR) 80.1%) took it to max-content and
            starved the `1fr` — which crushed the meaning paragraph into a
            tall narrow ribbon. The stats therefore sit UNDER the number and
            are allowed to wrap, and the verdict column is given a floor so it
            can never be squeezed below a readable measure. */}
        <div className="pre-answer">
          <div className="pre-answer-l">
            <div className={`pre-verdict${small ? " sm" : ""} ${VERDICT_CLS[v]}`}>
              {VERDICT_DOT[v]} {VERDICT_TEXT[v]}
            </div>
            <p className="pre-verdict-sub" style={{ marginTop: 6 }}>{VERDICT_MEANING[v]}</p>
          </div>
          <div className="pre-answer-r">
            <span className="pre-figure-l">Expected gap</span>
            <span className={`pre-figure-xl ${toneClass(f?.expectedGapPct)}`}>
              {hasForecast ? `${f!.expectedGapPct! >= 0 ? "+" : ""}${f!.expectedGapPct!.toFixed(2)}%` : "—"}
            </span>
            <span className="pre-figure-m">
              {fpts(f?.expectedGapPts ?? null)}
              {" · "}P(UP) {fpct((f?.probUp ?? 0) * 100)}
              {" · "}P(DIR) {fpct((f?.probDirectional ?? 0) * 100)}
            </span>
          </div>
        </div>

        <div className="pre-act">
          <span className="pre-act-t">{act.head}</span>
          <span className="pre-act-s">
            {p?.regime ? `REGIME ${p.regime} · BAND ${band.key}` : "NO VIX TAPE"}
            {snap.confirm?.state ? ` · POST-BELL ${snap.confirm.state}` : ""}
          </span>
        </div>
        <p className="pre-verdict-sub">{act.body}</p>

        <p className="pre-foot">
          {f?.band} BAND: {f?.interceptPct.toFixed(2)}% + {f?.slopePctPerEdge.toFixed(2)} × EDGE ={" "}
          {hasForecast ? `${f!.expectedGapPct!.toFixed(2)}%` : "—"} · RESIDUAL σ{" "}
          {f?.residualSdPct.toFixed(2)}% · PUBLISH GATE ±{f?.gate?.toFixed(2) ?? "0.25"}% ·{" "}
          {m?.calibrated ? "FITTED HERE" : "NIFTY 50 FIT, TRANSFERRED"}
        </p>

        {meters}
      </div>

      <div className="pre-hero-r">
        <div className="pre-kicker"><span>Expected gap against the publish gate</span></div>
        <GapGauge
          egap={p?.expectedGapPct ?? null}
          gate={p?.gate ?? EGAP_MIN}
          realised={snap.gap?.gapPct ?? null}
        />
        <div className="pre-badge-row">
          <span className={`badge ${VERDICT_CLS[v]}`}>{VERDICT_DOT[v]} {VERDICT_TEXT[v]}</span>
          {m && (
            <span className={`badge ${m.calibrated ? "ok" : "bad"}`}>
              {m.calibrated ? "BAND FITTED HERE" : "BAND TRANSFERRED"}
            </span>
          )}
          <span className="badge">σ {f?.residualSdPct.toFixed(2) ?? "—"}%</span>
          <span className="badge">GATE ±{f?.gate?.toFixed(2) ?? "0.25"}%</span>
        </div>
        <p className="pre-foot">
          THE GATE IS THE ONLY REASON A FLAT VERDICT EXISTS. IT IS SET AT ~1.7× THE ±{FLAT_BAND_PCT}% BAND THE DESK
          CALLS NO-EDGE: PUBLISH ONLY WHEN A GAP IS EXPECTED TO BE BIG ENOUGH TO PAY FOR ITS OWN COSTS.
        </p>
      </div>
    </div>
  );
}

/** The selected market's own session — the tape-check right column. */
function SessionPanel({ snap }: { snap: OpeningSnap }) {
  const i = snap.index ?? {};
  const m = snap.market;
  const s = m?.session;
  const toOpen = s?.toOpenMin === null || s?.toOpenMin === undefined
    ? "—"
    : s.toOpenMin > 0
      ? `OPENS IN ${s.toOpenMin >= 60 ? `${Math.floor(s.toOpenMin / 60)}H ${s.toOpenMin % 60}M` : `${s.toOpenMin}M`}`
      : "SESSION UNDERWAY";
  const opened = i.open !== null && i.open !== undefined;
  return (
    <>
      <div className="cells">
        <Cell lbl="Last" val={fprice(i.last)} sub={f2(i.chg, "%")} cls={toneClass(i.chg)} />
        <Cell lbl="Prior close" val={fprice(i.prevClose, 2)} />
        <Cell lbl="Open" val={fprice(i.open, 2)} sub={opened ? f2(snap.gap?.gapPct ?? null, "%") + " GAP" : "NOT OPENED"} cls={toneClass(snap.gap?.gapPct)} />
        <Cell lbl="High" val={fprice(i.high, 2)} sub="SESSION" />
        <Cell lbl="Low" val={fprice(i.low, 2)} sub="SESSION" />
        <Cell lbl="Session" val={s?.label ?? "—"} sub={s?.istWindow ?? "—"} />
      </div>
      <p className="pre-note">
        LOCAL SESSION {s?.localWindow ?? "—"} · {toOpen}.{" "}
        {opened
          ? "The open above is this market's realised opening gap against its own prior close — an observed fact, not a call."
          : "The open above stays dashed until this market opens on its own clock."}
      </p>
      <p className="pre-warn">WHY THERE IS NO CALL HERE — {m?.read ?? "—"}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 01 · deduction — the seven steps, with this morning's numbers
// ---------------------------------------------------------------------------

type StepState = "PASS" | "FAIL" | "NOTE";

function Step({ n, title, formula, state, why }: {
  n: number; title: string; formula: string; state: StepState; why: string;
}) {
  const cls = state === "PASS" ? "ok" : state === "FAIL" ? "fail" : "note";
  return (
    <div className={`pre-step ${cls}`}>
      <div className="pre-step-rail">
        <span className="pre-step-n">{n}</span>
        <span className="pre-step-line" />
      </div>
      {/* Title and state chip share a row; the formula gets its own line. The
          formulas are long and comparable — putting them in the title row made
          them wrap raggedly and impossible to scan down the column. */}
      <div className="pre-step-b">
        <div className="pre-step-top">
          <span className="pre-step-t">{title}</span>
          <span className={`badge ${state === "PASS" ? "ok" : state === "FAIL" ? "bad" : "fnc"}`}>
            {state === "PASS" ? "OK" : state === "FAIL" ? "BLOCKS" : "NOTE"}
          </span>
        </div>
        <p className="pre-step-f">{formula}</p>
        <p className="pre-step-why">{why}</p>
      </div>
    </div>
  );
}

export function DeductionSteps({ snap }: { snap: OpeningSnap }) {
  const p = snap.predict;
  const legs = p?.legs ?? [];
  const m = snap.market;
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const reporting = legs.filter((l) => l.vote !== null);
  const noTape = legs.filter((l) => l.vote === null).length;
  const shut = legs.filter((l) => l.priorOnly).length;
  const stale = legs.filter((l) => l.stale).length;
  const silent = legs.filter((l) => l.vote === 0).length;
  const sat = legs.filter((l) => l.saturated).length;
  const tails = legs.filter((l) => l.tail).length;
  const cov = p?.coverage ?? 0;
  const covOK = cov >= COVERAGE_MIN;
  const edge = p?.edge ?? null;
  const egap = p?.expectedGapPct ?? null;
  const gate = p?.gate ?? EGAP_MIN;
  const mag = egap === null ? null : Math.abs(egap);
  const called = p?.verdict === "GREEN" || p?.verdict === "RED";
  const band = gapBand(p?.regime ?? null);

  const groups = useMemo(
    () => GROUP_ORDER.map((g) => ({ g, e: p?.groups?.[g] })).filter((x) => x.e && x.e!.edge !== null),
    [p?.groups]
  );
  const top = useMemo(
    () => [...groups].sort((a, b) => Math.abs(b.e!.edge!) - Math.abs(a.e!.edge!)).slice(0, 2),
    [groups]
  );

  return (
    <>
      <div className="pre-steps">
        <Step
          n={1} title="Read the tape" state={noTape ? "NOTE" : "PASS"}
          formula={`${reporting.length}/${legs.length} LEGS REPORTED · ${shut} AT THE LAST COMPLETED CLOSE (MARKET SHUT) · ${stale} STALE${noTape ? ` · ${noTape} NO TAPE` : ""}`}
          why="Each leg is read only inside its own market's hours. A missing leg is NOT a flat leg — it lowers coverage instead of manufacturing conviction."
        />
        <Step
          n={2} title="Deadband" state={silent > legs.length * 0.6 ? "NOTE" : "PASS"}
          formula={`${silent} LEG${silent === 1 ? "" : "S"} INSIDE THEIR DEADBAND → VOTE 0 · ${sat} SATURATED AT SCALE${tails ? ` · ${tails} REJECTED AS OUTLIER` : ""}`}
          why="A move too small to be information votes zero. A move too large to be news is rejected outright. Only what survives both is weighted."
        />
        <Step
          n={3} title="Weight + coverage" state={covOK ? "PASS" : "FAIL"}
          formula={`COVERAGE ${fpct(cov * 100)} vs FLOOR ${fpct(COVERAGE_MIN * 100)} · ${fpct((p?.staleShare ?? 0) * 100)} OF REPORTING WEIGHT STALE`}
          why="Weights are ridge-fitted against the realised gap and shrunk 30% toward the hand prior, so a thin sample cannot swing what the desk publishes. Below the floor it refuses to call a direction at all."
        />
        <Step
          n={4} title="Weighted edge" state={edge === null ? "FAIL" : "PASS"}
          formula={edge === null
            ? "NO EDGE — NO LEG REPORTED WEIGHT"
            : `Σ(WEIGHT × VOTE) ÷ Σ(WEIGHT) = ${f3(edge)} · FACTOR SPREAD ${f3(p?.disagreement ?? null)}${p?.conflict ? " · ⚠ LEGS CONFLICT" : ""}`}
          why="The edge is the weighted average of the leg votes in [-1,+1]. Six of the fifteen legs are one US-equity bet seen six times, so the averaging divides that duplication out and the fit is what remains."
        />
        <Step
          n={5} title="Size the gap" state={egap === null ? "FAIL" : tapeCheck ? "NOTE" : "PASS"}
          formula={egap === null
            ? "NO FORECAST — NO EDGE TO MAP THROUGH A BAND"
            : `${tapeCheck ? "INDIAN OPEN — " : ""}${band.label} (${band.key}): ${band.intercept.toFixed(2)}% + ${band.slope.toFixed(2)} × ${f3(edge)} = ${f2(egap, "%")}`}
          why={tapeCheck
            ? "This percent is the gap expected at the Indian open. It is not converted into this market's points anywhere on this desk, because doing so would be a number in an unmeasured unit."
            : "A colour without a size is not a forecast. The slope and intercept are the walk-forward fold medians for the India-vol regime, not the in-sample fit."}
        />
        <Step
          n={6} title="Test it against the gate" state={tapeCheck ? "NOTE" : called ? "PASS" : "FAIL"}
          formula={tapeCheck
            ? `|${mag === null ? "—" : mag.toFixed(2)}|% vs ±${gate.toFixed(2)}% — NOT APPLIED. NO CALL IS PUBLISHED FOR ${m?.label ?? "THIS MARKET"}'S OPEN.`
            : mag === null
              ? "NO FORECAST TO TEST"
              : `|${mag.toFixed(2)}|% vs PUBLISH GATE ±${gate.toFixed(2)}% → ${mag >= gate ? "CLEARS" : "INSIDE"}`}
          why={tapeCheck
            ? "The gate is the Indian open's gate. Another venue's open needs its own decision minute, its own leg windows and its own measured band before a gate means anything."
            : "The gate is the only reason a flat verdict exists: publish only when the expected gap is ~1.7× the size of a gap the desk calls no-edge."}
        />
        <Step
          n={7} title="Put a probability on it"
          state={p?.probUp === null || p?.probUp === undefined ? "FAIL" : tapeCheck ? "NOTE" : "PASS"}
          formula={p?.probUp === null || p?.probUp === undefined
            ? "NO PROBABILITY — NO FORECAST"
            : tapeCheck
              ? `NOT PUBLISHED FOR ${m?.label ?? "THIS MARKET"}. THE INDIAN OPEN'S READ WAS P(UP) ${fpct(p.probUp * 100)} · P(DIRECTIONAL) ${fpct((p?.probDirectional ?? 0) * 100)} · σ ${band.residSd.toFixed(2)}%.`
              : `P(OPENS ABOVE PRIOR CLOSE) ${fpct(p.probUp * 100)} · P(GAP IS DIRECTIONAL) ${fpct((p?.probDirectional ?? 0) * 100)} · RESIDUAL σ ${band.residSd.toFixed(2)}%`}
          why={tapeCheck
            ? "A probability is the number most likely to be misread as a call on the wrong market, so it is withheld rather than relabelled."
            : "The forecast is a point estimate plus this regime's residual. σ is what the model cannot explain — it is the honest size of the error, and the only thing worth sizing against."}
        />
      </div>

      <div className="pre-card accent" style={{ marginTop: 10 }}>
        <span className="pre-card-h">Where the call came from</span>
        <p className="pre-card-b">
          {tapeCheck
            ? `Steps 1–4 describe the overnight tape as it stands — that part is the same whatever market is selected. Steps 5–7 are the NIFTY 50 fit at the 09:00 IST Indian open${top.length ? `, which came from ${top.map((t) => `${t.g} (${f3(t.e!.edge)})`).join(" and ")}` : ""}. ${m?.label ?? "This market"} is shown on its own tape, not called.`
            : called
              ? `The call came from ${top.map((t) => `${t.g} (${f3(t.e!.edge)})`).join(" and ")} — weighted together they carry ${fpct((top[0]?.e?.weight ?? 0) + (top[1]?.e?.weight ?? 0))} edge units. The remaining ${legs.length - (top[0]?.e?.legs ?? 0) - (top[1]?.e?.legs ?? 0)} legs did not change the answer.`
              : `No direction was published. Step ${covOK ? 6 : 3} is what stopped it — ${covOK ? `the forecast gap of ${egap === null ? "—" : `${egap.toFixed(2)}%`} sits inside the ±${gate.toFixed(2)}% gate.` : `coverage of ${fpct(cov * 100)} is below the ${fpct(COVERAGE_MIN * 100)} floor.`} That is the desk refusing to trade, which is a different statement from being wrong.`}
        </p>
        <p className="pre-foot">
          Steps 1–7 are the published wire read unchanged. Nothing on this panel is re-derived, rounded or adjusted
          for display — if a number here disagrees with the panel it came from, the wire is the truth.
        </p>
      </div>
    </>
  );
}

export const GROUP_ORDER: LegGroup[] = ["FUTURES", "ASIA", "US CASH", "FX", "MACRO", "VOL"];
export const GROUP_WHY: Record<LegGroup, string> = {
  FUTURES: "OVERNIGHT REPRICING — 24H, LIVE AT THE BELL. WEAKEST FACTOR ALONE; EARNS ITS PLACE BY DENOISING THE OTHERS",
  ASIA: "LIVE ASIAN SESSION LEAD — PRINTS BEFORE THE BELL. THE STRONGEST FACTOR ALONE",
  "US CASH": "LAST COMPLETED US SESSION — CLOSED ~02:30 IST. HIGHEST-GAINING FACTOR ALONE",
  FX: "RUPEE STRENGTH VS THE IMPORT-HEAVY INDEX — NEARLY UNCORRELATED WITH EVERYTHING ELSE",
  MACRO: "OIL / GOLD / DOLLAR / YIELDS — THE INFLATION AND DOLLAR LEG",
  VOL: "OVERSEAS RISK-PRICING — THE BEST SINGLE LEG BY SIGN AGREEMENT",
};

// ---------------------------------------------------------------------------
// 02 · leg build — every vote, its weight, what it contributed
// ---------------------------------------------------------------------------

function legState(l: OpeningLeg): { txt: string; cls: string } {
  if (l.tail) return { txt: "REJECTED", cls: "none" };
  if (l.chg === null) return { txt: "NO TAPE", cls: "none" };
  if (l.stale) return { txt: "STALE ×¼", cls: "stale" };
  if (l.priorOnly) return { txt: "PRIOR CLOSE", cls: "prior" };
  if (l.deadbanded) return { txt: "DEADBAND → 0", cls: "dead" };
  if (l.saturated) return { txt: "SATURATED", cls: "sat" };
  return { txt: "LIVE", cls: "live" };
}

export function LegTable({ score, filter, setFilter, votingOnly, setVotingOnly, openKey, setOpenKey }: {
  score: OpeningScore;
  filter: LegGroup | null; setFilter: (g: LegGroup | null) => void;
  votingOnly: boolean; setVotingOnly: (v: boolean) => void;
  openKey: string | null; setOpenKey: (k: string | null) => void;
}) {
  const all = score.legs ?? [];
  const rows = all.filter((l) => {
    if (filter && l.group !== filter) return false;
    if (votingOnly && !(l.vote !== null && l.vote !== 0)) return false;
    return true;
  });
  const wsum = rows.reduce((a, l) => a + l.applied, 0);
  return (
    <>
      <div className="pre-legs-tools">
        <button className={`pill${filter === null ? " active" : ""}`} onClick={() => setFilter(null)} aria-pressed={filter === null}>
          All groups
        </button>
        {GROUP_ORDER.filter((g) => all.some((l) => l.group === g)).map((g) => (
          <button
            key={g}
            className={`pill${filter === g ? " active" : ""}`}
            onClick={() => setFilter(filter === g ? null : g)}
            aria-pressed={filter === g}
            title={GROUP_WHY[g]}
          >
            {g}
          </button>
        ))}
        <button
          className={`pill${votingOnly ? " active" : ""}`}
          onClick={() => setVotingOnly(!votingOnly)}
          aria-pressed={votingOnly}
          title="Legs whose move cleared their deadband and therefore voted"
        >
          Voting only
        </button>
        <span className="pre-rail-label" style={{ marginLeft: "auto" }}>
          SHOWING {rows.length} OF {all.length} · APPLIED WEIGHT {wsum.toFixed(3)}
        </span>
      </div>

      <div className="scrollx pre-legs" style={{ marginTop: 8 }}>
        <table className="plain">
          <thead>
            <tr>
              <th>Leg</th><th>Group</th><th>Symbol</th>
              <th style={{ textAlign: "right" }}>Reading %</th>
              <th style={{ textAlign: "right" }}>Vote</th>
              <th style={{ textAlign: "right" }}>Vote axis</th>
              <th style={{ textAlign: "right" }}>Weight</th>
              <th style={{ textAlign: "right" }}>Applied</th>
              <th style={{ textAlign: "right" }}>Contrib</th>
              <th style={{ textAlign: "right" }}>Fitted r</th>
              <th style={{ textAlign: "right" }}>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const st = legState(l);
              const open = openKey === l.key;
              return (
                <Fragment key={l.key}>
                  <tr
                    onClick={() => setOpenKey(open ? null : l.key)}
                    aria-expanded={open}
                    title={`${l.label} — click for the note`}
                  >
                    <td><strong className="sec">{l.short}</strong></td>
                    <td className="faint" style={{ fontSize: 11 }}>{l.group}</td>
                    <td className="faint" style={{ fontSize: 11 }}>{l.symbol}</td>
                    <td style={{ textAlign: "right" }} className={l.chg === null ? "" : toneClass(l.chg)}>{f2(l.chg)}</td>
                    <td style={{ textAlign: "right" }} className={l.vote === null ? "faint" : toneClass(l.vote)}>{f3(l.vote)}</td>
                    <td style={{ textAlign: "right" }}><span className="pre-bar-cell"><DivBar v={l.vote} title={`Vote ${f3(l.vote)} of a ±1.00 scale`} /></span></td>
                    <td style={{ textAlign: "right" }} className="faint">{l.weight.toFixed(3)}</td>
                    <td style={{ textAlign: "right" }} className={l.applied < l.weight - 1e-9 ? "neg" : "faint"}>{l.applied.toFixed(3)}</td>
                    <td style={{ textAlign: "right" }} className={l.contribution === 0 ? "faint" : toneClass(l.contribution)}>{f3(l.contribution)}</td>
                    <td style={{ textAlign: "right" }} className="faint">{l.measuredR === null || l.measuredR === undefined ? "—" : l.measuredR.toFixed(3)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`pre-st ${st.cls}`}>{st.txt}</span>
                      {open && <span className="faint" style={{ fontSize: 10 }}> ▲</span>}
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={11} style={{ padding: 0 }}>
                        <div className="pre-leg-note">
                          <strong className="sec">{l.short}</strong> — {l.label} · {l.symbol} · {GROUP_WHY[l.group]}
                          <br />
                          {l.note}
                          <br />
                          DEADBAND ±{LEG_BY_KEY[l.key]?.deadband.toFixed(2)}% · SCALE {LEG_BY_KEY[l.key]?.scale.toFixed(2)}% ·
                          PLAUSIBLE ±{LEG_BY_KEY[l.key]?.plausiblePct}%{LEG_BY_KEY[l.key]?.invert ? " · INVERTED (A RISE IS BEARISH)" : ""} ·
                          MEASURED SIGN AGREEMENT {LEG_BY_KEY[l.key]?.measuredSign === null || LEG_BY_KEY[l.key]?.measuredSign === undefined ? "—" : `${LEG_BY_KEY[l.key]?.measuredSign}%`} ·
                          PRIOR WEIGHT {LEG_BY_KEY[l.key]?.priorWeight.toFixed(2) ?? "—"} · BACKTESTABLE {l.backtestable ? "YES" : "NO"}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={11}><span className="pre-empty">NO LEGS MATCH THIS FILTER — every leg is either in another group or abstaining.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="pre-foot" style={{ marginTop: 8 }}>
        VOTE = tanh(READING) PAST A PER-LEG DEADBAND, THEN WEIGHTED. A MISSING LEG CONTRIBUTES 0 AND LOWERS
        COVERAGE — IT IS NEVER COUNTED AS A FLAT TAPE. A STALE TAPE IS COUNTED AT ONE QUARTER WEIGHT. CLICK ANY ROW
        FOR WHY THAT LEG EARNS ITS PLACE. SPECS:{" "}
        {PRE_OPEN_LEGS.map((l) => `${l.short} ±${l.deadband.toFixed(2)}/${l.scale.toFixed(2)}`).join(" · ")}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 03 · factor origin — where the conviction comes from, cross-filtering the legs
// ---------------------------------------------------------------------------

export function FactorOrigin({ score, filter, setFilter }: {
  score: OpeningScore; filter: LegGroup | null; setFilter: (g: LegGroup | null) => void;
}) {
  const groups = useMemo(() => GROUP_ORDER.map((g) => ({ g, e: score.groups?.[g] })), [score.groups]);
  const live = groups.filter((x) => x.e && x.e!.edge !== null);
  return (
    <div className="pre-factors">
      {live.map(({ g, e }) => (
        <button
          key={g}
          className={`pre-factor${filter === g ? " on" : ""}`}
          onClick={() => setFilter(filter === g ? null : g)}
          aria-pressed={filter === g}
          title={GROUP_WHY[g]}
        >
          <span className="pre-factor-n">{g}</span>
          <span className="pre-bar-cell"><DivBar v={e!.edge} title={`${g} factor edge ${f3(e!.edge)}`} /></span>
          <span className="pre-factor-w">{e!.legs} LEGS · WEIGHT {e!.weight.toFixed(3)}</span>
          <span className={`pre-factor-e ${e!.edge === null ? "faint" : toneClass(e!.edge)}`}>{f3(e!.edge)}</span>
        </button>
      ))}
      {!live.length && <p className="pre-empty">NO FACTOR REPORTED — the group table is empty, which is why the call is a refusal.</p>}
      {score.conflict && (
        <p className="pre-warn" style={{ marginTop: 4 }}>
          ⚠ {score.conflictNote} — GATE RAISED 50% TO COMPENSATE.
        </p>
      )}
      <p className="pre-foot" style={{ marginTop: 4 }}>
        CLICK A FACTOR TO FILTER THE LEG TABLE ABOVE TO THAT GROUP. SIX OF THE LEGS ARE ONE US-EQUITY BET SEEN SIX
        TIMES (ES/NQ/YM CORRELATE 0.85–0.96, SPX/NDX/DJI 0.75–0.96). THE WEIGHTED AVERAGE DIVIDES THAT
        DUPLICATION OUT AND RIDGE SHRINKAGE REMOVES WHAT IS LEFT — SO GROUPING SHOWS THE CALL&apos;S ORIGIN, IT DOES
        NOT BUY ACCURACY.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 04 · overnight tape — one card per leg, each on its own deadband axis
// ---------------------------------------------------------------------------

/**
 * Where this leg's move sits between zero and saturation, with its deadband
 * drawn. Scaled per leg, so ES at ±0.6% and OIL at ±1.5% are both readable on
 * one card instead of one of them being a flat line.
 */
function TapeAxis({ chg, deadband, scale }: { chg: number | null; deadband: number; scale: number }) {
  if (chg === null || !isFinite(chg)) {
    return <span className="pre-tc-axis"><span className="zero" /></span>;
  }
  const dom = Math.max(scale, Math.abs(chg)) * 1.15;
  const pct = (v: number) => 50 + (Math.max(-dom, Math.min(dom, v)) / dom) * 50;
  const bandL = pct(-deadband), bandR = pct(deadband);
  // Positions are rounded for the DOM: a 17-digit float in a style string is
  // noise in the markup and buys no precision the browser uses.
  const px2 = (n: number) => n.toFixed(2);
  return (
    <span className="pre-tc-axis">
      <span className="band" style={{ left: `${px2(bandL)}%`, width: `${px2(Math.max(0.6, bandR - bandL))}%` }} />
      <span className="zero" />
      <span className="mark" style={{ left: `calc(${px2(pct(chg))}% - 1.5px)`, background: toneHex(chg) }} />
    </span>
  );
}

/**
 * One card per leg. Sorted by the size of the vote the leg actually cast, so
 * the cards read as the engine's own priority order — the biggest influence on
 * the call is the first card — rather than as an alphabetical index.
 */
export function TapeCards({ legs }: { legs: OpeningLeg[] }) {
  const ordered = useMemo(
    () => [...legs].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
    [legs]
  );
  return (
    <div className="pre-tape">
      {ordered.map((l) => {
        const spec = LEG_BY_KEY[l.key];
        const st = legState(l);
        return (
          <div
            key={l.key}
            className={`pre-tape-card${l.priorOnly ? " shut" : ""}${l.tail ? " rejected" : ""}`}
            title={`${l.label} · ${GROUP_WHY[l.group]}`}
          >
            <div className="pre-tc-top">
              <span className="pre-tc-k">{l.short}</span>
              <span className="pre-tc-px">{l.last === null || l.last === undefined ? "—" : fprice(l.last, 2)}</span>
            </div>
            <div className="pre-tc-chg" style={{ color: toneHex(l.chg) }}>
              {l.chg === null ? (l.tail ? "REJECTED" : "NO TAPE") : f2(l.chg, "%")}
            </div>
            <TapeAxis chg={l.chg} deadband={spec?.deadband ?? 0.1} scale={spec?.scale ?? 1} />
            <div className="pre-tc-axis-legend">
              <span>−{spec?.scale.toFixed(1) ?? "—"}%</span>
              <span className="faint">DEADBAND SHADED</span>
              <span>+{spec?.scale.toFixed(1) ?? "—"}%</span>
            </div>
            <div className="pre-tc-foot">
              <span className={`pre-st ${st.cls}`}>{st.txt}</span>
              <span className={l.contribution === 0 ? "faint" : toneClass(l.contribution)}>
                CONTRIB {f3(l.contribution)}
              </span>
              <span>{spec?.invert ? "INVERTED" : l.priorOnly ? "SHUT" : "LIVE"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The target's own session path, drawn against its prior close. */
export function GapPathChart({ snap, height = 150 }: { snap: OpeningSnap; height?: number }) {
  const bars = (snap.intraday ?? []).filter((b) => isFinite(b.close));
  const prev = snap.index?.prevClose ?? null;
  const W = 320, H = height;
  const { hover, bind } = useHoverIndex(bars.length);
  if (bars.length < 2 || prev === null) {
    return (
      <p className="pre-empty">
        NO INTRADAY PATH YET ON THIS CLOCK — {snap.market?.label ?? "THIS MARKET"} OPENS{" "}
        {snap.market?.session.istWindow ?? "09:15 IST"}. GAP AND CONFIRM STAY DASHED UNTIL THEN.
      </p>
    );
  }
  const vals = bars.map((b) => b.close);
  const lo = Math.min(prev, ...vals), hi = Math.max(prev, ...vals);
  const pad = Math.max((hi - lo) * 0.18, hi * 0.0006);
  const y = (v: number) => (H - 14 - ((v - (lo - pad)) / (hi + pad - (lo - pad) || 1)) * (H - 26)).toFixed(1);
  const x = (i: number) => ((i / Math.max(bars.length - 1, 1)) * W).toFixed(1);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const hv = hover !== null ? vals[hover] : null;
  const last = vals[vals.length - 1]!;
  const up = last >= prev;
  const col = up ? "var(--green)" : "var(--red)";
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H }}
          role="img" tabIndex={0} {...bind}
          aria-label={`${snap.market?.label ?? "Index"} intraday path from ${fprice(prev)} to ${fprice(last)}`}
        >
          <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={up ? "color-mix(in srgb, var(--green) 12%, transparent)" : "color-mix(in srgb, var(--red) 12%, transparent)"} />
          <line x1="0" y1={y(prev)} x2={W} y2={y(prev)} stroke="var(--faint)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <line x1={x(0)} y1={y(bars[0]!.open)} x2={W} y2={y(bars[0]!.open)} stroke="rgba(255,176,0,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <polyline points={pts.join(" ")} fill="none" stroke={col} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
          {hover !== null && (
            <line x1={x(hover)} y1="0" x2={x(hover)} y2={H} stroke="var(--amber)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {hover !== null && hv !== null && (
          <HoverTip
            idx={hover} count={bars.length} date={`${bars[hover]!.time} IST`}
            rows={[
              { label: "CLOSE", color: col, text: fprice(hv, 2) },
              { label: "VS PRIOR", color: toneHex(hv - prev), text: f2(((hv - prev) / prev) * 100, "%") },
            ]}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }} className="faint">
        <span>{bars[0]!.time} OPEN {fprice(bars[0]!.open, 2)}</span>
        <span>PRIOR CLOSE {fprice(prev, 2)}</span>
        <span>{bars[bars.length - 1]!.time} {fprice(last, 2)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// intraday track — six hourly marks from now to the bell
// ---------------------------------------------------------------------------

export interface PathMarkWire {
  j: number; slot: number; ist: string; local: string; close: boolean;
  state: "PROJECTED" | "BEYOND_BELL" | "NO_SAMPLE";
  level: number | null; lo: number | null; hi: number | null;
  pctFromAnchor: number | null; pctFromPrior: number | null;
  pAbovePrior: number | null; pUp: number | null; n: number;
}
export interface PathWire {
  fetchedAtIST?: string;
  market: { key: string; label: string; symbol: string; venue: string; tz: string; openHHMM: string; closeHHMM: string };
  session: { state: string; label: string; istWindow: string; localWindow: string; toOpenMin: number | null };
  anchor: {
    level: number | null; prevClose: number | null; open: number | null; gapPct: number | null;
    barsSettled: number; barsForming: number; capacity: number;
  };
  marks: PathMarkWire[];
  bucket: { key: string; label: string; n: number; pooled: boolean; total: number; note: string };
  grade: {
    split: string; n: number; hitPct: number | null; maePct: number | null;
    baseHitPct: number | null; edgePts: number | null; verdict: string; note: string;
  } | null;
  sample: { sessions: number; capacity: number; windowFrom: string | null; windowTo: string | null; floor: number };
  realised: Array<{ ist: string; local: string; close: number; settled: boolean }>;
  summary: { marksPublished: number; markHours: number; verdict: string };
  caveats: string[];
}

/**
 * The projected track on one axis: what has printed today as a solid line, the
 * six marks as a dashed median inside its own p10/p90 fan, both struck against
 * the prior close. Slot index is the x, so the realised hours and the projected
 * hours occupy the same scale and the seam between them is a fact about the
 * session rather than an artefact of two charts stapled together.
 */
function TrackChart({ wire }: { wire: PathWire }) {
  const a = wire.anchor;
  const marks = wire.marks.filter((m) => m.state === "PROJECTED");
  const done = wire.realised.filter((b) => b.settled);
  const W = 340, H = 168, PL = 6, PR = 6, PT = 16, PB = 20;
  const cap = Math.max(1, a.capacity - 1);
  const xs = (slot: number) => (PL + (slot / cap) * (W - PL - PR)).toFixed(1);

  const vals: number[] = [];
  if (a.prevClose) vals.push(a.prevClose);
  if (a.level) vals.push(a.level);
  for (const b of wire.realised) vals.push(b.close);
  for (const m of marks) {
    for (const v of [m.level, m.lo, m.hi]) if (v !== null && isFinite(v)) vals.push(v);
  }
  if (vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, hi * 0.0004);
  const y0 = lo - pad, y1 = hi + pad;
  const ys = (v: number) => (PT + (1 - (v - y0) / (y1 - y0 || 1)) * (H - PT - PB)).toFixed(1);

  const seam = a.barsSettled;
  const real = done.map((b, i) => `${xs(Math.min(i, seam))},${ys(b.close)}`).join(" ");
  const fanTop = marks.map((m) => `${xs(m.slot!)},${ys(m.hi!)}`);
  const fanBot = marks.map((m) => `${xs(m.slot!)},${ys(m.lo!)}`).reverse();
  const line = marks.map((m) => `${xs(m.slot!)},${ys(m.level!)}`);
  const anchorX = xs(Math.min(seam, cap));
  const anchorY = a.level !== null ? ys(a.level) : null;

  return (
    <div className="pre-track-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H }}
        role="img"
        aria-label={`${wire.market.label} intraday track: ${done.length} settled hours printed, ${marks.length} hourly marks projected to the close`}
      >
        {a.prevClose !== null && (
          <line x1="0" y1={ys(a.prevClose)} x2={W} y2={ys(a.prevClose)} stroke="var(--faint)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        )}
        {marks.length > 1 && (
          <polygon points={`${anchorX},${anchorY ?? ys(a.level ?? 0)} ${fanTop.join(" ")} ${fanBot.join(" ")}`}
            fill="color-mix(in srgb, var(--amber) 10%, transparent)" stroke="color-mix(in srgb, var(--amber) 32%, transparent)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
        {real && <polyline points={real} fill="none" stroke="var(--text)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
        {anchorY !== null && (
          <line x1={anchorX} y1={anchorY} x2={marks[0] ? xs(marks[0].slot!) : anchorX} y2={marks[0] ? ys(marks[0].lo!) : anchorY}
            stroke="var(--sub)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        {line.length > 1 && <polyline points={line.join(" ")} fill="none" stroke="var(--amber)" strokeWidth="1.8" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />}
        {anchorY !== null && <circle cx={anchorX} cy={anchorY} r="3.5" fill="var(--bg)" stroke="var(--text)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />}
        {marks.map((m) => (
          <circle key={m.j} cx={xs(m.slot!)} cy={ys(m.level!)} r={m.close ? 4 : 2.6} fill={m.close ? "var(--amber)" : "var(--bg)"} stroke="var(--amber)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="pre-track-ax">
        <span>{wire.market.openHHMM} OPEN</span>
        {/* The prior-close rule is captioned in HTML, not in the SVG: this chart
            scales with `preserveAspectRatio="none"` so the plot stretches to
            fill the panel, and any <text> inside it is stretched with it. An
            8px caption in a stretched viewport renders as a smeared smear. */}
        <span>PRIOR CLOSE <b>{a.prevClose === null ? "—" : fprice(a.prevClose, 0)}</b></span>
        <span className="pos">PRINTED</span>
        <span className="amber">CONDITIONAL MEDIAN · p10–p90 FAN</span>
        <span>{wire.market.closeHHMM} CLOSE</span>
      </div>
    </div>
  );
}

/**
 * One card per hourly mark. The bar under the number is the fan drawn to the
 * scale of the whole day, so a 0.9% range on mark 1 and a 1.6% range on the close
 * are visibly different widths rather than both filling the cell.
 */
function TrackNode({ m, lo, hi }: { m: PathMarkWire; lo: number; hi: number }) {
  if (m.state !== "PROJECTED" || m.level === null) {
    return (
      <div className="pre-tn dead">
        <span className="pre-tn-t">{m.ist}</span>
        <span className="pre-tn-v">—</span>
        <span className="pre-tn-s">{m.state === "BEYOND_BELL" ? "PAST THE BELL" : "NO SAMPLE"}</span>
      </div>
    );
  }
  const span = hi - lo || 1;
  const at = (v: number) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const up = (m.pctFromPrior ?? 0) >= 0;
  return (
    <div className={`pre-tn${m.close ? " close" : ""}`}>
      <span className="pre-tn-t">{m.ist}<em>{m.local}</em></span>
      <span className={`pre-tn-v ${toneClass(m.pctFromPrior)}`}>{fprice(m.level, 1)}</span>
      <span className={`pre-tn-s ${up ? "pos" : "neg"}`}>{f2(m.pctFromPrior, "%")} VS PRIOR</span>
      <span className="pre-tn-bar" title={`p10 ${fprice(m.lo, 1)} — p90 ${fprice(m.hi, 1)}`}>
        <i style={{ left: `${at(m.lo!).toFixed(1)}%`, width: `${Math.max(1, at(m.hi!) - at(m.lo!)).toFixed(1)}%` }} />
        <b style={{ left: `${at(m.level).toFixed(1)}%` }} />
      </span>
      <span className="pre-tn-s">
        P&gt;PRIOR <b>{fpct((m.pAbovePrior ?? 0) * 100)}</b> · n {m.n}
      </span>
    </div>
  );
}

/**
 * The in-depth movement view. Six marks, one an hour, from where the session
 * actually is to the closing bell — conditioned on the same gap band the call
 * was made in, and graded out of sample against an always-up baseline so the
 * reader can see whether the median earned the right to be drawn at all.
 */
export function IntradayTrack({ market, onClose }: { market: string; onClose?: () => void }) {
  const [wire, setWire] = useState<PathWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setBusy(true);
    setError(null);
    fetch(`/api/opening/path?market=${encodeURIComponent(market)}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `PATH ${r.status}`);
        setWire(j as PathWire);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "PATH UNAVAILABLE");
      })
      .finally(() => { if (!ac.signal.aborted) setBusy(false); });
    return () => ac.abort();
  }, [market, nonce]);

  if (busy && !wire) {
    return (
      <div className="pre-card">
        <span className="pre-card-h">Intraday track · rebuilding the session sample</span>
        <div className="pre-load"><div className="pre-load-row w70" /><div className="pre-load-row" /><div className="pre-load-row w40" /></div>
        <p className="pre-foot">
          TWO YEARS OF HOURLY BARS ARE BEING REBUILT INTO SESSIONS ON THIS VENUE&apos;S OWN CALENDAR. THE CONDITIONAL
          DISTRIBUTION IS NOT AVAILABLE UNTIL EVERY SESSION HAS A PRIOR CLOSE TO MEASURE AGAINST.
        </p>
      </div>
    );
  }

  if (error || !wire) {
    return (
      <div className="pre-card" style={{ borderLeftColor: "var(--red)" }}>
        <span className="pre-card-h">Intraday track unavailable</span>
        <p className="pre-card-b">
          {error ?? "NO PATH PAYLOAD"} — THE TRACK NEEDS TWO YEARS OF HOURLY BARS ON THIS VENUE&apos;S OWN CLOCK. WITHOUT
          A SAMPLE THERE IS NO HONEST SIX-MARK PATH, SO NONE IS SHOWN.
        </p>
        <div><button className="ghost" onClick={() => setNonce((n) => n + 1)}>↻ Retry</button></div>
      </div>
    );
  }

  const a = wire.anchor;
  const g = wire.grade;
  const marks = wire.marks;
  const live = marks.filter((m) => m.state === "PROJECTED");
  const beyond = marks.filter((m) => m.state !== "PROJECTED").length;
  const spread = live.length
    ? (Math.max(...live.map((m) => m.pctFromAnchor ?? 0)) - Math.min(...live.map((m) => m.pctFromAnchor ?? 0)))
    : null;
  const vals = [
    ...(a.prevClose ? [a.prevClose] : []),
    ...(a.level ? [a.level] : []),
    ...wire.realised.map((b) => b.close),
    ...live.flatMap((m) => [m.level!, m.lo!, m.hi!]),
  ];
  const lo = vals.length ? Math.min(...vals) : 0;
  const hi = vals.length ? Math.max(...vals) : 1;
  const edgeTone = g?.edgePts === null || g === null ? "" : g.edgePts >= 5 ? "ok" : g.edgePts > 0 ? "fnc" : "bad";

  return (
    <>
      <div className="pre-cols">
        <div className="pre-card">
          <span className="pre-card-h">
            {wire.market.label} · {live.length} hourly marks to the {wire.market.closeHHMM} {wire.market.tz.split("/")[1]} bell
          </span>
          {live.length ? (
            <>
              <TrackChart wire={wire} />
              <div className="pre-tn-row">
                {marks.map((m) => <TrackNode key={m.j} m={m} lo={lo} hi={hi} />)}
              </div>
            </>
          ) : (
            <p className="pre-empty">
              NO MARKS LEFT TO PROJECT — {wire.market.label} IS {wire.session.label} ON THIS CLOCK AND ALL{" "}
              {a.capacity} HOURLY BARS OF THE SESSION HAVE SETTLED. THE TRACK IS PUBLISHED FOR THE HOURS AHEAD, NOT
              FOR HOURS ALREADY PRINTED.
            </p>
          )}
          <div className="pre-track-foot">
            <p className="pre-foot">
              ONE MARK AN HOUR FROM WHERE THE SESSION IS TO THE CLOSING PRINT. EACH MARK IS THE MEDIAN OF THE HISTORICAL
              MOVE OVER THAT HOUR, TAKEN ONLY FROM{" "}
              <b>{wire.bucket.pooled ? `ALL ${wire.bucket.total} SESSIONS` : `${wire.bucket.n} OF ${wire.bucket.total} SESSIONS`}</b>{" "}
              {wire.bucket.pooled ? "— THE GAP CONDITION IS NOT IN THE NUMBER" : "WHOSE OPEN GAP FELL IN TODAY'S BAND"}.
              THE BAR UNDER EACH LEVEL IS THAT MARK&apos;S OWN p10–p90 RANGE, DRAWN TO THE SCALE OF THE WHOLE DAY — READ
              THE BAR, NOT THE NUMBER: A {spread === null ? "—" : `${spread.toFixed(2)}%`} SPREAD BETWEEN THE FIRST AND
              LAST MARK IS THE HONEST WIDTH OF A DAY THAT CANNOT BE CALLED FROM HERE.
            </p>
            {beyond > 0 && (
              <p className="pre-warn">
                {beyond} OF {marks.length} MARKS FALL PAST THE {wire.market.closeHHMM} BELL AND ARE PUBLISHED AS DASHES.
                THE DESK DOES NOT EXTEND A SIX-HOUR TRACK BEYOND THE CLOSING PRINT TO FILL THE ROW.
              </p>
            )}
            {wire.bucket.note && <p className={wire.bucket.pooled ? "pre-warn" : "pre-note"}>{wire.bucket.note}</p>}
          </div>
        </div>

        <div className="pre-card">
          <span className="pre-card-h">How the track is anchored · and what it is worth</span>
          <div className="cells">
            <Cell lbl="Anchor" val={fprice(a.level, 1)} sub={a.level !== null && a.prevClose ? f2(((a.level / a.prevClose) - 1) * 100, "%") + " VS PRIOR" : "—"} cls={toneClass(a.level !== null && a.prevClose ? (a.level / a.prevClose - 1) * 100 : null)} />
            <Cell lbl="Condition" val={wire.bucket.key.replace("_", " ")} sub={`${wire.bucket.n} OF ${wire.bucket.total} SESSIONS`} cls={wire.bucket.pooled ? "neg" : ""} />
            <Cell lbl="Hours done" val={`${a.barsSettled}/${a.capacity}`} sub={a.barsForming ? `${a.barsForming} FORMING` : "ALL SETTLED"} />
            <Cell lbl="Open gap" val={f2(a.gapPct, "%")} sub={a.open !== null ? `OPEN ${fprice(a.open, 1)}` : "NOT OPENED"} cls={toneClass(a.gapPct)} />
            <Cell lbl="Sample" val={wire.sample.sessions.toLocaleString("en-IN")} sub={`${wire.sample.windowFrom ?? "—"} → ${wire.sample.windowTo ?? "—"}`} />
            <Cell lbl="Out-of-sample" val={g ? fpct(g.hitPct) : "—"} sub={g ? `${g.n.toLocaleString("en-IN")} SCORED MARKS` : "NOT GRADED"} cls={edgeTone === "ok" ? "pos" : edgeTone === "bad" ? "neg" : ""} />
          </div>

          {g ? (
            <>
              <div className="pre-meters">
                <Meter
                  label="Conditional median hit rate" value={(g.hitPct ?? 0) / 100} display={fpct(g.hitPct)}
                  tone={edgeTone === "ok" ? "ok" : edgeTone === "bad" ? "bad" : undefined}
                  tick={(g.baseHitPct ?? 0) / 100}
                  foot={`TICK = NAIVE "IT ALWAYS GOES UP" AT ${fpct(g.baseHitPct)} · EDGE ${g.edgePts === null ? "—" : f2(g.edgePts, " PTS")}`}
                />
                <Meter
                  label="Mark error (MAE)" value={Math.min(1, (g.maePct ?? 0) / 1)} display={`${g.maePct?.toFixed(2) ?? "—"}%`}
                  foot={`MEAN ABSOLUTE ERROR PER MARK, OUT OF SAMPLE`}
                />
              </div>
              <div className="pre-badge-row">
                <span className={`badge ${edgeTone}`}>{g.verdict}</span>
                <span className="badge">{g.split}</span>
              </div>
              <p className="pre-foot">
                {g.note} AN EDGE OF {g.edgePts === null ? "—" : g.edgePts.toFixed(2)} POINTS IS WHAT THE CONDITIONING
                BOUGHT OVER A COIN FLIP — READ IT BEFORE TRUSTING THE LINE.
              </p>
            </>
          ) : (
            <p className="pre-warn">
              NO GRADE — TOO FEW SESSIONS IN THE CONDITIONAL SAMPLE TO FIT ON ONE HALF AND SCORE ON THE OTHER. A DESK
              THAT CANNOT SCORE ITS OWN TRACK OUT OF SAMPLE SHOWS THE SHAPE WITHOUT A VERDICT.
            </p>
          )}

          <div className="pre-ledger">
            {(wire.caveats ?? []).map((c, i) => (
              <div key={i} className={`pre-led-row${SEVERE.test(c) ? " sev" : ""}`}>
                <span className="pre-led-dot" />
                <span>{c}</span>
              </div>
            ))}
            {!wire.caveats?.length && (
              <div className="pre-led-row"><span className="pre-led-dot" /><span>NO OPEN CAVEATS ON THIS TRACK.</span></div>
            )}
          </div>
          <p className="pre-foot">LOADED {wire.fetchedAtIST ?? "—"} · TRACK CONDITIONING IS INDEPENDENT OF THE GAP FORECAST — A FLAT PRE-OPEN VERDICT DOES NOT MEAN THE PATH IS FLAT, AND A GREEN VERDICT DOES NOT MOVE THESE MARKS.</p>
          {onClose && <div><button className="ghost" onClick={onClose}>▾ Hide track</button></div>}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 05 · breadth
// ---------------------------------------------------------------------------

const SEGMENTS: Array<[string, string]> = [
  ["NIFTY 50", "nifty50"], ["NIFTY BANK", "bank"], ["NIFTY IT", "it"],
  ["NIFTY PHARMA", "pharma"], ["NIFTY AUTO", "auto"], ["SENSEX", "sensex"],
  ["NIFTY 500", "n500"], ["MIDCAP 150", "midcap"], ["SMALLCAP 250", "smallcap"],
  ["TOTAL MKT", "total"],
];

export function BreadthBlock({ snap, search, setSearch, status, setStatus }: {
  snap: OpeningSnap;
  search: string; setSearch: (s: string) => void;
  status: string; setStatus: (s: string) => void;
}) {
  const b = snap.breadth;
  const m = snap.market;
  if (!b) {
    return (
      <div className="pre-card">
        <span className="pre-card-h">Breadth</span>
        <p className="pre-card-b">
          NSE ADVANCE/DECLINE FEED UNAVAILABLE. THE PRE-OPEN MODEL DOES NOT USE BREADTH, SO THE CALL STANDS — WHAT
          IS MISSING IS THE POST-BELL GRADE, NOT THE FORECAST.
        </p>
      </div>
    );
  }
  const activeKey = breadthKeyForTarget(
    OPENING_TARGETS.find((t) => t.key === (m?.key ?? DEFAULT_TARGET_KEY)) ?? OPENING_TARGETS[0]!
  );
  const total = Math.max(1, b.adv + b.dec + b.unc);
  const pctW = (n: number) => `${(n / total) * 100}%`;
  const rows = (b.rows ?? []).filter((r) => {
    if (search && !String(r.symbol).toUpperCase().includes(search.toUpperCase())) return false;
    if (status === "ADV" && r.status !== "Advance") return false;
    if (status === "DEC" && r.status !== "Decline") return false;
    if (status === "UNCH" && r.status !== "Unchanged") return false;
    return true;
  });
  const segs = SEGMENTS
    .map(([label, key]) => [label, key, (b.matrix?.[key] ?? [0, 0, 0]) as [number, number, number]] as const)
    .filter(([, , v]) => v[0] + v[1] + v[2] > 0);
  const gainers = b.gainers ?? [];
  const losers = b.losers ?? [];
  const gMax = Math.max(...gainers.map((r: any) => Math.abs(r.chgPct ?? 0)), 0.01);
  const lMax = Math.max(...losers.map((r: any) => Math.abs(r.chgPct ?? 0)), 0.01);

  return (
    <>
      <div className="pre-card">
        <span className="pre-card-h">
          {b.label ?? "NIFTY 50"} · {b.source === "NSE" ? "NSE OFFICIAL" : "YAHOO FALLBACK"} · ADVANCE / DECLINE
        </span>
        <div className="pre-ad">
          <div className="pre-ad-bar" role="img" aria-label={`${b.adv} advances, ${b.dec} declines, ${b.unc} unchanged`}>
            <span className="a" style={{ width: pctW(b.adv) }}>{b.adv || ""}</span>
            <span className="d" style={{ width: pctW(b.dec) }}>{b.dec || ""}</span>
            <span className="u" style={{ width: pctW(b.unc) }}>{b.unc || ""}</span>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span className="pre-note">NET <b className={toneClass(b.adv - b.dec)}>{b.adv - b.dec >= 0 ? "+" : ""}{(b.adv - b.dec).toLocaleString("en-IN")}</b></span>
            <span className="pre-note">BREADTH <b className={toneClass(b.pct)}>{f2(b.pct, "%")}</b></span>
            <span className="pre-note">NAMES <b>{total.toLocaleString("en-IN")}</b></span>
            <span className="pre-note">SESSION <b className={b.sessionFresh ? "pos" : "neg"}>{b.sessionFresh ? "TODAY · ADMISSIBLE" : "LAST SESSION · EXCLUDED FROM CALL"}</b></span>
          </div>
          {b.note && <p className={b.proxy ? "pre-warn" : "pre-note"}>{b.note}</p>}
        </div>
      </div>

      {segs.length > 0 && (
        <div className="pre-card">
          <span className="pre-card-h">Every segment NSE publishes · the selected one is marked</span>
          <div className="pre-heat">
            {segs.map(([label, key, v]) => {
              const net = v[0] - v[1];
              const t = v[0] + v[1] + v[2];
              const breadthPct = t ? ((v[0] - v[1]) / t) * 100 : 0;
              const mag = Math.abs(breadthPct);
              const tint = mag < 8 ? "" : `${breadthPct > 0 ? "up" : "down"}${mag >= 25 ? "-strong" : ""}`;
              return (
                <div
                  key={key}
                  className={`pre-heat-cell${tint ? ` t-${tint}` : ""}${key === activeKey ? " on" : ""}`}
                  title={`${label}: ${v[0]} advancing, ${v[1]} declining, ${v[2]} unchanged`}
                >
                  <span className="pre-heat-n">{label}</span>
                  <span className={`pre-heat-v ${toneClass(net)}`}>{net >= 0 ? "+" : ""}{net.toLocaleString("en-IN")}</span>
                  <span className="pre-heat-s">{t ? `${breadthPct >= 0 ? "+" : ""}${breadthPct.toFixed(1)}% · ${v[0]}▲ ${v[1]}▼` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(gainers.length > 0 || losers.length > 0) && (
        <div className="pre-cols even">
          {([["Top gainers", gainers, gMax], ["Top losers", losers, lMax]] as const).map(([title, list, max]) => (
            <div className="pre-card" key={title}>
              <span className="pre-card-h">{title} · NIFTY 500 constituents</span>
              <div className="pre-movers">
                {list.map((r: any) => (
                  <div className="pre-mover" key={r.symbol}>
                    <span className="sec">{r.symbol}</span>
                    <span className={r.chgPct >= 0 ? "pos" : "neg"} style={{ textAlign: "right" }}>
                      {f2(r.chgPct, "%")}
                    </span>
                    <span className="pre-mover-bar">
                      <i
                        className={r.chgPct >= 0 ? "pos" : "neg"}
                        style={{ width: `${Math.min(100, (Math.abs(r.chgPct) / max) * 100).toFixed(1)}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
              {rows.length === 0 && (
                <p className="pre-foot">
                  THE ONLY PER-NAME FEED NSE SERVES ON THIS ENDPOINT IS THE NIFTY 500 CONSTITUENT LIST — SO THESE ARE
                  THE BROAD MARKET&apos;S MOVERS WHENEVER THE SELECTED INDEX IS A NARROWER ONE. NOT THE SELECTED
                  INDEX&apos;S MOVERS.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="pre-card">
          <span className="pre-card-h">Breadth explorer · {rows.length} securities · {(b.universe ?? rows.length).toLocaleString("en-IN")} in the feed</span>
          <div className="pre-legs-tools" style={{ marginBottom: 8 }}>
            <input
              className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())}
              placeholder="SEARCH SYMBOL…" aria-label="Search securities"
              style={{ flex: 1, minWidth: 140 }}
            />
            {["ALL", "ADV", "DEC", "UNCH"].map((s) => (
              <button key={s} className={`pill${status === s ? " active" : ""}`} onClick={() => setStatus(s)} aria-pressed={status === s}>
                {s}
              </button>
            ))}
            <button className="ghost" onClick={() => downloadCSV(
              `opening-breadth-${m?.key ?? "nifty"}.csv`,
              ["SYMBOL", "LAST", "CHG_PCT", "VOLUME", "VALUE_CR", "STATUS"],
              rows.map((r: any) => [r.symbol, r.last, r.chgPct, r.volume, r.valueCr, r.status])
            )}>↓ CSV</button>
          </div>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>VAL ₹ CR</th><th style={{ textAlign: "right" }}>STATUS</th></tr></thead>
              <tbody>
                {rows.slice(0, 120).map((r: any) => (
                  <tr key={r.symbol}>
                    <td><span className="sec">{r.symbol}</span></td>
                    <td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                    <td style={{ textAlign: "right" }}><span className={toneClass(r.chgPct)}>{f2(r.chgPct)}</span></td>
                    <td style={{ textAlign: "right" }}>{r.volume ? r.volume.toLocaleString("en-IN") : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.valueCr ? r.valueCr.toLocaleString("en-IN") : "—"}</td>
                    <td style={{ textAlign: "right" }}><span className={r.status === "Advance" ? "pos" : r.status === "Decline" ? "neg" : ""}>{String(r.status).toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pre-foot">
            SHOWING {Math.min(120, rows.length)} OF {rows.length} · FOR STUDY ONLY, NOT ADVICE. THIS LIST IS THE
            NIFTY 500 CONSTITUENT FEED, SO IT IS THE BROAD MARKET&apos;S BREADTH WHENEVER THE SELECTED INDEX IS A
            NARROWER ONE — THE HEADLINE A/D ABOVE IS THE SELECTED INDEX&apos;S OWN SEGMENT.
          </p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 06 · confirmation — the post-bell grade, as a track, not a paragraph
// ---------------------------------------------------------------------------

/** The gap the wire did not publish — every field explicitly absent. */
const NO_GAP: GapWire = {
  open: null, prevClose: null, last: null,
  gapPct: null, livePct: null, retracePct: null, filled: null, flat: null,
};

export function ConfirmTimeline({ snap }: { snap: OpeningSnap }) {
  const c = snap.confirm;
  const g: GapWire = snap.gap ?? NO_GAP;
  if (!c || c.state === "NO_DATA") {
    return (
      <div className="pre-card">
        <span className="pre-card-h">In-session confirmation</span>
        <p className="pre-card-b">
          {c?.headline ?? `NO OPEN TAPE YET — ${snap.market?.label ?? "THIS MARKET"} HAS NOT OPENED ON THIS CLOCK, SO THERE IS NOTHING TO GRADE. THE FORECAST STANDS UNTOUCHED UNTIL THE BELL.`}
        </p>
        <p className="pre-foot">
          Breadth is deliberately kept OUT of the pre-open model: a historical 09:00 IST advance/decline snapshot is
          not reconstructable, so folding it in would make the live call unverifiable. It grades the gap after the
          fact instead.
        </p>
      </div>
    );
  }
  const forecast = snap.forecast?.expectedGapPct ?? null;
  // The four plotted points are all levels AGAINST PRIOR CLOSE, which is the
  // only axis they genuinely share. `retracePct` is a share of the OPEN price,
  // not of the prior close, so it is converted back to a level here — plotting
  // it raw would put the retrace point on a different axis from the other three
  // and quietly make the track look wrong.
  const retraceLevel =
    c.gapPct !== null && c.gapPct !== undefined && c.retracePct !== null && c.retracePct !== undefined
      ? c.gapPct * (1 - c.retracePct / 100)
      : null;
  const pts = [forecast, c.gapPct, retraceLevel, g.livePct ?? null];
  const finite = pts.filter((x): x is number => x !== null && isFinite(x));
  const dom = Math.max(0.4, ...finite.map((x) => Math.abs(x) * 1.2));
  const W = 300, H = 46;
  const X = [0.04, 0.34, 0.64, 0.94];
  const yRaw = (v: number) => H / 2 - (v / dom) * (H / 2 - 6);
  const y = (v: number) => yRaw(v).toFixed(1);
  const seg: Array<[number, number]> = [[0, 1], [1, 2], [2, 3]];
  const stateCls = c.state === "CONFIRMED" ? "ok" : c.state === "FADING" ? "bad" : "fnc";
  const node = (l: string, v: string, s: ReactNode, now?: boolean) => (
    <div className={`pre-tl-node${now ? " now" : ""}`}>
      <span className="pre-tl-l">{l}</span>
      <span className="pre-tl-v">{v}</span>
      <span className="pre-tl-s">{s}</span>
    </div>
  );
  return (
    <div className="pre-tl">
      <div className="pre-tl-track">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 46 }}
          role="img" aria-label={`All values against prior close: forecast ${f2(forecast)}%, open ${f2(c.gapPct)}%, after ${f2(c.retracePct)}% retraced ${f2(retraceLevel)}%, now ${f2(g.livePct)}%`}
        >
          <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="var(--grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {/* No <text> in this SVG on purpose: it scales with
              preserveAspectRatio="none", so a label inside it is stretched
              non-uniformly with the plot. The zero rule is captioned below in
              HTML instead, where it keeps its own type size and weight. */}
          {seg.map(([a, b]) => {
            const va = pts[a], vb = pts[b];
            if (va === null || vb === null || !isFinite(va) || !isFinite(vb)) return null;
            return <line key={`${a}-${b}`} x1={(X[a]! * W).toFixed(1)} y1={y(va)} x2={(X[b]! * W).toFixed(1)} y2={y(vb)} stroke={toneHex(vb)} strokeWidth="2" vectorEffect="non-scaling-stroke" />;
          })}
          {pts.map((v, i) =>
            v === null || !isFinite(v) ? null : (
              <circle key={i} cx={(X[i]! * W).toFixed(1)} cy={y(v)} r={i === 0 ? 3 : 4} fill={i === 0 ? "var(--bg)" : toneHex(v)} stroke={toneHex(v)} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )
          )}
        </svg>
        <div className="pre-tl-zero">
          <span>PRIOR CLOSE = 0.00% · ALL FOUR MARKS ARE LEVELS AGAINST IT</span>
          <span className="faint">{fprice(snap.index?.prevClose ?? null)}</span>
        </div>
      </div>
      <div className="pre-tl-nodes">
        {node("Forecast", f2(forecast, "%"), "PUBLISHED BEFORE THE BELL")}
        {node("Open", f2(c.gapPct, "%"), c.gapPct !== null && Math.abs(c.gapPct) > FLAT_BAND_PCT ? "REALISED GAP" : "INSIDE NO-EDGE BAND")}
        {node("After retrace", f2(retraceLevel, "%"), `${f2(c.retracePct, "%")} GIVEN BACK · ${c.filled ? "GAP FILLED" : c.filled === false ? "GAP HOLDING" : "—"}`)}
        {node("Now", f2(g.livePct, "%"), <span className={`badge ${stateCls}`}>{c.state}</span>, true)}
      </div>
      <p className="pre-note">
        <strong className={VERDICT_CLS[c.verdict]}>{c.headline}</strong> · FORECAST ERROR{" "}
        {c.forecastErrPct === null || c.forecastErrPct === undefined ? "—" : f2(c.forecastErrPct, "%")}{" "}
        {c.forecastErrPts === null || c.forecastErrPts === undefined ? "" : `(${fpts(c.forecastErrPts)})`} · BREADTH{" "}
        {f2(c.breadthPct, "%")} {snap.breadth?.sessionFresh ? "THIS SESSION" : "LAST SESSION"} · THE PRE-OPEN CALL
        IS <strong>{snap.predict?.verdict ?? "—"}</strong> AND THIS PANEL DOES NOT REWRITE IT.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 07 · position spec — where the money goes, and what would kill it
// ---------------------------------------------------------------------------

export function PositionSpec({ snap }: { snap: OpeningSnap }) {
  const p = snap.predict;
  const m = snap.market;
  const i = snap.index ?? {};
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const v: Verdict = p?.verdict ?? "NO_DATA";
  const prev = i.prevClose ?? null;
  const egapPts = snap.forecast?.expectedGapPts ?? null;
  const sigmaPct = gapBand(p?.regime ?? null).residSd;
  const sigmaPts = prev ? (sigmaPct / 100) * prev : null;
  const act = tapeCheck
    ? { head: "NOTHING TO TAKE FROM THIS DESK", body: `${m?.label ?? "This market"} is shown, not called. The desk publishes no gap, no probability and no position for another venue's open — so the honest answer to where the money goes is nowhere, until a model measured on that market exists. The overnight read above is the Indian session's.` }
    : ACTION_BY_VERDICT[v];

  const cards: Array<{ l: string; v: ReactNode; warn?: boolean }> = [
    { l: "The position", v: <><strong>{act.head}</strong><br />{act.body}</> },
    { l: "Instrument", v: m?.instrument ?? "—" },
    {
      l: "Size against",
      v: tapeCheck
        ? "Nothing to size — there is no forecast for this market, so there is no expected move to be wrong by. The Indian session's own error scale is on the deduction panel and is not this market's."
        : sigmaPts === null
          ? "No residual published — nothing to size against."
          : `σ ${sigmaPct.toFixed(2)}% = ${sigmaPts.toFixed(0)} pts on ${prev?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"}. The forecast gap is ${egapPts === null ? "—" : fpts(egapPts)}, so the expected move is ${sigmaPts > 0 && egapPts !== null ? `${(Math.abs(egapPts) / sigmaPts).toFixed(2)}×` : "—"} the size of the error bar. Size so 1σ of forecast error is your pre-agreed risk, not so the call is "right". Contract quantities need your broker's current lot size — the desk does not publish one, because lot sizes change.`,
    },
    {
      l: "Invalidation",
      v: tapeCheck
        ? "Not applicable — there is no position to invalidate. The rule the desk applies to its own published gaps: dead once the gap fills back through the prior close, or retraces more than 45% on adverse breadth."
        : "Dead once the gap fills back through the prior close, or once it retraces more than 45% on adverse breadth — the exact rule the in-session confirm model runs, shown live in the confirmation section. A call that fills its gap is not slightly wrong; it is not a gap any more.",
    },
    { l: "What moves it here", v: m?.read ?? "—" },
    {
      l: "Not covered",
      v: <>The move after the open · intraday trend · earnings, results and scheduled event risk · liquidity and gap risk in a thin tape · the legs that did not report (see the data ledger){tapeCheck ? " · and the open itself: this market is a tape check, not a call" : ""}</>,
    },
    {
      l: "Calibration",
      warn: !m?.calibrated,
      v: m?.calibrated
        ? "Fitted on this index — walk-forward out-of-sample, every fold scored only on strictly later sessions."
        : tapeCheck
          ? `Not fitted. The band, the gate and the leg windows are the NIFTY 50 desk's.${m?.legOverlap ? ` This index is also the \`${m.legOverlap}\` leg, so the overnight read is not independent of it.` : ""}`
          : "Not fitted on this index. The direction is a transfer of a NIFTY 50 measurement; the magnitude is not measured here and is not claimed as one.",
    },
  ];

  return (
    <>
      <div className="pre-spec">
        {cards.map((c) => (
          <div key={c.l} className={`pre-spec-card${c.warn ? " warn" : ""}`}>
            <span className="pre-spec-l">{c.l}</span>
            <span className="pre-spec-v">{c.v}</span>
          </div>
        ))}
      </div>
      <p className="pre-foot" style={{ marginTop: 8 }}>
        THIS IS A GAP FORECAST AND A MEASURE OF ITS OWN ERROR — NOT A RECOMMENDATION AND NOT A RISK PROFILE. FOR
        STUDY AND EDUCATION ONLY. THE DESK RUNS ON PUBLIC PRICE TAPE AND A FITTED WEIGHT SET: IT HAS NO VIEW ON YOUR
        CIRCUMSTANCES, AND IT IS NOT A SUBSTITUTE FOR ONE.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 08 · data ledger — every honest debt, the capture grid, the local log
// ---------------------------------------------------------------------------

const SEVERE = /NO TAPE|NO VOTE|TAPE OFF|PARTIAL|BELOW FLOOR|UNAVAILABLE|NOT IN THE FEED|OFF —|PROXY|NO CALL PUBLISHED/;

/** The local capture ledger. Never leaves the browser. */
export const CAPTURE_KEY = "iss.opening.log";

/** Remembers whether the reader wants the in-depth intraday track open. */
export const TRACK_KEY = "iss.opening.track";

export function readCaptureLog(): any[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CAPTURE_KEY);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/**
 * Record the call as it stood at this slot. Returns the new row count, or -1 if
 * the browser refused the write (quota/private mode) — the caller says so
 * rather than pretending it worked.
 */
export function captureSlot(snap: OpeningSnap): number {
  if (typeof window === "undefined") return -1;
  const rows = readCaptureLog();
  const next = [
    ...rows.slice(-499),
    {
      at: snap.fetchedAtIST,
      slot: snap.currentSlot,
      phase: snap.phase,
      market: snap.market?.key ?? DEFAULT_TARGET_KEY,
      edge: snap.predict?.edge ?? null,
      verdict: snap.predict?.verdict ?? null,
      prob: snap.predict?.probUp ?? null,
      coverage: snap.predict?.coverage ?? null,
      regime: snap.predict?.regime ?? null,
      conflict: snap.predict?.conflict ?? null,
      last: snap.index?.last ?? null,
      gap: snap.gap?.gapPct ?? null,
      egap: snap.forecast?.expectedGapPct ?? null,
    },
  ];
  try {
    window.localStorage.setItem(CAPTURE_KEY, JSON.stringify(next));
    return next.length;
  } catch {
    return -1;
  }
}

function CaptureLog({ rows, onLog }: { rows: any[]; onLog?: () => void }) {
  const recent = useMemo(() => rows.slice(-12).reverse(), [rows]);
  return (
    <div className="pre-card">
      <span className="pre-card-h">Captured slots · {rows.length} stored locally</span>
      <div className="pre-legs-tools" style={{ marginBottom: 8 }}>
        {onLog && <button className="ghost" onClick={onLog}>⌸ Log this slot</button>}
        <span className="pre-rail-label" style={{ marginLeft: "auto" }}>LOCAL STORAGE ONLY · NEVER SENT ANYWHERE</span>
      </div>
      {!recent.length ? (
        <p className="pre-empty">
          NO SNAPSHOTS LOGGED YET — USE ⌸ LOG THIS SLOT TO RECORD THE CALL AT EACH SLOT, THEN COMPARE THE LOGGED
          CALLS AGAINST THE REALISED GAPS HERE.
        </p>
      ) : (
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th>When</th><th>Slot</th><th>Market</th><th style={{ textAlign: "right" }}>Edge</th><th>Call</th><th style={{ textAlign: "right" }}>P(up)</th><th style={{ textAlign: "right" }}>Gap %</th><th style={{ textAlign: "right" }}>Index last</th></tr></thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td className="faint" style={{ fontSize: 11 }}>{r.at ?? "—"}</td>
                  <td>{r.slot ?? "—"}</td>
                  <td className="sec">{r.market ?? "NIFTY"}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(r.edge)}>{r.edge === null || r.edge === undefined ? "—" : f2(r.edge)}</td>
                  <td><span className={`badge ${r.verdict === "GREEN" ? "ok" : r.verdict === "RED" ? "bad" : "fnc"}`}>{r.verdict ?? "—"}</span></td>
                  <td style={{ textAlign: "right" }}>{r.prob !== null && r.prob !== undefined ? `${(r.prob * 100).toFixed(0)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(r.gap)}>{f2(r.gap)}</td>
                  <td style={{ textAlign: "right" }}>{fprice(r.last ?? r.nifty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DataLedger({ snap, logRows, onLog }: {
  snap: OpeningSnap; logRows: any[]; onLog?: () => void;
}) {
  const list = snap.caveats ?? [];
  return (
    <>
      <div className="pre-card">
        <span className="pre-card-h">Data caveats · {list.length} open</span>
        {!list.length ? (
          <p className="pre-card-b">
            NONE — every leg reported inside its deadband and age limits, and coverage cleared the floor. An empty
            ledger is a result, not an absence of one.
          </p>
        ) : (
          <div className="pre-ledger">
            {list.map((c, i) => (
              <div key={i} className={`pre-led-row${SEVERE.test(c) ? " sev" : ""}`}>
                <span className="pre-led-dot" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pre-card">
        <span className="pre-card-h">Capture grid · {snap.currentSlot ?? "—"} is the current slot</span>
        <div className="pre-slots">
          {(snap.slots ?? []).map((s) => {
            const now = s === snap.currentSlot;
            const past = !!snap.currentSlot && s < snap.currentSlot;
            return <span key={s} className={`pre-slot${now ? " on" : past ? " past" : ""}`}>{now ? `▶ ${s}` : s}</span>;
          })}
        </div>
        <p className="pre-foot">
          THE SLOT GRID IS THE PUBLISH SCHEDULE, NOT A TIMER: THE CALL IS STRUCK AT 09:00 IST AND EVERY SLOT AFTER
          IT IS A FRESH READ OF THE SAME OVERNIGHT TAPE, USED TO GRADE THE CALL YOU ALREADY MADE.
        </p>
      </div>

      <CaptureLog rows={logRows} onLog={onLog} />
    </>
  );
}

// ---------------------------------------------------------------------------
// section rail — move around the desk
// ---------------------------------------------------------------------------

export type Density = "full" | "compact";

interface NavEntry { id: string; label: string; status: string; key?: string }

export function buildSections(snap: OpeningSnap, filter: LegGroup | null): NavEntry[] {
  const p = snap.predict;
  const m = snap.market;
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const v: Verdict = p?.verdict ?? "NO_DATA";
  const legs = p?.legs ?? [];
  const liveLegs = legs.filter((l) => l.vote !== null && !l.priorOnly).length;
  const groups = GROUP_ORDER.filter((g) => !!p?.groups?.[g]?.edge && p!.groups[g]!.edge !== null);
  const breadth = snap.breadth;
  const out: NavEntry[] = [
    { id: "call", label: "Call", status: tapeCheck ? "NO CALL" : VERDICT_TEXT[v], key: "1" },
    { id: "deduction", label: "Deduction", status: "7 STEPS", key: "2" },
    { id: "legs", label: "Legs", status: `${p?.legsUsed ?? 0}/${p?.legCount ?? 0}`, key: "3" },
    { id: "factors", label: "Factors", status: filter ?? (groups[0] ?? "—"), key: "4" },
    { id: "tape", label: "Tape", status: `${liveLegs} LIVE`, key: "5" },
  ];
  if (!tapeCheck) {
    out.push({ id: "breadth", label: "Breadth", status: breadth ? f2(breadth.pct, "%") : "NO FEED", key: "6" });
    out.push({ id: "confirm", label: "Confirm", status: snap.confirm?.state ?? "PRE-BELL", key: "7" });
  }
  out.push({ id: "position", label: "Position", status: tapeCheck ? "TAPE CHECK" : ACTION_BY_VERDICT[v].short, key: "8" });
  out.push({ id: "ledger", label: "Ledger", status: `${(snap.caveats ?? []).length} CAVEATS`, key: "9" });
  return out;
}

export function SectionRail({ sections, active, onJump }: {
  sections: NavEntry[]; active: string; onJump: (id: string) => void;
}) {
  return (
    <nav className="pre-nav" aria-label="Desk sections">
      {sections.map((s, i) => (
        <button
          key={s.id}
          className={`pre-nav-btn${active === s.id ? " on" : ""}`}
          onClick={() => onJump(s.id)}
          aria-current={active === s.id ? "true" : undefined}
          title={`${s.label} — ${s.status}`}
        >
          <span className="n">{String(i + 1).padStart(2, "0")}</span>
          <span>{s.label}</span>
          <span className="st">{s.status}</span>
        </button>
      ))}
    </nav>
  );
}

/** Nearest scrollable ancestor — the page scrolls the document, a panel scrolls its body. */
function scrollParent(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const st = getComputedStyle(node);
    if (/(auto|scroll)/.test(st.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
    node = node.parentElement;
  }
  return window;
}

function useScrollSpy(ref: RefObject<HTMLElement | null>, ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? "call");
  const key = ids.join("|");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const list = key.split("|").filter(Boolean);
    if (!list.length) return;
    const scroller = scrollParent(el);
    // The measuring line is the BOTTOM of the rail itself, not a guessed
    // constant: the rail is sticky in some surfaces and static in others, and a
    // fixed offset highlights the wrong section in one of them.
    const line = () => {
      const rail = el.querySelector(".pre-nav");
      const r = rail instanceof HTMLElement ? rail.getBoundingClientRect() : null;
      return (r ? r.bottom : 96) + 12;
    };
    const onScroll = () => {
      const top = line();
      let cur = list[0]!;
      for (const id of list) {
        const node = el.querySelector(`[data-sec="${id}"]`);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= top) cur = id;
      }
      setActive((prev) => (prev === cur ? prev : cur));
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const t = window.setInterval(onScroll, 700);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearInterval(t);
    };
  }, [ref, key]);
  return active;
}

// ---------------------------------------------------------------------------
// the desk
// ---------------------------------------------------------------------------

export interface DeskLiveProps {
  snap: OpeningSnap | null;
  board: BoardWire | null;
  market: string;
  /** Optional so the desk can be rendered read-only (preview, embed, test). */
  onMarket?: (key: string) => void;
  density?: Density;
  loading?: boolean;
  error?: string;
  busy?: boolean;
  onRefresh?: () => void;
  onRetry?: () => void;
  onLog?: () => void;
  logRows?: any[];
  extraTop?: ReactNode;
  extraBottom?: ReactNode;
}

export function DeskLive(props: DeskLiveProps) {
  const {
    snap, board, market, onMarket, density = "full", loading, error, busy,
    onRefresh, onRetry, onLog, logRows = [], extraTop, extraBottom,
  } = props;
  const shell = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<LegGroup | null>(null);
  const [votingOnly, setVotingOnly] = useState(false);
  const [openLeg, setOpenLeg] = useState<string | null>(null);
  const [bSearch, setBSearch] = useState("");
  const [bStatus, setBStatus] = useState("ALL");
  // The in-depth intraday track is an OPTION, not a default panel: it costs a
  // two-year hourly rebuild, so it is fetched only once switched on. The choice
  // is remembered because a reader who wants it usually wants it on every visit.
  const [track, setTrack] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(TRACK_KEY) === "1") setTrack(true);
    } catch {
      /* private mode — the toggle still works, it just will not be remembered */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(TRACK_KEY, track ? "1" : "0");
    } catch {
      /* nothing to do: the desk works without the preference */
    }
  }, [track]);

  // The rail is presentational without a handler (read-only render), so it
  // degrades to a no-op instead of throwing.
  const choose = useCallback((key: string) => onMarket?.(key), [onMarket]);

  const sections = useMemo(() => (snap ? buildSections(snap, filter) : []), [snap, filter]);
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  const active = useScrollSpy(shell, ids);

  const jump = useCallback((id: string) => {
    const node = shell.current?.querySelector(`[data-sec="${id}"]`);
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Desk keyboard: digits jump sections, M cycles the market in the current
  // group, R refreshes, T toggles the intraday track. Never while typing in a
  // field or holding a modifier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (!snap) return;
      const digit = e.key >= "1" && e.key <= "9" ? Number(e.key) : 0;
      if (digit > 0) {
        const entry = sections[digit - 1];
        if (entry) { e.preventDefault(); jump(entry.id); }
        return;
      }
      if (e.key === "m" || e.key === "M") {
        const list = (board?.rows ?? []).filter((r) => r.key === market);
        const group = list[0]?.group ?? "INDIA";
        const peers = (board?.rows ?? []).filter((r) => r.group === group);
        if (peers.length > 1 && choose) {
          e.preventDefault();
          const i = peers.findIndex((r) => r.key === market);
          choose(peers[(i + 1) % peers.length]!.key);
        }
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setTrack((v) => !v);
        return;
      }
      if (e.key === "r" || e.key === "R") {
        if (onRefresh) { e.preventDefault(); onRefresh(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sections, jump, board, market, choose, onRefresh, snap]);

  if (!snap) {
    // With no snapshot there is no desk to show, so the error IS the page — and
    // the rail is still rendered above it, because the markets that ARE
    // readable are worth knowing about even when one of them is not.
    if (error) {
      return (
        <div className="pre-shell">
          {board && board.rows.length > 0 && (
            <MarketRail rows={board.rows} value={market} onChange={choose} />
          )}
          <div className="pre-card" style={{ borderLeftColor: "var(--red)" }}>
            <span className="pre-card-h">Desk unavailable</span>
            <p className="pre-card-b">
              {error} — NO SNAPSHOT FOR {market}, SO THERE IS NO CALL, NO FORECAST AND NO DEDUCTION TO SHOW. TRY
              ANOTHER MARKET ON THE RAIL, OR RETRY.
            </p>
            {onRetry && <div><button className="btn" onClick={onRetry}>↻ Retry</button></div>}
          </div>
        </div>
      );
    }
    return <DeskSkeleton density={density} rows={board?.rows ?? []} market={market} onMarket={choose} />;
  }

  const p = snap.predict;
  const m = snap.market;
  const tapeCheck = m?.mode === "TAPE_CHECK";
  const small = density === "compact";
  const sectionsToRender = (id: string) => sections.some((s) => s.id === id);

  return (
    <div className="pre-shell" ref={shell}>
      {board && board.rows.length > 0 && (
        <MarketRail rows={board.rows} value={market} onChange={choose} note={loading ? "REFRESHING…" : undefined} />
      )}

      <Masthead
        snap={snap} board={board} density={density}
        actions={{ refresh: onRefresh, log: onLog, busy }}
      />

      <SectionRail sections={sections} active={active} onJump={jump} />

      {extraTop}

      {error && snap && (
        <div className="pre-card" style={{ borderLeftColor: "var(--red)" }}>
          <span className="pre-card-h">Stale read</span>
          <p className="pre-card-b">
            THE LAST FETCH FAILED — {error} — SO EVERYTHING BELOW IS THE PREVIOUS TAPE, NOT A FRESH ONE. THE LOAD
            STAMP IN THE MASTHEAD IS THE TRUTH ON HOW OLD IT IS.
          </p>
          {onRetry && <div><button className="ghost" onClick={onRetry}>↻ Retry now</button></div>}
        </div>
      )}

      {sectionsToRender("call") && (
        <Section id="call">
          <SectionHead
            title="The call"
            meta={`${snap.target ?? ""}`}
          />
          <DecisionPanel snap={snap} density={density} />
          {m && (
            <div className="pre-cols even">
              <div className="pre-card">
                <span className="pre-card-h">What this index is</span>
                <p className="pre-card-b">{m.profile}</p>
                <p className="pre-foot">VENUE {m.venue} · {m.symbol} · SESSION {m.session.localWindow} ({m.session.istWindow}) · BREADTH FEED {m.breadthIndex ?? "NONE"}</p>
              </div>
              <div className="pre-card accent">
                <span className="pre-card-h">Read it here</span>
                <p className="pre-card-b">{m.read}</p>
                <p className="pre-foot">
                  {m.calibrated
                    ? "THIS INDEX IS WHERE THE BAND AND GATE WERE FITTED — THE MAGNITUDE BELOW IS A MEASUREMENT, NOT A TRANSFER."
                    : tapeCheck
                      ? "NO CALL IS PUBLISHED FOR THIS MARKET. WHAT IS SHOWN IS ITS OWN TAPE WITH THE INDIAN-SESSION READ ATTACHED."
                      : "DIRECTION IS A TRANSFER OF A NIFTY 50 MEASUREMENT. THE MAGNITUDE IS NOT MEASURED HERE AND IS NOT CLAIMED AS ONE."}
                </p>
              </div>
            </div>
          )}
        </Section>
      )}

      {sectionsToRender("deduction") && (
        <Section id="deduction">
          <SectionHead title="How the call was deduced" meta="SEVEN STEPS · THIS MORNING'S NUMBERS" />
          <div className="pre-card">
            <DeductionSteps snap={snap} />
          </div>
        </Section>
      )}

      {p && sectionsToRender("legs") && (
        <Section id="legs">
          <SectionHead title="Leg build" meta={`${p.legsUsed}/${p.legCount} REPORTING · COVERAGE ${fpct(p.coverage * 100)}`} />
          <div className="pre-card">
            <LegTable
              score={p} filter={filter} setFilter={setFilter}
              votingOnly={votingOnly} setVotingOnly={setVotingOnly}
              openKey={openLeg} setOpenKey={setOpenLeg}
            />
          </div>
        </Section>
      )}

      {p && sectionsToRender("factors") && (
        <Section id="factors">
          <SectionHead title="Factor origin" meta="WHERE THE CONVICTION COMES FROM" />
          <div className="pre-card">
            <FactorOrigin score={p} filter={filter} setFilter={setFilter} />
          </div>
        </Section>
      )}

      {p && sectionsToRender("tape") && (
        <Section id="tape">
          <SectionHead title="Overnight tape" meta="ONE CARD PER LEG · AXIS SHOWS DEADBAND TO SATURATION" />
          <div className="pre-cols">
            <div className="pre-card">
              <TapeCards legs={p.legs} />
              <p className="pre-foot" style={{ marginTop: 8 }}>
                EACH LEG IS READ ONLY INSIDE ITS OWN MARKET&apos;S TRADING HOURS. THE 24H INSTRUMENTS AND THE THREE
                ASIAN INDICES ARE READ LIVE MID-SESSION; THE US CASH LEGS ARE SHUT AT THE BELL, SO THEY CONTRIBUTE
                THE LAST COMPLETED US SESSION — THE FRESHEST US PRINT AVAILABLE AT 08:45 IST, NOT A STALE ONE. THE
                SHADED BAND ON EACH AXIS IS THAT LEG&apos;S DEADBAND: A MOVE INSIDE IT VOTES ZERO.
              </p>
            </div>
            <div className="pre-card">
              <span className="pre-card-h">{m?.label ?? "Index"} · session path vs prior close</span>
              <GapPathChart snap={snap} height={small ? 120 : 160} />
              <div className="cells" style={{ marginTop: 8 }}>
                <Cell lbl="Last" val={fprice(snap.index?.last, 2)} sub={f2(snap.index?.chg, "%")} cls={toneClass(snap.index?.chg)} />
                <Cell lbl="Open" val={fprice(snap.index?.open, 2)} sub={m?.session.istWindow ?? "—"} />
                <Cell lbl="High" val={fprice(snap.index?.high, 2)} sub="SESSION" />
                <Cell lbl="Low" val={fprice(snap.index?.low, 2)} sub="SESSION" />
                <Cell lbl="Range" val={snap.index?.range != null ? fprice(snap.index.range, 2) : "—"} sub="PTS" />
                <Cell lbl="Open gap" val={f2(snap.gap?.gapPct ?? null, "%")} sub="VS PRIOR CLOSE" cls={toneClass(snap.gap?.gapPct)} />
              </div>
              <div className="pre-legs-tools" style={{ marginTop: 8 }}>
                <button
                  className={`pill${track ? " active" : ""}`}
                  onClick={() => setTrack(!track)}
                  aria-pressed={track}
                  title="Six hourly marks from now to the closing bell, conditioned on past sessions in today's gap band"
                >
                  {track ? "▣ Intraday track ON" : "▢ Intraday track · 6 marks to the bell"}
                </button>
                <span className="pre-rail-label" style={{ marginLeft: "auto" }}>
                  {track ? "IN-DEPTH MOVEMENT" : "PRESS T"}
                </span>
              </div>
            </div>
          </div>
          {track && <IntradayTrack market={market} onClose={() => setTrack(false)} />}
        </Section>
      )}

      {sectionsToRender("breadth") && (
        <Section id="breadth">
          <SectionHead title="Breadth" meta={snap.breadth ? `${snap.breadth.label ?? ""} · ${snap.breadth.source}` : "NO FEED"} />
          <BreadthBlock snap={snap} search={bSearch} setSearch={setBSearch} status={bStatus} setStatus={setBStatus} />
        </Section>
      )}

      {sectionsToRender("confirm") && (
        <Section id="confirm">
          <SectionHead title="In-session confirmation" meta="OBSERVATION, NOT A FORECAST" />
          <div className="pre-card">
            <ConfirmTimeline snap={snap} />
          </div>
        </Section>
      )}

      {sectionsToRender("position") && (
        <Section id="position">
          <SectionHead title="Where the money goes" meta="THE POSITION, AND WHAT WOULD KILL IT" />
          <PositionSpec snap={snap} />
        </Section>
      )}

      {sectionsToRender("ledger") && (
        <Section id="ledger">
          <SectionHead title="Data ledger" meta="EVERY OPEN DEBT, IN ONE PLACE" />
          <div className="pre-cols">
            <DataLedger snap={snap} logRows={logRows} onLog={onLog} />
            <div className="pre-card">
              <span className="pre-card-h">Model provenance</span>
              <p className="pre-card-b">
                {snap.model ? (
                  <>
                    {snap.model.sessions} SESSIONS ({snap.model.sample}). {snap.model.method}.
                  </>
                ) : "—"}
              </p>
              <p className="pre-foot">{snap.model?.validation ?? ""}</p>
              <div className="pre-meters" style={{ marginTop: 8 }}>
                <Meter label="OOS sign agreement" value={(snap.model?.oosSignAgreement ?? 0) / 100} display={fpct(snap.model?.oosSignAgreement ?? null, "%")} tone="ok" foot={`BENCHMARK ${fpct(snap.model?.oosBenchmark ?? null, "%")}`} />
                <Meter label="OOS directional precision" value={(snap.model?.oosPrecision ?? 0) / 100} display={fpct(snap.model?.oosPrecision ?? null, "%")} tone="ok" foot={`MEAN-GAP SPREAD ${fpct(snap.model?.oosSpreadPct ?? null, "%")}`} />
                <Meter label="OOS RMSE gain" value={Math.min(1, (snap.model?.oosRmseGainPct ?? 0) / 25)} display={fpct(snap.model?.oosRmseGainPct ?? null, "%")} foot="VS THE UNCONDITIONAL BASE RATE" />
                <Meter
                label="OOS Brier score" value={snap.model?.oosBrier ?? null}
                display={f2(snap.model?.oosBrier ?? null, "")}
                tone={(snap.model?.oosBrier ?? 1) <= 0.21 ? "ok" : "bad"}
                foot="0.20 = A COIN FLIP ON A DICHOTOMOUS OUTCOME"
              />
              </div>
              <p className="pre-foot" style={{ marginTop: 8 }}>{snap.model?.ensembleNote ?? ""}</p>
            </div>
          </div>
        </Section>
      )}

      {extraBottom}

      <div className="pre-hintbar">
        <span><kbd>1</kbd>–<kbd>9</kbd> jump to a section</span>
        <span><kbd>M</kbd> next market in the group</span>
        <span><kbd>T</kbd> intraday track</span>
        <span><kbd>R</kbd> refresh the tape</span>
        <span>·</span>
        <span>FOR STUDY AND EDUCATION ONLY · NOT INVESTMENT ADVICE</span>
      </div>
    </div>
  );
}

export function DeskSkeleton({ density, rows, market, onMarket }: {
  density: Density; rows: BoardRow[]; market: string; onMarket: (k: string) => void;
}) {
  return (
    <div className="pre-shell">
      {rows.length ? <MarketRail rows={rows} value={market} onChange={onMarket} note="LOADING…" /> : null}
      <div className="pre-card">
        <div className="pre-load">
          <div className="pre-load-row w40" />
          <div className="pre-load-row w70" />
          <div className="pre-load-row" />
        </div>
      </div>
      <div className="pre-card">
        <span className="pre-card-h">Pulling the overnight tape, the Asia open and the selected market…</span>
        <div className="pre-load" style={{ marginTop: 8 }}>
          <div className="pre-load-row w70" />
          <div className="pre-load-row" />
          <div className="pre-load-row w40" />
        </div>
      </div>
      {density === "full" && (
        <p className="pre-foot">
          FIFTEEN OVERNIGHT LEGS ARE BEING READ IN PARALLEL, EACH INSIDE ITS OWN MARKET&apos;S TRADING HOURS, PLUS
          THIS MARKET&apos;S OWN SESSION TAPE.
        </p>
      )}
    </div>
  );
}