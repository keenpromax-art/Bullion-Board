"use client";

// Module 109 scorecard — the half of the desk that has to be trusted.
//
// Every number here is MEASURED from a zero-lookahead backfill of the same
// engine the live desk runs. The panel's job is to make it hard to quote the
// flattering figure without the one that disciplines it.

import { useMemo, useState } from "react";
import { Cell, downloadCSV, f2, f3, toneClass } from "./OpeningDesk";
import type { HeadlineWire, HistoryWire } from "./OpeningDesk";

const VERDICT_TEXT: Record<string, string> = {
  GREEN: "GAP UP", RED: "GAP DOWN", FLAT: "STAND ASIDE", NO_DATA: "NO CALL",
};
const OUTCOME_TEXT: Record<string, string> = {
  HIT: "HIT", MISS: "MISS", FLAT_HIT: "FLAT HIT", FLAT_MISS: "FLAT MISS", NO_DATA: "—",
};
const OUTCOME_CLS: Record<string, string> = {
  HIT: "badge ok", MISS: "badge bad", FLAT_HIT: "badge fnc",
  FLAT_MISS: "badge bad", NO_DATA: "badge",
};
/** Below this many genuinely-directional samples a bucket is noise, not a result. */
const MIN_N = 12;

function PctCell({ v, base, n }: { v: number | null; base?: number | null; n: number }) {
  if (v === null || n < MIN_N) {
    return <span className="faint" title={`n=${n} — too small to quote`}>n/a</span>;
  }
  const cls = base === null || base === undefined ? "" : v > base + 3 ? "pos" : v < base - 3 ? "neg" : "";
  return <span className={cls}>{v.toFixed(1)}%</span>;
}

/** The headline, stated so it cannot be quoted out of context. */
function ScorecardHeadline({ h }: { h: HistoryWire }) {
  const o = h.oos;
  const is = h.inSample;
  const flatShare = h.gapGraded ? (h.flatGaps / h.gapGraded) * 100 : 0;
  const alwaysUp = h.gapGraded ? ((h.upGaps + h.flatGaps) / h.gapGraded) * 100 : 0;
const edge = o.dirSignPct !== null && o.dirBasePct !== null ? o.dirSignPct - o.dirBasePct : null;
  const beats = edge !== null && edge > 0;
  const topConf = h.confCalibration?.bands?.find((b) => b.key === h.confCalibration.topBandKey);
  return (
    <div className="panel panel-glow">
<p className="p-head">
        Accuracy scorecard — out-of-sample rebuild of the live engine · {h.target?.label ?? "this index"} ·{" "}
        {h.sessions} sessions
        {h.target && !h.target.fitted && (
          <span className="badge" style={{ marginLeft: 8 }}>FITTED ON NIFTY 50 — TRANSFERRED HERE</span>
        )}
      </p>
      <div className="cells">
        <Cell
          lbl="OOS directional sign agreement"
          val={o.dirN >= MIN_N && o.dirSignPct !== null ? `${o.dirSignPct.toFixed(1)}%` : "n/a"}
          sub={`${o.dirN} DIRECTIONAL GAPS · ${o.folds} WALK-FORWARD FOLDS`}
          cls={beats ? "pos" : "neg"}
        />
        <Cell lbl="Best always-call" val={o.dirBasePct !== null ? `${o.dirBasePct.toFixed(1)}%` : "n/a"} sub={`SAME ${o.dirN} SESSIONS`} />
        <Cell
          lbl="Edge over benchmark"
          val={edge === null ? "n/a" : `${edge >= 0 ? "+" : ""}${edge.toFixed(1)} pts`}
          sub={beats ? "BEATS THE BENCHMARK" : "NO EDGE OVER BENCHMARK"}
          cls={beats ? "pos" : "neg"}
        />
        <Cell
          lbl="Precision on |gap|"
          val={o.precisionPct !== null ? `${o.precisionPct.toFixed(1)}%` : "—"}
          sub="SHARE OF SELECTED MOVE CALLED RIGHT"
          cls={(o.precisionPct ?? 0) > 93 ? "pos" : ""}
        />
        <Cell
          lbl="Points spread"
          val={o.spreadPct === null ? "—" : `${o.spreadPct >= 0 ? "+" : ""}${o.spreadPct.toFixed(2)}%`}
          sub={`GAP-UP CALLS ${o.greenMean !== null ? `+${o.greenMean.toFixed(2)}` : "—"}% vs GAP-DOWN ${o.redMean !== null ? o.redMean.toFixed(2) : "—"}%${o.spreadT !== null ? ` · t=${o.spreadT}` : ""}`}
          cls={toneClass(o.spreadPct)}
        />
        <Cell lbl="Expectation / unit edge" val={h.edgeToGapBps !== null ? `${h.edgeToGapBps} bps` : "—"} sub={`IN-SAMPLE · PUBLISHED PER BAND BELOW`} />
        <Cell lbl="Publish gate" val={`±${h.egapMin.toFixed(2)}%`} sub="IN FORECAST UNITS — SEE OPERATING CURVE" />
        <Cell
          lbl="Forecast RMSE"
          val={o.rmseGainPct !== null ? `−${o.rmseGainPct.toFixed(1)}%` : "—"}
          sub={o.rmseModel !== null && o.rmseBase !== null ? `${o.rmseModel.toFixed(3)} vs ${o.rmseBase.toFixed(3)}% BASE RATE` : ""}
          cls={(o.rmseGainPct ?? 0) > 0 ? "pos" : "neg"}
        />
        <Cell lbl="Brier on P(gap up)" val={o.brier !== null ? o.brier.toFixed(3) : "—"} sub="0.250 = A COIN" cls={(o.brier ?? 1) < 0.25 ? "pos" : ""} />
        <Cell lbl="In-sample sign agree" val={is.dirSignPct !== null ? `${is.dirSignPct.toFixed(1)}%` : "—"} sub="FIT ON ITS OWN SAMPLE — NOT THE HEADLINE" cls="faint" />
      </div>

      <div className="panel" style={{ marginTop: 12, borderColor: "rgba(255,160,40,0.35)" }}>
        <p className="p-head">Read this before quoting any percentage above</p>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.65 }}>
          <li className="muted">
            <strong className="muted">{flatShare.toFixed(1)}% OF NIFTY SESSIONS OPEN INSIDE ±{h.band}%.</strong>{" "}
            On those days every call — including a wrong one — scores a hit. That is why the whole-sample
            hit rate ({h.gapHitPct.toFixed(1)}%) is near-meaningless: always calling UP scores{" "}
            {alwaysUp.toFixed(1)}% on the same sample. Use the directional row instead.
          </li>
          <li className="muted">
            <strong className="muted">The headline is out-of-sample.</strong> Weights are re-fitted on
            60-session folds and each fold is scored only on strictly later sessions. The in-sample figure
            ({is.dirSignPct?.toFixed(1) ?? "—"}%) is printed beside it so the gap between the two cannot be
            quietly dropped.
          </li>
          <li className="muted">
            Each leg is rebuilt from the last print its OWN market had produced at 09:00 IST. Reading a shut
            market&apos;s &quot;live&quot; price is what used to make this scorecard grade a model nobody ran.
            {!h.noHourlyLegs.length ? "" : ` NO HOURLY HISTORY FOR ${h.noHourlyLegs.join(", ")} — FELL BACK TO PRIOR DAILY CLOSE.`}
          </li>
          <li className="muted">
            Nothing leaves the denominator. Flat calls that missed count as losses. FLAT calls: {o.flatCalls},
            of which {o.flatHitPct !== null ? `${o.flatHitPct.toFixed(1)}%` : "—"} produced a flat gap.
          </li>
          <li className="muted">
            The benchmark is the best single always-call on exactly the {o.dirN} sessions the model actually
            called — not a flattering average, and not a different sample size.
          </li>
          <li className="muted">
            <strong className="muted">Confidence does not order accuracy.</strong>{" "}
            {h.confCalibration?.monotone === false ? (
              <>
                The desk is consistently <em>under</em>-promising — stated {topConf?.label ?? "—"} confidence of{" "}
                {topConf?.statedPct?.toFixed(1) ?? "—"}% was right{" "}
                {topConf?.hitPct?.toFixed(1) ?? "—"}% of the time — but the hit rate is roughly flat across
                every band, so a higher number does not mean a likelier call. Read it as a tape-quality
                read-out, not a probability.
              </>
            ) : h.confCalibration?.monotone === true ? (
              <>Higher confidence bands measure more accurate on this rebuild. The ordering, and its per-band
                calibration gap, are printed in the confidence table.</>
            ) : (
              <>Too few bands carry enough directional calls to judge the ordering. The bands are printed below
                rather than dropped.</>
            )}
          </li>
          <li className="muted">
            A low confidence band is mostly <em>stand aside</em>, not a weak call: the publish gate floors
            confidence at 0.45 × tape quality, so the 20–40% bands are mostly FLAT sessions the desk declined
            to call. Grade them and you are grading the gate, not the model.
          </li>
          {h._meta.limits.map((l, i) => <li key={i} className="muted">{l}</li>)}
        </ul>
      </div>
    </div>
  );
}

/**
 * Per-leg evidence. The point of this table is that a leg's WEIGHT and its
 * measured correlation are shown side by side — a leg that earns weight
 * without evidence should be a visible argument, not a hidden constant.
 */
function LegEvidenceTable({ h }: { h: HistoryWire }) {
  const byGroup = useMemo(() => {
    const m = new Map<string, HistoryWire["weights"]>();
    for (const w of h.weights) {
      const g = w.group;
      m.set(g, [...(m.get(g) ?? []), w]);
    }
    return Array.from(m.entries());
  }, [h.weights]);
  return (
    <div className="panel">
      <p className="p-head">Leg evidence — fitted weight beside measured correlation</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>LEG</th><th>SYMBOL</th>
              <th style={{ textAlign: "right" }}>N</th>
              <th style={{ textAlign: "right" }}>r(vs GAP)</th>
              <th style={{ textAlign: "right" }}>SIGN AGREE</th>
              <th style={{ textAlign: "right" }}>PRIOR</th>
              <th style={{ textAlign: "right" }}>FITTED</th>
              <th style={{ textAlign: "right" }}>SHIPPED</th>
              <th>HOW IT WAS READ</th>
            </tr>
          </thead>
          <tbody>
            {byGroup.flatMap(([group, ws]) =>
              ws.map((w, i) => (
                <tr key={w.key}>
                  <td>
                    {i === 0 ? <span className="faint" style={{ fontSize: 10.5, marginRight: 6 }}>{group}</span> : <span style={{ display: "inline-block", width: 62 }} />}
                    <strong className="sec">{w.short}</strong>
                  </td>
                  <td className="faint" style={{ fontSize: 11 }}>{w.symbol}</td>
                  <td style={{ textAlign: "right" }} className="faint">{w.n}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(w.r)}>{w.r === null ? "—" : w.r.toFixed(3)}</td>
                  <td style={{ textAlign: "right" }}><PctCell v={w.signAgree} base={oBase(h)} n={w.n} /></td>
                  <td style={{ textAlign: "right" }} className="faint">{w.priorWeight.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }} className="faint">{w.fittedWeight.toFixed(3)}</td>
                  <td style={{ textAlign: "right" }}>{w.weight.toFixed(3)}</td>
                  <td className="faint" style={{ fontSize: 10.5 }}>
                    {Object.entries(w.how).map(([k, v]) => `${k.replace(/_/g, " ").toLowerCase()} ${v}`).join(" · ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
        WEIGHT = 30% TOWARD THE HAND PRIOR + 70% TOWARD THE RIDGE COEFFICIENT. `HOW IT WAS READ` SHOWS HOW MANY
        SESSIONS CAME FROM A LIVE 1H PRINT VERSUS A PRIOR DAILY CLOSE — IF A LEG FELL BACK TO PRIOR CLOSE FOR
        MOST OF THE SAMPLE ITS r IS UNDERSTATED AND ITS WEIGHT IS TOO SMALL.
      </p>
      <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
        <strong className="muted">DO NOT READ THIS TABLE AS &quot;HIGH r = GOOD LEG, LOW r = DROP IT&quot;.</strong>{" "}
        Deleting every leg whose sign agreement is under 58% made the engine measurably WORSE (RMSE gain fell to
        15.0% from 16.8%). A weakly-informative reading still cancels noise when it is averaged in — which is the
        actual job most of these legs are doing.
      </p>
    </div>
  );
}
const oBase = (h: HistoryWire) => h.oos.dirBasePct;

/** Monotone check on the gate: does a bigger edge actually buy accuracy? */
function CalibrationTable({ h }: { h: HistoryWire }) {
  const maxAbs = Math.max(0.45, ...h.calibration.map((c) => Math.abs(c.avgGapPct ?? 0)));
  return (
    <div className="panel">
      <p className="p-head">Calibration — measured outcome per edge bucket, out-of-sample</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>EDGE BUCKET</th>
              <th style={{ textAlign: "right" }}>N</th>
              <th style={{ textAlign: "right" }}>DIR N</th>
              <th style={{ textAlign: "right" }}>SIGN AGREE</th>
              <th style={{ textAlign: "right" }}>AVG GAP %</th>
              <th style={{ textAlign: "right" }}>AVG GAP</th>
              <th style={{ textAlign: "right" }}>ALL-SAMPLE HIT</th>
            </tr>
          </thead>
          <tbody>
            {h.calibration.map((c) => (
              <tr key={c.key}>
                <td><strong>{c.label}</strong></td>
                <td style={{ textAlign: "right" }} className="faint">{c.n}</td>
                <td style={{ textAlign: "right" }} className="faint">{c.dirN}</td>
                <td style={{ textAlign: "right" }}><PctCell v={c.dirSignPct} base={h.oos.dirBasePct} n={c.dirN} /></td>
                <td style={{ textAlign: "right" }} className={toneClass(c.avgGapPct)}>{f2(c.avgGapPct, "%")}</td>
                <td style={{ textAlign: "right" }}>
                  <span style={{ display: "inline-block", width: 88, position: "relative", height: 10 }}>
                    <span style={{ position: "absolute", left: 44, top: 0, bottom: 0, width: 1, background: "#5b5b62" }} />
                    {c.avgGapPct !== null && (
                      <span style={{
                        position: "absolute", top: 0, bottom: 0,
                        left: c.avgGapPct >= 0 ? 44 : 44 - (Math.abs(c.avgGapPct) / maxAbs) * 44,
                        width: (Math.abs(c.avgGapPct) / maxAbs) * 44,
                        background: c.avgGapPct >= 0 ? "#00d664" : "#ff453a",
                      }} />
                    )}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}><PctCell v={c.gapHitPct} n={c.n} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        SIGN AGREE uses only genuinely directional gaps and is struck against the{" "}
        {(h.oos.dirBasePct ?? 0).toFixed(1)}% benchmark. `n/a` means fewer than {MIN_N} directional samples —
        those buckets are printed, not hidden, because a suppressed row reads as a missing measurement.
      </p>
    </div>
  );
}

/**
 * The publish gate is a precision/coverage CHOICE, so the curve is published
 * rather than one number. Precision is the column that compares fairly across
 * thresholds; sign agreement flatters whichever gate happens to select more
 * up-days.
 */
function OperatingCurve({ h }: { h: HistoryWire }) {
  return (
    <div className="panel">
      <p className="p-head">Operating curve — the publish gate is a choice, so here is every choice</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>GATE (EXPECTED GAP)</th>
              <th style={{ textAlign: "right" }}>CALLS</th>
              <th style={{ textAlign: "right" }}>DIR N</th>
              <th style={{ textAlign: "right" }}>PRECISION</th>
              <th style={{ textAlign: "right" }}>SIGN AGREE</th>
              <th style={{ textAlign: "right" }}>BENCHMARK</th>
              <th style={{ textAlign: "right" }}>SPREAD</th>
              <th>READS AS</th>
            </tr>
          </thead>
          <tbody>
            {h.gateSweep.map((g) => {
              const live = Math.abs(g.egapMin - h.egapMin) < 1e-9;
              return (
                <tr key={g.egapMin} style={live ? { background: "rgba(255,160,40,0.06)" } : undefined}>
                  <td>
                    <strong>±{g.egapMin.toFixed(2)}%</strong>
                    {live && <span className="badge fnc" style={{ marginLeft: 6 }}>SHIPPED</span>}
                  </td>
                  <td style={{ textAlign: "right" }}>{g.dirCalls}</td>
                  <td style={{ textAlign: "right" }} className="faint">{g.dirN}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={g.precisionPct !== null && g.precisionPct > 94 ? "pos" : ""}>
                      {g.precisionPct === null ? "—" : `${g.precisionPct.toFixed(1)}%`}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}><PctCell v={g.dirSignPct} base={g.dirBasePct} n={g.dirN} /></td>
                  <td style={{ textAlign: "right" }} className="faint">{g.dirBasePct !== null ? `${g.dirBasePct.toFixed(1)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(g.spreadPct)}>{g.spreadPct === null ? "—" : `${g.spreadPct >= 0 ? "+" : ""}${g.spreadPct.toFixed(2)}%`}</td>
                  <td className="faint" style={{ fontSize: 11 }}>
                    {g.egapMin <= 0.2 ? "WIDE — MOST DIRECTIONAL SESSIONS, LOWEST PRECISION"
                      : g.egapMin <= 0.26 ? "BALANCED — WHAT THE DESK SHIPS"
                        : g.egapMin <= 0.32 ? "SELECTIVE"
                          : "NARROW — FEW CALLS, HIGHEST PRECISION"}
                  </td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "1px solid #26262b" }}>
              <td><strong className="faint">edge ≥ {h.legacyGate.edgeMin.toFixed(2)} × regime</strong></td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.dirCalls}</td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.dirN}</td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.precisionPct !== null ? `${h.legacyGate.precisionPct.toFixed(1)}%` : "—"}</td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.dirSignPct !== null ? `${h.legacyGate.dirSignPct.toFixed(1)}%` : "—"}</td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.dirBasePct !== null ? `${h.legacyGate.dirBasePct.toFixed(1)}%` : "—"}</td>
              <td style={{ textAlign: "right" }} className="faint">{h.legacyGate.spreadPct !== null ? `${h.legacyGate.spreadPct >= 0 ? "+" : ""}${h.legacyGate.spreadPct.toFixed(2)}%` : "—"}</td>
              <td className="faint" style={{ fontSize: 11 }}>THE PREVIOUS GATE, SAME ROWS — FOR COMPARISON ONLY</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        PRECISION = THE SHARE OF THE TOTAL |GAP| THE GATE SELECTED THAT THE MODEL CALLED IN THE RIGHT
        DIRECTION. IT IS THE COLUMN TO READ ACROSS ROWS: SIGN AGREEMENT MOVES WITH WHETHER A GATE HAPPENS TO
        PICK MORE UP-DAYS, WHICH SAYS NOTHING ABOUT SKILL. THERE IS NO SHARP KNEE ON THIS CURVE — PRECISION
        CLIMB STEADILY AS CALLS VANISH — SO THE RIGHT ROW DEPENDS ON THE READER&apos;S COSTS, WHICH THE DESK
        DOES NOT KNOW. THE SHIPPED ROW IS A BALANCED DEFAULT, NOT A CLAIMED OPTIMUM.
      </p>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
        THE GATE IS IN FORECAST PERCENT, NOT EDGE UNITS. THE PREVIOUS GATE WAS `|edge| ≥ 0.30 × REGIME_MULT`,
        WHICH PUBLISHED &quot;GAP UP&quot; FOR FORECASTS THAT DIFFERED BY 40% IN SIZE BETWEEN CALM AND NORMAL TAPE,
        AND DOUBLE-COUNTED THE REGIME CONDITIONING THAT THE BAND SLOPE ALREADY APPLIES.
      </p>
    </div>
  );
}

/** Regime conditioning now comes from the band slope, not a hand-set dial. */
function RegimeTable({ h }: { h: HistoryWire }) {
  return (
    <div className="panel">
      <p className="p-head">Regime — conditioning comes from the band slope, not a hand-set dial</p>
      <div className="scrollx">
        <table className="plain">
          <thead><tr><th>REGIME</th><th>INDIA VIX</th><th>BAND</th><th style={{ textAlign: "right" }}>SLOPE</th><th style={{ textAlign: "right" }}>RESID σ</th><th style={{ textAlign: "right" }}>CALLS</th><th style={{ textAlign: "right" }}>PRECISION</th><th style={{ textAlign: "right" }}>SPREAD</th><th>GAP-UP / GAP-DOWN CALLS AVG</th></tr></thead>
          <tbody>
            {h.regimeSplit.map((r) => (
              <tr key={r.regime}>
                <td><strong className={r.regime === "STRESS" ? "pos" : r.regime === "CALM" ? "neg" : ""}>{r.regime}</strong></td>
                <td className="faint">{r.regime === "CALM" ? "< 13" : r.regime === "STRESS" ? "> 18" : "13 – 18"}</td>
                <td><span className="badge">{r.band}</span></td>
                <td style={{ textAlign: "right" }}>{r.bandSlope.toFixed(2)}</td>
                <td style={{ textAlign: "right" }} className="faint">{r.bandResidSd.toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>{r.calls}</td>
                <td style={{ textAlign: "right" }}><PctCell v={r.precisionPct} base={94} n={r.n} /></td>
                <td style={{ textAlign: "right" }} className={toneClass(r.spreadPct)}>{r.spreadPct === null ? "n/a" : `${r.spreadPct >= 0 ? "+" : ""}${r.spreadPct.toFixed(2)}%`}</td>
                <td className="faint" style={{ fontSize: 11 }}>
                  {r.greenMean !== null && r.redMean !== null ? `+${r.greenMean.toFixed(2)}% / ${r.redMean.toFixed(2)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        NORMAL AND STRESS SHARE A BAND, SO A GATE IN FORECAST UNITS ALREADY TREATS THEM THE SAME — AND IT
        TREATS CALM TIGHTER WITHOUT ANY HAND-SET MULTIPLIER, BECAUSE THE CALM SLOPE IS 0.43 AGAINST 0.59.
        MEASURED ON TOP OF THAT GATE, THE OLD REGIME MULTIPLIER CHANGED NOTHING (PRECISION 93.7% EITHER WAY)
        WHILE COSTING 24 CALLS, SO IT WAS REMOVED RATHER THAN KEPT AS A DIAL.
      </p>
    </div>
  );
}

function ConfusionPanel({ h }: { h: HistoryWire }) {
  const c = h.confusion;
  const total = c.greenHit + c.greenMiss + c.redHit + c.redMiss;
  if (!total) return null;
  const Cell2 = ({ v, t, cls }: { v: number; t: string; cls: string }) => (
    <div className="cell">
      <div className="lbl">{t}</div>
      <div className={`val ${cls}`} style={{ fontSize: 17 }}>{v}</div>
      <div className="sub">{((v / total) * 100).toFixed(0)}% OF CALLS</div>
    </div>
  );
  return (
    <div className="panel">
      <p className="p-head">Confusion — every out-of-sample directional call, counted</p>
      <div className="cells">
        <Cell2 v={c.greenHit} t="Called UP · gap up" cls="pos" />
        <Cell2 v={c.greenMiss} t="Called UP · gap down" cls="neg" />
        <Cell2 v={c.redHit} t="Called DOWN · gap down" cls="pos" />
        <Cell2 v={c.redMiss} t="Called DOWN · gap up" cls="neg" />
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        Misses are shown, not netted away. The two right-hand columns are the model; the two left-hand
        columns are what it cost.
      </p>
    </div>
  );
}

/** Filterable, exportable session log. */
function SessionLog({ h }: { h: HistoryWire }) {
  const [filter, setFilter] = useState("ALL");
  const rows = useMemo(() => {
    if (filter === "ALL") return h.rows;
    if (filter === "CONFLICT") return h.rows.filter((r) => r.conflict);
    return h.rows.filter((r) => r.verdict === filter);
  }, [h.rows, filter]);
  return (
    <div className="panel">
      <p className="p-head">Session log — {rows.length} of {h.rows.length} reconstructed sessions (out-of-sample)</p>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        {["ALL", "GREEN", "RED", "FLAT", "CONFLICT"].map((s) => (
          <button key={s} className={`pill${filter === s ? " active" : ""}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
        <button className="ghost" style={{ marginLeft: "auto" }} onClick={() => downloadCSV(
          "opening-scorecard.csv",
          ["DATE", "EDGE", "EXPECTED_GAP_PCT", "COVERAGE", "STALE_SHARE", "VERDICT", "REGIME", "CONFLICT", "GAP_PCT", "DAY_PCT", "GAP_OUTCOME", "DAY_OUTCOME"],
          rows.map((r) => [r.date, r.edge, r.egap, r.coverage, r.staleShare, r.verdict, r.regime, r.conflict, r.gapPct, r.dayPct, r.gapOutcome, r.dayOutcome])
        )}>↓ CSV</button>
      </div>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>DATE</th><th style={{ textAlign: "right" }}>EDGE</th>
              <th style={{ textAlign: "right" }}>FORECAST</th><th style={{ textAlign: "right" }}>COV</th>
              <th>CALL</th><th>REGIME</th><th style={{ textAlign: "right" }}>GAP %</th>
              <th style={{ textAlign: "right" }}>DAY %</th><th>GAP OUTCOME</th><th>DAY OUTCOME</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 120).map((r) => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td style={{ textAlign: "right" }} className={toneClass(r.edge)}>{r.edge === null ? "—" : f3(r.edge)}</td>
                <td style={{ textAlign: "right" }} className={toneClass(r.egap)}>{r.egap === null || r.egap === undefined ? "—" : f2(r.egap, "%")}</td>
                <td style={{ textAlign: "right" }} className="faint">{((r.coverage ?? 0) * 100).toFixed(0)}%</td>
                <td>
                  <span className={`badge ${r.verdict === "GREEN" ? "ok" : r.verdict === "RED" ? "bad" : "fnc"}`}>
                    {VERDICT_TEXT[r.verdict] ?? r.verdict}
                  </span>
                  {r.conflict && <span className="badge" style={{ marginLeft: 4 }}>CONFLICT</span>}
                </td>
                <td className="faint" style={{ fontSize: 11 }}>{r.regime ?? "—"}</td>
                <td style={{ textAlign: "right" }} className={toneClass(r.gapPct)}>{f2(r.gapPct)}</td>
                <td style={{ textAlign: "right" }} className={toneClass(r.dayPct)}>{f2(r.dayPct)}</td>
                <td><span className={OUTCOME_CLS[r.gapOutcome] ?? ""}>{OUTCOME_TEXT[r.gapOutcome] ?? r.gapOutcome}</span></td>
                <td className="faint" style={{ fontSize: 11 }}>{OUTCOME_TEXT[r.dayOutcome] ?? r.dayOutcome}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 120 && (
        <p className="muted" style={{ fontSize: 11.5 }}>
          SHOWING 120 OF {rows.length} — DOWNLOAD CSV FOR THE FULL SET.
        </p>
      )}
    </div>
  );
}

function ProvenancePanel({ h }: { h: HistoryWire }) {
  const m = h._meta.model;
  const d = h.drift;
  return (
    <div className="panel">
      <p className="p-head">Provenance — where every published constant came from</p>
      <div className="cells">
        <Cell lbl="Sample" val={`${m.sessions} sess`} sub={m.sample} />
        <Cell lbl="Legs in engine" val={String(h.legCount)} sub={`MEAN COVERAGE ${h.coverageAvg !== null ? `${(h.coverageAvg * 100).toFixed(0)}%` : "—"}`} />
        <Cell
          lbl="Missing legs"
          val={h.missingLegs.length ? h.missingLegs.join(" ") : "NONE"}
          sub={h.missingLegs.length ? "NO DAILY HISTORY" : "ALL PRESENT"}
          cls={h.missingLegs.length ? "neg" : "pos"}
        />
        <Cell lbl="OOS folds" val={String(h.oos.folds)} sub={`GLOBAL SLOPE MED ${d.globalSlopeMed ?? "—"}`} />
        <Cell
          lbl="Conflicted sessions"
          val={String(h.conflict.n)}
          sub={h.conflict.hitPct !== null && h.conflict.cleanHitPct !== null
            ? `${h.conflict.hitPct.toFixed(1)}% HIT vs ${h.conflict.cleanHitPct.toFixed(1)}% UNCLEAN`
            : "TOO FEW TO QUOTE"}
        />
        <Cell
          lbl="Constant drift"
          val={d.stale ? "STALE" : "IN SYNC"}
          sub={d.stale ? "PUBLISHED != MEASURED — SEE BANDS" : "PUBLISHED == MEASURED"}
          cls={d.stale ? "neg" : "pos"}
        />
      </div>

      <p className="p-head" style={{ marginTop: 12 }}>Forecast bands — the slope is regime-dependent, so it is published per band</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>BAND</th><th style={{ textAlign: "right" }}>FOLDS</th>
              <th style={{ textAlign: "right" }}>SLOPE SHIPPED</th><th style={{ textAlign: "right" }}>SLOPE MEASURED</th>
              <th style={{ textAlign: "right" }}>SLOPE RANGE</th><th style={{ textAlign: "right" }}>DRIFT</th>
              <th style={{ textAlign: "right" }}>INTERCEPT</th><th style={{ textAlign: "right" }}>RESID σ</th>
            </tr>
          </thead>
          <tbody>
            {d.bands.map((b) => (
              <tr key={b.key}>
                <td><strong>{b.key}</strong> <span className="faint" style={{ fontSize: 10.5 }}>{b.label}</span></td>
                <td style={{ textAlign: "right" }} className="faint">{b.folds}</td>
                <td style={{ textAlign: "right" }}>{b.slopeShipped.toFixed(2)}</td>
                <td style={{ textAlign: "right" }}>{b.slopeMeasured === null ? "—" : b.slopeMeasured.toFixed(3)}</td>
                <td style={{ textAlign: "right" }} className="faint">{b.slopeRange[0] ?? "—"} … {b.slopeRange[1] ?? "—"}</td>
                <td style={{ textAlign: "right" }} className={b.slopeDriftPct === null ? "faint" : Math.abs(b.slopeDriftPct) > 20 ? "neg" : "pos"}>
                  {b.slopeDriftPct === null ? "—" : `${b.slopeDriftPct >= 0 ? "+" : ""}${b.slopeDriftPct}%`}
                </td>
                <td style={{ textAlign: "right" }} className="faint">{b.interceptShipped.toFixed(2)} / {b.interceptMeasured === null ? "—" : b.interceptMeasured.toFixed(3)}</td>
                <td style={{ textAlign: "right" }} className="faint">{b.residSdShipped.toFixed(2)} / {b.residSdMeasured === null ? "—" : b.residSdMeasured.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
        SHIPPED / MEASURED. THE GAP DISTRIBUTION IS HETEROSKEDASTIC IN VIX — MEAN |GAP| AND THE FORECAST
        RESIDUAL BOTH SCALE WITH IT — SO A SINGLE SLOPE MIS-STATES EVERY CALL BY REGIME. A THIRD STRESS BAND
        WAS TESTED AND REFUSED: IT BOUGHT 0.5 POINTS OF RMSE, COST BRIER, AND HAD ONLY FIVE FOLDS WITH AN
        INTERCEPT RANGING +0.09% TO +0.27%, WHICH IS NOT A NUMBER TO PUBLISH.
      </p>
      {d.stale && (
        <p className="neg" style={{ fontSize: 12, margin: "10px 0 0", fontWeight: 700 }}>
          ⚠ A PUBLISHED BAND SLOPE HAS DRIFTED &gt;20% FROM WHAT THIS REBUILD MEASURES — THE LIVE FORECAST
          IS OVER- OR UNDER-STATING EVERY CALL IN THAT REGIME. {d.note}
        </p>
      )}
      <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>{m.method}.</p>
      <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>{m.validation}.</p>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>{m.ensembleNote}</p>
    </div>
  );
}

/**
 * Confidence calibration — the direct question: when the desk printed a
 * confidence, how often was it right, and did being right pay?
 *
 * The three numbers that matter per band:
 *   STATED   the average confidence the desk published for those sessions
 *   HIT      the share of its directional calls in that band that were right
 *   CALIBR   HIT − STATED. Negative means the desk over-promises in that band,
 *            which is the only figure here that can embarrass the model.
 *
 * "Helped" is measured, not asserted: AVG GAP RIGHT − AVG GAP WRONG. If a band
 * is accurate but the calls it got right moved no more than the ones it got
 * wrong, the accuracy bought nothing.
 */
function ConfidenceCalibration({ h }: { h: HistoryWire }) {
  const cc = h.confCalibration;
  if (!cc?.bands?.length) return null;
  const widest = Math.max(0.05, ...cc.bands.map((b) => Math.max(b.ptsRight, b.ptsWrong)));
  const graded = cc.bands.filter((b) => b.hitPct !== null);
  const top = graded[0];
  return (
    <div className="panel">
      <p className="p-head">Confidence calibration — what the desk&apos;s own confidence number was worth</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>CONFIDENCE</th>
              <th style={{ textAlign: "right" }}>SESSIONS</th>
              <th style={{ textAlign: "right" }}>CALLS</th>
              <th style={{ textAlign: "right" }}>RIGHT</th>
              <th style={{ textAlign: "right" }}>WRONG</th>
              <th style={{ textAlign: "right" }}>STATED</th>
              <th style={{ textAlign: "right" }}>HIT RATE</th>
              <th style={{ textAlign: "right" }}>CALIBRATION</th>
              <th style={{ textAlign: "right" }}>MOVE CAUGHT</th>
              <th style={{ textAlign: "right" }}>MOVE LOST</th>
              <th style={{ textAlign: "right" }}>SPREAD</th>
            </tr>
          </thead>
          <tbody>
            {cc.bands.map((b) => {
              const thin = b.dirN < cc.minN;
              const over = b.calibPts !== null && b.calibPts < -5;
              return (
                <tr key={b.key}>
                  <td>
                    <strong>{b.label}</strong>
                    {b.key === cc.topBandKey && <span className="badge fnc" style={{ marginLeft: 6 }}>TOP</span>}
                  </td>
                  <td style={{ textAlign: "right" }} className="faint">{b.n}</td>
                  <td style={{ textAlign: "right" }}>{b.calls}</td>
                  <td style={{ textAlign: "right" }} className="pos">{b.right}</td>
                  <td style={{ textAlign: "right" }} className={b.wrong ? "neg" : "faint"}>{b.wrong}</td>
                  <td style={{ textAlign: "right" }} className="faint">
                    {b.statedPct === null ? "—" : `${b.statedPct.toFixed(1)}%`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {b.hitPct === null || thin ? (
                      <span className="faint" title={`only ${b.dirN} directional calls — under ${cc.minN}`}>n/a</span>
                    ) : (
                      <strong>{b.hitPct.toFixed(1)}%</strong>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }} className={over ? "neg" : b.calibPts === null || thin ? "faint" : "pos"}>
                    {b.calibPts === null || thin ? "—" : `${b.calibPts >= 0 ? "+" : "−"}${Math.abs(b.calibPts).toFixed(1)} pts`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span style={{ display: "inline-block", width: 78, position: "relative", height: 10 }}>
                      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: (b.ptsRight / widest) * 78, background: "#00d664" }} />
                      <span style={{ position: "absolute", left: 0, top: 6, bottom: 0, width: (b.ptsWrong / widest) * 78, background: "#ff453a" }} />
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }} className="pos">+{b.ptsRight.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }} className={b.ptsWrong ? "neg" : "faint"}>−{b.ptsWrong.toFixed(1)}%</td>
                  <td style={{ textAlign: "right" }} className={toneClass(b.spreadPct)}>
                    {b.spreadPct === null || thin ? "—" : `${b.spreadPct >= 0 ? "+" : ""}${b.spreadPct.toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cells" style={{ marginTop: 12 }}>
        <Cell
          lbl="Confidence ordering"
          val={cc.monotone === null ? "n/a" : cc.monotone ? "HOLDS" : "FAILS"}
          sub={cc.verdict}
          cls={cc.monotone === null ? "faint" : cc.monotone ? "pos" : "neg"}
        />
        <Cell
          lbl={`Highest band (${top?.label ?? "—"})`}
          val={top?.hitPct === null || top === undefined ? "n/a" : `${top.hitPct.toFixed(1)}%`}
          sub={top?.statedPct === null || top === undefined ? "TOO FEW CALLS" : `STATED ${top.statedPct.toFixed(1)}% · N=${top.dirN}`}
          cls={top && top.hitPct !== null && top.statedPct !== null && top.hitPct >= top.statedPct ? "pos" : "neg"}
        />
        <Cell
          lbl="Net move captured"
          val={`${cc.bands.reduce((s, b) => s + b.ptsRight, 0) >= 0 ? "+" : ""}${(cc.bands.reduce((s, b) => s + b.ptsRight, 0) - cc.bands.reduce((s, b) => s + b.ptsWrong, 0)).toFixed(1)}%`}
          sub="MOVE CAUGHT MINUS MOVE LOST, ALL BANDS"
          cls={cc.bands.reduce((s, b) => s + b.ptsRight, 0) - cc.bands.reduce((s, b) => s + b.ptsWrong, 0) >= 0 ? "pos" : "neg"}
        />
      </div>

      <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
        <strong className="muted">HOW TO READ THIS.</strong> FIND THE BAND MATCHING A LIVE CALL&apos;S CONFIDENCE AND
        COMPARE HIT RATE WITH STATED. IF HIT RATE IS BELOW STATED, THE DESK IS OVER-PROMISING IN THAT BAND AND
        THE NUMBER IS A DISPLAY QUANTITY, NOT A PROBABILITY. CALIBRATION IS THE ONLY COLUMN HERE THAT CAN
        DISAGREE WITH THE DESK&apos;S OWN SCORE.
      </p>
      <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
        GRADED OUT-OF-SAMPLE: CONFIDENCE IS RECOMPUTED ON EACH FOLD&apos;S OWN FORECAST, NOT CARRIED OVER FROM
        THE FULL-SAMPLE FIT. `n/a` MEANS FEWER THAN {cc.minN} GENUINELY DIRECTIONAL CALLS IN THE BAND — THOSE
        ROWS ARE PRINTED, NOT HIDDEN. ONLY DIRECTIONAL CALLS ARE GRADED: A FLAT CALL CARRIES A CONFIDENCE (THE
        FORMULA FLOORS AT 0.45 × TAPE QUALITY) BUT &quot;WAS THE DIRECTION RIGHT&quot; IS NOT A QUESTION ABOUT
        IT. CONFIDENCE IS BUILT FROM COVERAGE, STALE SHARE, FACTOR DISAGREEMENT AND DISTANCE PAST THE GATE — SO
        A HIGH BAND MEANS A STRONG TAPE BEYOND THE GATE, NOT A PROOF OF ANYTHING.
      </p>
    </div>
  );
}

export function ScorecardPanels({ h }: { h: HistoryWire }) {
  // A TAPE CHECK market has no published call, so there is nothing to grade.
  // Say exactly that rather than rendering NIFTY 50's numbers under a different
  // index's name — which is the one mistake this panel exists to prevent.
  if (h.graded === false) {
    return (
      <div className="panel panel-glow">
        <p className="p-head">
          Accuracy scorecard — not available for {h.target?.label ?? "this market"}
        </p>
        <div className="cell" style={{ borderColor: "rgba(255,160,40,0.45)" }}>
          <div className="lbl">NO PREDICTION TO SCORE</div>
          <div className="sub" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 4 }}>
            {h.skipReason ?? "THE DESK PUBLISHES NO VERDICT FOR THIS MARKET."}
          </div>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
          SWITCH THE LIVE DESK TO AN INDIAN INDEX — NIFTY 50, NIFTY BANK, SENSEX, NIFTY IT, NIFTY PHARMA, NIFTY
          AUTO OR NIFTY MIDCAP 50 — AND THE REBUILD FOLLOWS THE SELECTION AND RE-RUNS ON THAT INDEX&apos;S OWN
          OPENING GAPS.
        </p>
      </div>
    );
  }
  const t = h.target;
  return (
    <div className="grid">
      <ScorecardHeadline h={h} />
      <div className="panel" style={{ borderColor: t?.fitted ? "rgba(0,214,100,0.35)" : "rgba(255,160,40,0.4)" }}>
        <p className="p-head">What this rebuild graded</p>
        <div className="cells">
          <Cell lbl="Index" val={t?.label ?? "—"} sub={`${t?.symbol ?? "—"} · ${t?.venue ?? "—"}`} />
          <Cell
            lbl="Constants"
            val={t?.fitted ? "FITTED HERE" : "TRANSFERRED"}
            sub={t?.fitted ? "BANDS AND GATE MEASURED ON THIS INDEX" : "FITTED ON NIFTY 50 — SEE BANDS"}
            cls={t?.fitted ? "pos" : "neg"}
          />
          <Cell lbl="Sample" val={`${h.sessions} sess`} sub={h._meta.model.sample} />
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>{t?.transfer ?? ""}</p>
      </div>
      <ProvenancePanel h={h} />
      <ConfidenceCalibration h={h} />
      <LegEvidenceTable h={h} />
      <CalibrationTable h={h} />
      <OperatingCurve h={h} />      <RegimeTable h={h} />
      <ConfusionPanel h={h} />
      <SessionLog h={h} />
    </div>
  );
}

