"use client";

// Module 109 / FNC PRE — Pre-Market Opening Desk.
//
// Shared presentational pieces. Both surfaces that host this desk — the
// standalone /opening page and the terminal workspace panel — compose from
// here, so the two can never drift apart.

import { useMemo, useState } from "react";
import { HBars } from "./charts";
import { PRE_OPEN_LEGS } from "@/lib/opening";
import type { LegGroup, LegVote, Score, Verdict } from "@/lib/opening";

// ---- types (wire shape of /api/opening and /api/opening/history) ----
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
  slopePctPerEdge: number; interceptPct: number; residualSdPct: number; gate: number; note: string;
}
export interface ModelWire {
  sample: string; sessions: number; method: string; validation: string;
  slopeRange: [number, number, number];
  oosSignAgreement: number; oosBenchmark: number; oosPrecision: number; oosSpreadPct: number;
  oosBrier: number; oosRmseGainPct: number;
  ensembleNote: string;
}
export interface NiftyWire {
  last?: number | null; prevClose?: number | null; open?: number | null;
  high?: number | null; low?: number | null; chg?: number | null;
  range?: number | null; date?: string | null; bars?: number; session?: boolean;
}
export interface OpeningSnap {
  fetchedAtIST?: string; phase?: string; phaseLabel?: string; target?: string;
  currentSlot?: string; slots?: string[]; decisionMinuteIST?: string;
  nifty?: NiftyWire;
  gap?: GapWire;
  vix?: { last: number | null; chg: number | null; date: string | null; regime: string | null; cond: string | null; threshold: number };
  breadth?: {
    adv: number; dec: number; unc: number; total: number; pct: number | null; sentiment: string | null;
    matrix?: Record<string, [number, number, number]>;
    source: string; sessionFresh: boolean; universe: number;
    gainers: any[]; losers: any[]; rows: any[];
  } | null;
  predict?: OpeningScore;
  forecast?: ForecastWire;
  model?: ModelWire;
  regimeMeasured?: Record<string, { deltaPts: number; spreadPct: number; n: number }>;
  confirm?: ConfirmWire;
  intraday?: Array<{ time: string; open: number; high: number; low: number; close: number }>;
  caveats?: string[];
}

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
  _meta: {
    target: string; engine: string; limits: string[];
    model: ModelWire;
  };
}

// ---- formatting ----
export const f2 = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
export const f3 = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)}`;
export const fpct = (v: number | null | undefined, suffix = "%") =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v.toFixed(1)}${suffix}`;

export function toneClass(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return "";
  return v > 0 ? "pos" : v < 0 ? "neg" : "";
}

export const VERDICT_TEXT: Record<Verdict, string> = {
  GREEN: "● GAP UP",
  RED: "● GAP DOWN",
  FLAT: "● STAND ASIDE",
  NO_DATA: "○ NO CALL",
};
export const VERDICT_COLOR: Record<Verdict, string> = {
  GREEN: "rgba(0,214,100,0.5)", RED: "rgba(255,69,58,0.5)", FLAT: "#26262b", NO_DATA: "#26262b",
};
export const VERDICT_CLS: Record<Verdict, string> = {
  GREEN: "pos", RED: "neg", FLAT: "neutral", NO_DATA: "neutral",
};
/** One-line explanation of what each verdict means in tradeable terms. */
export const VERDICT_MEANING: Record<Verdict, string> = {
  GREEN: `Overnight information set leans gap-up. Needs ≥ the regime-gated edge to be published.`,
  RED: `Overnight information set leans gap-down. Needs ≥ the regime-gated edge to be published.`,
  FLAT: "Edge is inside the gate. The honest output is no position, not a coin flip.",
  NO_DATA: "Too few legs reporting to publish a direction. Coverage floor not met.",
};

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
 * The forecast meter: expected gap in %, with the publish gate drawn in the
 * SAME units as the forecast. A centre-zero edge meter and a gate expressed in
 * edge units could not be reconciled with a forecast stated in percent — the
 * gate and the forecast now share one scale, so the picture matches the number.
 */
export function EdgeMeter({ edge, gate, compact }: { edge: number | null; gate: number; compact?: boolean }) {
  const h = compact ? 14 : 30;
  const SPAN = 1.0;                       // +/- 1.00% expected gap, full scale
  const pctOf = (v: number) => ((v + SPAN) / (2 * SPAN)) * 100;
  const zero = pctOf(0);
  const gatePct = pctOf(gate);
  const valPct = edge === null ? null : pctOf(Math.max(-SPAN, Math.min(SPAN, edge)));
  return (
    <div style={{ position: "relative", height: h, background: "#121214", border: "1px solid #26262b", borderRadius: 2 }}>
      {/* the no-trade gate either side of zero, now in forecast % */}
      <div style={{
        position: "absolute", left: `${pctOf(-gate)}%`, width: `${gatePct - pctOf(-gate)}%`,
        top: 0, bottom: 0, background: "rgba(255,160,40,0.07)", borderLeft: "1px solid rgba(255,160,40,0.35)", borderRight: "1px solid rgba(255,160,40,0.35)",
      }} />
      <div style={{ position: "absolute", left: `${zero}%`, top: 0, bottom: 0, width: 1, background: "#5b5b62" }} />
      {valPct !== null && (
        <div style={{
          position: "absolute", left: `${Math.min(zero, valPct)}%`, width: `${Math.abs(valPct - zero)}%`,
          top: compact ? 2 : 4, bottom: compact ? 2 : 4,
          background: edge !== null && edge > 0 ? "#00d664" : edge !== null && edge < 0 ? "#ff453a" : "#5b5b62",
        }} />
      )}
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, color: "#5b5b62", marginTop: 3, letterSpacing: "0.06em" }}>
          <span>−1.00% GAP DOWN</span><span>NO-TRADE ±{gate.toFixed(2)}%</span><span>GAP UP +1.00%</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal signed bar used for leg votes and group edges. */
function SignedBar({ v, max = 1 }: { v: number | null; max?: number }) {
  if (v === null || !isFinite(v)) return <span className="faint">—</span>;
  const w = (Math.min(Math.abs(v), max) / max) * 50;
  const pos = v >= 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, width: 108 }}>
      <span style={{ width: 50, display: "flex", justifyContent: "flex-end" }}>
        {!pos && <span style={{ width: w, height: 8, background: "#ff453a" }} />}
      </span>
      <span style={{ width: 1, height: 10, background: "#5b5b62" }} />
      <span style={{ width: 50 }}>
        {pos && <span style={{ display: "block", width: w, height: 8, background: "#00d664" }} />}
      </span>
    </span>
  );
}

export const GROUP_ORDER: LegGroup[] = ["FUTURES", "ASIA", "US CASH", "FX", "MACRO", "VOL"];
export const GROUP_WHY: Record<LegGroup, string> = {
  FUTURES: "OVERNIGHT REPRICING — 24H INSTRUMENTS, LIVE AT THE BELL",
  ASIA: "LIVE ASIAN SESSION LEAD — PRINTS BEFORE THE BELL",
  "US CASH": "LAST COMPLETED US SESSION — CLOSED ~02:30 IST",
  FX: "RUPEE STRENGTH VS THE IMPORT-HEAVY INDEX",
  MACRO: "OIL / GOLD / DOLLAR / YIELDS — THE INFLATION AND DOLLAR LEG",
  VOL: "OVERSEAS RISK-PRICING — US VOL SPIKES HIT THE NIFTY GAP",
};

/** Full leg build: every vote, its weight, and what it contributed. */
export function LegBuild({ score }: { score: OpeningScore }) {
  const legs = score.legs ?? [];
  const groups = useMemo(() => GROUP_ORDER.map((g) => ({ g, e: score.groups?.[g] })), [score.groups]);
  return (
    <>
      <div className="panel">
        <p className="p-head">Leg build — every vote, its fitted weight, and what it contributed</p>
        <table className="plain">
          <thead>
            <tr>
              <th>GROUP</th><th>LEG</th><th>SYMBOL</th>
              <th style={{ textAlign: "right" }}>READING %</th>
              <th style={{ textAlign: "right" }}>VOTE</th>
              <th style={{ textAlign: "right" }}>WEIGHT</th>
              <th style={{ textAlign: "right" }}>APPLIED</th>
              <th style={{ textAlign: "right" }}>CONTRIB</th>
              <th style={{ textAlign: "right" }}>VOTE BAR</th>
              <th style={{ textAlign: "right" }}>FITTED r</th>
              <th>STATE</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((l) => (
              <tr key={l.key}>
                <td className="faint" style={{ fontSize: 11 }}>{l.group}</td>
                <td><strong className="sec">{l.short}</strong></td>
                <td className="faint" style={{ fontSize: 11 }}>{l.symbol}</td>
                <td style={{ textAlign: "right" }} className={l.chg === null ? "" : toneClass(l.chg)}>{f2(l.chg)}</td>
                <td style={{ textAlign: "right" }} className={l.vote === null ? "faint" : toneClass(l.vote)}>{f3(l.vote)}</td>
                <td style={{ textAlign: "right" }} className="faint">{l.weight.toFixed(3)}</td>
                <td style={{ textAlign: "right" }} className={l.applied < l.weight - 1e-9 ? "neg" : "faint"}>{l.applied.toFixed(3)}</td>
                <td style={{ textAlign: "right" }} className={l.contribution === 0 ? "faint" : toneClass(l.contribution)}>{f3(l.contribution)}</td>
                <td style={{ textAlign: "right" }}><SignedBar v={l.vote} /></td>
                <td style={{ textAlign: "right" }} className="faint">{l.measuredR === null || l.measuredR === undefined ? "—" : l.measuredR.toFixed(3)}</td>
                <td style={{ fontSize: 11 }}>
                  {l.tail
                    ? <span className="neg">TAIL — REJECTED</span>
                    : l.chg === null
                      ? <span className="neg">NO TAPE</span>
                      : l.stale
                        ? <span className="neg">STALE ×¼</span>
                        : l.priorOnly
                          ? <span className="badge">PRIOR CLOSE</span>
                          : l.deadbanded
                            ? <span className="faint">DEADBAND → 0</span>
                            : l.saturated
                              ? <span className="badge ok">SATURATED</span>
                              : <span className="faint">LIVE</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          VOTE = tanh(READING) PAST A PER-LEG DEADBAND. WEIGHT IS RIDGE-FITTED AGAINST THE REALISED GAP AND
          SHRUNK 30% TOWARD THE HAND PRIOR; `FITTED r` IS THAT LEG&apos;S MEASURED CORRELATION WITH THE GAP, SO A LEG
          THAT EARNS WEIGHT WITHOUT EVIDENCE IS VISIBLE HERE. A MISSING LEG CONTRIBUTES 0 AND LOWERS COVERAGE —
          IT IS NEVER COUNTED AS A FLAT TAPE. A STALE TAPE IS COUNTED AT ONE QUARTER WEIGHT. SPECS:{" "}
          {PRE_OPEN_LEGS.map((l) => `${l.short} ±${l.deadband.toFixed(2)}/${l.scale.toFixed(2)}`).join(" · ")}
        </p>
      </div>

      <div className="panel">
        <p className="p-head">Factor edges — where the conviction actually comes from</p>
        <table className="plain">
          <thead><tr><th>FACTOR</th><th style={{ textAlign: "right" }}>LEGS</th><th style={{ textAlign: "right" }}>EDGE</th><th style={{ textAlign: "right" }}>BAR</th><th>WHY IT MATTERS</th></tr></thead>
          <tbody>
            {groups.map(({ g, e }) => (
              <tr key={g}>
                <td><strong>{g}</strong></td>
                <td style={{ textAlign: "right" }} className="faint">{e ? e.legs : 0}</td>
                <td style={{ textAlign: "right" }} className={e?.edge === null || !e ? "faint" : toneClass(e?.edge)}>{e?.edge === null || !e ? "—" : f3(e.edge)}</td>
                <td style={{ textAlign: "right" }}><SignedBar v={e?.edge ?? null} /></td>
                <td className="faint" style={{ fontSize: 11 }}>{GROUP_WHY[g]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="faint" style={{ fontSize: 10.5, margin: "8px 0 0" }}>
          SIX OF THE LEGS ARE ONE US-EQUITY BET SEEN SIX TIMES (ES/NQ/YM CORRELATE 0.85–0.96, SPX/NDX/DJI
          0.75–0.96). THE WEIGHTED AVERAGE DIVIDES THAT DUPLICATION OUT AND RIDGE SHRINKAGE REMOVES WHAT IS
          LEFT, SO GROUPING IS HERE TO SHOW THE CALL&apos;S ORIGIN — NOT TO BUY ACCURACY.
        </p>
        {score.conflict && (
          <p className="neg" style={{ fontSize: 12, margin: "10px 0 0", fontWeight: 700 }}>
            ⚠ {score.conflictNote} — GATE RAISED 50% TO COMPENSATE
          </p>
        )}
      </div>
    </>
  );
}

/**
 * The magnitude forecast. The desk predicts a gap SIZE, not a colour, so the
 * number a trader sizes to is published in percent AND in index points.
 */
export function ForecastPanel({ snap, size }: { snap: OpeningSnap; size?: "sm" | "lg" }) {
  const f = snap.forecast;
  const p = snap.predict;
  const big = size !== "sm";
  if (!f) {
    return (
      <div className="panel">
        <p className="p-head">Gap forecast — magnitude</p>
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          NO FORECAST TAPE — THE MODEL COULD NOT PUBLISH AN EXPECTED GAP.
        </p>
      </div>
    );
  }
  const pts = f.expectedGapPts;
  const inBand = f.expectedGapPct !== null && Math.abs(f.expectedGapPct) <= 0.15;
  return (
    <div className="panel">
      <p className="p-head">Gap forecast — expected size, not just a colour</p>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        <span
          className={toneClass(f.expectedGapPct)}
          style={{ fontSize: big ? 26 : 18, fontWeight: 800, letterSpacing: "-0.5px" }}
        >
          {f.expectedGapPct === null ? "—" : `${f.expectedGapPct >= 0 ? "+" : ""}${f.expectedGapPct.toFixed(2)}%`}
        </span>
        <span className="muted" style={{ fontSize: big ? 13 : 12 }}>
          {pts === null ? "NO PRIOR CLOSE FOR POINTS" : `${pts >= 0 ? "+" : ""}${pts.toFixed(0)} PTS ON ${(snap.nifty?.prevClose ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        </span>
      </div>
      <div className="cells" style={{ marginTop: 10 }}>
        <Cell lbl="P(opens above prior close)" val={fpct((f.probUp ?? 0) * 100)} sub="FROM THE FORECAST + RESIDUAL" cls={toneClass((f.probUp ?? 0.5) - 0.5)} />
        <Cell lbl="P(gap is directional)" val={fpct((f.probDirectional ?? 0) * 100)} sub="OUTSIDE THE ±0.15% BAND" cls={(f.probDirectional ?? 0) > 0.5 ? "" : "faint"} />
        <Cell lbl="Band" val={f.band ?? "—"} sub={f.bandLabel ?? "—"} />
        <Cell lbl="Slope" val={`${Math.round(f.slopePctPerEdge * 100)} bps`} sub={`PER 1.00 EDGE · INTERCEPT ${f.interceptPct.toFixed(2)}%`} />
        <Cell lbl="Residual σ" val={`${f.residualSdPct.toFixed(2)}%`} sub="WHAT THIS REGIME'S FORECAST CANNOT EXPLAIN" cls="faint" />
        <Cell lbl="Forecast band" val={inBand ? "INSIDE ±0.15%" : "DIRECTIONAL"} sub={inBand ? "NO TRADEABLE GAP EXPECTED" : `${Math.round((f.probDirectional ?? 0) * 100)}% CONFIDENCE IT CLEARS`} cls={inBand ? "" : toneClass(f.expectedGapPct)} />
        <Cell lbl="Factor disagreement" val={f3(snap.predict?.disagreement ?? null)} sub="CONFIDENCE INPUT ONLY" cls={(snap.predict?.disagreement ?? 0) > 0.35 ? "" : "faint"} />
        <Cell lbl="Model edge" val={f3(p?.edge ?? null)} sub={`${p?.band ?? "—"} BAND · SCORES THE TAPE`} cls={toneClass(p?.edge)} />
        <Cell lbl="Publish gate" val={`±${f.gate?.toFixed(2) ?? "0.25"}%`} sub="IN FORECAST UNITS" cls="faint" />
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
        GAP = {f.band} BAND: {f.interceptPct.toFixed(2)}% + {f.slopePctPerEdge.toFixed(2)} × EDGE. {f.note}
      </p>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
        OUT-OF-SAMPLE, THIS FORECAST CUT RMSE {snap.model ? `${snap.model.oosRmseGainPct}%` : "—"} AGAINST THE UNCONDITIONAL
        BASE RATE AND THE DIRECTIONAL CALLS SHOWED A {(snap.model?.oosSpreadPct ?? 0).toFixed(2)}% MEAN-GAP SPREAD.
        SIZE THE POSITION OFF THE PERCENT AND THE POINTS, NOT OFF THE COLOUR.
      </p>
    </div>
  );
}

/** The publish decision, with the gate and the reason it failed if it did. */
export function VerdictBanner({ snap, size }: { snap: OpeningSnap; size?: "sm" | "lg" }) {
  const p = snap.predict;
  const v: Verdict = p?.verdict ?? "NO_DATA";
  const big = size !== "sm";
  const dirCalled = v === "GREEN" || v === "RED";
  return (
    <div className="panel panel-glow" style={{ borderColor: VERDICT_COLOR[v] }}>
      <p className="p-head">Pre-open call — {snap.target ?? "—"}</p>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: big ? 30 : 20, fontWeight: 800, letterSpacing: "-0.5px", overflowWrap: "anywhere" }} className={VERDICT_CLS[v]}>
          {VERDICT_TEXT[v]}
        </span>
        <span className="muted" style={{ fontSize: big ? 13 : 12 }}>
          EDGE {f3(p?.edge ?? null)} · CONF {fpct((p?.confidence ?? 0) * 100)} · COVERAGE {fpct((p?.coverage ?? 0) * 100)}
        </span>
      </div>
      <div style={{ marginTop: big ? 12 : 8 }}>
        <EdgeMeter edge={p?.expectedGapPct ?? null} gate={p?.gate ?? 0.25} compact={size === "sm"} />
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>{VERDICT_MEANING[v]}</p>
      <div className="cells" style={{ marginTop: 10 }}>
        <Cell lbl="Expected gap" val={fpct(snap.forecast?.expectedGapPct ?? null, "%")} sub={`${(snap.forecast?.expectedGapPts ?? 0) >= 0 ? "+" : ""}${(snap.forecast?.expectedGapPts ?? 0).toFixed(0)} PTS`} cls={toneClass(snap.forecast?.expectedGapPct)} />
        <Cell lbl="P(gap up)" val={fpct((p?.probUp ?? 0) * 100)} sub="FROM THE FORECAST" cls={toneClass((p?.probUp ?? 0.5) - 0.5)} />
        <Cell lbl="Regime" val={p?.regime ?? "—"} sub={p?.regime ? `GATE ×${({ CALM: 1.25, NORMAL: 1, STRESS: 0.85 } as Record<string, number>)[p.regime]}` : "NO VIX TAPE"} cls={p?.regime === "STRESS" ? "pos" : p?.regime === "CALM" ? "neg" : ""} />
        <Cell lbl="Legs reporting" val={`${p?.legsUsed ?? 0}/${p?.legCount ?? 0}`} sub={`${fpct((p?.coverage ?? 0) * 100)} OF WEIGHT · ${fpct((p?.staleShare ?? 0) * 100)} STALE`} cls={(p?.staleShare ?? 0) > 0.34 ? "neg" : ""} />
        <Cell lbl="India VIX" val={snap.vix?.last != null ? snap.vix.last.toFixed(2) : "—"} sub={f2(snap.vix?.chg, "%") + " SESSION"} cls={snap.vix?.cond === "VOLATILE" ? "neg" : ""} />
        <Cell lbl="Open gap" val={f2(snap.gap?.gapPct ?? null, "%")} sub="OPEN vs PRIOR CLOSE" cls={toneClass(snap.gap?.gapPct)} />
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
        {snap.phaseLabel ?? snap.phase ?? "—"} · DECISION STRIKE {snap.decisionMinuteIST ?? "09:00"} IST
        · LOAD {snap.fetchedAtIST ?? "—"} · SLOT {snap.currentSlot ?? "—"}
      </p>
      {big && (
        <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
          {dirCalled
            ? "PUBLISHED CALL — the gap has not happened yet, so this is a forecast. Size to confidence, not to conviction."
            : "NO DIRECTION PUBLISHED — a flat verdict means no position. It is not a weak green."}
        </p>
      )}
    </div>
  );
}

/** Post-bell observation. Kept visually and verbally separate from the forecast. */
export function ConfirmBanner({ snap }: { snap: OpeningSnap }) {
  const c = snap.confirm;
  if (!c) return null;
  const tone =
    c.state === "CONFIRMED" ? "ok" : c.state === "FADING" ? "bad" : "fnc";
  return (
    <div className="panel">
      <p className="p-head">In-session confirmation — observation, not a forecast</p>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className={`badge ${tone}`}>{c.state}</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{c.headline}</span>
      </div>
      <div className="cells" style={{ marginTop: 10 }}>
        <Cell lbl="Open gap" val={f2(c.gapPct, "%")} cls={toneClass(c.gapPct)} />
        <Cell lbl="Gap retraced" val={f2(c.retracePct, "%")} sub="OF THE MOVE" cls={toneClass(-(c.retracePct ?? 0))} />
        <Cell lbl="Gap filled" val={c.filled === null ? "—" : c.filled ? "FILLED" : "HOLDING"} cls={c.filled ? "neg" : ""} />
        <Cell lbl="Breadth" val={f2(c.breadthPct, "%")} sub={snap.breadth?.sessionFresh ? "THIS SESSION" : "LAST SESSION"} cls={toneClass(c.breadthPct)} />
        <Cell
          lbl="Forecast error"
          val={c.forecastErrPct === null || c.forecastErrPct === undefined ? "—" : f2(c.forecastErrPct, "%")}
          sub={c.forecastErrPts === null || c.forecastErrPts === undefined ? "NO PRIOR CLOSE" : `${c.forecastErrPts >= 0 ? "+" : ""}${c.forecastErrPts.toFixed(0)} PTS vs FORECAST`}
          cls={toneClass(-(c.forecastErrPct ?? 0))}
        />
        <Cell lbl="Confirm verdict" val={c.verdict} cls={VERDICT_CLS[c.verdict]} />
        <Cell lbl="Pre-open call" val={snap.predict?.verdict ?? "—"} sub="UNCHANGED BY THIS PANEL" />
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
        Breadth is deliberately kept OUT of the pre-open model — a historical 09:00 IST advance/decline
        snapshot is not reconstructable, so folding it in would make the live call unverifiable.
        It grades the gap after the fact instead.
      </p>
    </div>
  );
}

/** The honest-debt panel. Empty state is a bug, not a styling choice. */
export function Caveats({ snap, compact }: { snap: OpeningSnap; compact?: boolean }) {
  const list = snap.caveats ?? [];
  if (!list.length) {
    return (
      <div className="panel">
        <p className="p-head">Data caveats</p>
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          NONE — every leg reported inside its deadband/age limits and coverage cleared the floor.
        </p>
      </div>
    );
  }
  return (
    <div className="panel">
      <p className="p-head">Data caveats — {list.length} open</p>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.6 }}>
        {list.slice(0, compact ? 4 : list.length).map((c, i) => (
          <li key={i} className="muted">{c}</li>
        ))}
      </ul>
      {compact && list.length > 4 && (
        <p className="faint" style={{ fontSize: 11, margin: "6px 0 0" }}>+{list.length - 4} MORE ON THE FULL DESK</p>
      )}
    </div>
  );
}

export function BreadthMatrix({ breadth }: { breadth: NonNullable<OpeningSnap["breadth"]> }) {
  const tup = (v?: [number, number, number]): [number, number, number] => [Number(v?.[0] ?? 0), Number(v?.[1] ?? 0), Number(v?.[2] ?? 0)];
  const all: Array<[string, [number, number, number]]> = [
    ["NIFTY 50", tup(breadth.matrix?.nifty50)],
    ["NIFTY 500", tup(breadth.matrix?.n500)],
    ["MIDCAP 150", tup(breadth.matrix?.midcap)],
    ["SMALLCAP 250", tup(breadth.matrix?.smallcap)],
    ["TOTAL MKT", tup(breadth.matrix?.total)],
  ];
  const segs = all.filter(([, v]) => v[0] + v[1] + v[2] > 0);
  if (!segs.length) return null;
  return (
    <div className="scrollx">
      <table className="plain">
        <thead><tr><th>SEGMENT</th><th style={{ textAlign: "right" }}>ADV</th><th style={{ textAlign: "right" }}>DEC</th><th style={{ textAlign: "right" }}>UNCH</th><th style={{ textAlign: "right" }}>NET</th></tr></thead>
        <tbody>
          {segs.map(([label, v]) => (
            <tr key={label}>
              <td><strong>{label}</strong></td>
              <td style={{ textAlign: "right" }} className="pos">{v[0].toLocaleString("en-IN")}</td>
              <td style={{ textAlign: "right" }} className="neg">{v[1].toLocaleString("en-IN")}</td>
              <td style={{ textAlign: "right" }}>{v[2].toLocaleString("en-IN")}</td>
              <td style={{ textAlign: "right" }}><span className={v[0] - v[1] >= 0 ? "pos" : "neg"}>{v[0] - v[1] >= 0 ? "+" : ""}{(v[0] - v[1]).toLocaleString("en-IN")}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MoversTable({ rows, side }: { rows: any[]; side: "gainers" | "losers" }) {
  if (!rows?.length) return null;
  return (
    <div className="panel">
      <p className="p-head">{side === "gainers" ? "Top gainers" : "Top losers"}</p>
      <table className="plain">
        <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.symbol}>
              <td><span className="sec">{r.symbol}</span></td>
              <td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
              <td style={{ textAlign: "right" }} className={side === "gainers" ? "pos" : "neg"}>{f2(r.chgPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BreadthPanel({ snap }: { snap: OpeningSnap }) {
  const b = snap.breadth;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  if (!b) {
    return (
      <div className="panel">
        <p className="p-head">Market breadth</p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          NSE ADVANCE/DECLINE FEED UNAVAILABLE — THE PRE-OPEN MODEL DOES NOT USE IT, SO THE CALL STANDS.
        </p>
      </div>
    );
  }
  const rows = b.rows ?? [];
  const filtered = rows.filter((r) => {
    if (search && !String(r.symbol).toUpperCase().includes(search.toUpperCase())) return false;
    if (status === "Adv" && r.status !== "Advance") return false;
    if (status === "Dec" && r.status !== "Decline") return false;
    if (status === "Unch" && r.status !== "Unchanged") return false;
    return true;
  });
  return (
    <>
      <div className="panel">
        <p className="p-head">Breadth — {b.source === "NSE" ? "NSE OFFICIAL" : "YAHOO FALLBACK"} · A/D</p>
        <div className="cells">
          <Cell lbl="Advances" val={String(b.adv)} cls="pos" />
          <Cell lbl="Declines" val={String(b.dec)} cls="neg" />
          <Cell lbl="Unchanged" val={String(b.unc)} />
          <Cell lbl="Net" val={`${b.adv - b.dec >= 0 ? "+" : ""}${(b.adv - b.dec).toLocaleString("en-IN")}`} cls={b.adv - b.dec >= 0 ? "pos" : "neg"} />
          <Cell lbl="Breadth %" val={f2(b.pct, "%")} sub={`${b.total} NAMES`} cls={toneClass(b.pct)} />
          <Cell lbl="Session" val={b.sessionFresh ? "TODAY" : "PRIOR"} sub={b.sessionFresh ? "ADMISSIBLE" : "EXCLUDED FROM CALL"} cls={b.sessionFresh ? "pos" : "neg"} />
        </div>
        <div style={{ marginTop: 10 }}>
          <HBars rows={[
            { label: "ADVANCES", value: b.adv ?? 0, display: String(b.adv ?? 0), color: "#00d664" },
            { label: "DECLINES", value: b.dec ?? 0, display: String(b.dec ?? 0), color: "#ff453a" },
            { label: "UNCHANGED", value: b.unc ?? 0, display: String(b.unc ?? 0), color: "#5b5b62" },
          ]} />
        </div>
        <div style={{ marginTop: 10 }}><BreadthMatrix breadth={b} /></div>
      </div>

      {rows.length > 0 && (
        <div className="panel">
          <p className="p-head">Breadth explorer — {rows.length} securities</p>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <input className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="SEARCH SYMBOL…" style={{ flex: 1 }} />
            {["All", "Adv", "Dec", "Unch"].map((s) => (
              <button key={s} className={`pill${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>{s.toUpperCase()}</button>
            ))}
            <button className="ghost" onClick={() => downloadCSV(
              "opening-breadth.csv",
              ["SYMBOL", "LAST", "CHG_PCT", "VOLUME", "VALUE_CR", "STATUS"],
              filtered.map((r: any) => [r.symbol, r.last, r.chgPct, r.volume, r.valueCr, r.status])
            )}>↓ CSV</button>
          </div>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>VAL ₹ CR</th><th style={{ textAlign: "right" }}>STATUS</th></tr></thead>
              <tbody>
                {filtered.slice(0, 120).map((r: any) => (
                  <tr key={r.symbol}>
                    <td><span className="sec">{r.symbol}</span></td>
                    <td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                    <td style={{ textAlign: "right" }}><span className={toneClass(r.chgPct)}>{f2(r.chgPct)}</span></td>
                    <td style={{ textAlign: "right" }}>{r.volume ? r.volume.toLocaleString("en-IN") : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.valueCr ? r.valueCr.toLocaleString("en-IN") : "—"}</td>
                    <td style={{ textAlign: "right" }}><span className={r.status === "Advance" ? "pos" : r.status === "Decline" ? "neg" : ""}>{r.status.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11.5 }}>
            SHOWING {Math.min(120, filtered.length)} OF {filtered.length} · FOR STUDY ONLY, NOT ADVICE.
          </p>
        </div>
      )}
    </>
  );
}

export function SlotGrid({ snap }: { snap: OpeningSnap }) {
  if (!snap.slots?.length) return null;
  return (
    <div className="panel">
      <p className="p-head">Capture grid — snapshot slots</p>
      <div className="pills">
        {snap.slots.map((s) => (
          <span key={s} className={`badge${s === snap.currentSlot ? " fnc" : ""}`}>{s === snap.currentSlot ? `▶ ${s}` : s}</span>
        ))}
      </div>
    </div>
  );
}
