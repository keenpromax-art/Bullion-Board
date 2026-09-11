"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { pctReturns } from "@/lib/indicators";
import { sharpe, maxDrawdown } from "@/lib/risk";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { LineChart } from "@/components/charts";

const PALETTE = ["#ffa028", "#00d664", "#ff453a", "#8f7bff", "#00c8ff", "#ff5da2"];
const RANGES = ["1mo", "3mo", "6mo", "1y", "2y"];

interface Series { sym: string; dates: string[]; norm: number[]; ret: number; vol: number; sharpe: number; maxDD: number }

export default function ComparePage() {
  const [input, setInput] = useState("RELIANCE.NS,INFY.NS,^NSEI");
  const [syms, setSyms] = useState<string[]>(["RELIANCE.NS", "INFY.NS", "^NSEI"]);
  const [range, setRange] = useState("1y");
  const [data, setData] = useState<Series[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      syms.map(async (s) => {
        const r = await fetch(`/api/history?symbol=${encodeURIComponent(s)}&range=${range}&interval=1d`);
        const j = await r.json();
        if (!r.ok || !j.bars?.length) throw new Error(s);
        const closes: number[] = j.bars.map((b: any) => b.close);
        const base = closes[0];
        const norm = closes.map((c) => (c / base) * 100);
        const rets = pctReturns(closes);
        const vol = Math.sqrt(rets.reduce((a, b) => a + b * b, 0) / Math.max(1, rets.length)) * Math.sqrt(252) * 100;
        return {
          sym: s, dates: j.bars.map((b: any) => b.date), norm,
          ret: ((closes[closes.length - 1] - base) / base) * 100,
          vol, sharpe: sharpe(rets), maxDD: maxDrawdown(norm).pct,
        } as Series;
      })
    )
      .then((rows) => { if (alive) setData(rows); })
      .catch(() => { if (alive) setData([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [syms, range]);

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Compare — rebased to 100</p>
          <div className="toolbar">
            <input className="box" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())} placeholder="SYM1,SYM2,…" style={{ flex: 2 }} />
            <button className="btn" onClick={() => setSyms(input.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6))}>RUN</button>
            {RANGES.map((r) => (
              <button key={r} className={`pill${range === r ? " active" : ""}`} onClick={() => setRange(r)}>{r.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <div className="panel">
          <p className="p-head">Rebased to 100 {data.length > 0 && data[0].dates.length > 1 ? <span className="faint">— {data[0].dates[0]} → {data[0].dates[data[0].dates.length - 1]}</span> : null}</p>
          {loading && <p className="muted">LOADING SERIES…</p>}
          {!loading && data.length > 0 && (
            <LineChart
              series={data.map((d, i) => ({ label: d.sym, color: PALETTE[i % PALETTE.length], values: d.norm }))}
              height={240}
              yFmt={(v) => v.toFixed(1)}
              dates={data[0].dates}
            />
          )}
        </div>
        {data.length > 0 && (
          <div className="panel">
            <table className="plain">
              <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>RET %</th><th style={{ textAlign: "right" }}>ANN VOL %</th><th style={{ textAlign: "right" }}>SHARPE</th><th style={{ textAlign: "right" }}>MAX DD %</th></tr></thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.sym}>
                    <td><span className="sec">{d.sym}</span></td>
                    <td style={{ textAlign: "right" }}><span className={d.ret >= 0 ? "pos" : "neg"}>{d.ret >= 0 ? "+" : ""}{d.ret.toFixed(1)}</span></td>
                    <td style={{ textAlign: "right" }}>{d.vol.toFixed(1)}</td>
                    <td style={{ textAlign: "right" }}>{d.sharpe.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }}><span className="neg">{d.maxDD.toFixed(1)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <StatusBar extra="COMP" />
    </>
  );
}
