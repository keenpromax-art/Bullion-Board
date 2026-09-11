"use client";

import { useEffect, useRef, useState } from "react";
import { store, type Alert } from "@/lib/store";
import { normalizeTicker } from "@/lib/utils";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [sym, setSym] = useState("");
  const [cond, setCond] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [perm, setPerm] = useState("default");
  const [lastCheck, setLastCheck] = useState("—");
  const alertsRef = useRef<Alert[]>([]);
  alertsRef.current = alerts;

  useEffect(() => {
    setAlerts(store.getAlerts());
    if (typeof window !== "undefined" && "Notification" in window) setPerm(Notification.permission);
  }, []);

  function save(a: Alert[]) {
    setAlerts(a);
    store.setAlerts(a);
  }

  useEffect(() => {
    async function poll() {
      const act = alertsRef.current.filter((a) => a.active && !a.triggered);
      if (act.length === 0) return;
      const syms = [...new Set(act.map((a) => a.symbol))];
      const quotes = await Promise.all(
        syms.map(async (s) => {
          try {
            const r = await fetch(`/api/quote?symbol=${encodeURIComponent(s)}`);
            return { s, j: await r.json() };
          } catch { return { s, j: null }; }
        })
      );
      const px: Record<string, number> = {};
      for (const q of quotes) if (q.j && !q.j.error) px[q.s] = q.j.regularMarketPrice;
      let changed = false;
      const next = alertsRef.current.map((a) => {
        if (!a.active || a.triggered || !(a.symbol in px)) return a;
        const hit = a.cond === "above" ? px[a.symbol] >= a.price : px[a.symbol] <= a.price;
        if (hit) {
          changed = true;
          if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
            new Notification(`${a.symbol} ${a.cond.toUpperCase()} ${a.price}`, { body: `LAST ₹${px[a.symbol]}` });
          }
          return { ...a, triggered: true };
        }
        return a;
      });
      if (changed) save(next);
      setLastCheck(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    }
    poll();
    const t = setInterval(poll, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function add() {
    const s = normalizeTicker(sym);
    const p = parseFloat(price);
    if (!s || !isFinite(p) || p <= 0) return;
    const id = alerts.length ? Math.max(...alerts.map((x) => x.id)) + 1 : 1;
    save([...alerts, { id, symbol: s, cond, price: p, active: true, triggered: false, created: new Date().toISOString() }]);
    setSym(""); setPrice("");
  }

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Alerts — polled every 60s · last check {lastCheck}</p>
          <div className="grid grid-4">
            <input className="box" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SEC…" />
            <select className="box" value={cond} onChange={(e) => setCond(e.target.value as "above" | "below")}>
              <option value="above">ABOVE ≥</option>
              <option value="below">BELOW ≤</option>
            </select>
            <input className="box" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="TRIGGER ₹…" inputMode="decimal" />
            <button className="btn" onClick={add}>+ ARM</button>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>BROWSER NOTIFY: {perm.toUpperCase()}</span>
            {perm !== "granted" && (
              <button className="ghost" onClick={() => { if ("Notification" in window) Notification.requestPermission().then(setPerm); }}>ENABLE POPUPS</button>
            )}
          </div>
        </div>
        <div className="panel">
          <table className="plain">
            <thead><tr><th>SEC</th><th>COND</th><th style={{ textAlign: "right" }}>TRIGGER</th><th>STATE</th><th style={{ textAlign: "right" }}>ACT</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td><span className="sec">{a.symbol.replace(".NS", "")}</span></td>
                  <td>{a.cond === "above" ? "≥ ABOVE" : "≤ BELOW"}</td>
                  <td style={{ textAlign: "right" }}>₹{a.price.toLocaleString("en-IN")}</td>
                  <td>{a.triggered ? <span className="badge ok"><span className="dot" />HIT</span> : a.active ? <span className="badge fnc">ARMED</span> : <span className="badge">OFF</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => save(alerts.map((x) => x.id === a.id ? { ...x, active: !x.active, triggered: false } : x))}>{a.active ? "OFF" : "ON"}</button>
                    {" "}
                    <button className="ghost" style={{ padding: "4px 10px" }} onClick={() => save(alerts.filter((x) => x.id !== a.id))}>DEL</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {alerts.length === 0 && <p className="muted">NO ALERTS — ARM FIRST TRIGGER ABOVE. TAB MUST STAY OPEN FOR POLLING.</p>}
        </div>
      </main>
      <StatusBar extra="ALRT" />
    </>
  );
}
