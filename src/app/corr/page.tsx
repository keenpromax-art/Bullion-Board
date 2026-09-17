"use client";

import { useEffect, useMemo, useState } from "react";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { HBars } from "@/components/charts";

const DEFAULT_SYMS = "RELIANCE.NS,HDFCBANK.NS,ICICIBANK.NS,INFY.NS,TCS.NS,SBIN.NS,ITC.NS,LT.NS";
const PRESETS: Record<string, string> = {
  LEADERS: DEFAULT_SYMS,
  BANKS: "HDFCBANK.NS,ICICIBANK.NS,SBIN.NS,KOTAKBANK.NS,AXISBANK.NS,INDUSINDBK.NS",
  IT: "INFY.NS,TCS.NS,HCLTECH.NS,WIPRO.NS,TECHM.NS",
  HEAVY: "RELIANCE.NS,LT.NS,NTPC.NS,ONGC.NS,POWERGRID.NS,COALINDIA.NS",
};

type CorrData = { labels: string[]; matrix: (number | null)[][]; n: number };

const short = (s: string) => s.replace(".NS", "");

function downloadCSV(name: string, header: string[], rows: unknown[][]) {
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

export default function CorrPage() {
  const [input, setInput] = useState(DEFAULT_SYMS);
  const [syms, setSyms] = useState(DEFAULT_SYMS);
  const [data, setData] = useState<CorrData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/corr?syms=${encodeURIComponent(syms)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "corr failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [syms]);

  const stats = useMemo(() => {
    if (!data) return null;
    const { labels, matrix } = data;
    const pairs: Array<{ a: string; b: string; v: number }> = [];
    const acc = new Map<string, { s: number; c: number }>();
    labels.forEach((l) => acc.set(l, { s: 0, c: 0 }));
    let sum = 0, cnt = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const v = matrix[i]?.[j];
        if (typeof v !== "number" || !isFinite(v)) continue;
        pairs.push({ a: labels[i], b: labels[j], v });
        sum += v; cnt++;
        acc.get(labels[i])!.s += v; acc.get(labels[i])!.c++;
        acc.get(labels[j])!.s += v; acc.get(labels[j])!.c++;
      }
    }
    const desc = [...pairs].sort((x, y) => y.v - x.v);
    const asc = [...pairs].sort((x, y) => x.v - y.v);
    const byAvg = labels
      .map((l) => ({ sym: l, avg: acc.get(l)!.c ? acc.get(l)!.s / acc.get(l)!.c : NaN }))
      .sort((x, y) => x.avg - y.avg);
    return {
      pairs, desc, asc,
      mean: cnt ? sum / cnt : NaN,
      max: desc[0] ?? null, min: asc[0] ?? null,
      byAvg,
      bestDiv: byAvg[0] ?? null,
      mostLinked: byAvg[byAvg.length - 1] ?? null,
    };
  }, [data]);

  const symCount = input.split(",").map((s) => s.trim()).filter(Boolean).length;
  const hotKey = (a: string, b: string) =>
    stats?.max && ((stats.max.a === a && stats.max.b === b) || (stats.max.a === b && stats.max.b === a));
  const coldKey = (a: string, b: string) =>
    stats?.min && ((stats.min.a === a && stats.min.b === b) || (stats.min.a === b && stats.min.b === a));

  function cellStyle(v: number | null, i: number, j: number, a: string, b: string): React.CSSProperties {
    if (v === null) return { background: "transparent", color: "#5b5b62" };
    if (i === j) return { background: "rgba(161,161,170,0.08)", color: "#5b5b62" };
    const alpha = Math.min(0.55, 0.08 + Math.abs(v) * 0.45);
    const bg = v >= 0 ? `rgba(0,214,100,${alpha})` : `rgba(255,69,58,${alpha})`;
    const style: React.CSSProperties = { background: bg, color: "#f5f5f4" };
    if (Math.abs(v) >= 0.5) style.fontWeight = 700;
    if (hotKey(a, b) || coldKey(a, b)) style.outline = "1px solid var(--amber)";
    return style;
  }

  const askAI = async () => {
    if (!data || !stats) return;
    const topPairs = stats.desc.slice(0, 5).map((p) => `${short(p.a)}×${short(p.b)}=${p.v.toFixed(2)}`).join(", ");
    const loosest = stats.asc.slice(0, 3).map((p) => `${short(p.a)}×${short(p.b)}=${p.v.toFixed(2)}`).join(", ");
    const summary = `N=${data.n} SECS=${data.labels.length} MEAN_CORR=${stats.mean.toFixed(2)} TIGHTEST=${topPairs} LOOSEST=${loosest} BEST_DIV=${stats.bestDiv ? short(stats.bestDiv.sym) + "=" + stats.bestDiv.avg.toFixed(2) : "—"} MOST_LINKED=${stats.mostLinked ? short(stats.mostLinked.sym) + "=" + stats.mostLinked.avg.toFixed(2) : "—"}`;
    setAiLoading(true); setAiOut("");
    try {
      const r = await chatComplete([
        { role: "system", content: aiSystem.correlation() },
        { role: "user", content: `${NO_INVENT}\n\n${summary}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(r);
    } catch { setAiOut("AI UNAVAILABLE."); }
    setAiLoading(false);
  };

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Correlation — 1Y daily log returns {data ? `· N=${data.n}` : ""}</p>
          <div className="toolbar">
            <input className="box" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="SYM1,SYM2,… (MAX 12)" style={{ flex: 2 }} spellCheck={false} autoComplete="off" />
            <button className="btn" onClick={() => setSyms(input)} disabled={loading || symCount === 0}>{loading ? "RUNNING…" : "RUN"}</button>
            {data && (
              <button
                className="ghost"
                onClick={() => downloadCSV(
                  "corr-matrix.csv",
                  ["SEC", ...data.labels.map(short)],
                  data.labels.map((l, i) => [short(l), ...data.matrix[i].map((v) => (v === null ? "" : v))])
                )}
              >↓ CSV</button>
            )}
            <span className="faint" style={{ fontSize: 11 }}>{symCount}/12 SEC</span>
          </div>
          <div className="pills" style={{ marginTop: 8 }}>
            {Object.entries(PRESETS).map(([k, v]) => (
              <button key={k} className={`pill${syms === v ? " active" : ""}`} onClick={() => { setInput(v); setSyms(v); }}>{k}</button>
            ))}
          </div>
          {loading && <p className="muted">COMPUTING MATRIX…</p>}
          {err && <p className="neg">ERR: {err}</p>}
        </div>

        {stats && data && (
          <div className="cells">
            <div className="cell"><div className="lbl">Universe</div><div className="val" style={{ fontSize: 16 }}>{data.labels.length} <span className="faint" style={{ fontSize: 11 }}>SEC</span></div><div className="sub">N={data.n} sessions</div></div>
            <div className="cell"><div className="lbl">Mean corr</div><div className="val" style={{ fontSize: 16 }}>{isFinite(stats.mean) ? stats.mean.toFixed(2) : "—"}</div><div className="sub">off-diagonal avg</div></div>
            <div className="cell"><div className="lbl">Tightest pair</div><div className="val pos" style={{ fontSize: 15 }}>{stats.max ? `${short(stats.max.a)}×${short(stats.max.b)}` : "—"}</div><div className="sub">{stats.max ? stats.max.v.toFixed(2) : ""} lockstep</div></div>
            <div className="cell"><div className="lbl">Loosest pair</div><div className="val" style={{ fontSize: 15, color: "var(--amber)" }}>{stats.min ? `${short(stats.min.a)}×${short(stats.min.b)}` : "—"}</div><div className="sub">{stats.min ? stats.min.v.toFixed(2) : ""} diversifier</div></div>
            <div className="cell"><div className="lbl">Best diversifier</div><div className="val" style={{ fontSize: 15 }}>{stats.bestDiv ? short(stats.bestDiv.sym) : "—"}</div><div className="sub">{stats.bestDiv && isFinite(stats.bestDiv.avg) ? `avg ${stats.bestDiv.avg.toFixed(2)}` : ""}</div></div>
            <div className="cell"><div className="lbl">Most linked</div><div className="val" style={{ fontSize: 15 }}>{stats.mostLinked ? short(stats.mostLinked.sym) : "—"}</div><div className="sub">{stats.mostLinked && isFinite(stats.mostLinked.avg) ? `avg ${stats.mostLinked.avg.toFixed(2)}` : ""} hedge-risk</div></div>
          </div>
        )}

        {data && (
          <div className="panel" style={{ overflowX: "auto" }}>
            <table className="plain">
              <thead>
                <tr>
                  <th></th>
                  {data.labels.map((l) => <th key={l} style={{ textAlign: "right" }} title={l}>{short(l)}</th>)}
                  <th style={{ textAlign: "right" }} title="MEAN CORR VS REST">AVG</th>
                </tr>
              </thead>
              <tbody>
                {data.labels.map((l, i) => {
                  const avg = stats?.byAvg.find((x) => x.sym === l)?.avg;
                  return (
                    <tr key={l}>
                      <td><strong title={l}>{short(l)}</strong></td>
                      {data.matrix[i].map((v, j) => (
                        <td
                          key={j}
                          style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", ...cellStyle(v, i, j, l, data.labels[j]) }}
                          title={i === j ? `${short(l)} × ITSELF` : `${short(l)} × ${short(data.labels[j])} = ${v === null ? "—" : v.toFixed(2)}`}
                        >
                          {v === null ? "—" : v.toFixed(2)}
                        </td>
                      ))}
                      <td className="faint" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={`${short(l)} MEAN VS REST`}>
                        {avg !== undefined && isFinite(avg) ? avg.toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 11.5 }}>+1 LOCKSTEP · 0 UNRELATED · −1 MIRROR. AMBER FRAME = EXTREMES. AVG = MEAN VS REST — LOW AVG DIVERSIFIES, HIGH AVG HEDGES POORLY.</p>
          </div>
        )}

        {stats && data && stats.pairs.length > 0 && (
          <div className="grid grid-3">
            <div className="panel">
              <p className="p-head">Tightest — moves together</p>
              {stats.desc.slice(0, 6).map((p) => (
                <div key={p.a + p.b} className="kv">
                  <span>{short(p.a)}×{short(p.b)}</span>
                  <strong className={p.v >= 0.5 ? "pos" : ""}>{p.v.toFixed(2)}</strong>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>PAIR-HEDGE WITHIN THESE = WEAK. SIZE DOWN.</p>
            </div>
            <div className="panel">
              <p className="p-head">Loosest — diversifiers</p>
              {stats.asc.slice(0, 6).map((p) => (
                <div key={p.a + p.b} className="kv">
                  <span>{short(p.a)}×{short(p.b)}</span>
                  <strong style={{ color: "var(--amber)" }}>{p.v.toFixed(2)}</strong>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>PREFER THESE LEGS FOR HEDGES + BLENDS.</p>
            </div>
            <div className="panel">
              <p className="p-head">Mean linkage — per sec</p>
              <HBars rows={stats.byAvg.map((x) => ({
                label: short(x.sym),
                value: isFinite(x.avg) ? x.avg : 0,
                display: isFinite(x.avg) ? x.avg.toFixed(2) : "—",
                color: x.avg >= 0.5 ? "#00d664" : x.avg <= 0.2 ? "#ffa028" : "#a1a1aa",
              }))} />
            </div>
          </div>
        )}
        {aiOut && (
          <div className="panel"><p className="p-head">AI analyst</p><p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p></div>
        )}
        {data && !aiOut && (
          <div className="panel"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "ANALYSING…" : "RUN AI"}</button></div>
        )}
      </main>
      <StatusBar extra={`CORR${data ? ` · ${data.labels.length} SEC · N=${data.n}` : ""}`} />
    </>
  );
}
