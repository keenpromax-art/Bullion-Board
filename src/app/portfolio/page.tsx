"use client";

import { useEffect, useState } from "react";
import { store, type Position } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { HBars } from "@/components/charts";

interface Live extends Position {
  price: number; chgPct: number; value: number; invested: number;
  pnl: number; pnlPct: number; yieldPct: number;
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [live, setLive] = useState<Live[]>([]);
  const [loading, setLoading] = useState(false);
  const [sym, setSym] = useState("");
  const [qty, setQty] = useState("10");
  const [avg, setAvg] = useState("");

  useEffect(() => { setPositions(store.getPositions()); }, []);

  function save(p: Position[]) {
    setPositions(p);
    store.setPositions(p);
  }

  async function refresh(pos: Position[] = positions) {
    if (pos.length === 0) { setLive([]); return; }
    setLoading(true);
    const rows = await Promise.all(
      pos.map(async (x) => {
        try {
          const [q, e] = await Promise.all([
            fetch(`/api/quote?symbol=${encodeURIComponent(x.symbol)}`).then((r) => r.json()),
            fetch(`/api/events?symbol=${encodeURIComponent(x.symbol)}`).then((r) => r.json()).catch(() => ({})),
          ]);
          const price = q.regularMarketPrice ?? 0;
          const value = price * x.qty;
          const invested = x.avg * x.qty;
          return {
            ...x, price, chgPct: q.regularMarketChangePercent ?? 0, value,
            invested, pnl: value - invested,
            pnlPct: invested ? ((value - invested) / invested) * 100 : 0,
            yieldPct: e.ttmYieldPct ?? 0,
          } as Live;
        } catch {
          return { ...x, price: 0, chgPct: 0, value: 0, invested: x.avg * x.qty, pnl: 0, pnlPct: 0, yieldPct: 0 } as Live;
        }
      })
    );
    setLive(rows);
    setLoading(false);
  }

  useEffect(() => { refresh(positions); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);

  const invested = live.reduce((s, r) => s + r.invested, 0);
  const value = live.reduce((s, r) => s + r.value, 0);
  const dayPnl = live.reduce((s, r) => s + (r.price * (r.chgPct / 100) * r.qty) / (1 + r.chgPct / 100), 0);
  const divIncome = live.reduce((s, r) => s + (r.value * r.yieldPct) / 100, 0);

  function add() {
    const s = normalizeTicker(sym);
    const q = parseFloat(qty), a = parseFloat(avg);
    if (!s || !isFinite(q) || q <= 0 || !isFinite(a) || a <= 0) return;
    const id = positions.length ? Math.max(...positions.map((x) => x.id)) + 1 : 1;
    save([...positions, { id, symbol: s, qty: q, avg: a }]);
    setSym(""); setQty("10"); setAvg("");
  }

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Blotter — {live.length} lines {loading ? "· PRICING…" : ""}</p>
          <div className="cells">
            <div className="cell"><div className="lbl">Invested</div><div className="val">₹{Math.round(invested).toLocaleString("en-IN")}</div><div className="sub">cost</div></div>
            <div className="cell"><div className="lbl">Value</div><div className="val">₹{Math.round(value).toLocaleString("en-IN")}</div><div className="sub">live</div></div>
            <div className="cell"><div className="lbl">P&amp;L</div><div className={`val ${value - invested >= 0 ? "pos" : "neg"}`}>{value - invested >= 0 ? "+" : ""}₹{Math.round(value - invested).toLocaleString("en-IN")}</div><div className="sub">{invested ? (((value - invested) / invested) * 100).toFixed(2) : "—"}%</div></div>
            <div className="cell"><div className="lbl">Day P&amp;L</div><div className={`val ${dayPnl >= 0 ? "pos" : "neg"}`}>{dayPnl >= 0 ? "+" : ""}₹{Math.round(dayPnl).toLocaleString("en-IN")}</div><div className="sub">today</div></div>
            <div className="cell"><div className="lbl">Div fcast</div><div className="val pos">₹{Math.round(divIncome).toLocaleString("en-IN")}</div><div className="sub">TTM yield × value</div></div>
            <div className="cell"><div className="lbl">Lines</div><div className="val">{live.length}</div><div className="sub"><button className="ghost" style={{ padding: "4px 10px" }} onClick={() => refresh()}>RE-PRICE</button></div></div>
          </div>
          <div className="grid grid-3" style={{ marginTop: 10 }}>
            <input className="box" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SEC… (RELIANCE)" />
            <input className="box" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="QTY…" inputMode="decimal" />
            <input className="box" value={avg} onChange={(e) => setAvg(e.target.value)} placeholder="BUY AVG ₹…" inputMode="decimal" />
          </div>
          <div style={{ marginTop: 8 }}><button className="btn" onClick={add}>+ ADD LOT</button></div>
        </div>

        <div className="panel">
          <table className="plain">
            <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>QTY</th><th style={{ textAlign: "right" }}>AVG</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>VALUE</th><th style={{ textAlign: "right" }}>P&amp;L</th><th style={{ textAlign: "right" }}>WT</th><th style={{ textAlign: "right" }}>ACT</th></tr></thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.id}>
                  <td><span className="sec">{r.symbol.replace(".NS", "")}</span> <span className="faint" style={{ fontSize: 11 }}>{r.yieldPct.toFixed(2)}% YLD</span></td>
                  <td style={{ textAlign: "right" }}>{r.qty}</td>
                  <td style={{ textAlign: "right" }}>{r.avg.toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }}>{r.price.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                  <td style={{ textAlign: "right" }}>{Math.round(r.value).toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }}><span className={r.pnl >= 0 ? "pos" : "neg"}>{r.pnl >= 0 ? "+" : ""}{r.pnlPct.toFixed(1)}%</span></td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ height: 6, background: "#1a1a1e", borderRadius: 2, minWidth: 80 }}>
                      <div style={{ width: `${value ? (r.value / value) * 100 : 0}%`, height: "100%", background: "#ffa028", borderRadius: 2 }} />
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}><button className="ghost" style={{ padding: "4px 10px" }} onClick={() => save(positions.filter((x) => x.id !== r.id))}>DEL</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {live.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="p-head">P&amp;L by line</p>
              <HBars rows={live.map((r) => ({
                label: r.symbol.replace(".NS", ""),
                value: Math.round(r.pnl),
                display: `${r.pnl >= 0 ? "+" : ""}₹${Math.round(r.pnl).toLocaleString("en-IN")}`,
                color: r.pnl >= 0 ? "#00d664" : "#ff453a",
              }))} />
            </div>
          )}
          {live.length === 0 && <p className="muted">EMPTY BOOK — ADD FIRST LOT ABOVE. STORED IN THIS BROWSER ONLY.</p>}
        </div>
      </main>
      <StatusBar extra="HOLD" />
    </>
  );
}
