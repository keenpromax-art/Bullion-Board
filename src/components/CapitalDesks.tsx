"use client";

import { useEffect, useState } from "react";
import { LineChart, BarChart, Donut, HBars } from "./charts";
import { sectorOf, SECTORS } from "@/lib/sectors";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";

/* ---------------- analyst ratings desk (ANR) ---------------- */

const REC_COLORS = ["#00d664", "#39d353", "#e3b341", "#ff853a", "#ff453a"];

// Rupee prints: max 2 decimals (₹111.67, never ₹111.667).
const rs = (v: unknown): string =>
  typeof v === "number" && isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";

// Conviction = 50% buy skew + 25% upside + 25% revision momentum (all 0–100 scaled).
const convictionOf = (pctBuy: number, upsidePct: number | null | undefined, revMom: number): number =>
  Math.round(
    (pctBuy ?? 0) * 0.5 +
    ((Math.max(-20, Math.min(50, upsidePct ?? 0)) + 20) / 70) * 100 * 0.25 +
    ((Math.max(-10, Math.min(10, revMom)) + 10) / 20) * 100 * 0.25
  );

export function ANRDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [surp, setSurp] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [peers, setPeers] = useState<any[] | null>(null);
  const [peersLoading, setPeersLoading] = useState(false);
  const [sortK, setSortK] = useState<string>("period");
  const [sortD, setSortD] = useState<1 | -1>(1);
  const [aiWhy, setAiWhy] = useState("");
  const [aiWhyLoading, setAiWhyLoading] = useState(false);
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const [cmpRows, setCmpRows] = useState<any[] | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(""); setSurp([]); setHist([]); setPeers(null);
    fetch(`/api/analyst?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "analyst failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    fetch(`/api/estimates?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setSurp(j.surprise ?? []); }).catch(() => {});
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1y&interval=1d`).then((r) => r.json()).then((j) => { if (alive && !j.error) setHist(j.bars ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [symbol]);

  if (err) return <div className="panel"><p className="neg">ANR ERR: {err}</p></div>;
  if (!data) return <div className="panel"><p className="muted">POLLING STREET…</p></div>;
  if (!data.hasData) {
    return (
      <div className="panel">
        <p className="p-head">Analyst ratings — {symbol}</p>
        <p className="muted">NO COVERAGE ON FEED FOR THIS NAME.</p>
      </div>
    );
  }
  const t = data.trend ?? [];
  const latest = t.find((r: any) => r.period === "0m") ?? t[0] ?? {};
  const e = data.earnings ?? {};
  const s = data.stats ?? {};
  const tg = data.targets ?? {};
  const nTot = (latest.strongBuy ?? 0) + (latest.buy ?? 0) + (latest.hold ?? 0) + (latest.sell ?? 0) + (latest.strongSell ?? 0);
  const parts = [
    { label: `STRONG BUY ${latest.strongBuy ?? 0}`, value: latest.strongBuy ?? 0, color: REC_COLORS[0] },
    { label: `BUY ${latest.buy ?? 0}`, value: latest.buy ?? 0, color: REC_COLORS[1] },
    { label: `HOLD ${latest.hold ?? 0}`, value: latest.hold ?? 0, color: REC_COLORS[2] },
    { label: `SELL ${latest.sell ?? 0}`, value: latest.sell ?? 0, color: REC_COLORS[3] },
    { label: `STRONG SELL ${latest.strongSell ?? 0}`, value: latest.strongSell ?? 0, color: REC_COLORS[4] },
  ];
  const buyPctOf = (r: any) => {
    const tot = (r.strongBuy ?? 0) + (r.buy ?? 0) + (r.hold ?? 0) + (r.sell ?? 0) + (r.strongSell ?? 0);
    return tot ? ((r.strongBuy + r.buy) / tot) * 100 : 0;
  };
  const chrono = [...t].reverse();
  const buySeries = chrono.map(buyPctOf);
  const buyDelta = buySeries.length > 1 ? buySeries[buySeries.length - 1] - buySeries[0] : 0;
  const trendUp = buySeries.length > 1 ? buySeries[buySeries.length - 1] >= buySeries[0] : true;
  const peg = s.forwardPE && e.growthPct ? s.forwardPE / e.growthPct : null;
  const est1y = (data.estimates ?? []).find((x: any) => x.period === "+1y") ?? {};
  const revMom = (est1y.up30d ?? 0) - (est1y.down30d ?? 0);
  const conviction = convictionOf(data.pctBuy ?? 0, tg.upsidePct, revMom);
  const contra = data.pctBuy >= 90 ? "CROWDED LONG — CONTRARIAN CAUTION" : data.pctBuy <= 15 ? "UNIVERSALLY HATED — CONTRARIAN OPPORTUNITY" : null;
  const asOf = (() => {
    try {
      const d = new Date(data.fetchedAt ?? "");
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
      return `${String(d.getDate()).padStart(2, "0")}-${mon}-${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    } catch { return "—"; }
  })();
  const sorted = [...t].sort((a: any, b: any) => {
    const gv = (r: any) => (sortK === "period" ? ["0m", "-1m", "-2m", "-3m"].indexOf(r.period) : sortK === "buypct" ? buyPctOf(r) : (r[sortK] ?? 0));
    return (gv(a) > gv(b) ? 1 : gv(a) < gv(b) ? -1 : 0) * sortD;
  });
  const th = (label: string, key: string) => (
    <th style={{ textAlign: key === "period" ? "left" : "right", cursor: "pointer", color: sortK === key ? "var(--amber)" : undefined }} onClick={() => {
      if (sortK === key) setSortD(sortD === 1 ? -1 : 1);
      else { setSortK(key); setSortD(1); }
    }}>{label}{sortK === key ? (sortD === 1 ? " ▲" : " ▼") : ""}</th>
  );
  const loadPeers = async () => {
    const key = sectorOf(symbol);
    const mates = (key ? SECTORS[key].tickers : []).filter((x) => x !== symbol.toUpperCase()).slice(0, 3);
    if (!mates.length) { setPeers([]); return; }
    setPeersLoading(true);
    try {
      const arr = await Promise.all(mates.map(async (m) => {
        try {
          const r = await fetch(`/api/company?symbol=${encodeURIComponent(m)}`);
          const j = await r.json();
          return r.ok ? j : null;
        } catch { return null; }
      }));
      setPeers(arr.filter(Boolean));
    } finally { setPeersLoading(false); }
  };
  const pxCloses = hist.filter((b: any) => typeof b.close === "number");
  const pxDates = pxCloses.map((b: any) => b.date);
  const pxVals = pxCloses.map((b: any) => b.close as number);
  const tgtLine = pxVals.map(() => (typeof tg.mean === "number" ? tg.mean : null));

  async function askWhy() {
    if (aiWhyLoading) return;
    setAiWhyLoading(true); setAiWhy("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.consensus() },
        { role: "user", content: `SEC ${symbol}. CONSENSUS ${data.consensus} (${data.pctBuy}% BUY, ${data.nAnalysts} ANALYSTS). TARGET ${tg.mean ?? "?"} (${tg.upsidePct ?? "?"}% UPSIDE, RANGE ${tg.low ?? "?"}-${tg.high ?? "?"}, DISPERSION ${tg.dispersionPct ?? "?"}%). 30D REVS +${est1y.up30d ?? 0}/-${est1y.down30d ?? 0}. BUY% DELTA ${buyDelta >= 0 ? "+" : ""}${buyDelta.toFixed(0)}PP VS OLDEST VINTAGE. CONVICTION ${conviction}/100. TASK: WHY THIS CONSENSUS — WHAT DRIVES IT + WHAT COULD BREAK IT. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiWhy(txt);
    } catch (e: unknown) { setAiWhy(`AI ERR: ${e instanceof Error ? e.message : "failed"}`); }
    finally { setAiWhyLoading(false); }
  }

  function exportCSV() {
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [`STREET,${symbol}`,
      "PERIOD,STRONG_BUY,BUY,HOLD,SELL,STRONG_SELL,BUY_PCT",
      ...t.map((r: any) => [r.period, r.strongBuy, r.buy, r.hold, r.sell, r.strongSell, buyPctOf(r).toFixed(1)].map(esc).join(",")),
      `ESTIMATES,${symbol}`,
      "PERIOD,END_DATE,EPS_AVG,EPS_LO,EPS_HI,REV_CR,GROWTH_PCT,UP30D,DOWN30D",
      ...(data.estimates ?? []).map((x: any) => [x.period, x.endDate, x.epsAvg, x.epsLow, x.epsHigh, x.revAvg ? Math.round(x.revAvg / 1e7) : "", x.growthPct, x.up30d, x.down30d].map(esc).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${symbol}-ANR.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function runCompare() {
    const syms = [cmpA.trim().toUpperCase(), cmpB.trim().toUpperCase()].filter(Boolean).slice(0, 2);
    if (!syms.length) return;
    setCmpLoading(true); setCmpRows(null);
    try {
      const rows = await Promise.all(syms.map(async (sm) => {
        try {
          const r = await fetch(`/api/analyst?symbol=${encodeURIComponent(sm)}`);
          const j = await r.json();
          if (!r.ok || !j.hasData) return { symbol: sm, err: true };
          const e1 = (j.estimates ?? []).find((x: any) => x.period === "+1y") ?? {};
          const rm = (e1.up30d ?? 0) - (e1.down30d ?? 0);
          return {
            symbol: sm, consensus: j.consensus, pctBuy: j.pctBuy,
            mean: j.targets?.mean ?? null, upsidePct: j.targets?.upsidePct ?? null,
            conviction: convictionOf(j.pctBuy ?? 0, j.targets?.upsidePct, rm),
          };
        } catch { return { symbol: sm, err: true }; }
      }));
      setCmpRows([
        { symbol, consensus: data.consensus, pctBuy: data.pctBuy, mean: tg.mean ?? null, upsidePct: tg.upsidePct ?? null, conviction, self: true },
        ...rows,
      ]);
    } finally { setCmpLoading(false); }
  }

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Analyst ratings — {symbol} · {data.nAnalysts} analysts · as of {asOf}</p>
        <div className="cells">
          <div className="cell">
            <div className="lbl">Consensus</div>
            <div className={`val ${data.pctBuy >= 60 ? "pos" : data.pctBuy < 40 ? "neg" : ""}`} style={{ fontSize: 19 }}>{data.consensus}</div>
            <div className="sub">{data.pctBuy}% buy · street: {data.streetKey ?? "—"}{contra ? <span className="badge bad" style={{ marginLeft: 6 }}>⚠ {contra}</span> : null}</div>
          </div>
          <div className="cell"><div className="lbl">Buy split</div><div className="val" style={{ fontSize: 15 }}>{latest.strongBuy ?? 0} SB / {latest.buy ?? 0} B</div><div className="sub">hold {latest.hold ?? 0} · sell {(latest.sell ?? 0) + (latest.strongSell ?? 0)} of {nTot}</div></div>
          <div className="cell"><div className="lbl">Rev 30D mom</div><div className={`val ${(revMom) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{revMom >= 0 ? "+" : "−"}{Math.abs(revMom)}</div><div className="sub"><span className="pos">+{est1y.up30d ?? 0}</span> up / <span className="neg">−{est1y.down30d ?? 0}</span> down · leads price</div></div>
          <div className="cell"><div className="lbl">Target mean</div><div className={`val ${(tg.upsidePct ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 17 }}>{tg.mean ? rs(tg.mean) : "—"}</div><div className="sub">{tg.upsidePct !== null && tg.upsidePct !== undefined ? `${tg.upsidePct >= 0 ? "+" : ""}${tg.upsidePct}% upside` : "no target"}</div></div>
          <div className="cell"><div className="lbl">Target range</div><div className="val" style={{ fontSize: 14 }}>{tg.low && tg.high ? `${rs(tg.low)} – ${rs(tg.high)}` : "—"}</div><div className="sub">{tg.dispersionPct !== null && tg.dispersionPct !== undefined ? `range ÷ mean ${tg.dispersionPct}% · comparable across names` : `med ${tg.median ? rs(tg.median) : "—"}`}</div></div>
          <div className="cell"><div className="lbl">Conviction</div><div className={`val ${conviction >= 70 ? "pos" : conviction < 50 ? "neg" : ""}`} style={{ fontSize: 17 }} title="50% buy skew + 25% upside (−20…+50 scaled) + 25% 30-day revision momentum (−10…+10 scaled)">{conviction}/100</div><div className="sub">{conviction >= 70 ? "strong" : conviction >= 50 ? "moderate" : "weak"} · 50% buy · 25% upside · 25% revs</div></div>
          <div className="cell"><div className="lbl">Fwd PE / Trail</div><div className="val">{s.forwardPE?.toFixed(1) ?? "—"} / {s.trailingPE?.toFixed(1) ?? "—"}</div><div className="sub">PEG {peg !== null && isFinite(peg) ? peg.toFixed(2) : "—"}</div></div>
          <div className="cell"><div className="lbl">P/B</div><div className="val">{s.priceToBook?.toFixed(2) ?? "—"}</div><div className="sub">book {s.bookValue?.toFixed(1) ?? "—"}</div></div>
          <div className="cell"><div className="lbl">EPS est {e.endDate || ""}</div><div className="val" style={{ fontSize: 15 }}>{e.epsAvg ?? "—"}</div><div className="sub">lo {e.epsLow ?? "—"} · hi {e.epsHigh ?? "—"}</div></div>
          <div className="cell"><div className="lbl">EPS growth</div><div className={`val ${e.growthPct >= 0 ? "pos" : "neg"}`}>{e.growthPct !== null && e.growthPct !== undefined ? `${e.growthPct >= 0 ? "+" : ""}${e.growthPct}%` : "—"}</div><div className="sub">{e.nAnalysts ?? "—"} analysts</div></div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <p className="p-head">Recommendation split — counts (hover slices)</p>
            <Donut slices={parts} unit="" />
          </div>
          <div>
            <p className="p-head">Buy % by vintage — bars · now {buySeries.length ? buySeries[buySeries.length - 1].toFixed(0) : "—"}% ({buyDelta >= 0 ? "+" : "−"}{Math.abs(buyDelta).toFixed(0)}pp vs {chrono[0]?.period ?? "—"})</p>
            <BarChart values={buySeries} labels={chrono.map((r: any) => r.period)} height={140} posColor={trendUp ? "#00d664" : "#ff453a"} negColor="#ff453a" />
          </div>
        </div>
        {pxVals.length > 20 && tg.mean ? (
          <div style={{ marginTop: 10 }}>
            <p className="p-head">Price history 1Y vs current consensus target · {tg.upsidePct !== null && tg.upsidePct !== undefined ? `${tg.upsidePct >= 0 ? "+" : ""}${tg.upsidePct}% upside` : ""}</p>
            <LineChart
              dates={pxDates.filter((_, i) => i % 5 === 0)}
              yFmt={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
              series={[
                { label: "PRICE", color: "#ffb000", values: pxVals.filter((_, i) => i % 5 === 0) },
                { label: "TARGET (NOW)", color: "#00d664", values: tgtLine.filter((_, i) => i % 5 === 0), dashed: true },
              ]}
            />
            <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>DASHED = CURRENT CONSENSUS SNAPSHOT ({rs(tg.mean)}), NOT A HISTORICAL SERIES. RATINGS COUNTS COVER ~4 MONTHS — 12M HISTORY NEEDS A RATINGS FEED.</p>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <p className="p-head">Street table — counts by period (click headers to sort)</p>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <button className="ghost" onClick={exportCSV}>↓ CSV — STREET + ESTIMATES</button>
        </div>
        <div className="scrollx">
          <table className="plain">
            <thead><tr>{th("PERIOD", "period")}{th("STR BUY", "strongBuy")}{th("BUY", "buy")}{th("HOLD", "hold")}{th("SELL", "sell")}{th("STR SELL", "strongSell")}{th("BUY %", "buypct")}</tr></thead>
            <tbody>
              {sorted.map((r: any) => (
                <tr key={r.period}>
                  <td><strong>{r.period}</strong></td>
                  <td style={{ textAlign: "right" }} className="pos">{r.strongBuy}</td>
                  <td style={{ textAlign: "right" }} className="pos">{r.buy}</td>
                  <td style={{ textAlign: "right" }}>{r.hold}</td>
                  <td style={{ textAlign: "right" }} className="neg">{r.sell}</td>
                  <td style={{ textAlign: "right" }} className="neg">{r.strongSell}</td>
                  <td style={{ textAlign: "right" }}><strong>{buyPctOf(r).toFixed(0)}%</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>RATING HISTORY ONLY GOES BACK 4 MONTHS ON YAHOO — 12M HISTORY NEEDS A RATINGS FEED.</p>
      </div>

      <div className="panel">
        <p className="p-head">Estimates — all forward periods (EPS + revenue + revisions)</p>
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>PERIOD</th><th style={{ textAlign: "right" }}>EPS AVG</th><th style={{ textAlign: "right" }}>LO–HI</th><th style={{ textAlign: "right" }}>REV EST</th><th style={{ textAlign: "right" }}>GROWTH</th><th style={{ textAlign: "right" }}>REV 30D</th></tr></thead>
            <tbody>
              {(data.estimates ?? []).map((x: any, i: number) => (
                <tr key={i}>
                  <td><strong>{x.period}</strong>{x.endDate ? <div className="faint" style={{ fontSize: 10.5 }}>{x.endDate} · {x.epsAnalysts ?? "—"} an</div> : null}</td>
                  <td style={{ textAlign: "right" }}>{x.epsAvg ?? "—"}</td>
                  <td style={{ textAlign: "right" }} className="faint">{x.epsLow ?? "—"} – {x.epsHigh ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>{x.revAvg ? (x.revAvg / 1e7).toFixed(0) + " Cr" : "—"}</td>
                  <td style={{ textAlign: "right" }} className={x.growthPct >= 0 ? "pos" : "neg"}>{x.growthPct !== null && x.growthPct !== undefined ? `${x.growthPct >= 0 ? "+" : ""}${x.growthPct}%` : "—"}</td>
                  <td style={{ textAlign: "right" }}><span className="pos">+{x.up30d ?? 0}</span> / <span className="neg">−{x.down30d ?? 0}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>REVISION MOMENTUM (UP MINUS DOWN) OFTEN LEADS PRICE — EBITDA SPLITS NOT ON YAHOO FEED.</p>
      </div>

      {surp.length > 0 && (
        <div className="panel">
          <p className="p-head">Beat / miss — actual vs estimate</p>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>QTR</th><th style={{ textAlign: "right" }}>ACTUAL</th><th style={{ textAlign: "right" }}>EST</th><th style={{ textAlign: "right" }}>SURPRISE</th></tr></thead>
              <tbody>
                {surp.map((x: any, i: number) => {
                  const sp = x.epsActual !== null && x.epsEstimate ? ((x.epsActual - x.epsEstimate) / Math.abs(x.epsEstimate)) * 100 : null;
                  return (
                    <tr key={i}>
                      <td><strong>{x.quarter}</strong></td>
                      <td style={{ textAlign: "right" }}>{x.epsActual ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{x.epsEstimate ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{sp === null ? "—" : <span className={sp >= 0 ? "pos" : "neg"}>{sp >= 0 ? "BEAT +" : "MISS "}{sp.toFixed(1)}%</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <p className="p-head">Why this consensus — AI</p>
        <div className="toolbar">
          <button className="btn" onClick={askWhy} disabled={aiWhyLoading}>{aiWhyLoading ? "RUNNING…" : "RUN AI: WHY THIS CONSENSUS"}</button>
        </div>
        {aiWhy && <pre className="ai" style={{ marginTop: 8 }}>{aiWhy}</pre>}
      </div>

      <div className="panel">
        <p className="p-head">Peer multiples — sector context</p>
        {!peers && (
          <div className="toolbar">
            <button className="btn" onClick={loadPeers} disabled={peersLoading}>{peersLoading ? "LOADING…" : "LOAD PEER MULTIPLES"}</button>
            <span className="faint" style={{ fontSize: 11 }}>3 SAME-SECTOR NAMES · IS {s.forwardPE?.toFixed(1) ?? "?"}x CHEAP OR RICH?</span>
          </div>
        )}
        {peers && peers.length > 0 && (
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>NAME</th><th style={{ textAlign: "right" }}>FWD PE</th><th style={{ textAlign: "right" }}>TRAIL PE</th><th style={{ textAlign: "right" }}>P/B</th></tr></thead>
              <tbody>
                <tr><td><strong>{symbol} ★</strong></td><td style={{ textAlign: "right" }}>{s.forwardPE?.toFixed(1) ?? "—"}</td><td style={{ textAlign: "right" }}>{s.trailingPE?.toFixed(1) ?? "—"}</td><td style={{ textAlign: "right" }}>{s.priceToBook?.toFixed(2) ?? "—"}</td></tr>
                {peers.map((p: any) => (
                  <tr key={p.symbol}>
                    <td>{p.symbol}</td>
                    <td style={{ textAlign: "right" }}>{p.derived?.fwdPE?.toFixed?.(1) ?? p.derived?.fwdPE ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{p.derived?.trailPE?.toFixed?.(1) ?? p.derived?.trailPE ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{p.profile?.valuation?.pb?.toFixed?.(2) ?? p.profile?.valuation?.pb ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {peers && peers.length === 0 && <p className="muted">NO SECTOR MAPPING FOR THIS SYMBOL.</p>}
      </div>

      <div className="panel">
        <p className="p-head">Conviction compare — {symbol} vs 2 names</p>
        <div className="toolbar">
          <input
            className="box" value={cmpA} onChange={(e) => setCmpA(e.target.value.toUpperCase())}
            placeholder={(() => { try { const k = sectorOf(symbol); const ms = k ? SECTORS[k].tickers.filter((x) => x !== symbol.toUpperCase()).slice(0, 2) : []; return ms[0] ?? "NAME 1…"; } catch { return "NAME 1…"; } })()}
            style={{ maxWidth: 170 }} spellCheck={false} autoComplete="off"
          />
          <input
            className="box" value={cmpB} onChange={(e) => setCmpB(e.target.value.toUpperCase())}
            placeholder={(() => { try { const k = sectorOf(symbol); const ms = k ? SECTORS[k].tickers.filter((x) => x !== symbol.toUpperCase()).slice(0, 2) : []; return ms[1] ?? "NAME 2…"; } catch { return "NAME 2…"; } })()}
            style={{ maxWidth: 170 }} spellCheck={false} autoComplete="off"
          />
          <button className="btn" onClick={runCompare} disabled={cmpLoading}>{cmpLoading ? "LOADING…" : "COMPARE"}</button>
          <span className="faint" style={{ fontSize: 11 }}>SAME 50/25/25 CONVICTION MATH BOTH SIDES</span>
        </div>
        {cmpRows && (
          <div className="scrollx" style={{ marginTop: 8 }}>
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>NAME</th><th style={{ textAlign: "right" }}>CONSENSUS</th><th style={{ textAlign: "right" }}>BUY %</th><th style={{ textAlign: "right" }}>TARGET</th><th style={{ textAlign: "right" }}>UPSIDE</th><th style={{ textAlign: "right" }}>CONVICTION</th></tr></thead>
              <tbody>
                {cmpRows.map((r: any) => (
                  <tr key={r.symbol}>
                    <td><strong>{r.symbol}{r.self ? " ★" : ""}</strong></td>
                    {r.err ? <td colSpan={5} style={{ textAlign: "right" }} className="faint">NO COVERAGE</td> : (
                      <>
                        <td style={{ textAlign: "right" }}>{r.consensus}</td>
                        <td style={{ textAlign: "right" }}>{r.pctBuy}%</td>
                        <td style={{ textAlign: "right" }}>{r.mean !== null ? rs(r.mean) : "—"}</td>
                        <td style={{ textAlign: "right" }} className={(r.upsidePct ?? 0) >= 0 ? "pos" : "neg"}>{r.upsidePct !== null ? `${r.upsidePct >= 0 ? "+" : ""}${r.upsidePct}%` : "—"}</td>
                        <td style={{ textAlign: "right" }}><strong className={r.conviction >= 70 ? "pos" : r.conviction < 50 ? "neg" : ""}>{r.conviction}</strong></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <p className="p-head">Beyond free data — needs a ratings feed</p>
        <div className="fnrow dead"><span className="faint" style={{ minWidth: 26 }}>·</span><span style={{ flex: 1 }}><strong className="faint">PER-FIRM TABLE (FIRM × RATING × TARGET × UPDATED)</strong></span><span className="badge bad">NEEDS RATINGS FEED</span></div>
        <div className="fnrow dead"><span className="faint" style={{ minWidth: 26 }}>·</span><span style={{ flex: 1 }}><strong className="faint">UPGRADE / DOWNGRADE / INITIATION LOG + LAST ACTION</strong></span><span className="badge bad">NEEDS RATINGS FEED</span></div>
        <div className="fnrow dead"><span className="faint" style={{ minWidth: 26 }}>·</span><span style={{ flex: 1 }}><strong className="faint">TARGET-PRICE TREND HISTORY + 12M RATING HISTORY + ACCURACY TRACKING</strong></span><span className="badge bad">NEEDS RATINGS FEED</span></div>
        <div className="fnrow dead"><span className="faint" style={{ minWidth: 26 }}>·</span><span style={{ flex: 1 }}><strong className="faint">FIRM-TIER WEIGHTING BY HISTORICAL ACCURACY</strong></span><span className="badge bad">NEEDS RATINGS FEED</span></div>
      </div>
    </div>
  );
}

/* ---------------- capital structure desk (CAST: stack + WACC + DDIS) ---------------- */

export function CastDesk({ symbol }: { symbol: string }) {
  const [co, setCo] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [dd, setDd] = useState<any>(null);
  const [err, setErr] = useState("");
  const [rf, setRf] = useState("7");
  const [beta, setBeta] = useState("1");
  const [erp, setErp] = useState("6");
  const [rd, setRd] = useState("9");

  useEffect(() => {
    let alive = true;
    setCo(null); setSt(null); setDd(null); setErr("");
    Promise.all([
      fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()),
      fetch(`/api/statements?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()),
      fetch(`/api/schedule?symbol=${encodeURIComponent(symbol)}&parent=Borrowings&section=balance-sheet`).then((r) => r.json()).catch(() => ({})),
    ])
      .then(([c, s, d]) => {
        if (!alive) return;
        if (c.error && s.error) throw new Error(c.error || s.error);
        setCo(c.error ? null : c);
        setSt(s.error ? null : s);
        setDd(d.rows ? d : null);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol]);

  if (err) return <div className="panel"><p className="neg">CAST ERR: {err}</p></div>;
  if (!co && !st) return <div className="panel"><p className="muted">BUILDING CAPITAL STACK…</p></div>;

  const mcapCr = (co?.quote?.marketCap ?? 0) / 1e7 || (st?.marketCapCr ?? 0);
  const num = (rows: any[] | undefined, cands: string[]): number | null => {
    if (!rows) return null;
    const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = rows.find((r) => cands.some((c) => nn(r.label).includes(nn(c))));
    if (!hit) return null;
    for (let i = hit.values.length - 1; i >= 0; i--) if (hit.values[i] !== null) return hit.values[i];
    return null;
  };
  const borrow = st?.bs ? num(st.bs.rows, ["borrowings", "total debt", "long term debt"]) : null;
  const cap = st?.bs ? num(st.bs.rows, ["equity share capital", "share capital", "share issued", "common stock", "stockholders equity"]) : null;
  const res = st?.bs ? num(st.bs.rows, ["reserves", "other equity", "retained earnings"]) : null;
  const pbt = st?.pl ? num(st.pl.rows, ["profit before tax", "pretax income"]) : null;
  const ni = st?.pl ? num(st.pl.rows, ["net profit", "profit after tax", "net income"]) : null;
  const debt = borrow ?? 0;
  const tax = pbt && ni && pbt !== 0 ? Math.max(0, Math.min(0.6, (pbt - ni) / pbt)) : 0.25;
  const P = (s: string) => parseFloat(s);
  const re = P(rf) / 100 + P(beta) * (P(erp) / 100);
  const wacc = mcapCr + debt > 0
    ? (mcapCr / (mcapCr + debt)) * re + (debt / (mcapCr + debt)) * (P(rd) / 100) * (1 - tax)
    : NaN;
  const de = mcapCr > 0 ? debt / mcapCr : null;

  // D/E + debt history from BS ledger (Yahoo/yfinance labels)
  let deSeries: { pers: string[]; de: (number | null)[]; debt: (number | null)[] } | null = null;
  if (st?.bs) {
    const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const bRow = st.bs.rows.find((r: any) => ["borrowings", "total debt", "long term debt"].some((c) => nn(r.label).includes(nn(c))));
    const cRow = st.bs.rows.find((r: any) => ["equity share capital", "share capital", "share issued", "stockholders equity"].some((c) => nn(r.label).includes(nn(c))));
    const rRow = st.bs.rows.find((r: any) => ["reserves", "other equity", "retained earnings"].some((c) => nn(r.label).includes(nn(c))));
    if (bRow) {
      const pers: string[] = st.bs.periods ?? [];
      const de = pers.map((_, i) => {
        const d = bRow.values[i];
        const e = (cRow?.values[i] ?? 0) + (rRow?.values[i] ?? 0);
        return d !== null && e ? d / e : null;
      });
      deSeries = { pers, de, debt: bRow.values };
    }
  }
  const x3: [string, string, string] | undefined = deSeries && deSeries.pers.length > 2
    ? [deSeries.pers[0], deSeries.pers[Math.floor(deSeries.pers.length / 2)], deSeries.pers[deSeries.pers.length - 1]]
    : undefined;

  const schedNum = (v: unknown): number | null => {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/,/g, ""));
      return isFinite(n) ? n : null;
    }
    return null;
  };

  const F = (label: string, v: string, set: (s: string) => void) => (
    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>{label}
      <input className="box" value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" />
    </label>
  );

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Capital stack — {symbol} · equity ₹{Math.round(mcapCr).toLocaleString("en-IN")} Cr vs debt ₹{Math.round(debt).toLocaleString("en-IN")} Cr</p>
        <div className="cells">
          <div className="cell"><div className="lbl">D/E</div><div className={`val ${de !== null && de > 1 ? "neg" : ""}`}>{de !== null ? de.toFixed(2) : "—"}×</div><div className="sub">debt / mcap</div></div>
          <div className="cell"><div className="lbl">Cost of equity</div><div className="val">{isFinite(re) ? `${(re * 100).toFixed(1)}%` : "—"}</div><div className="sub">rf + β·erp</div></div>
          <div className="cell"><div className="lbl">After-tax debt</div><div className="val">{isFinite(P(rd)) ? `${((P(rd) / 100) * (1 - tax) * 100).toFixed(1)}%` : "—"}</div><div className="sub">tax {(tax * 100).toFixed(0)}%</div></div>
          <div className="cell"><div className="lbl">WACC</div><div className="val pos" style={{ fontSize: 20 }}>{isFinite(wacc) ? `${(wacc * 100).toFixed(1)}%` : "—"}</div><div className="sub">blended</div></div>
        </div>
        <div className="grid grid-4" style={{ marginTop: 10 }}>
          {F("RISK-FREE %", rf, setRf)}
          {F("BETA", beta, setBeta)}
          {F("ERP %", erp, setErp)}
          {F("COST OF DEBT %", rd, setRd)}
        </div>
        <div style={{ marginTop: 10 }}>
          <Donut slices={[
            { label: "EQUITY", value: mcapCr, color: "#00d664" },
            { label: "DEBT", value: debt, color: "#ff453a" },
          ]} />
        </div>
      </div>

      {deSeries && (
        <div className="panel">
          <p className="p-head">Leverage path — D/E + borrowings ₹ Cr</p>
          <LineChart
            series={[{ label: "D/E", color: "#ffa028", values: deSeries.de }]}
            height={110} yFmt={(v) => `${v.toFixed(2)}×`} dates={deSeries.pers} xLabels={x3}
          />
          <div style={{ marginTop: 8 }}>
            <BarChart
              values={deSeries.debt.map((v) => v ?? 0)}
              labels={deSeries.pers} height={90} posColor="#ff453a" negColor="#ff453a"
            />
          </div>
        </div>
      )}

      <div className="panel">
        <p className="p-head">Debt distribution — borrowings breakup, latest</p>
        {!dd ? (
          <p className="muted">PULLING SCHEDULES…</p>
        ) : (dd.rows ?? []).length === 0 ? (
          <p className="muted">NO BREAKUP ON FEED.</p>
        ) : (
          <>
            <Donut slices={(dd.rows ?? []).slice(0, 6).map((r: any, i: number) => {
              const arr = Object.values(r.values ?? {}).map(schedNum).filter((v): v is number => v !== null);
              return {
                label: String(r.label).toUpperCase().slice(0, 18),
                value: arr.length ? arr[arr.length - 1] : 0,
                color: ["#ffa028", "#00d664", "#8f7bff", "#00c8ff", "#ff453a", "#5b5b62"][i % 6],
              };
            })} />
            <table className="plain" style={{ marginTop: 8 }}>
              <thead><tr><th>TRANCHE</th><th style={{ textAlign: "right" }}>LATEST ₹ CR</th></tr></thead>
              <tbody>
                {(dd.rows ?? []).map((r: any) => {
                  const arr = Object.values(r.values ?? {}).map(schedNum).filter((v): v is number => v !== null);
                  const last = arr.length ? arr[arr.length - 1] : null;
                  return (
                    <tr key={r.label}>
                      <td><strong>{r.label}</strong></td>
                      <td style={{ textAlign: "right" }}>{last !== null ? last.toLocaleString("en-IN") : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
