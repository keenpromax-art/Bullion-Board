"use client";

import { useEffect, useState } from "react";
import { normalizeTicker } from "@/lib/utils";
import { BarChart } from "./charts";
import { LegInput } from "./QuantDesks";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Chrome-free seasonality — rendered natively inside terminal panels AND on
// the full /season page (no iframe, no nested command bars).
export function SeasonDesks({ symbol, showInput = false }: { symbol: string; showInput?: boolean }) {
  const [sym, setSym] = useState(symbol);
  const [input, setInput] = useState(symbol);
  const [stats, setStats] = useState<Array<{ m: number; avg: number; hit: number; n: number }> | null>(null);
  const [years, setYears] = useState<Array<{ y: number; ret: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function run(s: string) {
    const clean = normalizeTicker(s);
    setLoading(true); setStats(null); setErr(""); setYears([]);
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent(clean)}&range=10y&interval=1mo`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "history failed");
      const bars = j.bars as Array<{ date: string; close: number }>;
      if (bars.length < 13) throw new Error(`SHORT HISTORY ${clean} (${bars.length} BARS)`);
      const buckets: number[][] = Array.from({ length: 12 }, () => []);
      const byYear: Record<string, { first: number; last: number }> = {};
      for (let i = 1; i < bars.length; i++) {
        if (!(bars[i].close > 0) || !(bars[i - 1].close > 0)) continue;
        const ret = (bars[i].close - bars[i - 1].close) / bars[i - 1].close;
        const d = new Date(bars[i].date + "T00:00:00");
        buckets[d.getMonth()].push(ret);
        const y = String(d.getFullYear());
        if (!byYear[y]) byYear[y] = { first: bars[i - 1].close, last: bars[i].close };
        else byYear[y].last = bars[i].close;
      }
      setSym(clean);
      setStats(buckets.map((b, m) => ({
        m,
        avg: b.length ? (b.reduce((a, x) => a + x, 0) / b.length) * 100 : 0,
        hit: b.length ? (b.filter((x) => x > 0).length / b.length) * 100 : 0,
        n: b.length,
      })));
      setYears(Object.entries(byYear).map(([y, v]) => ({ y: Number(y), ret: ((v.last - v.first) / v.first) * 100 })).sort((a, b) => b.y - a.y));
    } catch (e: any) {
      setStats([]);
      setErr(e.message);
    }
    finally { setLoading(false); }
  }

  useEffect(() => {
    setSym(symbol); setInput(symbol); run(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const nowM = new Date().getMonth();
  const best = stats && stats.length ? [...stats].sort((a, b) => b.avg - a.avg)[0] : null;
  const worst = stats && stats.length ? [...stats].sort((a, b) => a.avg - b.avg)[0] : null;

  return (
    <div className="grid" style={{ gap: 10 }}>
      {showInput && (
        <div className="toolbar">
          <LegInput value={input} onChange={setInput} onRun={() => run(input)} label="TICKER… (TYPE A COMPANY)" />
          <button className="btn" onClick={() => run(input)}>RUN</button>
        </div>
      )}
      {loading && <p className="muted">CRUNCHING 10Y FOR {sym}…</p>}
      {err && <p className="neg">SEASON ERR: {err} <button className="ghost" style={{ marginLeft: 6 }} onClick={() => run(input)}>RETRY</button></p>}
      {stats && stats.length > 0 && (
        <div>
          <div className="cells" style={{ marginBottom: 10 }}>
            <div className="cell"><div className="lbl">Best month</div><div className="val pos" style={{ fontSize: 15 }}>{best ? MONTHS[best.m] : "—"}</div><div className="sub">{best ? `+${best.avg.toFixed(1)}% avg · ${best.hit.toFixed(0)}% hit` : ""}</div></div>
            <div className="cell"><div className="lbl">Worst month</div><div className="val neg" style={{ fontSize: 15 }}>{worst ? MONTHS[worst.m] : "—"}</div><div className="sub">{worst ? `${worst.avg.toFixed(1)}% avg · ${worst.hit.toFixed(0)}% hit` : ""}</div></div>
            <div className="cell"><div className="lbl">Now ({MONTHS[nowM]})</div><div className="val" style={{ fontSize: 15 }}>{stats[nowM] ? `${stats[nowM].avg >= 0 ? "+" : ""}${stats[nowM].avg.toFixed(1)}%` : "—"}</div><div className="sub">{stats[nowM] ? `${stats[nowM].hit.toFixed(0)}% hit · n=${stats[nowM].n}` : ""}</div></div>
          </div>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th></th>{MONTHS.map((m, i) => <th key={m} style={{ textAlign: "right", color: i === nowM ? "var(--amber)" : undefined }}>{i === nowM ? `▶${m}` : m}</th>)}</tr></thead>
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
          </div>
          <p className="muted" style={{ fontSize: 11.5 }}>AVG MONTHLY RETURN + % OF UP MONTHS · ▶ = CURRENT MONTH · GREEN = TAILWIND.</p>
          <div style={{ marginTop: 8 }}>
            <p className="p-head">Monthly edge — avg % by month</p>
            <BarChart values={stats.map((s) => s.avg)} labels={MONTHS} height={100} />
          </div>
        </div>
      )}
      {years.length > 0 && (
        <div>
          <p className="p-head">Yearly returns</p>
          <BarChart values={years.map((y) => y.ret)} labels={years.map((y) => String(y.y))} height={110} />
          <div className="scrollx" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
            <table className="plain">
              <thead><tr><th>YEAR</th><th style={{ textAlign: "right" }}>RET %</th></tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.y}><td>{y.y}</td><td style={{ textAlign: "right" }}><span className={y.ret >= 0 ? "pos" : "neg"}>{y.ret >= 0 ? "+" : ""}{y.ret.toFixed(1)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
