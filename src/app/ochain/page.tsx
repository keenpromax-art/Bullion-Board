"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { LineChart, BarChart, HBars } from "@/components/charts";
import { store } from "@/lib/store";
import { blackScholes } from "@/lib/options";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
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

  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  const askAI = async () => {
    if (!rows.length) return;
    const pcr = rows.reduce((a, r) => a + r.ceOI, 0) / (rows.reduce((a, r) => a + r.peOI, 0) || 1);
    const topCall = [...rows].sort((a, b) => b.ceOI - a.ceOI)[0];
    const topPut = [...rows].sort((a, b) => b.peOI - a.peOI)[0];
    const summary = `SYMBOL=${symbol} SPOT=${underlying} EXPIRY=${expiry} PCR=${pcr.toFixed(3)} MAX_CALL_OI=${topCall?.strike ?? "—"}(${topCall?.ceOI ?? 0}) MAX_PUT_OI=${topPut?.strike ?? "—"}(${topPut?.peOI ?? 0}) ROWS=${rows.length}` + (dossier && sel ? ` SEL_STRIKE=${strike} SEL_ROLE=${dossier.role} SEL_PCR=${dossier.strikePCR.toFixed(2)} SEL_STRADDLE=${dossier.straddle.toFixed(2)} SEL_BUILD=${dossier.ceBuild}/${dossier.peBuild} SEL_READ=${dossier.verdict}` : "");
    setAiLoading(true); setAiOut("");
    try {
      const r = await chatComplete([
        { role: "system", content: aiSystem.optionChain() },
        { role: "user", content: `${NO_INVENT}\n\n${summary}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(r);
    } catch { setAiOut("AI UNAVAILABLE."); }
    setAiLoading(false);
  };

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

  function pickStrike(s: number) {
    setStrike(s);
    requestAnimationFrame(() => {
      document.getElementById("strike-dossier")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Hoisted above the dossier memo (which reads them): ATM index + Greeks.
  const atmIdx = strikes.reduce((bi, s, i) => (Math.abs(s - underlying) < Math.abs(strikes[bi] - underlying) ? i : bi), 0);
  const atmStrike = strikes.length ? strikes[atmIdx] : 0;
  const ceG = greeksFor(sel, true);
  const peG = greeksFor(sel, false);

  // Strike dossier — everything the chain knows about ONE strike: positioning,
  // Greeks edge, straddle, buildup, liquidity, wall distances, verdict.
  const dossier = useMemo(() => {
    if (!sel || !underlying || !m) return null;
    const dist = sel.strike - underlying;
    const distPct = (dist / underlying) * 100;
    const totOI = m.totC + m.totP || 1;
    const totChg = rows.reduce((a, r) => a + Math.abs(r.ceChgOI) + Math.abs(r.peChgOI), 0) || 1;
    const totVol = m.totCV + m.totPV || 1;
    const oiShare = ((sel.ceOI + sel.peOI) / totOI) * 100;
    const chgShare = ((Math.abs(sel.ceChgOI) + Math.abs(sel.peChgOI)) / totChg) * 100;
    const volShare = ((sel.ceVol + sel.peVol) / totVol) * 100;
    const strikePCR = sel.peOI / Math.max(sel.ceOI, 1);
    const straddle = sel.ceLTP + sel.peLTP;
    const strPct = (straddle / underlying) * 100;
    const atmRow = rows[atmIdx];
    const buildOf = (netChg: number, chgOI: number, ltp: number): string => {
      if (!(ltp > 0)) return "DEAD";
      if (chgOI === 0) return "NO BUILD";
      if (netChg > 0 && chgOI > 0) return "LONG BUILDUP";
      if (netChg < 0 && chgOI > 0) return "SHORT BUILDUP";
      if (netChg > 0 && chgOI < 0) return "SHORT COVER";
      return "LONG UNWIND";
    };
    const liqOf = (bid: number, ask: number, ltp: number): string => {
      if (!(ltp > 0) || !(bid > 0) || !(ask > 0) || ask <= bid) return "DEAD";
      const sp = ((ask - bid) / ((ask + bid) / 2)) * 100;
      return sp < 2 ? "LIQUID" : sp < 5 ? "OK" : "WIDE";
    };
    const ceBuild = buildOf(sel.ceNetChg, sel.ceChgOI, sel.ceLTP);
    const peBuild = buildOf(sel.peNetChg, sel.peChgOI, sel.peLTP);
    const ceLiq = liqOf(sel.ceBidPx, sel.ceAskPx, sel.ceLTP);
    const peLiq = liqOf(sel.peBidPx, sel.peAskPx, sel.peLTP);
    const ceEdge = ceG ? sel.ceLTP - ceG.price : null;
    const peEdge = peG ? sel.peLTP - peG.price : null;
    const below = rows.filter((r) => r.strike < underlying).sort((a, b) => b.peOI - a.peOI);
    const above = rows.filter((r) => r.strike > underlying).sort((a, b) => b.ceOI - a.ceOI);
    const supRank = below.findIndex((r) => r.strike === sel.strike);
    const resRank = above.findIndex((r) => r.strike === sel.strike);
    const role = supRank >= 0 && supRank < 3 ? `SUPPORT #${supRank + 1}` : resRank >= 0 && resRank < 3 ? `RESISTANCE #${resRank + 1}` : sel.strike < underlying ? "WEAK SUPPORT" : sel.strike > underlying ? "WEAK RESIST" : "ATM PIVOT";
    const verdict = sel.strike === atmStrike
      ? `ATM — STRADDLE ${f2(straddle)} (±${strPct.toFixed(2)}%) PRICES THE EXP MOVE · ${ceBuild}/${peBuild}`
      : `${role} · ${strikePCR >= 1 ? "PUT-HEAVY" : "CALL-HEAVY"} PCR ${strikePCR.toFixed(2)} · ${ceBuild} vs ${peBuild}`;
    return {
      dist, distPct, oiShare, chgShare, volShare, strikePCR, straddle, strPct,
      ceBuild, peBuild, ceLiq, peLiq, ceEdge, peEdge, role, verdict,
      atmCeIV: atmRow?.ceIV ?? null, atmPeIV: atmRow?.peIV ?? null,
      mpDist: sel.strike - m.maxPain, gwDist: sel.strike - m.gammaWall,
      beUp: sel.strike + straddle, beDn: sel.strike - straddle,
    };
  }, [sel, underlying, m, rows, atmIdx, atmStrike, ceG, peG]);
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

  const win = rows.filter((_, i) => Math.abs(i - atmIdx) <= 14);

  const stradPay = cePay && pePay ? {
    xs: cePay.xs,
    pnls: cePay.pnls.map((p, i) => p + (pePay.pnls[i] ?? 0)),
    cost: (sel?.ceLTP ?? 0) + (sel?.peLTP ?? 0),
  } : null;

  // CALL vs PUT — deterministic edge read for THIS strike. +1 votes CALL,
  // -1 votes PUT, weighted; dead-illiquid legs veto their side. Educational
  // positioning read, not a tip — stake framing shows what the trade needs.
  const edgePick = useMemo(() => {
    if (!dossier || !sel || !underlying) return null;
    const F: Array<{ name: string; vote: 1 | -1 | 0; w: number; why: string }> = [];
    const ceB = (v: string, w2: number, w1: number): [1 | -1 | 0, number, string] => {
      if (v === "LONG BUILDUP") return [1, w2, "FRESH CE LONGS"];
      if (v === "SHORT COVER") return [1, w1, "CE SHORTS EXITING"];
      if (v === "SHORT BUILDUP") return [-1, w2, "FRESH CE SHORTS"];
      if (v === "LONG UNWIND") return [-1, w1, "CE LONGS EXITING"];
      return [0, 0, v === "DEAD" ? "CE DEAD" : "CE FLAT"];
    };
    const peB = (v: string, w2: number, w1: number): [1 | -1 | 0, number, string] => {
      if (v === "LONG BUILDUP") return [-1, w2, "PUT BUYING (HEDGE/SPEC)"];
      if (v === "SHORT COVER") return [-1, w1, "PUT WRITERS COVERING ON FEAR"];
      if (v === "SHORT BUILDUP") return [1, w2, "PUT WRITING (BULLISH)"];
      if (v === "LONG UNWIND") return [1, w1, "FEAR FADING, PUTS DUMPED"];
      return [0, 0, v === "DEAD" ? "PE DEAD" : "PE FLAT"];
    };
    const [v1, w1, s1] = ceB(dossier.ceBuild, 2, 1);
    F.push({ name: "CE BUILDUP", vote: v1, w: w1, why: s1 });
    const [v2, w2, s2] = peB(dossier.peBuild, 2, 1);
    F.push({ name: "PE BUILDUP", vote: v2, w: w2, why: s2 });
    if (dossier.role.startsWith("SUPPORT")) F.push({ name: "WALL ROLE", vote: 1, w: 2, why: `${dossier.role} — BOUNCE BIDS` });
    else if (dossier.role.startsWith("RESISTANCE")) F.push({ name: "WALL ROLE", vote: -1, w: 2, why: `${dossier.role} — REJECTION SUPPLY` });
    else if (dossier.role === "WEAK SUPPORT") F.push({ name: "WALL ROLE", vote: 1, w: 1, why: "SOFT SUPPORT BELOW" });
    else if (dossier.role === "WEAK RESIST") F.push({ name: "WALL ROLE", vote: -1, w: 1, why: "SOFT SUPPLY ABOVE" });
    else F.push({ name: "WALL ROLE", vote: 0, w: 0, why: "ATM PIVOT — NO WALL EDGE" });
    if (sug) {
      const wv = sug.confidence === "HIGH" ? 2 : 1;
      F.push(sug.side === "CE" ? { name: "CHAIN SIGNAL", vote: 1, w: wv, why: `ENGINE ${sug.action}` } : sug.side === "PE" ? { name: "CHAIN SIGNAL", vote: -1, w: wv, why: `ENGINE ${sug.action}` } : { name: "CHAIN SIGNAL", vote: 0, w: 0, why: "ENGINE NEUTRAL" });
    }
    if (m) F.push(m.sentiment === "Bullish" ? { name: "CHAIN MOOD", vote: 1, w: 1, why: `PCR ${m.pcr} BULLISH` } : { name: "CHAIN MOOD", vote: -1, w: 1, why: `PCR ${m.pcr} BEARISH` });
    if (dossier.ceEdge !== null && dossier.ceEdge < 0) F.push({ name: "CE EDGE", vote: 1, w: 1, why: `CE ${f2(Math.abs(dossier.ceEdge))} UNDER THEO` });
    if (dossier.peEdge !== null && dossier.peEdge < 0) F.push({ name: "PE EDGE", vote: -1, w: 1, why: `PE ${f2(Math.abs(dossier.peEdge))} UNDER THEO` });
    if (dossier.mpDist !== 0) F.push({ name: "MAX-PAIN PULL", vote: dossier.mpDist > 0 ? -1 : 1, w: 1, why: dossier.mpDist > 0 ? "STRIKE ABOVE MAX-PAIN — DRAG DOWN" : "STRIKE BELOW MAX-PAIN — DRAG UP" });
    let callPts = 0, putPts = 0;
    for (const f of F) {
      if (f.vote > 0) callPts += f.w;
      else if (f.vote < 0) putPts += f.w;
    }
    const ceDead = dossier.ceLiq === "DEAD";
    const peDead = dossier.peLiq === "DEAD";
    const raw = callPts - putPts;
    let verdict: string, side: "CALL" | "PUT" | "NONE";
    if (ceDead && peDead) { verdict = "NO EDGE — BOTH LEGS DEAD"; side = "NONE"; }
    else if (ceDead && raw > 0) { verdict = "NO EDGE — CALL WANTED BUT DEAD"; side = "NONE"; }
    else if (peDead && raw < 0) { verdict = "NO EDGE — PUT WANTED BUT DEAD"; side = "NONE"; }
    else if (raw >= 3) { verdict = "CALL EDGE"; side = "CALL"; }
    else if (raw <= -3) { verdict = "PUT EDGE"; side = "PUT"; }
    else { verdict = "NO EDGE — FLOW SPLIT"; side = "NONE"; }
    if (side === "CALL" && ceDead) { verdict = "NO EDGE — CALL DEAD"; side = "NONE"; }
    if (side === "PUT" && peDead) { verdict = "NO EDGE — PUT DEAD"; side = "NONE"; }
    const favLTP = side === "CALL" ? sel.ceLTP : side === "PUT" ? sel.peLTP : 0;
    const favBE = side === "CALL" ? cePay?.breakeven ?? null : side === "PUT" ? pePay?.breakeven ?? null : null;
    const needPct = side !== "NONE" && favBE !== null ? ((favBE - underlying) / underlying) * 100 : null;
    const bleed = side === "CALL" ? ceG?.theta ?? null : side === "PUT" ? peG?.theta ?? null : null;
    const flip = side === "CALL" ? "SPOT LOSING THE WALL / PE BUILDUP FLIP / SIGNAL TO PE" : side === "PUT" ? "SPOT RECLAIMING THE WALL / CE BUILDUP FLIP / SIGNAL TO CE" : "A 3-PT MARGIN EITHER WAY — WAIT FOR BUILDUP";
    return { factors: F, callPts, putPts, raw, verdict, side, favLTP, favBE, needPct, bleed, flip };
  }, [dossier, sel, underlying, m, sug, cePay, pePay, ceG, peG]);

  return (
    <>
      <CommandBar ticker={(() => { try { return store.getTicker(); } catch { return "NIFTY"; } })()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="110" symbol={symbol} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
          </div>
        </div>
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
                    {i % 4 === 0 && <text x={i * bw} y={146} fontSize="9" fill="#8a8a93">{r.strike >= 1000 ? `${(r.strike / 1000).toFixed(1)}k` : r.strike}</text>}
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
            <p className="p-head">Option chain — {rows.length} strikes · orange = ATM {strike.toLocaleString("en-IN")} · CLICK ANY ROW FOR THE FULL STRIKE DOSSIER</p>
            <div className="scrollx">
              <table className="plain">
                <thead><tr>
                  <th style={{ textAlign: "right" }}>CE OI</th><th style={{ textAlign: "right" }}>CHG OI</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>IV</th><th style={{ textAlign: "right" }}>LTP</th>
                  <th>STRIKE</th>
                  <th style={{ textAlign: "right" }}>LTP</th><th style={{ textAlign: "right" }}>IV</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>CHG OI</th><th style={{ textAlign: "right" }}>PE OI</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.strike} onClick={() => pickStrike(r.strike)} title={`OPEN ${r.strike} DOSSIER`} style={{ cursor: "pointer", ...(r.strike === strike ? { background: "rgba(255,160,40,0.10)" } : {}) }}>
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

        {dossier && sel && (
          <div className="panel panel-glow" id="strike-dossier">
            <p className="p-head">
              Strike dossier — {strike.toLocaleString("en-IN")} · {sel.strike === atmStrike ? "ATM" : `${f0(Math.abs(dossier.dist))} PTS ${dossier.dist > 0 ? "ABOVE" : "BELOW"} SPOT · CALL ${dossier.dist > 0 ? "OTM" : "ITM"} / PUT ${dossier.dist > 0 ? "ITM" : "OTM"}`} · {expiry} · T-{tDays}D
            </p>
            <div className="cells">
              <div className="cell"><div className="lbl">Spot dist</div><div className={`val ${dossier.dist >= 0 ? "pos" : "neg"}`}>{dossier.dist >= 0 ? "+" : ""}{dossier.distPct.toFixed(2)}%</div><div className="sub">vs {f2(underlying)}</div></div>
              <div className="cell"><div className="lbl">Role</div><div className="val" style={{ fontSize: 14 }}>{dossier.role}</div><div className="sub">OI walls</div></div>
              <div className="cell"><div className="lbl">PCR@strike</div><div className={`val ${dossier.strikePCR >= 1 ? "pos" : "neg"}`}>{dossier.strikePCR.toFixed(2)}</div><div className="sub">PE÷CE OI</div></div>
              <div className="cell"><div className="lbl">OI share</div><div className="val">{dossier.oiShare.toFixed(1)}%</div><div className="sub">of chain</div></div>
              <div className="cell"><div className="lbl">Chg-OI share</div><div className="val">{dossier.chgShare.toFixed(1)}%</div><div className="sub">fresh print</div></div>
              <div className="cell"><div className="lbl">Vol share</div><div className="val">{dossier.volShare.toFixed(1)}%</div><div className="sub">of chain</div></div>
              <div className="cell"><div className="lbl">Straddle</div><div className="val">{f2(dossier.straddle)}</div><div className="sub">±{dossier.strPct.toFixed(2)}%</div></div>
              <div className="cell"><div className="lbl">BE up / dn</div><div className="val" style={{ fontSize: 14 }}>{f0(dossier.beUp)} / {f0(dossier.beDn)}</div><div className="sub">straddle</div></div>
              <div className="cell"><div className="lbl">Max-pain Δ</div><div className="val">{dossier.mpDist >= 0 ? "+" : ""}{f0(dossier.mpDist)}</div><div className="sub">vs {f0(m?.maxPain ?? 0)}</div></div>
              <div className="cell"><div className="lbl">Gamma-wall Δ</div><div className="val">{dossier.gwDist >= 0 ? "+" : ""}{f0(dossier.gwDist)}</div><div className="sub">vs {f0(m?.gammaWall ?? 0)}</div></div>
            </div>
            {edgePick && (
              <div style={{ marginTop: 10 }}>
                <p className="p-head">Call vs put — where is the money here · {edgePick.verdict}</p>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10 }}>
                  <span className={`badge ${edgePick.side === "CALL" ? "ok" : edgePick.side === "PUT" ? "bad" : "fnc"}`} style={{ fontSize: 15, padding: "8px 14px" }}>
                    {edgePick.side === "NONE" ? "SIT OUT" : `PLAY ${edgePick.side}`}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>CALL {edgePick.callPts} PTS · PUT {edgePick.putPts} PTS · NEEDS ±3 MARGIN</span>
                </div>
                <HBars rows={[
                  { label: "CALL", value: edgePick.callPts, display: `${edgePick.callPts} PTS`, color: "#00d664" },
                  { label: "PUT", value: edgePick.putPts, display: `${edgePick.putPts} PTS`, color: "#ff453a" },
                ]} />
                {edgePick.side !== "NONE" && (
                  <div className="cells" style={{ marginTop: 10 }}>
                    <div className="cell"><div className="lbl">Entry ({edgePick.side})</div><div className="val">{f2(edgePick.favLTP)}</div><div className="sub">LTP pay</div></div>
                    <div className="cell"><div className="lbl">Breakeven</div><div className="val" style={{ fontSize: 15 }}>{edgePick.favBE !== null ? f0(edgePick.favBE) : "—"}</div><div className="sub">{edgePick.needPct !== null ? `${edgePick.needPct >= 0 ? "+" : ""}${edgePick.needPct.toFixed(2)}% needed` : "move needed"}</div></div>
                    <div className="cell"><div className="lbl">Theta bleed</div><div className="val neg">{edgePick.bleed !== null ? edgePick.bleed.toFixed(2) : "—"}/day</div><div className="sub">holding cost</div></div>
                    <div className="cell"><div className="lbl">Invalidation</div><div className="val" style={{ fontSize: 12 }}>FLIP = OUT</div><div className="sub">{edgePick.flip}</div></div>
                  </div>
                )}
                <table className="plain" style={{ marginTop: 10 }}>
                  <thead><tr><th>FACTOR</th><th>VOTE</th><th>WHY</th></tr></thead>
                  <tbody>
                    {edgePick.factors.map((f, i) => (
                      <tr key={i}>
                        <td><strong>{f.name}</strong></td>
                        <td>{f.vote > 0 ? <span className="pos"><strong>CALL ×{f.w}</strong></span> : f.vote < 0 ? <span className="neg"><strong>PUT ×{f.w}</strong></span> : <span className="faint">—</span>}</td>
                        <td style={{ fontSize: 12.5 }}>{f.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>RULES SCORE FROM THIS STRIKE'S BUILDUP + WALLS + SIGNAL + THEO EDGE — EDUCATIONAL READ, NOT A TIP · STRADDLE ±{dossier.strPct.toFixed(2)}% IS WHAT THE FLOOR PRICES</p>
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <p className="p-head">Legs — every quote, Greek, edge, buildup, liquidity readout</p>
              <div className="scrollx">
                <table className="plain">
                  <thead><tr><th>METRIC</th><th style={{ textAlign: "right" }}>CALL</th><th style={{ textAlign: "right" }}>PUT</th></tr></thead>
                  <tbody>
                    {([
                      ["LTP", f2(sel.ceLTP), f2(sel.peLTP)],
                      ["NET CHG", `${sel.ceNetChg >= 0 ? "+" : ""}${f2(sel.ceNetChg)}`, `${sel.peNetChg >= 0 ? "+" : ""}${f2(sel.peNetChg)}`],
                      ["OI", f0(sel.ceOI), f0(sel.peOI)],
                      ["CHG OI", `${sel.ceChgOI >= 0 ? "+" : ""}${f0(sel.ceChgOI)}`, `${sel.peChgOI >= 0 ? "+" : ""}${f0(sel.peChgOI)}`],
                      ["VOLUME", f0(sel.ceVol), f0(sel.peVol)],
                      ["IV %", `${f2(sel.ceIV)} (ATM ${dossier.atmCeIV !== null ? f2(dossier.atmCeIV) : "—"})`, `${f2(sel.peIV)} (ATM ${dossier.atmPeIV !== null ? f2(dossier.atmPeIV) : "—"})`],
                      ["BID × QTY", `${f2(sel.ceBidPx)}×${f0(sel.ceBidQty)}`, `${f2(sel.peBidPx)}×${f0(sel.peBidQty)}`],
                      ["ASK × QTY", `${f2(sel.ceAskPx)}×${f0(sel.ceAskQty)}`, `${f2(sel.peAskPx)}×${f0(sel.peAskQty)}`],
                      ["SPREAD", sel.ceBidPx > 0 && sel.ceAskPx > sel.ceBidPx ? `${f2(sel.ceAskPx - sel.ceBidPx)} (${(((sel.ceAskPx - sel.ceBidPx) / ((sel.ceAskPx + sel.ceBidPx) / 2)) * 100).toFixed(1)}%)` : "—", sel.peBidPx > 0 && sel.peAskPx > sel.peBidPx ? `${f2(sel.peAskPx - sel.peBidPx)} (${(((sel.peAskPx - sel.peBidPx) / ((sel.peAskPx + sel.peBidPx) / 2)) * 100).toFixed(1)}%)` : "—"],
                      ["THEO", ceG ? f2(ceG.price) : "—", peG ? f2(peG.price) : "—"],
                      ["EDGE LTP−THEO", dossier.ceEdge !== null ? `${dossier.ceEdge >= 0 ? "+" : ""}${f2(dossier.ceEdge)}` : "—", dossier.peEdge !== null ? `${dossier.peEdge >= 0 ? "+" : ""}${f2(dossier.peEdge)}` : "—"],
                      ["DELTA", ceG ? ceG.delta.toFixed(3) : "—", peG ? peG.delta.toFixed(3) : "—"],
                      ["GAMMA", ceG ? ceG.gamma.toFixed(5) : "—", peG ? peG.gamma.toFixed(5) : "—"],
                      ["THETA / DAY", ceG ? ceG.theta.toFixed(3) : "—", peG ? peG.theta.toFixed(3) : "—"],
                      ["VEGA", ceG ? ceG.vega.toFixed(2) : "—", peG ? peG.vega.toFixed(2) : "—"],
                      ["BREAKEVEN", cePay ? f2(cePay.breakeven) : "—", pePay ? f2(pePay.breakeven) : "—"],
                      ["BUILDUP", dossier.ceBuild, dossier.peBuild],
                      ["LIQUIDITY", dossier.ceLiq, dossier.peLiq],
                    ] as Array<[string, string, string]>).map(([k, c, p]) => (
                      <tr key={k}>
                        <td><strong>{k}</strong></td>
                        <td style={{ textAlign: "right" }} className={k === "BUILDUP" ? (c.includes("LONG BUILDUP") ? "pos" : c.includes("SHORT BUILDUP") ? "neg" : undefined) : undefined}>{c}</td>
                        <td style={{ textAlign: "right" }} className={k === "BUILDUP" ? (p.includes("LONG BUILDUP") ? "pos" : p.includes("SHORT BUILDUP") ? "neg" : undefined) : undefined}>{p}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {stradPay && (
              <div style={{ marginTop: 10 }}>
                <p className="p-head">Straddle — LONG CE+PE @ {f2(stradPay.cost)} · BE {f0(dossier.beDn)} / {f0(dossier.beUp)}</p>
                <LineChart series={[{ label: "STRADDLE PNL", color: "#ffa028", values: stradPay.pnls }]} height={130} yFmt={(v) => v.toFixed(0)} xLabels={[stradPay.xs[0].toFixed(0), stradPay.xs[30].toFixed(0), stradPay.xs[59].toFixed(0)]} />
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>READ: <strong style={{ color: "var(--amber)" }}>{dossier.verdict}</strong></p>
            <p className="faint" style={{ fontSize: 10.5, margin: "4px 0 0 0" }}>GREEKS VIA BLACK-SCHOLES ON LISTED IV (SOLVED WHERE 0) · BUILDUP = LTP-NETCHG × CHG-OI · NSE SNAPSHOT {ts || "—"}</p>
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
                    <tr key={g.strike} onClick={() => pickStrike(g.strike)} title={`OPEN ${g.strike} DOSSIER`} style={{ cursor: "pointer", ...(g.strike === strike ? { background: "rgba(255,160,40,0.10)" } : {}) }}>
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
                { label: "SCORED", value: acc.n, display: String(acc.n), color: "#8a8a93" },
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
        {aiOut && (
          <div className="panel"><p className="p-head">AI analyst</p><p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p></div>
        )}
        {rows.length > 0 && !aiOut && (
          <div className="panel"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "ANALYSING…" : "RUN AI"}</button></div>
        )}
      </main>
      <StatusBar extra={`OC ${symbol} ${expiry}`} />
    </>
  );
}
