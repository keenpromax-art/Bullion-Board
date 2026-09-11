"use client";

import { useEffect, useState } from "react";
import { LineChart, BarChart, Donut, HBars } from "./charts";
import { sectorOf, SECTORS } from "@/lib/sectors";

/* ---------------- analyst ratings desk (ANR) ---------------- */

const REC_COLORS = ["#00d664", "#39d353", "#e3b341", "#ff853a", "#ff453a"];

export function ANRDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [surp, setSurp] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [peers, setPeers] = useState<any[] | null>(null);
  const [peersLoading, setPeersLoading] = useState(false);
  const [sortK, setSortK] = useState<string>("period");
  const [sortD, setSortD] = useState<1 | -1>(1);

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
  const peak = buySeries.length ? Math.max(...buySeries) : 0;
  const peakAt = chrono[buySeries.indexOf(peak)]?.period ?? "";
  const trendUp = buySeries.length > 1 ? buySeries[buySeries.length - 1] >= buySeries[0] : true;
  const peg = s.forwardPE && e.growthPct ? s.forwardPE / e.growthPct : null;
  const est1y = (data.estimates ?? []).find((x: any) => x.period === "+1y") ?? {};
  const revMom = (est1y.up30d ?? 0) - (est1y.down30d ?? 0);
  const conviction = Math.round(
    (data.pctBuy ?? 0) * 0.5 +
    ((Math.max(-20, Math.min(50, tg.upsidePct ?? 0)) + 20) / 70) * 100 * 0.25 +
    ((Math.max(-10, Math.min(10, revMom)) + 10) / 20) * 100 * 0.25
  );
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
    <th style={{ textAlign: key === "period" ? "left" : "right", cursor: "pointer" }} onClick={() => {
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

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Analyst ratings — {symbol} · {data.nAnalysts} analysts · as of {asOf}</p>
        <div className="cells">
          <div className="cell">
            <div className="lbl">Consensus</div>
            <div className={`val ${data.pctBuy >= 60 ? "pos" : data.pctBuy < 40 ? "neg" : ""}`} style={{ fontSize: 19 }}>{data.consensus}</div>
            <div className="sub">{data.pctBuy}% buy · street: {data.streetKey ?? "—"}</div>
          </div>
          <div className="cell"><div className="lbl">Buy split</div><div className="val" style={{ fontSize: 15 }}>{latest.strongBuy ?? 0} SB / {latest.buy ?? 0} B</div><div className="sub">hold {latest.hold ?? 0} · sell {(latest.sell ?? 0) + (latest.strongSell ?? 0)} of {nTot}</div></div>
          <div className="cell"><div className="lbl">Target mean</div><div className={`val ${(tg.upsidePct ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 17 }}>{tg.mean ? `₹${tg.mean.toLocaleString("en-IN")}` : "—"}</div><div className="sub">{tg.upsidePct !== null && tg.upsidePct !== undefined ? `${tg.upsidePct >= 0 ? "+" : ""}${tg.upsidePct}% upside` : "no target"}</div></div>
          <div className="cell"><div className="lbl">Target range</div><div className="val" style={{ fontSize: 14 }}>{tg.low && tg.high ? `₹${tg.low.toLocaleString("en-IN")} – ₹${tg.high.toLocaleString("en-IN")}` : "—"}</div><div className="sub">{tg.dispersionPct !== null && tg.dispersionPct !== undefined ? `spread ${tg.dispersionPct}% = uncertainty` : `med ${tg.median ? `₹${tg.median.toLocaleString("en-IN")}` : "—"}`}</div></div>
          <div className="cell"><div className="lbl">Conviction</div><div className={`val ${conviction >= 70 ? "pos" : conviction < 50 ? "neg" : ""}`} style={{ fontSize: 17 }}>{conviction}/100</div><div className="sub">{conviction >= 70 ? "strong" : conviction >= 50 ? "moderate" : "weak"} · rating+upside+revs</div></div>
          <div className="cell"><div className="lbl">Fwd PE / Trail</div><div className="val">{s.forwardPE?.toFixed(1) ?? "—"} / {s.trailingPE?.toFixed(1) ?? "—"}</div><div className="sub">PEG {peg !== null && isFinite(peg) ? peg.toFixed(2) : "—"}</div></div>
          <div className="cell"><div className="lbl">P/B</div><div className="val">{s.priceToBook?.toFixed(2) ?? "—"}</div><div className="sub">book {s.bookValue?.toFixed(1) ?? "—"}</div></div>
          <div className="cell"><div className="lbl">EPS est {e.endDate || ""}</div><div className="val" style={{ fontSize: 15 }}>{e.epsAvg ?? "—"}</div><div className="sub">lo {e.epsLow ?? "—"} · hi {e.epsHigh ?? "—"}</div></div>
          <div className="cell"><div className="lbl">EPS growth</div><div className={`val ${e.growthPct >= 0 ? "pos" : "neg"}`}>{e.growthPct !== null && e.growthPct !== undefined ? `${e.growthPct >= 0 ? "+" : ""}${e.growthPct}%` : "—"}</div><div className="sub">{e.nAnalysts ?? "—"} analysts</div></div>
        </div>
        {contra && <p className="neg" style={{ fontSize: 12, marginBottom: 0 }}>⚠ {contra}</p>}
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <p className="p-head">Recommendation split — counts (hover slices)</p>
            <Donut slices={parts} unit="" />
          </div>
          <div>
            <p className="p-head">Buy % trend — line, peak {peak.toFixed(1)} @ {peakAt}</p>
            <LineChart
              dates={chrono.map((r: any) => r.period)}
              yFmt={(v) => `${v.toFixed(0)}%`}
              series={[{ label: "BUY%", color: trendUp ? "#00d664" : "#ff453a", values: buySeries }]}
            />
          </div>
        </div>
        {pxVals.length > 20 && tg.mean ? (
          <div style={{ marginTop: 10 }}>
            <p className="p-head">Price vs consensus target — 1Y</p>
            <LineChart
              dates={pxDates.filter((_, i) => i % 5 === 0)}
              yFmt={(v) => `₹${Math.round(v).toLocaleString("en-IN")}`}
              series={[
                { label: "PRICE", color: "#ffb000", values: pxVals.filter((_, i) => i % 5 === 0) },
                { label: "TARGET", color: "#00d664", values: tgtLine.filter((_, i) => i % 5 === 0), dashed: true },
              ]}
            />
          </div>
        ) : null}
      </div>

      <div className="panel">
        <p className="p-head">Street table — counts by period (click headers to sort)</p>
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
