"use client";

import { useEffect, useMemo, useState } from "react";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { AreaChart, BarChart } from "@/components/charts";

type Tab = "HIST" | "DVD" | "SPLIT";
type Range = "1mo" | "3mo" | "6mo" | "1y" | "3y" | "5y";

const RANGES: Range[] = ["1mo", "3mo", "6mo", "1y", "3y", "5y"];

export default function EventsPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [input, setInput] = useState("RELIANCE.NS");
  const [tab, setTab] = useState<Tab>("HIST");
  const [range, setRange] = useState<Range>("1y");
  const [hist, setHist] = useState<any[]>([]);
  const [ev, setEv] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(60);

  const askAI = async () => {
    const barCount = hist.length;
    const last = hist[hist.length - 1];
    const first = hist[0];
    const chg = first && last ? ((last.close - first.open) / first.open * 100).toFixed(2) : "—";
    const dvdCount = ev?.dividends?.length ?? 0;
    const splitCount = ev?.splits?.length ?? 0;
    setAiLoading(true); setAiOut("");
    try {
      const r = await chatComplete([
        { role: "system", content: aiSystem.corpActions() },
        { role: "user", content: `${NO_INVENT}\n\nSYMBOL=${symbol} BARS=${barCount} PERIOD=${first?.date ?? "—"} TO ${last?.date ?? "—"} TOTAL_RETURN=${chg}% DIVIDENDS=${dvdCount} SPLITS=${splitCount}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(r);
    } catch { setAiOut("AI UNAVAILABLE."); }
    setAiLoading(false);
  };

  async function run(sym: string, rg: Range) {
    setLoading(true);
    const [h, e] = await Promise.all([
      fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=${rg}&interval=1d`).then((r) => r.json()).catch(() => ({})),
      fetch(`/api/events?symbol=${encodeURIComponent(sym)}`).then((r) => r.json()).catch(() => ({})),
    ]);
    setHist(((h.bars ?? []) as any[]).slice());
    setEv(e.dividends ? e : null);
    setShown(60);
    setLoading(false);
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("symbol");
    const s = normalizeTicker(q || store.getTicker());
    setSymbol(s); setInput(s); run(s, "1y");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closes = useMemo(() => hist.map((b) => b.close).filter((v: any) => typeof v === "number"), [hist]);
  const stats = useMemo(() => {
    if (closes.length < 2) return null;
    const last = closes[closes.length - 1];
    const first = closes[0];
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const rets: number[] = [];
    for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    const sd = Math.sqrt(rets.reduce((s, v) => s + v * v, 0) / rets.length) * Math.sqrt(252) * 100;
    const avgV = hist.reduce((s, b) => s + (b.volume || 0), 0) / hist.length;
    return {
      last, ret: ((last - first) / first) * 100, hi, lo,
      offHi: ((last - hi) / hi) * 100, offLo: ((last - lo) / lo) * 100,
      sd, avgV, n: closes.length,
    };
  }, [closes, hist]);

  const rows = useMemo(() => [...hist].reverse().slice(0, shown), [hist, shown]);
  const divs = (ev?.dividends ?? []) as any[];
  const divByYear = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of divs) {
      const y = String(d.date).slice(0, 4);
      m.set(y, (m.get(y) ?? 0) + (d.amount || 0));
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [ev]);

  function exportCSV() {
    const lines = ["date,open,high,low,close,volume"];
    for (const b of hist) lines.push(`${b.date},${b.open},${b.high},${b.low},${b.close},${b.volume ?? 0}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${symbol}-${range}-history.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const up = stats ? stats.ret >= 0 : true;

  return (
    <>
      <CommandBar ticker={symbol} onTicker={(t) => { setSymbol(t); setInput(t); run(t, range); }} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">History &amp; actions — {symbol}</p>
          <div className="toolbar">
            <input className="box" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} />
            <button className="btn" onClick={() => { const s = normalizeTicker(input); setSymbol(s); run(s, range); }}>RUN</button>
            {(["HIST", "DVD", "SPLIT"] as Tab[]).map((t) => (
              <button key={t} className={`pill${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{t === "HIST" ? "PRICES" : t === "DVD" ? `DIVIDENDS${ev ? ` · ${ev.ttmYieldPct}% TTM` : ""}` : `SPLITS${ev?.splits?.length ? ` · ${ev.splits.length}` : ""}`}</button>
            ))}
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <span className="faint" style={{ fontSize: 11 }}>RANGE</span>
            {RANGES.map((r) => (
              <button key={r} className={`pill${range === r ? " active" : ""}`} style={{ fontSize: 11, padding: "4px 10px" }}
                onClick={() => { setRange(r); run(symbol, r); }}>{r.toUpperCase()}</button>
            ))}
            <button className="ghost" onClick={exportCSV} disabled={!hist.length}>EXPORT CSV</button>
          </div>
          {loading && <p className="muted">PULLING LEDGER…</p>}
          {stats && (
            <div className="cells" style={{ marginTop: 12 }}>
              <div className="cell"><div className="lbl">Range return</div><div className={`val ${up ? "pos" : "neg"}`}>{up ? "+" : ""}{stats.ret.toFixed(1)}%</div><div className="sub">{hist.length} sessions</div></div>
              <div className="cell"><div className="lbl">52W-style hi/lo</div><div className="val" style={{ fontSize: 14 }}>{Math.round(stats.hi).toLocaleString("en-IN")} / {Math.round(stats.lo).toLocaleString("en-IN")}</div><div className="sub">off hi {stats.offHi.toFixed(1)}%</div></div>
              <div className="cell"><div className="lbl">Volatility</div><div className="val">{stats.sd.toFixed(1)}%</div><div className="sub">ann</div></div>
              <div className="cell"><div className="lbl">Avg volume</div><div className="val" style={{ fontSize: 14 }}>{Math.round(stats.avgV).toLocaleString("en-IN")}</div><div className="sub">shares/day</div></div>
              <div className="cell"><div className="lbl">Last</div><div className={`val ${up ? "pos" : "neg"}`}>{stats.last.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</div><div className="sub">{hist[hist.length - 1]?.date ?? ""}</div></div>
            </div>
          )}
        </div>

        {tab === "HIST" && (
          <div className="panel">
            <p className="p-head">Close + volume — {range.toUpperCase()} · green up-days / red down-days</p>
            <AreaChart values={closes} dates={hist.map((b) => b.date)} label="CLOSE" height={110} />
            <div style={{ marginTop: 8 }}>
              <BarChart
                values={hist.map((b, i) => {
                  const prev = i > 0 ? hist[i - 1].close : b.open;
                  const v = b.volume || 0;
                  return b.close >= prev ? v : -v;
                })}
                labels={hist.map((b) => b.date)} height={56} posColor="#00d664" negColor="#ff453a"
              />
            </div>
            <table className="plain" style={{ marginTop: 8 }}>
              <thead><tr><th>DATE</th><th style={{ textAlign: "right" }}>OPEN</th><th style={{ textAlign: "right" }}>HIGH</th><th style={{ textAlign: "right" }}>LOW</th><th style={{ textAlign: "right" }}>CLOSE</th><th style={{ textAlign: "right" }}>DAY %</th><th style={{ textAlign: "right" }}>VOLUME</th></tr></thead>
              <tbody>
                {rows.map((b, ri) => {
                  const upD = b.close >= b.open;
                  const prev = hist[hist.length - 1 - ri - 1]?.close ?? b.open;
                  const dpct = prev ? ((b.close - prev) / prev) * 100 : 0;
                  const shock = Math.abs(dpct) >= 5;
                  return (
                    <tr key={b.date} style={shock ? { background: upD ? "rgba(0,214,100,0.06)" : "rgba(255,69,58,0.06)" } : undefined}>
                      <td>{b.date}</td>
                      <td style={{ textAlign: "right" }}>{b.open?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                      <td style={{ textAlign: "right" }}>{b.high?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                      <td style={{ textAlign: "right" }}>{b.low?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                      <td style={{ textAlign: "right" }}><span className={upD ? "pos" : "neg"}>{b.close?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span></td>
                      <td style={{ textAlign: "right" }}><span className={dpct >= 0 ? "pos" : "neg"}>{dpct >= 0 ? "+" : ""}{dpct.toFixed(1)}%</span></td>
                      <td style={{ textAlign: "right" }}>{b.volume?.toLocaleString("en-IN")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown < hist.length && <button className="ghost" style={{ marginTop: 8 }} onClick={() => setShown((s) => s + 120)}>MORE » ({hist.length - shown} LEFT)</button>}
          </div>
        )}

        {tab === "DVD" && (
          <div className="grid">
            <div className="panel">
              <p className="p-head">Payouts — TTM ₹{ev?.ttmTotal ?? "—"} · {ev?.ttmYieldPct ?? "—"}% yield · {ev?.payoutsTTM ?? 0} payouts</p>
              <table className="plain">
                <thead><tr><th>EX-DATE</th><th style={{ textAlign: "right" }}>₹ / SHARE</th><th style={{ textAlign: "right" }}>YIELD @ PX</th></tr></thead>
                <tbody>
                  {divs.map((d: any, i: number) => (
                    <tr key={i}><td>{d.date}</td><td style={{ textAlign: "right" }} className="pos">+{d.amount}</td>
                      <td style={{ textAlign: "right" }}>{stats && stats.last ? `${((d.amount / stats.last) * 100).toFixed(2)}%` : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
              {divs.length === 0 && <p className="muted">NO PAYOUTS ON FEED FOR THIS WINDOW.</p>}
            </div>
            {divByYear.length > 1 && (
              <div className="panel">
                <p className="p-head">Yearly totals — ₹ / share</p>
                <BarChart values={divByYear.map(([, v]) => v)} labels={divByYear.map(([y]) => y)} height={110} posColor="#ffa028" negColor="#ffa028" />
              </div>
            )}
          </div>
        )}

        {tab === "SPLIT" && (
          <div className="panel">
            <p className="p-head">Splits & bonuses — prices already split-adjusted</p>
            <table className="plain">
              <thead><tr><th>DATE</th><th style={{ textAlign: "right" }}>RATIO</th></tr></thead>
              <tbody>
                {(ev?.splits ?? []).map((s: any, i: number) => (
                  <tr key={i}><td>{s.date}</td><td style={{ textAlign: "right" }}><span className="badge fnc">{s.ratio}</span></td></tr>
                ))}
              </tbody>
            </table>
            {(!ev || ev.splits?.length === 0) && <p className="muted">NO SPLITS ON FEED FOR THIS WINDOW.</p>}
          </div>
        )}
        {aiOut && (
          <div className="panel"><p className="p-head">AI analyst</p><p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p></div>
        )}
        {!aiOut && hist.length > 0 && (
          <div className="panel"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "ANALYSING…" : "RUN AI"}</button></div>
        )}
      </main>
      <StatusBar ticker={symbol} extra={`EVTS · ${hist.length} BARS`} />
    </>
  );
}
