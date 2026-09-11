"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { LineChart, BarChart, HBars } from "@/components/charts";
import { store } from "@/lib/store";
import { blackScholes } from "@/lib/options";
import {
  analyseChain, calcSuggestion, supportResistance, payoffData, thetaDecay,
  suggestionAccuracy, expiryToDays, solveIV, OC_RISK_FREE,
  type ChainRow,
} from "@/lib/ochain";

interface HistRow {
  time: string; value: number; score: number | null; pcr: number;
  maxPain: number; action: string;
}

function downloadCSV(name: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([[header, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const f0 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const f2 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function OChainPage() {
  const [symbols, setSymbols] = useState<{ indices: string[]; stocks: string[] }>({ indices: ["NIFTY"], stocks: [] });
  const [mode, setMode] = useState<"Index" | "Stock">("Index");
  const [symbol, setSymbol] = useState("NIFTY");
  const [expiries, setExpiries] = useState<string[]>([]);
  const [expiry, setExpiry] = useState("");
  const [strikes, setStrikes] = useState<number[]>([]);
  const [strike, setStrike] = useState(0);
  const [rows, setRows] = useState<ChainRow[]>([]);
  const [underlying, setUnderlying] = useState(0);
  const [ts, setTs] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [fetches, setFetches] = useState(0);
  const [auto, setAuto] = useState(false);
  const [intervalS, setIntervalS] = useState(60);
  const [hist, setHist] = useState<HistRow[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const rf = mode === "Index" ? 1000 : 10;
  const unit = mode === "Index" ? "K" : "×10";
  const instKey = `${mode}|${symbol}|${expiry}`;

  useEffect(() => {
    fetch("/api/ochain/symbols").then((r) => r.json()).then((j) => {
      if (j.indices?.length || j.stocks?.length) setSymbols({ indices: j.indices ?? ["NIFTY"], stocks: j.stocks ?? [] });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setExpiry(""); setExpiries([]); setRows([]); setStrikes([]); setStrike(0);
    fetch(`/api/ochain/expiry?symbol=${encodeURIComponent(symbol)}&mode=${mode}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "expiry failed");
        setExpiries(j.expiries ?? []);
        if (j.expiries?.length) setExpiry(j.expiries[0]);
      })
      .catch(() => setExpiries([]));
  }, [symbol, mode]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`iss.ochain.${instKey}`);
      setHist(raw ? JSON.parse(raw) : []);
    } catch { setHist([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instKey]);

  useEffect(() => {
    try { window.localStorage.setItem(`iss.ochain.${instKey}`, JSON.stringify(hist.slice(-200))); } catch { /* quota */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist]);

  async function fetchChain() {
    if (!expiry) return;
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/ochain/chain?symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}&mode=${mode}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "chain failed");
      const data: ChainRow[] = j.rows ?? [];
      const spot: number = j.underlying ?? 0;
      const sts = [...new Set(data.map((x) => x.strike))].sort((a, b) => a - b);
      setRows(data); setUnderlying(spot);
      setTs(j.timestamp ?? "");
      setStrikes(sts);
      const atm = sts.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a), sts[0] ?? 0);
      const sp = strike && sts.includes(strike) ? strike : atm;
      setStrike(sp);
      setFetches((f) => f + 1);
      try {
        const m = analyseChain(data, sp, rf, spot);
        const sug = calcSuggestion(m, spot);
        const t = new Date();
        const hh = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
        setHist((h) => [...h.slice(-199), { time: hh, value: spot, score: sug.score, pcr: m.pcr, maxPain: m.maxPain, action: sug.action }]);
      } catch { /* analyse errors surface below */ }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!auto || !expiry) return;
    timer.current = setInterval(fetchChain, Math.max(60, intervalS) * 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, intervalS, expiry, symbol, mode, strike]);

  const m = useMemo(() => {
    if (!rows.length || !strike) return null;
    try { return analyseChain(rows, strike, rf, underlying); } catch { return null; }
  }, [rows, strike, rf, underlying]);

  const sug = useMemo(() => (m ? calcSuggestion(m, underlying) : null), [m, underlying]);
  const tDays = useMemo(() => (expiry ? expiryToDays(expiry) : 7), [expiry]);
  const sel = rows.find((r) => r.strike === strike);
  const sr = useMemo(
    () => (rows.length && underlying ? supportResistance(rows.map((r) => r.strike), rows.map((r) => r.ceOI), rows.map((r) => r.peOI), underlying) : { support: [], resistance: [] }),
    [rows, underlying]
  );
  const acc = useMemo(
    () => suggestionAccuracy(hist.map((h) => ({ score: h.score, value: h.value, time: h.time }))),
    [hist]
  );

  function greeksFor(row: ChainRow | undefined, isCall: boolean) {
    if (!row || !underlying) return null;
    const T = Math.max(tDays, 1) / 365;
    const listed = isCall ? row.ceIV : row.peIV;
    const iv = listed > 0 ? listed / 100 : solveIV(isCall ? row.ceLTP : row.peLTP, underlying, row.strike, T, OC_RISK_FREE, isCall) / 100;
    if (!(iv > 0)) return null;
    const g = blackScholes(underlying, row.strike, T, OC_RISK_FREE, iv, isCall ? "CALL" : "PUT");
    if (!g) return null;
    return { ...g, ivUsed: iv * 100, moneyness: row.strike === strike ? (underlying > row.strike ? (isCall ? "ITM" : "OTM") : underlying < row.strike ? (isCall ? "OTM" : "ITM") : "ATM") : g.moneyness };
  }
  const ceG = greeksFor(sel, true);
  const peG = greeksFor(sel, false);

  const fullGreeks = useMemo(() => {
    if (!rows.length || !underlying) return [];
    const T = Math.max(tDays, 1) / 365;
    return rows.map((r) => {
      const ceIV = r.ceIV > 0 ? r.ceIV / 100 : solveIV(r.ceLTP, underlying, r.strike, T, OC_RISK_FREE, true) / 100;
      const peIV = r.peIV > 0 ? r.peIV / 100 : solveIV(r.peLTP, underlying, r.strike, T, OC_RISK_FREE, false) / 100;
      const ce = ceIV > 0 ? blackScholes(underlying, r.strike, T, OC_RISK_FREE, ceIV, "CALL") : null;
      const pe = peIV > 0 ? blackScholes(underlying, r.strike, T, OC_RISK_FREE, peIV, "PUT") : null;
      return {
        strike: r.strike,
        ceD: ce?.delta, ceG: ce?.gamma, ceT: ce?.theta, ceV: ce?.vega,
        peD: pe?.delta, peG: pe?.gamma, peT: pe?.theta, peV: pe?.vega,
      };
    });
  }, [rows, underlying, tDays]);

  const cePay = sel ? payoffData(underlying, strike, sel.ceLTP, true) : null;
  const pePay = sel ? payoffData(underlying, strike, sel.peLTP, false) : null;
  const ceDecay = sel ? thetaDecay(underlying, strike, sel.ceIV || 15, true) : null;
  const peDecay = sel ? thetaDecay(underlying, strike, sel.peIV || 15, false) : null;

  const atmIdx = strikes.reduce((bi, s, i) => (Math.abs(s - underlying) < Math.abs(strikes[bi] - underlying) ? i : bi), 0);
  const win = rows.filter((_, i) => Math.abs(i - atmIdx) <= 14);

  return (
    <>
      <CommandBar ticker={(() => { try { return store.getTicker(); } catch { return "NIFTY"; } })()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">NSE option chain — {symbol} · {expiry || "NO EXPIRY"} · {mode.toUpperCase()}</p>
          <div className="toolbar">
            <select className="box" value={mode} onChange={(e) => { setMode(e.target.value as "Index" | "Stock"); setSymbol(e.target.value === "Index" ? (symbols.indices[0] ?? "NIFTY") : (symbols.stocks[0] ?? "")); }}>
              <option value="Index">INDEX</option>
              <option value="Stock">STOCK</option>
            </select>
            <select className="box" value={symbol} onChange={(e) => setSymbol(e.target.value)} style={{ minWidth: 150 }}>
              {(mode === "Index" ? symbols.indices : symbols.stocks).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="box" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ minWidth: 130 }}>
              {expiries.length === 0 && <option value="">—</option>}
              {expiries.map((x) => <option key={x} value={x}>{x} · T-{expiryToDays(x)}D</option>)}
            </select>
            <select className="box" value={strike || ""} onChange={(e) => setStrike(Number(e.target.value))} style={{ minWidth: 110 }}>
              {strikes.length === 0 && <option value="">STRIKE</option>}
              {strikes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn" onClick={fetchChain} disabled={loading || !expiry}>{loading ? "…" : "FETCH"}</button>
            <button className="ghost" onClick={() => { const a = strikes.reduce((x, s) => (Math.abs(s - underlying) < Math.abs(x - underlying) ? s : x), strikes[0] ?? 0); setStrike(a); }}>ATM</button>
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }} className="muted">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> AUTO-POLL
            </label>
            <select className="box" value={intervalS} onChange={(e) => setIntervalS(Number(e.target.value))}>
              {[60, 120, 300, 600].map((s) => <option key={s} value={s}>{s >= 60 ? `${s / 60} MIN` : `${s}S`}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>FETCHES {fetches} · {ts ? `NSE TS ${ts}` : "NO TAPE YET"}</span>
            {hist.length > 0 && (
              <button className="ghost" onClick={() => downloadCSV(
                `ochain-${symbol}-${expiry}.csv`,
                ["TIME", "UNDERLYING", "SCORE", "PCR", "MAX_PAIN", "ACTION"],
                hist.map((h) => [h.time, h.value, h.score ?? "", h.pcr, h.maxPain, h.action])
              )}>↓ HISTORY CSV</button>
            )}
          </div>
          {err && <p className="neg" style={{ marginTop: 8 }}>ERR: {err} — NSE often blocks datacenter IPs. LOCAL RUNS WORK BEST. <button className="ghost" onClick={fetchChain}>RETRY</button></p>}
        </div>

        {m && sug && (
          <div className="panel panel-glow">
            <p className="p-head">Summary — spot {underlying.toLocaleString("en-IN", { maximumFractionDigits: 2 })} · strike {strike}</p>
            <div className="cells">
              <div className="cell"><div className="lbl">PCR (OI)</div><div className={`val ${m.pcr >= 1 ? "pos" : "neg"}`}>{m.pcr}</div><div className="sub">{m.sentiment.toUpperCase()}</div></div>
              <div className="cell"><div className="lbl">Max pain</div><div className="val">{Math.round(m.maxPain).toLocaleString("en-IN")}</div><div className="sub">conf {(m.maxPainConf * 100).toFixed(0)}%</div></div>
              <div className="cell"><div className="lbl">Gamma wall</div><div className="val">{Math.round(m.gammaWall).toLocaleString("en-IN")}</div><div className="sub">γ×OI peak</div></div>
              <div className="cell"><div className="lbl">IV skew</div><div className="val">{m.ivSkew >= 0 ? "+" : ""}{m.ivSkew}%</div><div className="sub">PE−CE ATM</div></div>
              <div className="cell"><div className="lbl">CE / PE OI</div><div className="val" style={{ fontSize: 15 }}>{(m.totC / rf).toFixed(1)} / {(m.totP / rf).toFixed(1)}{unit}</div><div className="sub">vol ratio {m.vr}</div></div>
              <div className="cell"><div className="lbl">Max CE / PE</div><div className="val" style={{ fontSize: 15 }}>{Math.round(m.mcStrike).toLocaleString("en-IN")} / {Math.round(m.mpStrike).toLocaleString("en-IN")}</div><div className="sub">OI walls</div></div>
            </div>
          </div>
        )}

        {sug && (
          <div className="panel panel-glow">
            <p className="p-head">Signal — score {sug.score >= 0 ? "+" : ""}{sug.score} · {sug.confidence.toUpperCase()} {sug.confPct}%</p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
              <span className={`badge ${sug.side === "PE" ? "ok" : sug.side === "CE" ? "bad" : "fnc"}`} style={{ fontSize: 15, padding: "8px 14px" }}>{sug.action}</span>
            </div>
            <table className="plain">
              <thead><tr><th>DIR</th><th>SIDE</th><th>RATIONALE</th></tr></thead>
              <tbody>
                {sug.reasons.map((r, i) => (
                  <tr key={i}>
                    <td><span className={r.dir.includes("BULL") ? "pos" : r.dir.includes("BEAR") ? "neg" : "neutral"}><strong>{r.dir}</strong></span></td>
                    <td><span className="badge fnc">{r.side}</span></td>
                    <td style={{ fontSize: 12.5 }}>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">Support (PE walls ↓) / Resistance (CE walls ↑)</p>
              <table className="plain">
                <thead><tr><th>SUPPORT</th><th style={{ textAlign: "right" }}>RESISTANCE</th></tr></thead>
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td className="pos"><strong>{sr.support[i]?.toLocaleString("en-IN") ?? "—"}</strong></td>
                      <td style={{ textAlign: "right" }} className="neg"><strong>{sr.resistance[i]?.toLocaleString("en-IN") ?? "—"}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <p className="p-head">Strike Greeks — {strike} · T-{tDays}D</p>
              <table className="plain">
                <thead><tr><th></th><th style={{ textAlign: "right" }}>CALL</th><th style={{ textAlign: "right" }}>PUT</th></tr></thead>
                <tbody>
                  {([
                    ["IV %", ceG ? ceG.ivUsed.toFixed(1) : "—", peG ? peG.ivUsed.toFixed(1) : "—"],
                    ["THEO", ceG ? ceG.price.toFixed(2) : "—", peG ? peG.price.toFixed(2) : "—"],
                    ["DELTA", ceG ? ceG.delta.toFixed(3) : "—", peG ? peG.delta.toFixed(3) : "—"],
                    ["GAMMA", ceG ? ceG.gamma.toFixed(5) : "—", peG ? peG.gamma.toFixed(5) : "—"],
                    ["THETA/D", ceG ? ceG.theta.toFixed(3) : "—", peG ? peG.theta.toFixed(3) : "—"],
                    ["VEGA", ceG ? ceG.vega.toFixed(2) : "—", peG ? peG.vega.toFixed(2) : "—"],
                  ] as Array<[string, string, string]>).map(([k, c, p]) => (
                    <tr key={k}><td><strong>{k}</strong></td><td style={{ textAlign: "right" }}>{c}</td><td style={{ textAlign: "right" }}>{p}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="panel">
            <p className="p-head">OI distribution ±14 strikes around ATM</p>
            <svg viewBox="0 0 640 150" style={{ width: "100%", height: 150 }} preserveAspectRatio="none">
              {win.map((r, i) => {
                const mx = Math.max(...win.map((x) => Math.max(x.ceOI, x.peOI)), 1);
                const bw = 640 / win.length;
                const hc = (r.ceOI / mx) * 62, hp = (r.peOI / mx) * 62;
                const atm = r.strike === strike;
                return (
                  <g key={r.strike}>
                    <rect x={i * bw + 1} y={70 - hc} width={bw / 2 - 1} height={hc} fill={atm ? "#ffa028" : "#ff453a"} opacity="0.85" />
                    <rect x={i * bw + bw / 2} y={70} width={bw / 2 - 1} height={hp} fill={atm ? "#ffd28f" : "#00d664"} opacity="0.85" />
                    {i % 4 === 0 && <text x={i * bw} y={146} fontSize="9" fill="#5b5b62">{r.strike >= 1000 ? `${(r.strike / 1000).toFixed(1)}k` : r.strike}</text>}
                  </g>
                );
              })}
              <line x1="0" x2="640" y1="70" y2="70" stroke="#5b5b62" strokeWidth="1" />
            </svg>
            <div className="pills" style={{ marginTop: 6 }}>
              <span className="badge bad">■ CE OI (UP)</span>
              <span className="badge ok">■ PE OI (DOWN)</span>
              <span className="badge fnc">■ ATM {strike.toLocaleString("en-IN")}</span>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">IV smile — % by strike</p>
              <LineChart
                series={[
                  { label: "CE IV", color: "#ff453a", values: win.map((r) => r.ceIV || null) },
                  { label: "PE IV", color: "#00d664", values: win.map((r) => r.peIV || null) },
                ]}
                height={130}
                yFmt={(v) => `${v.toFixed(0)}%`}
                xLabels={[String(win[0]?.strike ?? ""), String(win[Math.floor(win.length / 2)]?.strike ?? ""), String(win[win.length - 1]?.strike ?? "")]}
              />
            </div>
            <div className="panel">
              <p className="p-head">Chg OI — positioning flow</p>
              <BarChart values={win.map((r) => r.ceChgOI - r.peChgOI)} labels={win.map((r) => String(r.strike))} height={130} />
              <p className="muted" style={{ fontSize: 11 }}>CE−PE CHG OI PER STRIKE · +VE = CALL WRITING</p>
            </div>
          </div>
        )}

        {cePay && pePay && sel && (
          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">Payoff — LONG {strike} CE @ {sel.ceLTP.toFixed(2)} · BE {cePay.breakeven.toFixed(1)}</p>
              <LineChart series={[{ label: "PNL", color: "#ffa028", values: cePay.pnls }]} height={130} yFmt={(v) => v.toFixed(0)} xLabels={[cePay.xs[0].toFixed(0), cePay.xs[30].toFixed(0), cePay.xs[59].toFixed(0)]} />
            </div>
            <div className="panel">
              <p className="p-head">Payoff — LONG {strike} PE @ {sel.peLTP.toFixed(2)} · BE {pePay.breakeven.toFixed(1)}</p>
              <LineChart series={[{ label: "PNL", color: "#8f7bff", values: pePay.pnls }]} height={130} yFmt={(v) => v.toFixed(0)} xLabels={[pePay.xs[0].toFixed(0), pePay.xs[30].toFixed(0), pePay.xs[59].toFixed(0)]} />
            </div>
            <div className="panel">
              <p className="p-head">Theta decay — CE · {sel.ceIV.toFixed(1)}% IV</p>
              <LineChart series={[{ label: "THEO PX", color: "#ff453a", values: ceDecay ? ceDecay.prices : [] }]} height={110} yFmt={(v) => v.toFixed(1)} xLabels={["30D", "15D", "1D"]} />
            </div>
            <div className="panel">
              <p className="p-head">Theta decay — PE · {sel.peIV.toFixed(1)}% IV</p>
              <LineChart series={[{ label: "THEO PX", color: "#00d664", values: peDecay ? peDecay.prices : [] }]} height={110} yFmt={(v) => v.toFixed(1)} xLabels={["30D", "15D", "1D"]} />
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="panel">
            <p className="p-head">Option chain — {rows.length} strikes · orange = ATM {strike.toLocaleString("en-IN")}</p>
            <div className="scrollx">
              <table className="plain">
                <thead><tr>
                  <th style={{ textAlign: "right" }}>CE OI</th><th style={{ textAlign: "right" }}>CHG OI</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>IV</th><th style={{ textAlign: "right" }}>LTP</th>
                  <th>STRIKE</th>
                  <th style={{ textAlign: "right" }}>LTP</th><th style={{ textAlign: "right" }}>IV</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>CHG OI</th><th style={{ textAlign: "right" }}>PE OI</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.strike} style={r.strike === strike ? { background: "rgba(255,160,40,0.10)" } : undefined}>
                      <td style={{ textAlign: "right" }}>{f0(r.ceOI)}</td><td style={{ textAlign: "right" }}>{f0(r.ceChgOI)}</td><td style={{ textAlign: "right" }}>{f0(r.ceVol)}</td><td style={{ textAlign: "right" }}>{f2(r.ceIV)}</td><td style={{ textAlign: "right" }}>{f2(r.ceLTP)}</td>
                      <td><strong className={r.strike === strike ? "sec" : ""}>{r.strike.toLocaleString("en-IN")}</strong></td>
                      <td style={{ textAlign: "right" }}>{f2(r.peLTP)}</td><td style={{ textAlign: "right" }}>{f2(r.peIV)}</td><td style={{ textAlign: "right" }}>{f0(r.peVol)}</td><td style={{ textAlign: "right" }}>{f0(r.peChgOI)}</td><td style={{ textAlign: "right" }}>{f0(r.peOI)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="panel">
            <p className="p-head">Full-chain Greeks — Δ Γ Θ V per leg (T-{tDays}D)</p>
            <div className="scrollx" style={{ maxHeight: 380, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>STRIKE</th><th style={{ textAlign: "right" }}>CE Δ</th><th style={{ textAlign: "right" }}>CE Γ</th><th style={{ textAlign: "right" }}>CE Θ</th><th style={{ textAlign: "right" }}>CE V</th><th style={{ textAlign: "right" }}>PE Δ</th><th style={{ textAlign: "right" }}>PE Γ</th><th style={{ textAlign: "right" }}>PE Θ</th><th style={{ textAlign: "right" }}>PE V</th></tr></thead>
                <tbody>
                  {fullGreeks.map((g) => (
                    <tr key={g.strike} style={g.strike === strike ? { background: "rgba(255,160,40,0.10)" } : undefined}>
                      <td><strong>{g.strike.toLocaleString("en-IN")}</strong></td>
                      <td style={{ textAlign: "right" }}>{g.ceD?.toFixed(3) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.ceG?.toFixed(5) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.ceT?.toFixed(2) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.ceV?.toFixed(2) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.peD?.toFixed(3) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.peG?.toFixed(5) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.peT?.toFixed(2) ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{g.peV?.toFixed(2) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hist.length >= 2 && (
          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">PCR trend — {hist.length} fetches</p>
              <LineChart series={[{ label: "PCR", color: "#ffa028", values: hist.map((h) => h.pcr) }]} height={110} yFmt={(v) => v.toFixed(2)} dates={hist.map((h) => h.time)} xLabels={[hist[0].time, hist[Math.floor(hist.length / 2)].time, hist[hist.length - 1].time]} />
            </div>
            <div className="panel">
              <p className="p-head">Max-pain trail</p>
              <LineChart series={[{ label: "MAX PAIN", color: "#8f7bff", values: hist.map((h) => h.maxPain) }]} height={110} yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} dates={hist.map((h) => h.time)} xLabels={[hist[0].time, hist[Math.floor(hist.length / 2)].time, hist[hist.length - 1].time]} />
            </div>
            <div className="panel">
              <p className="p-head">Signal accuracy — {Math.round(acc.hitRate * 1000) / 10}% over {acc.n} calls</p>
              <HBars rows={[
                { label: "HIT RATE", value: Math.round(acc.hitRate * 1000) / 10, display: `${Math.round(acc.hitRate * 1000) / 10}%`, color: "#00d664" },
                { label: "SCORED", value: acc.n, display: String(acc.n), color: "#5b5b62" },
              ]} />
              <table className="plain" style={{ marginTop: 8 }}>
                <thead><tr><th>TIME</th><th style={{ textAlign: "right" }}>SCORE</th><th>PRED</th><th>ACT</th><th style={{ textAlign: "right" }}>HIT?</th></tr></thead>
                <tbody>
                  {acc.records.slice(-12).reverse().map((r, i) => (
                    <tr key={i}>
                      <td className="faint">{r.time ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{r.score}</td>
                      <td>{String(r.predicted).toUpperCase()}</td>
                      <td>{String(r.actual).toUpperCase()}</td>
                      <td style={{ textAlign: "right" }}>{r.correct === null ? "—" : r.correct ? <span className="pos">HIT</span> : <span className="neg">MISS</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <p className="p-head">Fetch log — latest first</p>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                <table className="plain">
                  <thead><tr><th>TIME</th><th style={{ textAlign: "right" }}>SPOT</th><th style={{ textAlign: "right" }}>SCORE</th><th>ACTION</th></tr></thead>
                  <tbody>
                    {[...hist].reverse().slice(0, 30).map((h, i) => (
                      <tr key={i}>
                        <td className="faint">{h.time}</td>
                        <td style={{ textAlign: "right" }}>{h.value.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                        <td style={{ textAlign: "right" }}>{(h.score ?? 0) >= 0 ? "+" : ""}{h.score ?? "—"}</td>
                        <td style={{ fontSize: 11.5 }}>{h.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
      <StatusBar extra={`OC ${symbol} ${expiry}`} />
    </>
  );
}
