"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { rangeTable } from "@/lib/notebook";
import { HBars, BarChart, Donut, Histogram } from "@/components/charts";
import { downloadCSV } from "@/components/ModuleDesks";

// Notebook desks 76-84 — TS port of Stocks_Final.ipynb (live Yahoo tape).
// Anatomy: cells strip -> p-head panels -> verdict banner -> faint footnotes.
// Every desk: loading / empty / error + retry; fail-open legs; derived in useMemo.

function useNb(kind: string, qs: string) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const url = `/api/nb/${kind}${qs ? `?${qs}` : ""}`;
  async function load() {
    const my = ++seq.current;
    setLoading(true); setErr("");
    try {
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "scan failed");
      if (seq.current === my) setData(j);
    } catch (e: any) {
      if (seq.current === my) setErr(e.message);
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return { data, err, loading, reload: load };
}

function fmt(v: any, d = 2, suffix = ""): string {
  if (v === null || v === undefined || !isFinite(Number(v))) return "—";
  const n = Number(v);
  return `${n >= 0 ? "" : ""}${n.toFixed(d)}${suffix}`;
}

function Head({ id, sub }: { id: string; sub: string }) {
  return (
    <div className="panel panel-glow">
      <p className="p-head">{id} · {funcCode(id)} &lt;GO&gt;</p>
      <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0 0" }}>{sub}</p>
    </div>
  );
}

function Pills({ opts, val, set }: { opts: string[]; val: string; set: (v: string) => void }) {
  return (
    <div className="pills">
      {opts.map((o) => (
        <button key={o} className={`pill${o === val ? " active" : ""}`} onClick={() => set(o)}>{o}</button>
      ))}
    </div>
  );
}

function AiBlock({ id, label, context }: { id: string; label: string; context: string }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.genericDesk(funcCode(id), label) },
        { role: "user", content: `${context} TASK: VERDICT + TOP PICKS + 3 RISKS + INVALIDATION. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setOut(txt);
    } catch (e: any) { setOut(`AI ERR: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <p className="p-head">AI analyst — {funcCode(id)}</p>
      <div className="toolbar"><button className="btn" onClick={run} disabled={busy}>{busy ? "RUNNING…" : "RUN AI"}</button></div>
      {out && <pre className="ai" style={{ marginTop: 8 }}>{out}</pre>}
    </div>
  );
}

function Cells({ items }: { items: { l: string; v: string; s?: string; cls?: string }[] }) {
  return (
    <div className="cells">
      {items.map((c) => (
        <div className="cell" key={c.l}>
          <div className="lbl">{c.l}</div>
          <div className={`val ${c.cls ?? ""}`} style={{ fontSize: 15 }}>{c.v}</div>
          {c.s && <div className="sub">{c.s}</div>}
        </div>
      ))}
    </div>
  );
}

// ---- 76: Monthly Seasonality Scanner (cells 1/2/13) ----
export function NbSeasonDesk() {
  const [u, setU] = useState("FO");
  const { data, err, loading, reload } = useNb("seasonality", `universe=${u}`);
  const rows: any[] = data?.rows ?? [];
  const top = useMemo(() => rows.slice(0, 15), [rows]);
  const skipped = data?.skipped as
    | { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> }
    | undefined;
  const skips = skipped && skipped.count > 0 ? skipped : null;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="76" sub={`SEASONALITY SCANNER · NEXT-MONTH ${data?.monthName?.toUpperCase() ?? ""} (M${data?.targetMonth ?? "—"}) · SHARPE-RANKED · ALL ${data?.universe ?? "—"} F&O NAMES REQUESTED`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        <button
          className="ghost"
          onClick={() =>
            downloadCSV(
              `seasonality_${data?.monthName?.toLowerCase() ?? "month"}_${u.toLowerCase()}.csv`,
              ["#", "TICKER", "LTP", "WIN_RATE_PCT", "AVG_RETURN_PCT", "STD_DEV_PCT", "SHARPE", "SKEW", "MAX_PCT", "MIN_PCT", "YEARS"],
              rows.map((r: any, i: number) => [i + 1, r.sym, r.ltp, r.win, r.avg, r.sd, r.sharpe, r.skew, r.max, r.min, r.n])
            )
          }
          title="Download every row that passed, not just the 100 shown"
        >
          ⤓ CSV {rows.length} ROWS
        </button>
        <span className="faint" style={{ fontSize: 10.5 }}>ALL {data?.universe ?? "—"} F&O NAMES, NO CAP · "ALL" = FULL NSE WATCHLIST (SLOW)</span>
      </div>
      {loading && <p className="muted">SCANNING 10Y MONTHLY TAPE…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ROWS PASSED MIN_YEARS=5 — RETRY.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "TARGET", v: data.monthName?.slice(0, 3).toUpperCase() ?? "—", s: `M${data.targetMonth} · NEXT` },
            { l: "SCORED", v: String(data.count), s: `OF ${data.universe}` },
            { l: "SKIPPED", v: String(data.skipped?.count ?? 0), s: "MIN_YEARS=5", cls: data.skipped?.count ? "neg" : undefined },
            { l: "TOP SHARPE", v: fmt(rows[0]?.sharpe, 3), s: rows[0]?.sym ?? "" },
            { l: "TOP AVG%", v: `${fmt(rows[0]?.avg)}%`, s: `WIN ${fmt(rows[0]?.win, 1)}%` },
            { l: "MED WIN%", v: `${fmt(rows[Math.floor(rows.length / 2)]?.win, 1)}%`, s: "MEDIAN" },
          ]} />
          {skips && (
            <div className="panel">
              <p className="p-head">Skipped — {skips.count} of {data.universe} did not reach the notebook&apos;s MIN_YEARS=5</p>
              <table className="plain">
                <thead><tr><th>REASON</th><th style={{ textAlign: "right" }}>SYMS</th></tr></thead>
                <tbody>
                  {Object.entries(skips.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <tr key={reason}><td>{reason}</td><td style={{ textAlign: "right" }}><strong>{n}</strong></td></tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SAMPLE: {skips.sample.map((s) => s.sym).join(", ")}
                {skips.count > skips.sample.length ? ` +${skips.count - skips.sample.length} MORE` : ""}
                {" · "}THE NOTEBOOK DROPS THESE SILENTLY VIA <code>continue</code>. THEY ARE NOT MISSING DATA — THEY HAVE
                FEWER THAN 5 OBSERVATIONS OF MONTH {data.targetMonth}, SO A RATE BUILT FROM THE OTHER {data.count} IS THE
                WHOLE BASIS OF EVERY NUMBER ON THIS DESK.
              </p>
            </div>
          )}
          <div className="panel">
            <p className="p-head">Avg return — top 15 by Sharpe</p>
            <BarChart values={top.map((r) => r.avg ?? 0)} labels={top.map((r) => r.sym)} height={130} />
          </div>
          <div className="panel">
            <p className="p-head">Ranked table — Sharpe desc · min 5 obs</p>
            <div className="scrollx" style={{ maxHeight: 420, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>#</th><th>TICKER</th><th style={{ textAlign: "right" }}>LTP ₹</th><th style={{ textAlign: "right" }}>WIN%</th><th style={{ textAlign: "right" }}>AVG%</th><th style={{ textAlign: "right" }}>STD%</th><th style={{ textAlign: "right" }}>SHARPE</th><th style={{ textAlign: "right" }}>SKEW</th><th style={{ textAlign: "right" }}>MAX/MIN</th><th style={{ textAlign: "right" }}>YRS</th></tr></thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={r.sym}>
                      <td className="faint">{i + 1}</td>
                      <td><span className="sec">{r.sym}</span></td>
                      <td style={{ textAlign: "right" }}>{fmt(r.ltp)}</td>
                      <td style={{ textAlign: "right" }} className={(r.win ?? 50) >= 50 ? "pos" : "neg"}>{fmt(r.win, 1)}</td>
                      <td style={{ textAlign: "right" }} className={(r.avg ?? 0) >= 0 ? "pos" : "neg"}>{r.avg >= 0 ? "+" : ""}{fmt(r.avg)}</td>
                      <td style={{ textAlign: "right" }}>{fmt(r.sd)}</td>
                      <td style={{ textAlign: "right" }}><strong>{fmt(r.sharpe, 3)}</strong></td>
                      <td style={{ textAlign: "right" }}>{fmt(r.skew, 2)}</td>
                      <td style={{ textAlign: "right" }} className="faint">{fmt(r.max)}/{fmt(r.min)}</td>
                      <td style={{ textAlign: "right" }}>{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              RET = PCT_CHANGE ACROSS MONTH-END CLOSES, {data.monthName?.toUpperCase()} ONLY · SHARPE = AVG/STD (SAMPLE, NOT ANNUALISED —
              IT IS A RATIO OF TWO MONTHLY FIGURES) · MIN_YEARS=5 · LTP = LAST DAILY CLOSE ·
              SHOWING {Math.min(rows.length, 100)} OF {rows.length} · CSV EXPORTS ALL {rows.length}
            </p>
          </div>
          <AiBlock id="76" label="Seasonality Scanner" context={`SCORING MONTH ${data.monthName?.toUpperCase()} (M${data.targetMonth}, NEXT CALENDAR MONTH) SCORED ${data.count} OF ${data.universe} REQUESTED SKIPPED ${data.skipped?.count ?? 0} TOP ${rows.slice(0, 5).map((r: any) => `${r.sym} SH ${r.sharpe} AVG ${r.avg}% WIN ${r.win}% YRS ${r.n}`).join(" | ")}`} />
        </>
      )}
    </div>
  );
}

// ---- 77: SMA Crossover Screener (cell 3) ----
export function NbSmaDesk() {
  const [u, setU] = useState("FO");
  const { data, err, loading, reload } = useNb("sma", `universe=${u}`);
  const rows: any[] = data?.rows ?? [];
  const counts: Record<string, number> = data?.counts ?? {};
  const allRows: any[] = data?.all ?? [];
  const skipped = data?.skipped as { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> } | undefined;
  // Resolved to a definite value before the JSX so the panel can narrow on it;
  // `skipped?.count > 0 && ...` does not narrow inside the closure.
  const skips = skipped && skipped.count > 0 ? skipped : null;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="77" sub={`SMA 50/200 CROSSOVER SCREENER · 2Y DAILY · ALL ${data?.universe ?? "—"} F&O NAMES REQUESTED · AT≤3D / POST 4-20D / 2% PROXIMITY`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        <button
          className="ghost"
          onClick={() =>
            downloadCSV(
              `sma_crossover_${u.toLowerCase()}.csv`,
              ["#", "TICKER", "LAST", "SMA_50", "SMA_200", "DIFF_PCT", "DAYS_SINCE_CROSS", "CROSS_STATUS", "SIGNAL"],
              allRows.map((r: any, i: number) => [i + 1, r.sym, r.price, r.s50, r.s200, r.diffPct, r.daysSince, r.status, r.signal])
            )
          }
          title="Every symbol that produced a reading — neutral rows included, not just the actionable ones"
        >
          ⤓ CSV {allRows.length} ROWS
        </button>
      </div>
      {loading && <p className="muted">SCANNING 2Y TAPE…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ACTIONABLE CROSSES — UNIVERSE NEUTRAL.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "SCANNED", v: String(data.count), s: `OF ${data.universe}` },
            { l: "AT CROSS", v: String((counts["AT BULLISH CROSS"] ?? 0) + (counts["AT BEARISH CROSS"] ?? 0)), s: `${counts["AT BULLISH CROSS"] ?? 0} UP / ${counts["AT BEARISH CROSS"] ?? 0} DN` },
            { l: "POST", v: String((counts["POST BULLISH CROSS"] ?? 0) + (counts["POST BEARISH CROSS"] ?? 0)), s: `${counts["POST BULLISH CROSS"] ?? 0} UP / ${counts["POST BEARISH CROSS"] ?? 0} DN` },
            { l: "APPROACH", v: String((counts["APPROACHING BULLISH CROSS"] ?? 0) + (counts["APPROACHING BEARISH CROSS"] ?? 0)), s: `${counts["APPROACHING BULLISH CROSS"] ?? 0} UP / ${counts["APPROACHING BEARISH CROSS"] ?? 0} DN` },
            { l: "BULL SHARE", v: `${fmt(rows.filter((r) => r.signal === "BULLISH").length / Math.max(rows.length, 1) * 100, 0)}%`, s: "OF ACTIONABLE" },
          ]} />
          {/* SKIPPED, NAMED. The notebook prints this block and so does the desk:
              a screener that silently drops the symbols Yahoo refused turns
              "44 of 209" into a claim about 209 that it cannot support. Read the
              scanned count against the universe before trusting any rate above. */}
          {skips && (
            <div className="panel">
              <p className="p-head">Skipped &mdash; {skips.count} of {data.universe} never produced a reading</p>
              <table className="plain">
                <thead><tr><th>REASON</th><th style={{ textAlign: "right" }}>SYMS</th></tr></thead>
                <tbody>
                  {Object.entries(skips.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <tr key={reason}>
                      <td>{reason}</td>
                      <td style={{ textAlign: "right" }}><strong>{n}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SAMPLE: {skips.sample.map((s) => s.sym).join(", ")}
                {skips.count > skips.sample.length ? ` +${skips.count - skips.sample.length} MORE` : ""}
                {" \u00b7 "}EVERY RATE ABOVE IS DRAWN FROM THE {data.count} THAT ANSWERED, NOT FROM {data.universe}.
              </p>
            </div>
          )}
          <div className="panel">
            <p className="p-head">Actionable crosses — |diff| desc</p>
            <div className="scrollx" style={{ maxHeight: 440, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>TICKER</th><th style={{ textAlign: "right" }}>LAST ₹</th><th style={{ textAlign: "right" }}>SMA50</th><th style={{ textAlign: "right" }}>SMA200</th><th style={{ textAlign: "right" }}>DIFF%</th><th>STATUS</th><th>SIG</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sym}>
                      <td><span className="sec">{r.sym}</span></td>
                      <td style={{ textAlign: "right" }}>{fmt(r.price)}</td>
                      <td style={{ textAlign: "right" }}>{fmt(r.s50)}</td>
                      <td style={{ textAlign: "right" }}>{fmt(r.s200)}</td>
                      <td style={{ textAlign: "right" }} className={(r.diffPct ?? 0) >= 0 ? "pos" : "neg"}>{(r.diffPct ?? 0) >= 0 ? "+" : ""}{fmt(r.diffPct)}</td>
                      <td style={{ fontSize: 11 }}>{r.status}</td>
                      <td className={r.signal === "BULLISH" ? "pos" : r.signal === "BEARISH" ? "neg" : ""}>{r.signal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              SMA = SIMPLE MEAN 50/200 · THE NOTEBOOK&apos;S PROXIMITY BRANCHES ARE INVERTED AND ARE CORRECTED HERE: 50 ABOVE 200 IS
              BULLISH, SO IT READS APPROACHING BULLISH, NOT BEARISH · SHOWING {rows.length} ACTIONABLE OF {allRows.length} READINGS
              {skips ? ` · ${skips.count} SKIPPED, SEE ABOVE` : ""} · NEUTRAL ROWS HIDDEN ON SCREEN BUT INCLUDED IN THE CSV
            </p>
          </div>
          <AiBlock id="77" label="SMA Crossover Screener" context={`AT-CROSS ${rows.filter((r) => r.status.startsWith("AT")).slice(0, 8).map((r: any) => `${r.sym} ${r.status}`).join(" | ") || "NONE"}`} />
        </>
      )}
    </div>
  );
}

// ---- 78: Correlation Scanner (cells 4+11) ----
export function NbCorrDesk() {
  const [mode, setMode] = useState("PAIRS");
  const [u, setU] = useState("FO");
  const [target, setTarget] = useState("ITC.NS");
  const qs = mode === "PAIRS" ? `mode=pairs&universe=${u}` : `mode=single&target=${encodeURIComponent(target)}&universe=${u}`;
  const { data, err, loading, reload } = useNb("corr", qs);
  const rows: any[] = data?.rows ?? [];
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="78" sub="CORRELATION SCANNER · 1Y DAILY PEARSON · PAIRS NEG FILTER / SINGLE-TARGET TOP-3" />
      <div className="toolbar">
        <Pills opts={["PAIRS", "SINGLE"]} val={mode} set={setMode} />
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        {mode === "SINGLE" && (
          <input className="box" value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} placeholder="TARGET .NS" style={{ maxWidth: 140 }} />
        )}
        <button className="ghost" onClick={reload}>↻ RETRY</button>
      </div>
      {loading && <p className="muted">BUILDING 1Y CORRELATION MATRIX…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO NEGATIVE PAIRS — UNIVERSE CO-MOVES.</p>}
      {rows.length > 0 && (
        <div className="panel">
          <p className="p-head">{mode === "PAIRS" ? `Negative pairs — ${data.kept}/${data.requested} kept · ${data.count} pairs` : `Most inverse to ${data.target}`}</p>
          <div className="scrollx" style={{ maxHeight: 440, overflowY: "auto" }}>
            <table className="plain">
              <thead><tr>{mode === "PAIRS" ? <><th>LEG A</th><th>LEG B</th></> : <><th>RANK</th><th>TICKER</th></>}<th style={{ textAlign: "right" }}>PEARSON</th></tr></thead>
              <tbody>
                {rows.slice(0, 60).map((r: any, i: number) => (
                  <tr key={mode === "PAIRS" ? `${r.a}-${r.b}` : r.sym}>
                    {mode === "PAIRS" ? <><td><span className="sec">{r.a}</span></td><td><span className="sec">{r.b}</span></td></> : <><td className="faint">{i + 1}</td><td><span className="sec">{r.sym}</span></td></>}
                    <td style={{ textAlign: "right" }} className="pos">{fmt(r.corr, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 10.5 }}>RET = DAILY % · PEARSON COMPUTED ON SHARED TRADING DAYS ONLY, A PAIR NEEDS {data.minOverlap}+ OVERLAPPING
              SESSIONS OR IT IS NOT SCORED ({data.tooThin} PAIRS DROPPED FOR BEING TOO THIN) · ALL {data.pairsTested?.toLocaleString("en-IN") ?? "—"}
              COMBINATIONS OF {data.kept} KEPT NAMES WERE TESTED — SHOWING THE {data.count} MOST NEGATIVE · NO CAP ON THE
              UNIVERSE · SINGLE SHOWS TOP-25, HEAD-3 IS THE HEDGE</p>
        </div>
      )}
    </div>
  );
}

// ---- 79: Safety-First Optimizer (cells 5/6) ----
export function NbOptDesk() {
  const [u, setU] = useState("FO");
  const { data, err, loading, reload } = useNb("optimizer", `universe=${u}`);
  const legs: any[] = data?.opt?.legs ?? [];
const cands: any[] = data?.legs ?? [];
  const o = data?.opt;
  const skipped = data?.skipped as
    | { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> }
    | undefined;
  const skips = skipped && skipped.count > 0 ? skipped : null;
  const alpha = o && data?.benchmark?.expPct !== null && data?.benchmark?.expPct !== undefined
    ? o.expPct - data.benchmark.expPct : null;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="79" sub={`SAFETY-FIRST OPTIMIZER v4 · 2Y · RANKED OVER ALL ${data?.scanned ?? "—"} THEN 6% GATE → TOP-25 → 10-STOCK MAX-SHARPE · 5-25% BOX`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        <span className="faint" style={{ fontSize: 10.5 }}>TITLE SAYS ROY — CODE IS MAX-SHARPE (RF 6.5%, HURDLE 6%)</span>
      </div>
      {loading && <p className="muted">RANKING UNIVERSE + OPTIMIZING… (30-60S FIRST HIT)</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {data?.error && <p className="neg">{data.error}</p>}
      {o && (
        <>
          <div className="panel panel-glow">
            <p className="p-head">Verdict — 10-stock optimal</p>
            <div style={{ fontSize: 20, fontWeight: 800 }} className={o.expPct >= 6 ? "pos" : "neg"}>
              {o.expPct >= 6 ? "● CLEARS 6% HURDLE" : "● BELOW HURDLE"}
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>EXP {fmt(o.expPct)}% · VOL {fmt(o.volPct)}% · SHARPE {fmt(o.sharpe, 3)} · NIFTY EXP {fmt(data.benchmark?.expPct)}% · ALPHA {fmt(alpha)}pp</p>
          </div>
          <Cells items={[
            { l: "EXP 1Y%", v: `${fmt(o.expPct)}%`, s: "OPTIMAL", cls: "pos" },
            { l: "PROFIT ₹", v: `₹${Number(o.profit).toLocaleString("en-IN")}`, s: "ON ₹1L" },
            { l: "TOTAL ₹", v: `₹${Number(o.total).toLocaleString("en-IN")}`, s: "AFTER 1Y" },
            { l: "VOL%", v: `${fmt(o.volPct)}%`, s: `NIFTY ${fmt(data.benchmark?.volPct)}` },
            { l: "SHARPE", v: fmt(o.sharpe, 3), s: `NIFTY ${fmt(data.benchmark?.sharpe, 3)}` },
            { l: "PASSED", v: `${data.passed}/${data.scanned}`, s: `OF ${data.universe} REQUESTED` },
          ]} />
          {skips && (
            <div className="panel">
              <p className="p-head">Skipped — {skips.count} of {data.universe} produced no usable metric</p>
              <table className="plain">
                <thead><tr><th>REASON</th><th style={{ textAlign: "right" }}>SYMS</th></tr></thead>
                <tbody>
                  {Object.entries(skips.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <tr key={reason}><td>{reason}</td><td style={{ textAlign: "right" }}><strong>{n}</strong></td></tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SAMPLE: {skips.sample.map((s) => s.sym).join(", ")}
                {skips.count > skips.sample.length ? ` +${skips.count - skips.sample.length} MORE` : ""}
                {" · "}THE NOTEBOOK APPLIES <code>dropna(thresh=0.8)</code> AND KEEPS WHATEVER SURVIVES. HERE EVERY ONE OF
                THE {data.universe} IS REQUESTED AND THE {data.scanned} THAT ANSWERED ARE RANKED — AGAINST EACH OTHER,
                NOT AGAINST THE SURVIVORS OF THE 6% GATE.
              </p>
            </div>
          )}
          <div className="panel">
            <p className="p-head">Elite candidates — top {cands.length} by composite, after the 6% gate</p>
            <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>#</th><th>SYMBOL</th><th style={{ textAlign: "right" }}>SCORE</th><th style={{ textAlign: "right" }}>ACTUAL 1Y%</th><th style={{ textAlign: "right" }}>EXP 1Y%</th><th style={{ textAlign: "right" }}>VOL%</th><th style={{ textAlign: "right" }}>SHARPE</th><th style={{ textAlign: "right" }}>SORTINO</th><th style={{ textAlign: "right" }}>MDD%</th><th style={{ textAlign: "right" }}>IN BOOK</th></tr></thead>
                <tbody>
                  {cands.map((c, i) => {
                    const inBook = legs.some((l) => l.sym === c.sym);
                    return (
                      <tr key={c.sym} style={inBook ? { boxShadow: "inset 2px 0 0 var(--amber)" } : undefined}>
                        <td className="faint">{i + 1}</td>
                        <td><span className="sec">{c.sym}</span></td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(c.score, 3)}</strong></td>
                        <td style={{ textAlign: "right" }} className={(c.actualPct ?? 0) >= 0 ? "pos" : "neg"}>{fmt(c.actualPct)}</td>
                        <td style={{ textAlign: "right" }} className={(c.expPct ?? 0) >= 0 ? "pos" : "neg"}>{fmt(c.expPct)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(c.volPct, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(c.sharpe, 3)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(c.sortino, 3)}</td>
                        <td style={{ textAlign: "right" }} className="neg">{fmt(c.mddPct)}</td>
                        <td style={{ textAlign: "right" }}>{inBook ? <span className="warn">YES</span> : <span className="faint">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              SCORE = 0.30×EXP PCT-RANK + 0.20×ACTUAL PCT-RANK + 0.30×SHARPE PCT-RANK + 0.20×(−MDD) PCT-RANK, EACH RANK
              TAKEN OVER ALL {data.scanned} THAT ANSWERED · THE GATE IS ACTUAL&gt;0 AND EXP≥6%, APPLIED AFTER RANKING ·
              MARKED ROWS ARE THE TEN IN THE BOOK · LOWEST OVERLAP BETWEEN ANY PAIR OF DAILY TAPES: {data.minCovOverlap} SESSIONS
            </p>
          </div>
          <div className="panel">
            <p className="p-head">Optimal allocations — 5-25% box, Σ=1</p>
            <HBars rows={legs.map((l) => ({ label: l.sym, value: l.wPct, display: `${l.wPct}% · ₹${l.amt.toLocaleString("en-IN")}`, color: "var(--amber)" }))} />
            <div className="scrollx" style={{ marginTop: 8 }}>
              <table className="plain">
<thead><tr><th>LEG</th><th style={{ textAlign: "right" }}>W%</th><th style={{ textAlign: "right" }}>₹</th><th style={{ textAlign: "right" }}>EXP%</th><th style={{ textAlign: "right" }}>SHARPE</th><th style={{ textAlign: "right" }}>SORTINO</th><th style={{ textAlign: "right" }}>MDD%</th></tr></thead>
                  <tbody>
                    {legs.map((l) => (
                      <tr key={l.sym}><td><span className="sec">{l.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(l.wPct)}</td><td style={{ textAlign: "right" }}>{l.amt.toLocaleString("en-IN")}</td><td style={{ textAlign: "right" }}>{fmt(l.expPct)}</td><td style={{ textAlign: "right" }}>{fmt(l.sharpe, 3)}</td><td style={{ textAlign: "right" }}>{fmt(l.sortino, 3)}</td><td style={{ textAlign: "right" }} className="neg">{fmt(l.mddPct)}</td></tr>
                    ))}
                  </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              {data.method} · COVARIANCE IS PAIRED ON THE SAME TRADING DAY, NOT ON THE SAME ROW OFFSET, SO A GAP IN ONE
              TAPE CANNOT SILENTLY PAIR TWO DIFFERENT CALENDAR DAYS · WEIGHTS SUM {fmt(legs.reduce((a, l) => a + (l.wPct ?? 0), 0), 2)}% ·
              EXPECTED RETURN IS A LINEAR EXTRAPOLATION OF 2Y DAILY MEAN ×252, NOT A FORECAST — SEE THE AI BLOCK
            </p>
          </div>
          <AiBlock id="79" label="Safety-First Optimizer" context={`SCANNED ${data.scanned} OF ${data.universe} REQUESTED PASSED 6% GATE ${data.passed} ELITE ${data.eliteCount} CAPITAL Rs100000 OPT EXP ${o.expPct}% VOL ${o.volPct}% SHARPE ${o.sharpe} PROFIT Rs${o.profit} NIFTY EXP ${data.benchmark?.expPct}% SHARPE ${data.benchmark?.sharpe} LEGS ${legs.slice(0, 5).map((l: any) => `${l.sym} ${l.wPct}%`).join(" | ")}`} />
        </>
      )}
    </div>
  );
}

// ---- 80: Movers Rank (cells 7/8/9) ----
export function NbMoversDesk() {
  const [u, setU] = useState("FO");
  const [w, setW] = useState("1D");
  const { data, err, loading, reload } = useNb("movers", `universe=${u}&win=${w}`);
  const top: any[] = data?.top ?? [];
  const bot: any[] = data?.bottom ?? [];
  const allRows: any[] = data?.all ?? [];
  const skipped = data?.skipped as { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> } | undefined;
  const quar = data?.quarantined as { count: number; halted: number; stale: number; haltedSample: string[] } | undefined;
  const staleRows: any[] = data?.stale ?? [];
  // The notebook's cell prints LTP and Prev Close next to the percentage, so both
  // belong on the board - a +12.40% row tells you nothing about the two prices it
  // came from, and the prices are what you check the percentage against.
  const refBar = (r: any) => `${fmt(r.prevClose)} → ${fmt(r.price)}`;
  // BOTH returns two ranked windows from one scan — the notebook downloads 2mo
  // once and reads a week and a month off the same frame, and there is no reason
  // for the desk to charge for two passes.
  const windows: any[] = (data?.windows ?? []) as any[];
  const win0: any = windows[0] ?? {};
  const isBoth = w === "BOTH";
  const skips = skipped && skipped.count > 0 ? skipped : null;
  const qtn = quar && quar.count > 0 ? quar : null;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="80" sub={`MOVERS RANK · ${isBoth ? "1W + 1M, ONE SCAN" : `${w} TOP/BOTTOM ${w === "1D" ? 10 : 5}`} — ALL ${data?.universe ?? "—"} F&O NAMES SCANNED — SPOT EQUITY (NB TITLES SAY OPTIONS, CODE IS SPOT)`} />
      <div className="toolbar">
        <Pills opts={["1D", "1W", "1M", "BOTH"]} val={w} set={setW} />
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        {isBoth && windows.length === 2 && (
          <span className="faint" style={{ fontSize: 10.5 }}>
            {windows.map((x) => `${x.win}: ${x.ranked} RANKED · MEDIAN SPAN ${x.medianSpan}d (LIMIT ${x.spanLimit}d)`).join(" · ")}
          </span>
        )}
        <button
          className="ghost"
          onClick={() =>
            downloadCSV(
              `movers_${w.toLowerCase()}_${u.toLowerCase()}.csv`,
              ["TICKER", "LAST", "PREV_CLOSE", "CHG_PCT", "SPAN_CALENDAR_DAYS", "AS_OF"],
              allRows.map((r: any) => [r.sym, r.price, r.prevClose, r.chg, r.spanDays, r.date])
            )
          }
          title="Every symbol that produced a reading — the full ranked list, not just the 20 rows shown"
        >
          ⤓ CSV {allRows.length} ROWS
        </button>
      </div>
      {loading && <p className="muted">RANKING {u === "FO" ? 209 : "FULL NSE"}…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && top.length === 0 && <p className="muted">NO MOVERS — RETRY.</p>}
      {!isBoth && top.length > 0 && (
        <div className="grid grid-2">
          <div className="panel">
            <p className="p-head">Top 10 — {w} · {win0.ranked ?? top.length} ranked</p>
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>PREV→LAST</th><th style={{ textAlign: "right" }}>CHG%</th><th style={{ textAlign: "right" }}>SPAN</th></tr></thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }} className="faint">{refBar(r)}</td><td style={{ textAlign: "right" }} className={(r.chg ?? 0) >= 0 ? "pos" : "neg"}>{(r.chg ?? 0) >= 0 ? "+" : ""}{fmt(r.chg)}</td><td style={{ textAlign: "right" }} className="faint">{r.spanDays ?? "—"}d</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <p className="p-head">Bottom 10 — {w}</p>
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>PREV→LAST</th><th style={{ textAlign: "right" }}>CHG%</th><th style={{ textAlign: "right" }}>SPAN</th></tr></thead>
              <tbody>
                {bot.map((r) => (
                  <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }} className="faint">{refBar(r)}</td><td style={{ textAlign: "right" }} className={(r.chg ?? 0) >= 0 ? "pos" : "neg"}>{(r.chg ?? 0) >= 0 ? "+" : ""}{fmt(r.chg)}</td><td style={{ textAlign: "right" }} className="faint">{r.spanDays ?? "—"}d</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* BOTH: the notebook's four tables. One scan of 2mo serves the week and the
          month, which is the whole reason BOTH exists as a mode rather than two
          separate requests. */}
      {isBoth && windows.length === 2 && !loading && !err && (
        <>
          {windows.map((win: any) => (
            <div key={win.win} className="grid grid-2">
              <div className="panel">
                <p className="p-head">Top 5 — {win.win} · median span {win.medianSpan}d</p>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST ₹</th><th style={{ textAlign: "right" }}>CHG%</th><th style={{ textAlign: "right" }}>SPAN</th></tr></thead>
                  <tbody>
                    {win.top.map((r: any) => (
                      <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(r.price)}</td><td style={{ textAlign: "right" }} className={(r.chg ?? 0) >= 0 ? "pos" : "neg"}>{(r.chg ?? 0) >= 0 ? "+" : ""}{fmt(r.chg)}</td><td style={{ textAlign: "right" }} className="faint">{r.spanDays}d</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel">
                <p className="p-head">Bottom 5 — {win.win} · median span {win.medianSpan}d</p>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST ₹</th><th style={{ textAlign: "right" }}>CHG%</th><th style={{ textAlign: "right" }}>SPAN</th></tr></thead>
                  <tbody>
                    {win.bottom.map((r: any) => (
                      <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(r.price)}</td><td style={{ textAlign: "right" }} className={(r.chg ?? 0) >= 0 ? "pos" : "neg"}>{(r.chg ?? 0) >= 0 ? "+" : ""}{fmt(r.chg)}</td><td style={{ textAlign: "right" }} className="faint">{r.spanDays}d</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {windows.some((x: any) => x.top.some((r: any) => (r.chg ?? 0) < 0)) && (
            <p className="warn" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
              A RANK IS NOT A CLAIM. WHERE A TOP TABLE CONTAINS A RED ROW, FEWER THAN 5 NAMES
              ROSE IN THAT WINDOW AND THE TABLE IS PADDED WITH THE LEAST-BAD LOSSES.
            </p>
          )}
        </>
      )}
      {/* QUARANTINE. The notebook forward-fills halted names, which lands them at
          0.00% and quietly keeps them out of both lists. That is the right
          outcome, but it is invisible: a name simply never appears. Here the same
          names are removed from the ranking AND shown, with the reason and the
          real elapsed span, so "why isn't this stock on this list" is answerable
          without leaving the desk. */}
      {qtn && (
        <div className="panel">
          <p className="p-head">Held back from the ranking — {qtn.count} names whose print is not a real move</p>
          <div className="cells" style={{ marginBottom: 8 }}>
            <div className="cell"><div className="lbl">HALTED</div><div className="val" style={{ fontSize: 16 }}>{qtn.halted}</div><div className="sub">zero volume on the last print</div></div>
            <div className="cell"><div className="lbl">STALE</div><div className="val" style={{ fontSize: 16 }}>{qtn.stale}</div><div className="sub">span far longer than the median</div></div>
            <div className="cell"><div className="lbl">SKIPPED</div><div className="val" style={{ fontSize: 16 }}>{skips?.count ?? 0}</div><div className="sub">no usable reading at all</div></div>
          </div>
          {qtn.halted > 0 && (
            <p className="faint" style={{ fontSize: 10.5 }}>
              HALTED: {qtn.haltedSample.join(", ")}
              {qtn.halted > qtn.haltedSample.length ? ` +${qtn.halted - qtn.haltedSample.length} MORE` : ""}
            </p>
          )}
          {staleRows.length > 0 && (
            <table className="plain">
              <thead><tr><th>SEC</th><th>REASON</th><th style={{ textAlign: "right" }}>WOULD-HAVE-BEEN %</th><th style={{ textAlign: "right" }}>SPAN</th></tr></thead>
              <tbody>
                {staleRows.map((q: any) => (
                  <tr key={q.sym}>
                    <td><span className="sec">{q.sym}</span></td>
                    <td style={{ fontSize: 11 }}>{q.reason}</td>
                    <td style={{ textAlign: "right" }} className="faint">{q.chg === null ? "—" : `${q.chg > 0 ? "+" : ""}${q.chg}`}</td>
                    <td style={{ textAlign: "right" }} className="faint">{q.spanDays ?? "—"}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {qtn.stale > staleRows.length && (
            <p className="faint" style={{ fontSize: 10.5 }}>+{qtn.stale - staleRows.length} MORE STALE NOT LISTED</p>
          )}
          {skips && (
            <p className="faint" style={{ fontSize: 10.5 }}>
              SKIPPED BREAKDOWN: {Object.entries(skips.reasons).map(([r, n]) => `${r} ${n}`).join(" · ")} ·
              SAMPLE: {skips.sample.map((s) => s.sym).join(", ")}
            </p>
          )}
        </div>
      )}
      <p className="faint" style={{ fontSize: 10.5 }}>
        1D = LAST/SECOND-LAST CLOSE · 1W = ILOC[-6] · 1M = ILOC[-22] · COUNT {data?.count ?? "—"}/{data?.universe ?? "—"}
        {qtn ? ` · ${qtn.count} HELD BACK, SEE ABOVE` : ""} · SPAN = REAL ELAPSED CALENDAR DAYS BEHIND THE NUMBER
        {isBoth && " · BOTH WINDOWS SHARE ONE SCAN OF 2MO, NOT TWO SCANS"}
      </p>
      {/* A PADDED LIST. "Top 10" is a rank, not a claim that ten things went up.
          When fewer than ten names rose, the table must pad with the least-bad
          and those rows are RED - which reads as a broken render rather than a
          thin session. Testing whether the BEST name fell is the wrong question
          (it only catches a wholly-down universe); what matters is whether any
          row in the table is against its own direction. */}
      {!isBoth && top.some((r: any) => (r.chg ?? 0) < 0) && (
        <p className="warn" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
          FEWER THAN 10 NAMES ROSE. THE WINNERS TABLE IS A RANK, NOT A LIST OF GAINS —
          THE RED ROWS AT THE BOTTOM ARE THE LEAST-BAD LOSSES, PADDED IN BECAUSE NOTHING
          ELSE WAS AVAILABLE.
        </p>
      )}
      {bot.some((r: any) => (r.chg ?? 0) > 0) && (
        <p className="warn" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
          FEWER THAN 10 NAMES FELL. THE LOSERS TABLE IS A RANK, NOT A LIST OF LOSSES —
          THE GREEN ROWS ARE THE SMALLEST GAINS, PADDED IN BECAUSE NOTHING ELSE FELL.
        </p>
      )}
    </div>
  );
}

// ---- 81: Vol Range Dashboard (cell 10, single ticker) ----
export function NbVolDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=5y&interval=1d`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "history failed");
      setBars(j.bars ?? []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  const ltp = bars.length ? bars[bars.length - 1].close : NaN;
  const { daily, weekly, monthly, wkCount, moCount } = useMemo(() => {
    // No bar-count gate here. `rangeTable` already nulls out any window the
    // history cannot fill, so a short history should render the windows it CAN
    // support and dash the rest. The old `if (bars.length < 30) return {...empty}`
    // meant a recent IPO - the case with the least history and the most need for
    // an answer - showed a completely blank desk with no LTP and no explanation,
    // which is the opposite of what the notebook does: it renders each timeframe
    // independently and prints "Not enough daily data." where one is short.
    const wk: typeof bars = [];
    const mo: typeof bars = [];
    if (bars.length < 2) return { daily: [], weekly: [], monthly: [], wkCount: 0, moCount: 0 };
    /**
     * ISO WEEK KEY, ANCHORED TO THE WEEK'S OWN MONDAY.
     *
     * The old key was `${year}-W${Math.floor((daysSinceEpoch + 4) / 7)}` - the
     * bar's calendar year, glued to a continuous week counter that runs straight
     * through New Year. The trading week Mon 29 Dec 2025 - Fri 2 Jan 2026 is one
     * week to any exchange, but the three December bars keyed `2025-W2922` and
     * the two January bars keyed `2026-W2922`, so it was counted TWICE: two
     * partial weeks where there should be one full one.
     *
     * That is not a rounding artefact at the edge of the series. It happens once
     * a year, for five years of history, and each split week lands a stub in the
     * weekly window - a 1-day or 2-day "week" whose high/low and up/down moves
     * describe a fraction of a session and are then averaged in with the real
     * ones. The 260-week window silently ran on fewer genuine weeks than it
     * claimed.
     *
     * ISO weeks start on Monday, and each belongs to the year of its Monday, so
     * the key is derived from the Monday date rather than the bar date. This is
     * also exactly what W-FRI buckets on a Monday-to-Friday exchange, so the
     * grouping now matches the resample the notebook performs.
     */
    const isoWeekKey = (iso: string): string => {
      const d = new Date(iso + "T00:00:00Z");
      // Shift to the Thursday of this ISO week - the year that owns the week is
      // the year containing that Thursday.
      const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
      const thursday = new Date(d.getTime() + (3 - day) * 86400000);
      return `${thursday.getUTCFullYear()}-W${String(thursday.getUTCMonth() + 1).padStart(2, "0")}-${String(thursday.getUTCDate()).padStart(2, "0")}`;
    };
    const byW = new Map<string, typeof bars>();
    const byM = new Map<string, typeof bars>();
    for (const b of bars) {
      const d = new Date(b.date + "T00:00:00Z");
      const wkey = isoWeekKey(b.date);
      const mkey = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
      if (!byW.has(wkey)) byW.set(wkey, []);
      byW.get(wkey)!.push(b);
      if (!byM.has(mkey)) byM.set(mkey, []);
      byM.get(mkey)!.push(b);
    }
    for (const arr of byW.values()) {
      wk.push({ date: arr[arr.length - 1].date, open: arr[0].open, high: Math.max(...arr.map((x) => x.high)), low: Math.min(...arr.map((x) => x.low)), close: arr[arr.length - 1].close, volume: 0, time: 0 });
    }
    for (const arr of byM.values()) {
      mo.push({ date: arr[arr.length - 1].date, open: arr[0].open, high: Math.max(...arr.map((x) => x.high)), low: Math.min(...arr.map((x) => x.low)), close: arr[arr.length - 1].close, volume: 0, time: 0 });
    }
    return {
      daily: rangeTable(bars, [30, 60, 150, 300, 600, 1000], ltp),
      weekly: rangeTable(wk, [12, 26, 52, 104, 156, 260], ltp),
      monthly: rangeTable(mo, [3, 6, 12, 24, 36, 60], ltp),
      wkCount: wk.length,
      moCount: mo.length,
    };
  }, [bars, ltp]);
  const Tbl = ({ rows, tf }: { rows: ReturnType<typeof rangeTable>; tf: string }) => (
    <div className="scrollx">
      <table className="plain">
        <thead><tr><th>{tf} WIN</th><th style={{ textAlign: "right" }}>BARS</th><th style={{ textAlign: "right" }}>SWING%</th><th style={{ textAlign: "right" }}>UP%</th><th style={{ textAlign: "right" }}>DN%</th><th style={{ textAlign: "right" }}>PROJ LOW ₹</th><th style={{ textAlign: "right" }}>PROJ HIGH ₹</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.window}>
              <td>{r.window}</td>
              <td style={{ textAlign: "right" }} className="faint">
                {r.n >= (r as { window: number }).window
                  ? `${r.n}·${r.upN}/${r.downN}`
                  : `${r.n} <${r.window}`}
              </td>
              <td style={{ textAlign: "right" }}>{fmt(r.avgSwing)}</td>
              <td style={{ textAlign: "right" }} className="pos">{fmt(r.avgUp)}</td>
              <td style={{ textAlign: "right" }} className="neg">{fmt(r.avgDown)}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.projLow, 0)}</td>
              <td style={{ textAlign: "right" }}>{fmt(r.projHigh, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="81" sub={`VOL RANGE DASHBOARD · ${symbol} · LTP ₹${isFinite(ltp) ? ltp.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—"} · 5Y DAILY`} />
      {loading && <p className="muted">LOADING 5Y TAPE FOR {symbol}…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={load}>RETRY</button></p>}
      {/* Gated on whether anything was actually computed, not on a bar count, so a
          short history still gets its LTP and whichever windows it can fill. */}
      {bars.length > 1 && (
        <>
          <Cells items={[
            { l: "LTP ₹", v: isFinite(ltp) ? ltp.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—", s: `${bars.length} BARS` },
            { l: "D30 RANGE ₹", v: daily[0]?.projLow && daily[0]?.projHigh ? `${Math.round(daily[0].projLow as number).toLocaleString("en-IN")}↔${Math.round(daily[0].projHigh as number).toLocaleString("en-IN")}` : "—", s: "30D PROJ" },
            { l: "W52 RANGE ₹", v: weekly[2]?.projLow && weekly[2]?.projHigh ? `${Math.round(weekly[2].projLow as number).toLocaleString("en-IN")}↔${Math.round(weekly[2].projHigh as number).toLocaleString("en-IN")}` : "—", s: "52W PROJ" },
            { l: "M12 RANGE ₹", v: monthly[2]?.projLow && monthly[2]?.projHigh ? `${Math.round(monthly[2].projLow as number).toLocaleString("en-IN")}↔${Math.round(monthly[2].projHigh as number).toLocaleString("en-IN")}` : "—", s: "12M PROJ" },
          ]} />
          <div className="panel">
            <p className="p-head">Daily windows</p>
            {daily.some((r) => r.projLow !== null) ? <Tbl rows={daily} tf="D" /> : <p className="muted">NOT ENOUGH DAILY DATA — {bars.length} BARS.</p>}
          </div>
          <div className="panel">
            {/* The notebook resamples W-FRI; this buckets ISO weeks (Monday-start).
                For Mon-Fri trading those are the SAME grouping, but the code did
                not say so and the old label claimed a resample it never performed. */}
            <p className="p-head">Weekly windows · ISO weeks, Monday-start (same grouping as W-FRI on a Mon–Fri exchange)</p>
            {weekly.some((r) => r.projLow !== null) ? <Tbl rows={weekly} tf="W" /> : <p className="muted">NOT ENOUGH WEEKLY DATA — {wkCount} WEEKS FROM {bars.length} BARS.</p>}
          </div>
          <div className="panel">
            <p className="p-head">Monthly windows (month end)</p>
            {monthly.some((r) => r.projLow !== null) ? <Tbl rows={monthly} tf="M" /> : <p className="muted">NOT ENOUGH MONTHLY DATA — {moCount} MONTHS FROM {bars.length} BARS.</p>}
          </div>
          <div className="toolbar">
            <button
              className="ghost"
              onClick={() =>
                downloadCSV(
                  `volrange_${symbol.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}.csv`,
                  ["TIMEFRAME", "WINDOW", "BARS_USED", "UP_BARS", "DOWN_BARS", "AVG_SWING_PCT", "AVG_UP_PCT", "AVG_DOWN_PCT", "PROJ_LOW", "PROJ_HIGH"],
                  [
                    ...daily.map((r) => ["D", r.window, r.n, r.upN, r.downN, r.avgSwing, r.avgUp, r.avgDown, r.projLow, r.projHigh]),
                    ...weekly.map((r) => ["W", r.window, r.n, r.upN, r.downN, r.avgSwing, r.avgUp, r.avgDown, r.projLow, r.projHigh]),
                    ...monthly.map((r) => ["M", r.window, r.n, r.upN, r.downN, r.avgSwing, r.avgUp, r.avgDown, r.projLow, r.projHigh]),
                  ]
                )
              }
            >
              ⤓ CSV ALL WINDOWS
            </button>
          </div>
          <p className="faint" style={{ fontSize: 10.5 }}>
            SWING = (H-L)/L% · UP/DN = MEAN OF SIGNED BARS ONLY, SO UP AND DN HAVE DIFFERENT
            DENOMINATORS — THE BARS COLUMN SHOWS n·up/down, AND n&lt;WINDOW MEANS THE HISTORY CANNOT
            FILL IT · FIRST RETURN IN EACH WINDOW IS MEASURED AGAINST THE CLOSE OUTSIDE IT · PROJ
            ANCHORED TO SPOT LTP · THIS IS THE NOTEBOOK&apos;S AVERAGE ONE-BAR MOVE APPLIED TO THE
            CURRENT PRICE, NOT A MULTI-BAR OR CONFIDENCE-BAND FORECAST: THE 1000-DAY ROW CARRIES
            THE SAME DAILY MOVE AS THE 30-DAY ROW
          </p>
        </>
      )}
    </div>
  );
}

// ---- 82: Sector Scanner (cell 12) ----
export function NbSectorDesk() {
  const { data, err, loading, reload } = useNb("sector", "");
  const secs: any[] = data?.sectors ?? [];
  const leaders: any[] = data?.leaders ?? [];
  const skipped = data?.skipped as { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> } | undefined;
  const skips = skipped && skipped.count > 0 ? skipped : null;
  // A sector whose 1M mean rests on fewer names than its membership implies is a
  // different claim from one averaging a full slate, and the board used to show
  // both identically.
  const thinSectors = secs.filter((s) => s.count > 0 && s.n1m < s.count);
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="82" sub={`SECTOR SCANNER · ${data?.universe ?? "—"} SYMS / ${data?.sectorCount ?? "—"} SECTORS (NB MAP VERBATIM) · 1D/1W/1M MEANS`} />
      <div className="toolbar"><button className="ghost" onClick={reload}>↻ RETRY</button><span className="faint" style={{ fontSize: 10.5 }}>FETCHED {data?.fetched ?? "—"}/{data?.universe ?? "—"} · MAP HOLDS {data?.sectorsTotal ?? "—"} NAMES</span></div>
      {loading && <p className="muted">AGGREGATING SECTORS…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {skips && (
        <div className="panel">
          <p className="p-head">Skipped — {skips.count} of {data.universe} mapped names returned no tape</p>
          <table className="plain">
            <thead><tr><th>REASON</th><th style={{ textAlign: "right" }}>SYMS</th></tr></thead>
            <tbody>
              {Object.entries(skips.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                <tr key={reason}><td>{reason}</td><td style={{ textAlign: "right" }}><strong>{n}</strong></td></tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 10.5 }}>
            SAMPLE: {skips.sample.map((s) => s.sym).join(", ")}
            {" · "}THE NOTEBOOK BUILDS A ROW FOR EVERY COLUMN OF ITS FRAME AND LETS safe_ret RETURN NaN, SO A
            MISSING NAME STILL COUNTS TOWARD N. THESE ARE THE ONES THAT COULD NOT BE FETCHED AT ALL.
          </p>
        </div>
      )}
      {secs.length > 0 && (
        <>
          <div className="panel">
            <p className="p-head">Sectors by avg 1M% desc</p>
            <HBars rows={secs.map((s) => ({ label: `${s.name} (${s.count})`, value: Math.abs(s.m1 ?? 0), display: `${fmt(s.m1)}%`, color: (s.m1 ?? 0) >= 0 ? "var(--green)" : "var(--red)" }))} />
          </div>
          <div className="panel">
            <p className="p-head">Sector board</p>
            <div className="scrollx" style={{ maxHeight: 380, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>SECTOR</th><th style={{ textAlign: "right" }}>N</th><th style={{ textAlign: "right" }}>1D% (n)</th><th style={{ textAlign: "right" }}>1W% (n)</th><th style={{ textAlign: "right" }}>1M% (n)</th></tr></thead>
                <tbody>
                  {secs.map((s) => (
                    <tr key={s.name}>
                      <td><strong>{s.name}</strong></td>
                      <td style={{ textAlign: "right" }} className="faint">{s.count}</td>
                      <td style={{ textAlign: "right" }} className={(s.d1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(s.d1)}{s.n1d < s.count ? <span className="warn"> ·{s.n1d}</span> : null}</td>
                      <td style={{ textAlign: "right" }} className={(s.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(s.w1)}{s.n1w < s.count ? <span className="warn"> ·{s.n1w}</span> : null}</td>
                      <td style={{ textAlign: "right" }} className={(s.m1 ?? 0) >= 0 ? "pos" : "neg"}><strong>{(s.m1 ?? 0) >= 0 ? "+" : ""}{fmt(s.m1)}</strong>{s.n1m < s.count ? <span className="warn"> ·{s.n1m}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>
              N = NAMES MAPPED TO THE SECTOR, WHICH IS NOT THE NUMBER BEHIND EACH MEAN · AN AMBER
              ·n IS HOW MANY OF THOSE NAMES ACTUALLY PRODUCED THAT READING, SO A SECTOR CAN SHOW A
              CONFIDENT MEAN BESIDE A COUNT THAT IMPLIES FAR MORE NAMES THAN WERE AVERAGED ·
              {thinSectors.length > 0 ? ` ${thinSectors.length} SECTOR(S) HAVE A SHORT 1M BASE` : " EVERY SECTOR HAS A FULL 1M BASE"}
            </p>
          </div>
          <div className="panel">
            <p className="p-head">Top 10 by 1M%</p>
            <table className="plain">
              <thead><tr><th>SEC</th><th>SECTOR</th><th style={{ textAlign: "right" }}>1M%</th></tr></thead>
              <tbody>
                {leaders.map((l) => (
                  <tr key={l.sym}><td><span className="sec">{l.sym}</span></td><td className="faint" style={{ fontSize: 11 }}>{l.sec}</td><td style={{ textAlign: "right" }} className="pos">+{fmt(l.m1)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="faint" style={{ fontSize: 10.5 }}>TITLE SAYS OPTIONS — CODE IS SPOT 1D/1W/1M · MAP QUIRKS (MAXHEALTH∈INS, PFC/REC∈INFRA) PRESERVED</p>
          </div>
        </>
      )}
    </div>
  );
}

// ---- 83: IPO Listings (cell 14) ----
export function NbIpoDesk() {
  const { data, err, loading, reload } = useNb("ipo", "");
  const boards = data?.boards ?? {};
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="83" sub="IPO LISTINGS · SCREENER.IN VIA SERVER PROXY · 1H CACHE" />
      <div className="toolbar"><button className="ghost" onClick={reload}>↻ RETRY</button><a href="https://www.screener.in/ipo/" target="_blank" rel="noopener" style={{ fontSize: 12 }}>SCREENER →</a></div>
      {loading && <p className="muted">SCRAPING 3 IPO BOARDS…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {Object.keys(boards).map((k) => (
        <div className="panel" key={k}>
          <p className="p-head">{boards[k].label} — {boards[k].rows?.length ?? 0} ROWS</p>
          {boards[k].error && <p className="neg">ERR: {boards[k].error}</p>}
          {boards[k].rows?.length > 0 && (
            <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr>{boards[k].cols.map((c: string) => <th key={c}>{c.toUpperCase().slice(0, 18)}</th>)}</tr></thead>
                <tbody>
                  {boards[k].rows.map((r: string[], i: number) => (
                    <tr key={i}>{r.map((c, j) => <td key={j} style={{ fontSize: 11.5 }}>{j === 0 ? <strong>{c}</strong> : c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <p className="faint" style={{ fontSize: 10.5 }}>RAW SCREENER GRID PASS-THROUGH · NO COMPUTED FIELDS · COLUMNS = WHATEVER SCREENER RETURNS</p>
    </div>
  );
}

// ---- 84: NSE Intelligence Terminal (cell 15) ----
function median(xs: number[]): number | null {
  const a = xs.filter((v) => isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function Flag({ v }: { v: boolean | null | undefined }) {
  if (v === null || v === undefined) return <span className="faint">—</span>;
  return <span className={v ? "pos" : "neg"}>{v ? "YES" : "NO"}</span>;
}

export function NbTerminalDesk() {
  const [u, setU] = useState("FO");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("OVERVIEW");
  const qs = `universe=${u}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data, err, loading, reload } = useNb("terminal", qs);
  const rows: any[] = data?.rows ?? [];
  // Resolved to a definite value before the JSX so the panel can narrow on it;
  // `skipped?.count > 0 && ...` does not narrow inside the closure.
  const skipped = data?.skipped as
    | { count: number; reasons: Record<string, number>; sample: Array<{ sym: string; reason: string }> }
    | undefined;
  const skips = skipped && skipped.count > 0 ? skipped : null;

  const top = useMemo(() => [...rows].sort((a, b) => (b.mom ?? -1) - (a.mom ?? -1)).slice(0, 12), [rows]);
  const ob = useMemo(() => rows.filter((r) => (r.rsi ?? 0) >= 70).slice(0, 10), [rows]);
  const os = useMemo(() => rows.filter((r) => (r.rsi ?? 0) <= 30).slice(0, 10), [rows]);
  const hiv = useMemo(() => [...rows].sort((a, b) => (b.straddlePct ?? -1) - (a.straddlePct ?? -1)).slice(0, 12), [rows]);
  const tech = useMemo(() => [...rows].sort((a, b) => (b.rsi ?? -1) - (a.rsi ?? -1)).slice(0, 15), [rows]);
  const risky = useMemo(() => [...rows].sort((a, b) => (b.hv ?? -1) - (a.hv ?? -1)).slice(0, 15), [rows]);
  const seas = useMemo(
    () => rows.filter((r) => r.sea && r.sea.avg !== null).sort((a, b) => (b.sea.avg ?? -1e9) - (a.sea.avg ?? -1e9)),
    [rows]
  );
  const momHist = useMemo(() => rows.map((r) => r.mom).filter((v: any) => v !== null && v !== undefined), [rows]);
  const hvHist = useMemo(() => rows.map((r) => r.hv).filter((v: any) => v !== null && v !== undefined), [rows]);
  const seaHist = useMemo(
    () => rows.map((r) => r.sea?.avg).filter((v: any) => v !== null && v !== undefined),
    [rows]
  );
  const sectors = useMemo(() => {
    const g: Record<string, { n: number; up: number; moms: number[]; hvs: number[] }> = {};
    for (const r of rows) {
      const k = r.sec || "OTHERS";
      g[k] ??= { n: 0, up: 0, moms: [], hvs: [] };
      g[k].n += 1;
      if ((r.w1 ?? 0) > 0) g[k].up += 1;
      if (r.mom !== null && r.mom !== undefined) g[k].moms.push(r.mom);
      if (r.hv !== null && r.hv !== undefined) g[k].hvs.push(r.hv);
    }
    return Object.entries(g)
      .map(([sec, v]) => ({ sec, n: v.n, up: v.up, breadth: v.up / Math.max(v.n, 1), medMom: median(v.moms), medHv: median(v.hvs) }))
      .sort((a, b) => (b.medMom ?? -1) - (a.medMom ?? -1));
  }, [rows]);
  const verdict = useMemo(() => {
    if (!rows.length || !data) return "";
    const breadth = data.gainers / Math.max(data.count, 1);
    const med = median(rows.map((r) => r.mom));
    const medHv = median(hvHist);
    const tone = breadth > 0.6 && (med ?? 50) > 55 ? "RISK-ON"
      : breadth < 0.4 || (med ?? 50) < 45 ? "RISK-OFF" : "MIXED";
    return `${tone} · BREADTH ${(breadth * 100).toFixed(0)}% UP 1W · MED MOM RANK ${fmt(med, 1)} · MED HV20 ${fmt(medHv, 1)}% · DTE ${data.daysToExpiry} · COVERED ${data.count}/${data.requested}`;
  }, [rows, data, hvHist]);

  const csv = () =>
    downloadCSV(
      `nse_terminal_${data?.seaName?.toLowerCase() ?? "month"}_${u.toLowerCase()}.csv`,
      ["RANK_SUM", "TICKER", "SECTOR", "LTP", "D1_PCT", "W1_PCT", "M1_PCT", "M3_PCT", "M6_PCT", "Y1_PCT",
        "NB_RSI_14", "HV20_ANN_PCT", "ATR_14", "BB_POS_PCT", "BB_WIDTH_PCT", "STOCH_K", "STOCH_D", "Z20",
        "ABOVE_SMA20", "ABOVE_SMA50", "ABOVE_SMA200", "GOLDEN_CROSS", "MACD_BULL", "MACD_HIST",
        "PCT_FROM_52W_HIGH", "PCT_FROM_52W_LOW", "DD_CUR_PCT", "DD_MAX_PCT",
        "SHARPE", "SORTINO", "CALMAR", "BETA_1Y", "VOL_RATIO_20", "SIG_COUNT_6",
        "STRADDLE_PROXY_PCT", "EXPECTED_MOVE_PCT",
        "SEA_AVG_PCT", "SEA_WIN_PCT", "SEA_SHARPE", "SEA_MAX_PCT", "SEA_MIN_PCT", "SEA_YEARS", "BARS"],
      rows.map((r: any) => [
        r.mom, r.sym, r.sec, r.ltp, r.d1, r.w1, r.m1, r.m3, r.m6, r.y1,
        r.rsi, r.hv, r.atr, r.bbPos, r.bbWidth, r.stochK, r.stochD, r.z,
        r.a20, r.a50, r.a200, r.golden, r.macdBull, r.macdHist,
        r.h52, r.l52, r.dd?.cur ?? null, r.dd?.max ?? null,
        r.sharpe, r.sortino, r.calmar, r.beta, r.vr, r.sig,
        r.straddlePct, r.emPct,
        r.sea?.avg ?? null, r.sea?.wr ?? null, r.sea?.sharpe ?? null,
        r.sea?.max ?? null, r.sea?.min ?? null, r.sea?.n ?? null, r.bars,
      ])
    );

  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="84" sub={`NSE INTELLIGENCE TERMINAL v5 PORT · ${data?.count ?? "—"} OF ${data?.universe ?? "—"} F&O SYMS COVERED · NB-RSI(SIMPLE) · HV-PROXY OPTIONS · NEXT MONTH ${data?.seaName ?? "—"}${data?.seaMonth ? ` (M${data.seaMonth})` : ""} · DTE ${data?.daysToExpiry ?? "—"}`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <Pills opts={["OVERVIEW", "MOMENTUM", "OPTIONS", "TECHNICAL", "RISK", "SEASONALITY", "SECTOR", "ALL"]} val={tab} set={setTab} />
        <input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="FILTER…" style={{ maxWidth: 130 }} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        <button className="ghost" onClick={csv} disabled={!rows.length} title="Every covered row, all 28 metrics, gaps left blank">⤓ CSV {rows.length} ROWS</button>
      </div>
      {loading && <p className="muted">COMPUTING 28-METRIC BOARD… (30-60S FIRST HIT)</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ROWS COVERED — RETRY.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "COVERED", v: String(data.count), s: `OF ${data.requested} REQUESTED` },
            { l: "SKIPPED", v: String(data.skipped?.count ?? 0), s: "NO READABLE TAPE", cls: data.skipped?.count ? "neg" : undefined },
            { l: "GAINERS 1W", v: String(data.gainers), s: `${fmt(data.gainers / Math.max(data.count, 1) * 100, 0)}%`, cls: "pos" },
            { l: "LOSERS 1W", v: String(data.losers), s: "1W≤0", cls: "neg" },
            { l: "MED MOM", v: fmt(median(momHist), 1), s: "CROSS-SEC RANK" },
            { l: "DTE", v: String(data.daysToExpiry), s: "LAST THU" },
          ]} />
          <div className="panel panel-glow">
            <p className="p-head">Verdict</p>
            <p style={{ margin: 0, fontSize: 13, letterSpacing: "0.02em" }}>{verdict}</p>
            {!data.betaTape && (
              <p className="neg" style={{ margin: "6px 0 0 0", fontSize: 11.5 }}>
                NIFTY TAPE OFF — BETA COLUMN IS EMPTY, NOT LOW. IT IS A GAP, NOT A READING.
              </p>
            )}
          </div>
          {skips && (
            <div className="panel">
              <p className="p-head">Skipped — {skips.count} of {data.requested} requested never produced a reading</p>
              <table className="plain">
                <thead><tr><th>REASON</th><th style={{ textAlign: "right" }}>SYMS</th></tr></thead>
                <tbody>
                  {Object.entries(skips.reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <tr key={reason}><td>{reason}</td><td style={{ textAlign: "right" }}><strong>{n}</strong></td></tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SAMPLE: {skips.sample.map((s: any) => s.sym).join(", ")}
                {skips.count > skips.sample.length ? ` +${skips.count - skips.sample.length} MORE` : ""}
                {" · "}EVERY BREADTH, RANK AND MEDIAN ABOVE IS DRAWN FROM THE {data.count} THAT ANSWERED, NOT FROM {data.requested}. STALE TAPES ARE QUARANTINED, NOT SHOWN AS LIVE PRICES.
              </p>
            </div>
          )}
          {(tab === "OVERVIEW" || tab === "MOMENTUM") && (
            <div className="panel">
              <p className="p-head">Top momentum — MomScore cross-sectional rank (1M·20 + 3M·30 + 6M·35 + 1Y·15)</p>
              <div className="scrollx" style={{ maxHeight: 360, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LTP ₹</th><th style={{ textAlign: "right" }}>1W%</th><th style={{ textAlign: "right" }}>3M%</th><th style={{ textAlign: "right" }}>6M%</th><th style={{ textAlign: "right" }}>1Y%</th><th style={{ textAlign: "right" }}>NB-RSI</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>MOM</th><th style={{ textAlign: "right" }}>SIG/6</th></tr></thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                        <td style={{ textAlign: "right" }}>{fmt(r.ltp)}</td>
                        <td style={{ textAlign: "right" }} className={(r.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.w1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m3 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m3)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m6 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m6)}</td>
                        <td style={{ textAlign: "right" }} className={(r.y1 ?? 0) >= 0 ? "pos" : "neg"}>{r.y1 === null || r.y1 === undefined ? "—" : fmt(r.y1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.rsi, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.beta)}</td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(r.mom, 1)}</strong></td>
                        <td style={{ textAlign: "right" }}>{r.sig}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                MOM = SUM OF FOUR CROSS-SECTIONAL PERCENTILE RANKS: 1M×20 + 3M×30 + 6M×35 + 1Y×15, EACH RANK TAKEN
                OVER ALL {data.count} THAT ANSWERED, CEILING 100 · A MISSING HORIZON RANKS 0 AND CONTRIBUTES NOTHING,
                WHICH IS WHY {rows.filter((r: any) => r.y1 === null || r.y1 === undefined).length} ROWS SHOW — IN Y1 ·
                A NAME CAN LEAD WITH A NEGATIVE 1M IF ITS LONGER HORIZONS DOMINATE · RF 6.5% IN SHARPE/SORTINO
              </p>
              {(data.momBase ?? 0) < 20 && (
                <p className="warn" style={{ fontSize: 11.5, margin: "6px 0 0 0" }}>
                  RANK BASE IS ONLY {data.momBase} NAMES — THE FILTER NARROWED IT. A "100" HERE IS THE BEST OF A
                  HANDFUL OF TICKERS, NOT A REAL QUANTILE. CLEAR THE FILTER FOR A RANK YOU CAN TRADE ON.
                </p>
              )}
            </div>
          )}
          {tab === "OVERVIEW" && (
            <>
              <div className="grid grid-2">
                <div className="panel">
                  <p className="p-head">Breadth 1W</p>
                  <Donut slices={[{ label: "GAIN", value: data.gainers, color: "var(--green)" }, { label: "LOSS", value: data.losers, color: "var(--red)" }]} />
                </div>
                <div className="panel">
                  <p className="p-head">OB / OS (NB-RSI simple-mean)</p>
                  <div className="kv"><span className="muted">OB ≥70</span><strong className="neg">{ob.map((r) => r.sym).join(" · ") || "—"}</strong></div>
                  <div className="kv"><span className="muted">OS ≤30</span><strong className="pos">{os.map((r) => r.sym).join(" · ") || "—"}</strong></div>
                  <p className="faint" style={{ fontSize: 10.5 }}>RSI HERE = SIMPLE 14D MEAN (NB FORMULA), NOT WILDER</p>
                </div>
              </div>
              <div className="panel">
                <p className="p-head">MomScore rank distribution — where the tape actually sits</p>
                <Histogram values={momHist} bins={20} height={120} color="var(--sec)" />
              </div>
            </>
          )}
          {(tab === "OVERVIEW" || tab === "OPTIONS") && (
            <div className="panel">
              <p className="p-head">Options proxy — HV straddle (no chain: σ=HV20, K=S, T=DTE)</p>
              <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>HV%</th><th style={{ textAlign: "right" }}>STRADDLE%</th><th style={{ textAlign: "right" }}>EM±%</th><th style={{ textAlign: "right" }}>LTP ₹</th></tr></thead>
                  <tbody>
                    {hiv.map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span></td>
                        <td style={{ textAlign: "right" }}>{fmt(r.hv, 1)}</td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(r.straddlePct)}</strong></td>
                        <td style={{ textAlign: "right" }}>±{fmt(r.emPct)}</td>
                        <td style={{ textAlign: "right" }} className="faint">{fmt(r.ltp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                NO OPTION CHAIN IS FETCHED — σ IS BACKED-OUT HV20, NOT IV. SKIN VALUES AND IV PREMIUM ARE ABSENT,
                SO READ THIS AS A RANKING OF EXPECTED MOVE, NEVER AS A PRICE YOU CAN TRADE.
              </p>
            </div>
          )}
          {tab === "OPTIONS" && (
            <div className="panel">
              <p className="p-head">Expected move — proxy straddle % across the covered tape</p>
              <Histogram values={rows.map((r) => r.straddlePct).filter((v: any) => v !== null && v !== undefined)} bins={20} height={120} />
            </div>
          )}
          {tab === "TECHNICAL" && (
            <div className="panel">
              <p className="p-head">Technical state — oscillators and trend stack</p>
              <div className="scrollx" style={{ maxHeight: 440, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>RSI</th><th style={{ textAlign: "right" }}>STOCH K</th><th style={{ textAlign: "right" }}>STOCH D</th><th style={{ textAlign: "right" }}>BB%</th><th style={{ textAlign: "right" }}>BBW%</th><th style={{ textAlign: "right" }}>Z20</th><th style={{ textAlign: "right" }}>ATR</th><th style={{ textAlign: "right" }}>SMA20</th><th style={{ textAlign: "right" }}>SMA50</th><th style={{ textAlign: "right" }}>SMA200</th><th style={{ textAlign: "right" }}>GOLD</th><th style={{ textAlign: "right" }}>MACD</th><th style={{ textAlign: "right" }}>MACD H</th></tr></thead>
                  <tbody>
                    {tech.map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                        <td style={{ textAlign: "right" }} className={(r.rsi ?? 0) >= 70 ? "neg" : (r.rsi ?? 50) <= 30 ? "pos" : undefined}>{fmt(r.rsi, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.stochK, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.stochD, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.bbPos, 0)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.bbWidth, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.z, 2)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.atr)}</td>
                        <td style={{ textAlign: "right" }}><Flag v={r.a20} /></td>
                        <td style={{ textAlign: "right" }}><Flag v={r.a50} /></td>
                        <td style={{ textAlign: "right" }}><Flag v={r.a200} /></td>
                        <td style={{ textAlign: "right" }}><Flag v={r.golden} /></td>
                        <td style={{ textAlign: "right" }}><Flag v={r.macdBull} /></td>
                        <td style={{ textAlign: "right" }} className={((r.macdHist ?? 0) >= 0) ? "pos" : "neg"}>{fmt(r.macdHist, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                BB% = POSITION IN THE 20D BAND (0 = LOWER, 100 = UPPER) · BBW% = BAND WIDTH AS % OF ITS MA, A
                SQUEEZE INDICATOR · Z20 = SIGMA FROM 20D MEAN · MACD H = MACD LINE − SIGNAL, THE ACTUAL HISTOGRAM
                · STOCH D IS THE TRUE 3-PERIOD MEAN OF %K, NOT A COPY OF IT · SIG/6 COUNTS RSI 40-60, MACD,
                SMA50, SMA200, GOLDEN AND STOCH&gt;50
              </p>
            </div>
          )}
          {tab === "RISK" && (
            <>
              <div className="panel">
                <p className="p-head">Risk stack — volatility, Sharpe, drawdown, volume</p>
                <div className="scrollx" style={{ maxHeight: 380, overflowY: "auto" }}>
                  <table className="plain">
                    <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>HV20%</th><th style={{ textAlign: "right" }}>SHARPE</th><th style={{ textAlign: "right" }}>SORTINO</th><th style={{ textAlign: "right" }}>CALMAR</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>DD NOW%</th><th style={{ textAlign: "right" }}>DD MAX%</th><th style={{ textAlign: "right" }}>% FROM 52W H</th><th style={{ textAlign: "right" }}>% FROM 52W L</th><th style={{ textAlign: "right" }}>VOL×20</th><th style={{ textAlign: "right" }}>BARS</th></tr></thead>
                    <tbody>
                      {risky.map((r) => (
                        <tr key={r.sym}>
                          <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                          <td style={{ textAlign: "right" }}><strong>{fmt(r.hv, 1)}</strong></td>
                          <td style={{ textAlign: "right" }}>{fmt(r.sharpe, 2)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(r.sortino, 2)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(r.calmar, 2)}</td>
                          <td style={{ textAlign: "right" }}>{fmt(r.beta)}</td>
                          <td style={{ textAlign: "right" }} className="neg">{fmt(r.dd?.cur)}</td>
                          <td style={{ textAlign: "right" }} className="neg">{fmt(r.dd?.max)}</td>
                          <td style={{ textAlign: "right" }} className="neg">{r.h52 === null ? "—" : fmt(r.h52)}</td>
                          <td style={{ textAlign: "right" }} className="pos">{r.l52 === null ? "—" : fmt(r.l52)}</td>
                          <td style={{ textAlign: "right" }} className={((r.vr ?? 1) >= 1.5) ? "warn" : undefined}>{fmt(r.vr, 2)}</td>
                          <td style={{ textAlign: "right" }} className="faint">{r.bars}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="faint" style={{ fontSize: 10.5 }}>
                  SHARPE/SORTINO ANNUALISED AT √252 OVER DAILY EXCESS RETURNS, RF 6.5% · SORTINO USES NEGATIVE DAYS
                  ONLY, SO A NAME THAT NEVER FALLS REPORTS — RATHER THAN A FIGURE OFF A DEFINITION THAT DOES NOT HOLD ·
                  CALMAR = ANNUALISED RETURN / MAX DRAWDOWN · 52W WINDOWS RUN ON min(len,252) BARS WITH
                  MIN_PERIODS=20 · DD IS PEAK-TO-TRUNCH ON CLOSES · A LOW BARS COUNT MEANS THE 200D READINGS ARE NOT AVAILABLE
                </p>
              </div>
              <div className="panel">
                <p className="p-head">HV20 distribution</p>
                <Histogram values={hvHist} bins={20} height={120} />
              </div>
            </>
          )}
          {tab === "SEASONALITY" && (
            <div className="panel">
              <p className="p-head">Next-month seasonality — {data.seaName} (M{data.seaMonth}), 10Y monthly</p>
              {seas.length === 0 ? (
                <p className="muted">NO TICKER HAS 3+ OBSERVATIONS OF {data.seaName} — TOO SHORT TO SCORE.</p>
              ) : (
                <>
                  <BarChart values={seas.slice(0, 20).map((r) => r.sea.avg)} labels={seas.slice(0, 20).map((r) => r.sym)} height={130} />
                  <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
                    <table className="plain">
                      <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>{data.seaName} AVG%</th><th style={{ textAlign: "right" }}>WIN%</th><th style={{ textAlign: "right" }}>YEARS</th><th style={{ textAlign: "right" }}>MOM RANK</th></tr></thead>
                      <tbody>
                        {seas.slice(0, 60).map((r) => (
                          <tr key={r.sym}>
                            <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                            <td style={{ textAlign: "right" }} className={(r.sea.avg ?? 0) >= 0 ? "pos" : "neg"}><strong>{fmt(r.sea.avg)}</strong></td>
                            <td style={{ textAlign: "right" }}>{fmt(r.sea.wr, 0)}</td>
                            <td style={{ textAlign: "right" }} className={(r.sea.n ?? 0) < 5 ? "warn" : undefined}>{r.sea.n}</td>
                            <td style={{ textAlign: "right" }} className="faint">{fmt(r.mom, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="faint" style={{ fontSize: 10.5 }}>
                    THIS IS THE UPCOMING CALENDAR MONTH, NOT THE ONE CLOSING · SKIP UNDER 3 OBSERVATIONS ·
                    AMBER YEARS &lt; 5 IS A THIN SAMPLE, NOT A STRONG EDGE · {seas.filter((r) => (r.sea.n ?? 0) < 5).length} OF {seas.length} ARE THIN
                  </p>
                </>
              )}
            </div>
          )}
          {tab === "SECTOR" && (
            <>
              <div className="panel">
                <p className="p-head">Sector map — median MomScore rank</p>
                <HBars rows={sectors.slice(0, 18).map((s) => ({
                  label: s.sec, value: s.medMom ?? 0, display: fmt(s.medMom, 1),
                  color: (s.medMom ?? 0) >= 50 ? "var(--green)" : "var(--red)",
                }))} />
              </div>
              <div className="panel">
                <p className="p-head">Sector breadth 1W — share of names up</p>
                <BarChart
                  values={sectors.map((s) => s.breadth * 100)}
                  labels={sectors.map((s) => s.sec.slice(0, 4))}
                  height={130}
                />
              </div>
              <div className="panel">
                <p className="p-head">Sector table</p>
                <table className="plain">
                  <thead><tr><th>SECTOR</th><th style={{ textAlign: "right" }}>NAMES</th><th style={{ textAlign: "right" }}>UP 1W</th><th style={{ textAlign: "right" }}>BREADTH%</th><th style={{ textAlign: "right" }}>MED MOM</th><th style={{ textAlign: "right" }}>MED HV%</th></tr></thead>
                  <tbody>
                    {sectors.map((s) => (
                      <tr key={s.sec}>
                        <td><span className="sec">{s.sec}</span></td>
                        <td style={{ textAlign: "right" }}>{s.n}</td>
                        <td style={{ textAlign: "right" }}>{s.up}</td>
                        <td style={{ textAlign: "right" }} className={s.breadth > 0.5 ? "pos" : "neg"}>{fmt(s.breadth * 100, 0)}</td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(s.medMom, 1)}</strong></td>
                        <td style={{ textAlign: "right" }}>{fmt(s.medHv, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SECTOR TAGS COME FROM A FIXED MANUAL MAP OVER THE 209 F&O NAMES — A NAME MISSING FROM IT LANDS IN OTHERS,
                AND THE TAGS DO NOT MOVE WHEN A COMPANY RECLASSIFIES.
              </p>
            </>
          )}
          {tab === "ALL" && (
            <div className="panel">
              <p className="p-head">All covered tickers — {rows.length} of {data.count} (filter narrows server-side)</p>
              <div className="scrollx" style={{ maxHeight: 480, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LTP</th><th style={{ textAlign: "right" }}>1D</th><th style={{ textAlign: "right" }}>1W</th><th style={{ textAlign: "right" }}>1M</th><th style={{ textAlign: "right" }}>3M</th><th style={{ textAlign: "right" }}>6M</th><th style={{ textAlign: "right" }}>RSI</th><th style={{ textAlign: "right" }}>HV</th><th style={{ textAlign: "right" }}>Z20</th><th style={{ textAlign: "right" }}>SH</th><th style={{ textAlign: "right" }}>SO</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>MOM</th><th style={{ textAlign: "right" }}>{data.seaName}</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 150).map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                        <td style={{ textAlign: "right" }}>{fmt(r.ltp)}</td>
                        <td style={{ textAlign: "right" }} className={(r.d1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.d1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.w1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m3 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m3)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m6 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m6)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.rsi, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.hv, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.z, 2)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.sharpe, 2)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.sortino, 2)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.beta)}</td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(r.mom, 0)}</strong></td>
                        <td style={{ textAlign: "right" }} className="faint">{r.sea ? fmt(r.sea.avg) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>
                SHOWING {Math.min(rows.length, 150)} OF {rows.length} · CSV EXPORTS ALL {rows.length} WITH EVERY METRIC ·
                {data.skipped?.count ? `${data.skipped.count} REQUESTED SYMS ARE NOT IN THIS TABLE AT ALL — SEE SKIPPED ABOVE · ` : ""}
                EVERY — IS A GENUINE GAP, NOT A ZERO
              </p>
            </div>
          )}
          <AiBlock id="84" label="NSE Intelligence Terminal" context={`BOARD ${data.count}/${data.requested} SYMS COVERED GAIN ${data.gainers} LOSS ${data.losers} DTE ${data.daysToExpiry} BETA_TAPE ${data.betaTape ? "OK" : "OFF"} SKIPPED ${data.skipped?.count ?? 0} TOP-MOM ${top.slice(0, 5).map((r: any) => `${r.sym} RANK${r.mom} RSI${r.rsi} SIG${r.sig}`).join(" | ")} HOT-VOL ${hiv.slice(0, 3).map((r: any) => `${r.sym} STRADDLE${r.straddlePct}%`).join(" | ")} SEASONALITY_${data.seaName} TOP ${seas.slice(0, 3).map((r: any) => `${r.sym} ${r.sea.avg}%`).join(" | ")} OB ${ob.slice(0, 4).map((r: any) => r.sym).join(",") || "NONE"}`} />
        </>
      )}
    </div>
  );
}
