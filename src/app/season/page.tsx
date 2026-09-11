"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { BarChart } from "@/components/charts";

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

export default function SeasonPage() {
  const [symbol, setSymbol] = useState("RELIANCE.NS");
  const [input, setInput] = useState("RELIANCE.NS");
  const [stats, setStats] = useState<Array<{ m: number; avg: number; hit: number; n: number }> | null>(null);
  const [years, setYears] = useState<Array<{ y: number; ret: number }>>([]);
  const [loading, setLoading] = useState(false);

  async function run(sym: string) {
    setLoading(true); setStats(null);
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=10y&interval=1mo`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "history failed");
      const bars = j.bars as Array<{ date: string; close: number }>;
      const buckets: number[][] = Array.from({ length: 12 }, () => []);
      const byYear: Record<string, { first: number; last: number }> = {};
      for (let i = 1; i < bars.length; i++) {
        const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
        const d = new Date(bars[i].date + "T00:00:00");
        buckets[d.getMonth()].push(ret);
        const y = String(d.getFullYear());
        if (!byYear[y]) byYear[y] = { first: bars[i - 1].close, last: bars[i].close };
        else byYear[y].last = bars[i].close;
      }
      setStats(buckets.map((b, m) => ({
        m,
        avg: b.length ? (b.reduce((a, x) => a + x, 0) / b.length) * 100 : 0,
        hit: b.length ? (b.filter((x) => x > 0).length / b.length) * 100 : 0,
        n: b.length,
      })));
      setYears(Object.entries(byYear).map(([y, v]) => ({ y: Number(y), ret: ((v.last - v.first) / v.first) * 100 })).sort((a, b) => b.y - a.y));
    } catch { setStats([]); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("symbol");
    const s = normalizeTicker(q || store.getTicker());
    setSymbol(s); setInput(s); run(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <CommandBar ticker={symbol} onTicker={(t) => { setSymbol(t); setInput(t); run(t); }} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Seasonality — {symbol} · 10Y monthly</p>
          <div className="toolbar">
            <input className="box" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} />
            <button className="btn" onClick={() => { const s = normalizeTicker(input); setSymbol(s); run(s); }}>RUN</button>
          </div>
          {loading && <p className="muted">CRUNCHING 10Y…</p>}
        </div>
        {stats && stats.length > 0 && (
          <div className="panel">
            <table className="plain">
              <thead><tr><th></th>{MONTHS.map((m) => <th key={m} style={{ textAlign: "right" }}>{m}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td><strong>AVG %</strong></td>
                  {stats.map((s) => (
                    <td key={s.m} style={{ textAlign: "right", background: s.avg >= 0 ? `rgba(0,214,100,${Math.min(0.5, Math.abs(s.avg) / 12)})` : `rgba(255,69,58,${Math.min(0.5, Math.abs(s.avg) / 12)})` }}>
                      {s.avg >= 0 ? "+" : ""}{s.avg.toFixed(1)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td><strong>HIT %</strong></td>
                  {stats.map((s) => (
                    <td key={s.m} style={{ textAlign: "right" }}><span className={s.hit >= 60 ? "pos" : s.hit <= 40 ? "neg" : ""}>{s.hit.toFixed(0)}</span></td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 11.5 }}>AVG MONTHLY RETURN + % OF UP MONTHS. GREEN MONTHS = SEASONAL TAILWIND.</p>
          </div>
        )}
        {years.length > 0 && (
          <div className="panel">
            <p className="p-head">Yearly returns</p>
            <BarChart values={years.map((y) => y.ret)} labels={years.map((y) => String(y.y))} height={110} />
            <div style={{ marginTop: 8 }} />
            <table className="plain">
              <thead><tr><th>YEAR</th><th style={{ textAlign: "right" }}>RET %</th></tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.y}><td>{y.y}</td><td style={{ textAlign: "right" }}><span className={y.ret >= 0 ? "pos" : "neg"}>{y.ret >= 0 ? "+" : ""}{y.ret.toFixed(1)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <StatusBar ticker={symbol} extra="SEAS" />
    </>
  );
}
