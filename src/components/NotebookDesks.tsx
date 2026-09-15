"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { rangeTable } from "@/lib/notebook";
import { HBars, BarChart, Donut } from "@/components/charts";

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
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="76" sub={`SEASONALITY SCANNER · NEXT-MONTH ${data?.monthName?.toUpperCase() ?? ""} · SHARPE-RANKED · ${data?.universe ?? "—"} SYMS`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
        <span className="faint" style={{ fontSize: 10.5 }}>209 F&O DEFAULT · ALL = FULL NSE (SLOW)</span>
      </div>
      {loading && <p className="muted">SCANNING 10Y MONTHLY TAPE…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ROWS PASSED MIN_YEARS=5 — RETRY.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "TARGET", v: data.monthName?.slice(0, 3).toUpperCase() ?? "—", s: `M${data.targetMonth}` },
            { l: "SCANNED", v: String(data.count), s: `OF ${data.universe}` },
            { l: "TOP SHARPE", v: fmt(rows[0]?.sharpe, 3), s: rows[0]?.sym ?? "" },
            { l: "TOP AVG%", v: `${fmt(rows[0]?.avg)}%`, s: `WIN ${fmt(rows[0]?.win, 1)}%` },
            { l: "MED WIN%", v: `${fmt(rows[Math.floor(rows.length / 2)]?.win, 1)}%`, s: "MEDIAN" },
          ]} />
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
            <p className="faint" style={{ fontSize: 10.5 }}>RET = MONTHLY % · SHARPE = AVG/STD (SAMPLE) · SKIP N&lt;5 · LTP = 5D DAILY LAST</p>
          </div>
          <AiBlock id="76" label="Seasonality Scanner" context={`NEXT MONTH ${data.monthName} TOP ${rows.slice(0, 5).map((r: any) => `${r.sym} SH ${r.sharpe} AVG ${r.avg}% WIN ${r.win}%`).join(" | ")}`} />
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
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="77" sub="SMA 50/200 CROSSOVER SCREENER · 2Y DAILY · AT≤3D / POST 4-20D / 2% PROXIMITY" />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
      </div>
      {loading && <p className="muted">SCANNING 2Y TAPE…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ACTIONABLE CROSSES — UNIVERSE NEUTRAL.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "SCANNED", v: String(data.count), s: `OF ${data.universe}` },
            { l: "AT CROSS", v: String((counts["AT BULLISH CROSS"] ?? 0) + (counts["AT BEARISH CROSS"] ?? 0)), s: "≤3D" },
            { l: "POST", v: String((counts["POST BULLISH CROSS"] ?? 0) + (counts["POST BEARISH CROSS"] ?? 0)), s: "4-20D" },
            { l: "APPROACH", v: String((counts["APPROACHING BULLISH CROSS"] ?? 0) + (counts["APPROACHING BEARISH CROSS"] ?? 0)), s: "≤2%" },
            { l: "BULL SHARE", v: `${fmt(rows.filter((r) => r.signal === "BULLISH").length / Math.max(rows.length, 1) * 100, 0)}%`, s: "OF ACTIONABLE" },
          ]} />
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
            <p className="faint" style={{ fontSize: 10.5 }}>SMA = SIMPLE MEAN 50/200 · SKIP &lt;200 BARS · NEUTRAL ROWS HIDDEN</p>
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
          <p className="p-head">{mode === "PAIRS" ? `Negative pairs — ${data.kept}/${data.universe} kept · ${data.count} pairs` : `Most inverse to ${data.target}`}</p>
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
          <p className="faint" style={{ fontSize: 10.5 }}>RET = DAILY % · PEARSON · PAIRS CAPPED 150 (CELLS 4/11 PARITY) · SINGLE SHOWS TOP-25, HEAD-3 IS THE HEDGE</p>
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
  const o = data?.opt;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="79" sub="SAFETY-FIRST OPTIMIZER v4 · 2Y · 4-FACTOR RANK → TOP-25 → 10-STOCK MAX-SHARPE · 5-25% BOX" />
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
            <p className="muted" style={{ fontSize: 11.5 }}>EXP {fmt(o.expPct)}% · VOL {fmt(o.volPct)}% · SHARPE {fmt(o.sharpe, 3)} · NIFTY EXP {fmt(data.benchmark?.expPct)}%</p>
          </div>
          <Cells items={[
            { l: "EXP 1Y%", v: `${fmt(o.expPct)}%`, s: "OPTIMAL", cls: "pos" },
            { l: "PROFIT ₹", v: `₹${Number(o.profit).toLocaleString("en-IN")}`, s: "ON ₹1L" },
            { l: "TOTAL ₹", v: `₹${Number(o.total).toLocaleString("en-IN")}`, s: "AFTER 1Y" },
            { l: "VOL%", v: `${fmt(o.volPct)}%`, s: "ANN" },
            { l: "SHARPE", v: fmt(o.sharpe, 3), s: `NIFTY ${fmt(data.benchmark?.sharpe, 3)}` },
            { l: "PASSED", v: `${data.passed}/${data.scanned}`, s: "6% FILTER" },
          ]} />
          <div className="panel">
            <p className="p-head">Optimal allocations — 5-25% box, Σ=1</p>
            <HBars rows={legs.map((l) => ({ label: l.sym, value: l.wPct, display: `${l.wPct}% · ₹${l.amt.toLocaleString("en-IN")}`, color: "#ffa028" }))} />
            <div className="scrollx" style={{ marginTop: 8 }}>
              <table className="plain">
                <thead><tr><th>LEG</th><th style={{ textAlign: "right" }}>W%</th><th style={{ textAlign: "right" }}>₹</th><th style={{ textAlign: "right" }}>EXP%</th><th style={{ textAlign: "right" }}>SHARPE</th></tr></thead>
                <tbody>
                  {legs.map((l) => (
                    <tr key={l.sym}><td><span className="sec">{l.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(l.wPct)}</td><td style={{ textAlign: "right" }}>{l.amt.toLocaleString("en-IN")}</td><td style={{ textAlign: "right" }}>{fmt(l.expPct)}</td><td style={{ textAlign: "right" }}>{fmt(l.sharpe, 3)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 10.5 }}>{data.method} · SORTINO COMPUTED IN NB BUT UNUSED — OMITTED · 80% COVERAGE RULE</p>
          </div>
          <AiBlock id="79" label="Safety-First Optimizer" context={`OPT EXP ${o.expPct}% VOL ${o.volPct}% SH ${o.sharpe} LEGS ${legs.slice(0, 5).map((l: any) => `${l.sym} ${l.wPct}%`).join(" | ")}`} />
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
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="80" sub={`MOVERS RANK · ${w} % — SPOT EQUITY (NB TITLES SAY OPTIONS, CODE IS SPOT)`} />
      <div className="toolbar">
        <Pills opts={["1D", "1W", "1M"]} val={w} set={setW} />
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
      </div>
      {loading && <p className="muted">RANKING {u === "FO" ? 209 : "FULL NSE"}…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && top.length === 0 && <p className="muted">NO MOVERS — RETRY.</p>}
      {top.length > 0 && (
        <div className="grid grid-2">
          <div className="panel">
            <p className="p-head">Top 10 — {w}</p>
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST ₹</th><th style={{ textAlign: "right" }}>CHG%</th></tr></thead>
              <tbody>
                {top.map((r) => (
                  <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(r.price)}</td><td style={{ textAlign: "right" }} className="pos">+{fmt(r.chg)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <p className="p-head">Bottom 10 — {w}</p>
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST ₹</th><th style={{ textAlign: "right" }}>CHG%</th></tr></thead>
              <tbody>
                {bot.map((r) => (
                  <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(r.price)}</td><td style={{ textAlign: "right" }} className="neg">{fmt(r.chg)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="faint" style={{ fontSize: 10.5 }}>1D = LAST/SECOND-LAST CLOSE · 1W = IL0C[-6] · 1M = ILOC[-22] · COUNT {data?.count ?? "—"}/{data?.universe ?? "—"}</p>
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
  const { daily, weekly, monthly } = useMemo(() => {
    if (bars.length < 30) return { daily: [], weekly: [], monthly: [] };
    const wk: typeof bars = [];
    const mo: typeof bars = [];
    const byW = new Map<string, typeof bars>();
    const byM = new Map<string, typeof bars>();
    for (const b of bars) {
      const d = new Date(b.date + "T00:00:00Z");
      const wkey = `${d.getUTCFullYear()}-W${Math.floor((d.getTime() / 86400000 + 4) / 7)}`;
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
    };
  }, [bars, ltp]);
  const Tbl = ({ rows, tf }: { rows: ReturnType<typeof rangeTable>; tf: string }) => (
    <div className="scrollx">
      <table className="plain">
        <thead><tr><th>{tf} WIN</th><th style={{ textAlign: "right" }}>SWING%</th><th style={{ textAlign: "right" }}>UP%</th><th style={{ textAlign: "right" }}>DN%</th><th style={{ textAlign: "right" }}>PROJ LOW ₹</th><th style={{ textAlign: "right" }}>PROJ HIGH ₹</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.window}>
              <td>{r.window}</td>
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
      {bars.length > 30 && (
        <>
          <Cells items={[
            { l: "LTP ₹", v: isFinite(ltp) ? ltp.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : "—", s: `${bars.length} BARS` },
            { l: "D30 RANGE ₹", v: daily[0]?.projLow && daily[0]?.projHigh ? `${Math.round(daily[0].projLow as number).toLocaleString("en-IN")}↔${Math.round(daily[0].projHigh as number).toLocaleString("en-IN")}` : "—", s: "30D PROJ" },
            { l: "W52 RANGE ₹", v: weekly[2]?.projLow && weekly[2]?.projHigh ? `${Math.round(weekly[2].projLow as number).toLocaleString("en-IN")}↔${Math.round(weekly[2].projHigh as number).toLocaleString("en-IN")}` : "—", s: "52W PROJ" },
            { l: "M12 RANGE ₹", v: monthly[2]?.projLow && monthly[2]?.projHigh ? `${Math.round(monthly[2].projLow as number).toLocaleString("en-IN")}↔${Math.round(monthly[2].projHigh as number).toLocaleString("en-IN")}` : "—", s: "12M PROJ" },
          ]} />
          <div className="panel"><p className="p-head">Daily windows</p><Tbl rows={daily} tf="D" /></div>
          <div className="panel"><p className="p-head">Weekly windows (W-FRI)</p><Tbl rows={weekly} tf="W" /></div>
          <div className="panel"><p className="p-head">Monthly windows (ME)</p><Tbl rows={monthly} tf="M" /></div>
          <p className="faint" style={{ fontSize: 10.5 }}>SWING = (H-L)/L% · UP/DN = MEAN OF SIGNED DAYS ONLY · PROJ ANCHORED TO SPOT LTP</p>
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
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="82" sub="SECTOR SCANNER · 208 SYMS / 19 SECTORS (NB MAP VERBATIM) · 1D/1W/1M MEANS" />
      <div className="toolbar"><button className="ghost" onClick={reload}>↻ RETRY</button><span className="faint" style={{ fontSize: 10.5 }}>FETCHED {data?.fetched ?? "—"}/{data?.universe ?? "—"}</span></div>
      {loading && <p className="muted">AGGREGATING SECTORS…</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {secs.length > 0 && (
        <>
          <div className="panel">
            <p className="p-head">Sectors by avg 1M% desc</p>
            <HBars rows={secs.map((s) => ({ label: `${s.name} (${s.count})`, value: Math.abs(s.m1 ?? 0), display: `${fmt(s.m1)}%`, color: (s.m1 ?? 0) >= 0 ? "#00d664" : "#ff453a" }))} />
          </div>
          <div className="panel">
            <p className="p-head">Sector board</p>
            <div className="scrollx" style={{ maxHeight: 380, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>SECTOR</th><th style={{ textAlign: "right" }}>N</th><th style={{ textAlign: "right" }}>1D%</th><th style={{ textAlign: "right" }}>1W%</th><th style={{ textAlign: "right" }}>1M%</th></tr></thead>
                <tbody>
                  {secs.map((s) => (
                    <tr key={s.name}>
                      <td><strong>{s.name}</strong></td>
                      <td style={{ textAlign: "right" }} className="faint">{s.count}</td>
                      <td style={{ textAlign: "right" }} className={(s.d1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(s.d1)}</td>
                      <td style={{ textAlign: "right" }} className={(s.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(s.w1)}</td>
                      <td style={{ textAlign: "right" }} className={(s.m1 ?? 0) >= 0 ? "pos" : "neg"}><strong>{(s.m1 ?? 0) >= 0 ? "+" : ""}{fmt(s.m1)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
export function NbTerminalDesk() {
  const [u, setU] = useState("FO");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("OVERVIEW");
  const qs = `universe=${u}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data, err, loading, reload } = useNb("terminal", qs);
  const rows: any[] = data?.rows ?? [];
  const top = useMemo(() => [...rows].sort((a, b) => (b.mom ?? -1) - (a.mom ?? -1)).slice(0, 12), [rows]);
  const ob = useMemo(() => rows.filter((r) => (r.rsi ?? 0) >= 70).slice(0, 10), [rows]);
  const os = useMemo(() => rows.filter((r) => (r.rsi ?? 0) <= 30).slice(0, 10), [rows]);
  const hiv = useMemo(() => [...rows].sort((a, b) => (b.straddlePct ?? -1) - (a.straddlePct ?? -1)).slice(0, 10), [rows]);
  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head id="84" sub={`NSE INTELLIGENCE TERMINAL v5 PORT · 209 SYMS · NB-RSI(SIMPLE) · HV-PROXY OPTIONS · DTE ${data?.daysToExpiry ?? "—"}`} />
      <div className="toolbar">
        <Pills opts={["FO", "ALL"]} val={u} set={setU} />
        <Pills opts={["OVERVIEW", "MOMENTUM", "OPTIONS", "ALL"]} val={tab} set={setTab} />
        <input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="FILTER…" style={{ maxWidth: 130 }} />
        <button className="ghost" onClick={reload}>↻ RETRY</button>
      </div>
      {loading && <p className="muted">COMPUTING 28-METRIC BOARD… (30-60S FIRST HIT)</p>}
      {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO ROWS — RETRY.</p>}
      {rows.length > 0 && (
        <>
          <Cells items={[
            { l: "COVERED", v: String(data.count), s: `OF ${data.universe}` },
            { l: "GAINERS 1W", v: String(data.gainers), s: `${fmt(data.gainers / Math.max(data.count, 1) * 100, 0)}%`, cls: "pos" },
            { l: "LOSERS 1W", v: String(data.losers), s: "1W≤0", cls: "neg" },
            { l: "OB RSI≥70", v: String(ob.length), s: "OVERBOUGHT" },
            { l: "OS RSI≤30", v: String(os.length), s: "OVERSOLD" },
            { l: "DTE", v: String(data.daysToExpiry), s: "LAST THU" },
          ]} />
          {(tab === "OVERVIEW" || tab === "MOMENTUM") && (
            <div className="panel">
              <p className="p-head">Top momentum — MomScore (1M·20 + 3M·30 + 6M·35 + 1Y·15)</p>
              <div className="scrollx" style={{ maxHeight: 360, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LTP ₹</th><th style={{ textAlign: "right" }}>1W%</th><th style={{ textAlign: "right" }}>1M%</th><th style={{ textAlign: "right" }}>NB-RSI</th><th style={{ textAlign: "right" }}>HV%</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>MOM</th><th style={{ textAlign: "right" }}>SIG/6</th></tr></thead>
                  <tbody>
                    {top.map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span> <span className="faint" style={{ fontSize: 10 }}>{r.sec}</span></td>
                        <td style={{ textAlign: "right" }}>{fmt(r.ltp)}</td>
                        <td style={{ textAlign: "right" }} className={(r.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.w1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.rsi, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.hv, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.beta)}</td>
                        <td style={{ textAlign: "right" }}><strong>{fmt(r.mom, 1)}</strong></td>
                        <td style={{ textAlign: "right" }}>{r.sig}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab === "OVERVIEW" && (
            <div className="grid grid-2">
              <div className="panel">
                <p className="p-head">Breadth 1W</p>
                <Donut slices={[{ label: "GAIN", value: data.gainers, color: "#00d664" }, { label: "LOSS", value: data.losers, color: "#ff453a" }]} />
              </div>
              <div className="panel">
                <p className="p-head">OB / OS (NB-RSI simple-mean)</p>
                <div className="kv"><span className="muted">OB ≥70</span><strong className="neg">{ob.map((r) => r.sym).join(" · ") || "—"}</strong></div>
                <div className="kv"><span className="muted">OS ≤30</span><strong className="pos">{os.map((r) => r.sym).join(" · ") || "—"}</strong></div>
                <p className="faint" style={{ fontSize: 10.5 }}>RSI HERE = SIMPLE 14D MEAN (NB FORMULA), NOT WILDER</p>
              </div>
            </div>
          )}
          {(tab === "OVERVIEW" || tab === "OPTIONS") && (
            <div className="panel">
              <p className="p-head">Options proxy — HV straddle (no chain: σ=HV20, K=S, T=DTE)</p>
              <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>HV%</th><th style={{ textAlign: "right" }}>STRADDLE%</th><th style={{ textAlign: "right" }}>EM±%</th></tr></thead>
                  <tbody>
                    {hiv.map((r) => (
                      <tr key={r.sym}><td><span className="sec">{r.sym}</span></td><td style={{ textAlign: "right" }}>{fmt(r.hv, 1)}</td><td style={{ textAlign: "right" }}><strong>{fmt(r.straddlePct)}</strong></td><td style={{ textAlign: "right" }}>±{fmt(r.emPct)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {tab === "ALL" && (
            <div className="panel">
              <p className="p-head">All tickers — {rows.length} (filter narrows server-side)</p>
              <div className="scrollx" style={{ maxHeight: 480, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LTP</th><th style={{ textAlign: "right" }}>1D</th><th style={{ textAlign: "right" }}>1W</th><th style={{ textAlign: "right" }}>1M</th><th style={{ textAlign: "right" }}>RSI</th><th style={{ textAlign: "right" }}>HV</th><th style={{ textAlign: "right" }}>SH</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>MOM</th><th style={{ textAlign: "right" }}>SEA</th></tr></thead>
                  <tbody>
                    {rows.slice(0, 150).map((r) => (
                      <tr key={r.sym}>
                        <td><span className="sec">{r.sym}</span></td>
                        <td style={{ textAlign: "right" }}>{fmt(r.ltp)}</td>
                        <td style={{ textAlign: "right" }} className={(r.d1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.d1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.w1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.w1)}</td>
                        <td style={{ textAlign: "right" }} className={(r.m1 ?? 0) >= 0 ? "pos" : "neg"}>{fmt(r.m1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.rsi, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.hv, 1)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.sharpe, 2)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.beta)}</td>
                        <td style={{ textAlign: "right" }}>{fmt(r.mom, 0)}</td>
                        <td style={{ textAlign: "right" }} className="faint">{r.sea ? `${fmt(r.sea.avg)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 10.5 }}>FIRST 150 SHOWN · USE FILTER FOR REST · IV_RANK BUG (RANK==PCT) FIXED — SINGLE HV FIELD SHOWN</p>
            </div>
          )}
          <AiBlock id="84" label="NSE Intelligence Terminal" context={`BOARD ${data.count} SYMS GAIN ${data.gainers} LOSS ${data.losers} TOP-MOM ${top.slice(0, 5).map((r: any) => `${r.sym} M${r.mom} RSI${r.rsi}`).join(" | ")} OB ${ob.slice(0, 4).map((r: any) => r.sym).join(",") || "NONE"}`} />
        </>
      )}
    </div>
  );
}
