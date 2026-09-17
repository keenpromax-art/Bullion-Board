"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { Histogram, HBars } from "@/components/charts";

interface BRow { symbol: string; price: number; dayChgPct: number; above20: boolean; volRatio: number; gapPct: number }

export default function BreadthPage() {
  const [data, setData] = useState<{
    count: number; adv: number; dec: number; unch: number; pctAbove20: number;
    dist: number[];
    top: BRow[]; bottom: BRow[]; shockers: BRow[]; gaps: BRow[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  const askAI = async () => {
    if (!data) return;
    const top5 = data.top.slice(0, 5).map((r) => `${r.symbol} +${r.dayChgPct.toFixed(2)}%`).join(", ");
    const bot5 = data.bottom.slice(0, 5).map((r) => `${r.symbol} ${r.dayChgPct.toFixed(2)}%`).join(", ");
    const gap5 = data.gaps.slice(0, 5).map((r) => `${r.symbol} ${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%`).join(", ");
    const summary = `ADV=${data.adv} DEC=${data.dec} A/D=${data.dec ? (data.adv / data.dec).toFixed(2) : "—"} PCT_ABOVE_20DMA=${data.pctAbove20}% VERDICT=${data.adv > data.dec * 1.5 ? "RISK-ON" : data.dec > data.adv * 1.5 ? "RISK-OFF" : "MIXED"} TOP_MOVERS_UP=${top5} TOP_MOVERS_DOWN=${bot5} GAP_LEADERS=${gap5}`;
    setAiLoading(true); setAiOut("");
    try {
      const r = await chatComplete([
        { role: "system", content: aiSystem.marketBreadth() },
        { role: "user", content: `${NO_INVENT}\n\n${summary}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(r);
    } catch { setAiOut("AI UNAVAILABLE."); }
    setAiLoading(false);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/breadth")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "breadth failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function secTable(title: string, rows: BRow[], val: (r: BRow) => string, cls?: (r: BRow) => string) {
    return (
      <div className="panel">
        <p className="p-head">{title}</p>
        <table className="plain">
          <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>PX</th><th style={{ textAlign: "right" }}>VAL</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td><a href={`/module/1?symbol=${r.symbol}`}><span className="sec">{r.symbol.replace(".NS", "")}</span></a></td>
                <td style={{ textAlign: "right" }}>{r.price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                <td style={{ textAlign: "right" }}><span className={cls ? cls(r) : ""}>{val(r)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Breadth — Nifty-50 tape {loading ? "· SCANNING…" : data ? `· ${data.count} SEC` : ""}</p>
          {err && <p className="neg">ERR: {err}</p>}
          {data && (
            <div className="cells">
              <div className="cell"><div className="lbl">Advances</div><div className="val pos">{data.adv}</div><div className="sub">up today</div></div>
              <div className="cell"><div className="lbl">Declines</div><div className="val neg">{data.dec}</div><div className="sub">down today</div></div>
              <div className="cell"><div className="lbl">A/D</div><div className="val">{data.dec ? (data.adv / data.dec).toFixed(2) : "—"}</div><div className="sub">ratio</div></div>
              <div className="cell"><div className="lbl">Above 20D</div><div className="val">{data.pctAbove20}%</div><div className="sub">trend health</div></div>
              <div className="cell"><div className="lbl">Unchanged</div><div className="val">{data.unch}</div><div className="sub">flat</div></div>
              <div className="cell"><div className="lbl">Verdict</div><div className="val" style={{ fontSize: 15 }}>{data.adv > data.dec * 1.5 ? "RISK-ON" : data.dec > data.adv * 1.5 ? "RISK-OFF" : "MIXED"}</div><div className="sub">tape read</div></div>
            </div>
          )}
        </div>
        {data && data.dist && (
          <div className="panel">
            <p className="p-head">Day-change distribution + A/D</p>
            <Histogram values={data.dist} bins={18} height={100} />
            <div style={{ marginTop: 8 }}>
              <HBars rows={[
                { label: "ADVANCES", value: data.adv, display: String(data.adv), color: "#00d664" },
                { label: "DECLINES", value: data.dec, display: String(data.dec), color: "#ff453a" },
                { label: "ABOVE 20D %", value: data.pctAbove20, display: `${data.pctAbove20}%`, color: "#ffa028" },
              ]} />
            </div>
          </div>
        )}
        {data && (
          <div className="grid grid-2">
            {secTable("Movers up", data.top, (r) => `+${r.dayChgPct.toFixed(2)}%`, (r) => "pos")}
            {secTable("Movers down", data.bottom, (r) => `${r.dayChgPct.toFixed(2)}%`, (r) => "neg")}
            {secTable("Volume shockers ×AVG20", data.shockers, (r) => `${r.volRatio.toFixed(1)}×`)}
            {secTable("Gaps ≥1.5%", data.gaps, (r) => `${r.gapPct >= 0 ? "+" : ""}${r.gapPct.toFixed(2)}%`, (r) => (r.gapPct >= 0 ? "pos" : "neg"))}
          </div>
        )}
        {aiOut && (
          <div className="panel"><p className="p-head">AI analyst</p><p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p></div>
        )}
        {data && !aiOut && (
          <div className="panel"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "ANALYSING…" : "RUN AI"}</button></div>
        )}
      </main>
      <StatusBar extra="BRTH" />
    </>
  );
}
