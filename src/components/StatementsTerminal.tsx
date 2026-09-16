"use client";

// Statements Terminal (module 12 full view) — every computable slice of the
// 27-point financial-statements spec from Yahoo (yfinance) + screener holdings.
// Sources per section are labeled; anything needing a feed Yahoo lacks is an
// explicit NEEDS-FEED panel, never silently missing.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStatements, useCompany, RatiosTables } from "./FundaDesks";
import type { STable } from "./FundaDesks";
import { LineChart, GroupedBars, BarChart, Donut, HBars } from "./charts";
import { sectorOf, SECTORS } from "@/lib/sectors";
import { chatComplete } from "@/lib/ai";
import { store } from "@/lib/store";

type Num = number | null;
type Row = { label: string; values: Num[] };

const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function findVals(t: STable | null, cands: string[]): Num[] | null {
  if (!t) return null;
  const lows = t.rows.map((r) => ({ r, l: nn(r.label) }));
  for (const c of cands) {
    const nc = nn(c);
    const exact = lows.find((x) => x.l === nc);
    if (exact) return exact.r.values;
  }
  for (const c of cands) {
    const nc = nn(c);
    const all = lows.filter((x) => x.l.includes(nc));
    if (all.length) {
      all.sort((a, b) => a.r.label.length - b.r.label.length);
      return all[0].r.values;
    }
  }
  return null;
}

function matchRows(t: STable | null, pats: RegExp | RegExp[]): Row[] {
  if (!t) return [];
  const list = Array.isArray(pats) ? pats : [pats];
  return t.rows.filter((r) => list.some((p) => p.test(r.label)));
}

const at = (arr: Num[] | null | undefined, i: number): Num =>
  !arr || i < 0 || i >= arr.length ? null : (arr[i] as Num);
const yoyPct = (arr: Num[], i: number): Num => {
  const c = at(arr, i), p = at(arr, i - 1);
  if (c === null || p === null || !p || i === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
};
const cagrPct = (arr: Num[]): Num => {
  const f = arr.filter((x): x is number => x !== null);
  if (f.length < 2) return null;
  const a = f[0] as number, b = f[f.length - 1] as number;
  if (a <= 0 || b <= 0) return null;
  return (Math.pow(b / a, 1 / (f.length - 1)) - 1) * 100;
};

function Sec({ id, no, title, src, children }: { id: string; no: string; title: string; src: string; children: React.ReactNode }) {
  return (
    <div className="panel" id={id}>
      <p className="p-head">{no} · {title} <span className="faint">— {src}</span></p>
      {children}
    </div>
  );
}

function Dead({ items, need }: { items: string[]; need: string }) {
  return (
    <div className="panel">
      <p className="p-head">Not on Yahoo feed</p>
      {items.map((d) => (
        <div key={d} className="fnrow dead">
          <span className="faint" style={{ minWidth: 26 }}>·</span>
          <span style={{ flex: 1 }}><strong className="faint">{d.toUpperCase()}</strong></span>
          <span className="badge bad">{need}</span>
        </div>
      ))}
    </div>
  );
}

function LTable({ periods, rows, moneyFmt, heat, sub, onLabelClick }: {
  periods: string[]; rows: Row[];
  moneyFmt: (v: number) => string; heat: boolean; sub?: (label: string, i: number) => string | null;
  onLabelClick?: (label: string, e: React.MouseEvent) => void;
}) {
  if (!rows.length) return <p className="muted">NO ROWS ON FEED.</p>;
  return (
    <div className="scrollx">
      <table className="plain">
        <thead><tr><th style={{ textAlign: "left" }}>LINE</th>{periods.map((p) => <th key={p} style={{ textAlign: "right" }}>{p}</th>)}<th style={{ textAlign: "right", color: "var(--amber)" }}>YOY %</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            // Find last two non-null indices for correct YoY
            let li = -1, pi = -1;
            for (let k = r.values.length - 1; k >= 0; k--) {
              if (r.values[k] !== null) { if (li === -1) li = k; else { pi = k; break; } }
            }
            const y = li >= 0 && pi >= 0 ? yoyPct(r.values, li) : null;
            const bg = heat && y !== null
              ? y >= 0 ? `rgba(0,214,100,${Math.min(0.22, Math.abs(y) / 100)})` : `rgba(255,69,58,${Math.min(0.22, Math.abs(y) / 100)})`
              : undefined;
            return (
              <tr key={r.label}>
                <td>
                  {onLabelClick
                    ? <strong style={{ cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }} onClick={(e) => onLabelClick(r.label, e)}>{r.label}</strong>
                    : <strong>{r.label}</strong>}
                  {sub && <div className="faint" style={{ fontSize: 10.5 }}>{sub(r.label, r.values.length - 1)}</div>}
                </td>
                {r.values.map((v, i) => <td key={i} style={{ textAlign: "right" }}>{v === null ? "—" : moneyFmt(v)}</td>)}
                <td style={{ textAlign: "right", background: bg }}>
                  {y === null ? "—" : <span className={y >= 0 ? "pos" : "neg"}>{y >= 0 ? "+" : ""}{y.toFixed(1)}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const NAV: Array<[string, string]> = [
  ["t-ledger", "LEDGER"], ["t-growth", "GROWTH"], ["t-profit", "MARGINS"],
  ["t-lev", "LEVERAGE"], ["t-liq", "LIQUIDITY"], ["t-turn", "TURNS"],
  ["t-ps", "PER-SHARE"], ["t-val", "VALUE"], ["t-peer", "PEERS"],
  ["t-qual", "QUALITY"], ["t-tax", "TAX"], ["t-wc", "WC"],
  ["t-alloc", "ALLOC"], ["t-est", "ESTIMATES"], ["t-notes", "NOTES"],
  ["t-act", "ACTIONS"], ["t-ctx", "CONTEXT"], ["t-cash", "CASH"], ["t-off", "OFF-BS"],
];

export function StatementsTerminal({ symbol }: { symbol: string }) {
  const { data: st, err, loading } = useStatements(symbol);
  const { q: coQ } = useCompany(symbol);
  const [basis, setBasis] = useState<"annual" | "quarterly" | "ttm">("annual");
  const [pctMode, setPctMode] = useState(false);
  const [ccy, setCcy] = useState<"INR" | "USD">("INR");
  const [heat, setHeat] = useState(false);
  const [stmtFilter, setStmtFilter] = useState<"all" | "is" | "bs" | "cf">("all");
  const [explLabel, setExplLabel] = useState<string | null>(null);
  const [explText, setExplText] = useState<string>("");
  const [explLoading, setExplLoading] = useState(false);
  const [explPos, setExplPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const explRef = useRef<HTMLDivElement>(null);
  const [est, setEst] = useState<any>(null);
  const [evts, setEvts] = useState<any>(null);
  const [fx, setFx] = useState<number | null>(null);
  const [hist, setHist] = useState<any[]>([]);
  const [bench, setBench] = useState<any[]>([]);
  const [peers, setPeers] = useState<any[] | null>(null);
  const [peersLoading, setPeersLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setEst(null); setEvts(null); setPeers(null); setHist([]); setBench([]);
    fetch(`/api/estimates?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setEst(j); }).catch(() => {});
    fetch(`/api/events?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setEvts(j); }).catch(() => {});
    fetch(`/api/quote?symbol=${encodeURIComponent("USDINR=X")}`).then((r) => r.json()).then((j) => { if (alive && typeof j?.regularMarketPrice === "number") setFx(j.regularMarketPrice); }).catch(() => {});
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=5y&interval=1mo`).then((r) => r.json()).then((j) => { if (alive && !j.error) setHist(j.bars ?? []); }).catch(() => {});
    fetch(`/api/history?symbol=${encodeURIComponent("^NSEI")}&range=5y&interval=1mo`).then((r) => r.json()).then((j) => { if (alive && !j.error) setBench(j.bars ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [symbol]);

  const rate = fx && fx > 0 ? fx : 83;
  // Money formatter: ₹ Cr in INR mode, $ m/B in USD mode.
  const mf = (v: number) => ccy === "INR"
    ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 })
    : (() => { const usd = (v * 1e7) / rate; return usd >= 1e9 ? `$${(usd / 1e9).toFixed(2)}B` : `$${(usd / 1e6).toFixed(1)}m`; })();
  const unit = ccy === "INR" ? "₹ CRORES" : `$ M/B @ ${rate.toFixed(2)}`;

  // Basis tables: annual | quarterly | TTM (sum of last 4 quarters for flows)
  const basisTbl = useMemo(() => {
    if (!st) return { pl: null as STable | null, cf: null as STable | null, periods: [] as string[], bsNote: "" };
    if (basis === "annual") return { pl: st.pl, cf: st.cf, periods: st.pl?.periods ?? [], bsNote: "" };
    if (basis === "quarterly") return { pl: st.qtr, cf: st.qtrCF, periods: st.qtr?.periods ?? [], bsNote: "BS IS POINT-IN-TIME — SHOWING LATEST FY." };
    // TTM: sum last 4 quarterly columns per row (per-share-count rows take latest)
    const mkTTM = (t: STable | null): STable | null => {
      if (!t || t.periods.length < 4) return null;
      const k = 4;
      const rows = t.rows.map((r) => {
        const latestOnly = /(taxrate|averageshares|sharesnumber|shareissued|treasuryshares|ordinaryshares)/i.test(nn(r.label));
        const vals = r.values.slice(-k);
        if (latestOnly) {
          let last: Num = null;
          for (let i = vals.length - 1; i >= 0; i--) { const v = vals[i] as Num; if (v !== null) { last = v; break; } }
          return { ...r, values: [last], raw: [last === null ? "—" : String(last)] };
        }
        let s: Num = 0;
        for (const v of vals) { const x = v as Num; if (x === null) { s = null; break; } s += x; }
        const sv = s === null ? null : Math.round((s as number) * 100) / 100;
        return { ...r, values: [sv], raw: [sv === null ? "—" : String(sv)] };
      }).filter((r) => r.values[0] !== null);
      return { periods: ["TTM"], rows };
    };
    return { pl: mkTTM(st.qtr), cf: mkTTM(st.qtrCF), periods: ["TTM"], bsNote: "BS IS POINT-IN-TIME — SHOWING LATEST FY." };
  }, [st, basis]);

  const exportCSV = () => {
    if (!st) return;
    const lines = [`# ${st.symbol} statements terminal export`];
    const dump = (name: string, t: STable | null) => {
      if (!t) return;
      lines.push(`\n## ${name} (${t.periods.join(",")})`);
      for (const r of t.rows) lines.push([JSON.stringify(r.label), ...r.values.map((v) => (v === null ? "" : String(v)))].join(","));
    };
    dump("INCOME annual", st.pl); dump("BALANCE annual", st.bs); dump("CASHFLOW annual", st.cf);
    dump("INCOME quarterly", st.qtr); dump("RATIOS", st.rat); dump("HOLDINGS", st.sh);
    if (est?.surprise?.length) {
      lines.push("\n## ESTIMATE SURPRISES (quarter,actual,estimate)");
      for (const s of est.surprise) lines.push(`${s.quarter},${s.epsActual ?? ""},${s.epsEstimate ?? ""}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${st.symbol}-statements.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <div className="panel"><p className="muted">BUILDING STATEMENTS TERMINAL FOR {symbol}…</p></div>;
  if (err) return <div className="panel"><p className="neg">TERMINAL ERR: {err} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!st) return null;

  const P = basisTbl.periods;
  const revBase = findVals(basisTbl.pl, ["total revenue", "operating revenue"]);
  const astBase = findVals(st.bs, ["total assets"]);
  // % mode denominators (absolute when off)
  const pctDenIS = pctMode ? revBase : null;
  const pctDenBS = pctMode ? astBase : null;
  const synthesize = (rows: Row[], den: Num[] | null): Row[] => {
    if (!den) return rows;
    return rows.map((r) => ({
      label: r.label,
      values: r.values.map((v, i) => {
        const d = at(den, i);
        if (v === null || !d) return null;
        return Math.round(((v / d) * 100) * 100) / 100;
      }),
    }));
  };
  const moneyOrPct = (v: number) => (pctDenIS || pctDenBS ? `${v.toFixed(1)}%` : mf(v));

  const ratRow = (label: string): Num[] => st.rat?.rows.find((r) => r.label === label)?.values ?? [];
  // FY-end prices from 5y monthly bars (March closes) for valuation multiples
  const fyPrice = (label: string): Num => {
    const m = label.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/);
    if (!m || !hist.length) return null;
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(m[1]);
    const end = Date.parse(`${m[2]}-${String(mon + 1).padStart(2, "0")}-01T00:00:00Z`) + 32 * 864e5;
    let px: Num = null;
    for (const b of hist) {
      const t = Date.parse((b.date ?? "") + "T00:00:00Z");
      if (t <= end && typeof b.close === "number") px = b.close;
    }
    return px;
  };
  const sharesNow = (() => {
    const v = findVals(st.pl, ["basic average shares", "diluted average shares"]);
    if (!v) return null;
    for (let i = v.length - 1; i >= 0; i--) { const x = at(v, i); if (x) return x; }
    return null;
  })();
  const valPeriods = st.pl?.periods ?? [];
  const valRows: Row[] = (() => {
    const ebitda = findVals(st.pl, ["ebitda"]);
    const ebit = findVals(st.pl, ["ebit"]);
    const fcf = findVals(st.cf, ["free cash flow"]);
    const dps = findVals(st.pl, ["dividend per share"]);
    const eps = findVals(st.pl, ["diluted eps", "basic eps"]);
    const bvps = ratRow("Book Value Per Share Rs");
    const out: Row[] = [];
    const px = valPeriods.map(fyPrice);
    const mc = px.map((p) => (p !== null && sharesNow ? (p * sharesNow) / 1e7 : null)); // ₹ Cr
    const debt = findVals(st.bs, ["total debt"]);
    const cash = findVals(st.bs, ["cash and cash equivalents", "cash equivalents", "cash"]);
    const ev = mc.map((m, i) => (m !== null && at(debt, i) !== null ? m + (at(debt, i) as number) - (at(cash, i) ?? 0) : null));
    const revA = findVals(st.pl, ["total revenue", "operating revenue"]);
    const push = (label: string, vals: Num[]) => { if (vals.some((v) => v !== null)) out.push({ label, values: vals }); };
    push("FY-end Price ₹", px);
    push("Market Cap ₹ Cr", mc);
    push("Enterprise Value ₹ Cr", ev);
    push("P/E x", px.map((p, i) => (p !== null && at(eps, i) ? p / (at(eps, i) as number) : null)));
    push("P/B x", px.map((p, i) => (p !== null && at(bvps, i) ? p / (at(bvps, i) as number) : null)));
    push("EV/EBITDA x", ev.map((e, i) => (e !== null && at(ebitda, i) ? e / (at(ebitda, i) as number) : null)));
    push("EV/Sales x", ev.map((e, i) => (e !== null && at(revA, i) ? e / (at(revA, i) as number) : null)));
    push("EV/EBIT x", ev.map((e, i) => (e !== null && at(ebit, i) ? e / (at(ebit, i) as number) : null)));
    push("FCF Yield %", (fcf ?? []).map((f, i) => (f !== null && mc[i] ? (f / (mc[i] as number)) * 100 : null)));
    push("Dividend Yield %", (dps ?? []).map((d, i) => (d !== null && px[i] ? (d / (px[i] as number)) * 100 : null)));
    void cash;
    return out;
  })();

  const loadPeers = async () => {
    const key = sectorOf(symbol);
    const mates = (key ? SECTORS[key].tickers : []).filter((t) => t !== symbol.toUpperCase()).slice(0, 4);
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

  // Index-relative rebased series
  const rebase = (bars: any[]): Num[] => {
    const cl = bars.map((b) => (typeof b.close === "number" ? b.close : null));
    const first = cl.find((v) => v !== null) as number | undefined;
    if (!first) return [];
    return cl.map((v) => (v === null ? null : (v / first) * 100));
  };

  const handleLabelClick = async (label: string, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setExplLabel(label);
    setExplText("");
    setExplLoading(true);
    setExplPos({ x: rect.left, y: rect.bottom + 8 });
    try {
      const txt = await chatComplete([
        { role: "system", content: "You are a finance tutor explaining Indian equity financial statements. Be concise (2-4 sentences max). Explain what the line item means, why it matters, and any India-specific context. Use uppercase." },
        { role: "user", content: `Explain this financial line item: "${label}"` },
      ], { model: store.getExplainerModel() });
      setExplText(txt);
    } catch {
      setExplText("COULD NOT LOAD EXPLANATION.");
    } finally {
      setExplLoading(false);
    }
  };

  return (
    <div className="grid">
      <div className="panel panel-glow stmt-toolbar">
        <div className="toolbar">
          {(["annual", "quarterly", "ttm"] as const).map((b) => (
            <button key={b} className={`pill${basis === b ? " active" : ""}`} onClick={() => setBasis(b)}>{b.toUpperCase()}</button>
          ))}
          <button className={`pill${!pctMode ? " active" : ""}`} onClick={() => setPctMode(false)}>ABSOLUTE</button>
          <button className={`pill${pctMode ? " active" : ""}`} onClick={() => setPctMode(true)}>% OF SALES/ASSETS</button>
          <button className={`pill${ccy === "INR" ? " active" : ""}`} onClick={() => setCcy("INR")}>₹ CR</button>
          <button className={`pill${ccy === "USD" ? " active" : ""}`} onClick={() => setCcy("USD")}>USD</button>
          <button className={`pill${heat ? " active" : ""}`} onClick={() => setHeat(!heat)}>HEATMAP</button>
          <span style={{ borderLeft: "1px solid var(--grid)", margin: "0 4px" }} />
          {(["all", "is", "bs", "cf"] as const).map((f) => (
            <button key={f} className={`pill${stmtFilter === f ? " active" : ""}`} onClick={() => setStmtFilter(f)}>
              {f === "all" ? "ALL" : f === "is" ? "INCOME STMT" : f === "bs" ? "BALANCE SHEET" : "CASH FLOW"}
            </button>
          ))}
          <button className="ghost" onClick={exportCSV}>EXPORT CSV</button>
        </div>
        <div className="pills" style={{ marginTop: 8 }}>
          {NAV.map(([id, l]) => (
            <button key={id} className="pill" style={{ fontSize: 10.5, padding: "4px 8px" }}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{l}</button>
          ))}
        </div>
      </div>

      <div id="t-ledger">
        {(stmtFilter === "all" || stmtFilter === "is") && basisTbl.pl && (
          <div>
            <Sec id="t-is" no="§1a" title={`Revenue & COGS — ${unit}${pctMode ? " · % OF REVENUE" : ""}`} src="yahoo timeseries">
              <LTable periods={basisTbl.pl.periods} rows={synthesize(matchRows(basisTbl.pl, /operating revenue|total revenue|excise|cost of revenue|reconciled cost|gross profit/i).slice(0, 15), pctDenIS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} />
            </Sec>
            <div style={{ marginTop: 10 }}>
              <Sec id="t-is-opex" no="§1b" title={`Operating expenses — ${unit}${pctMode ? " · % OF REVENUE" : ""}`} src="yahoo timeseries">
                <LTable periods={basisTbl.pl.periods} rows={synthesize(matchRows(basisTbl.pl, /operating expense|selling general|selling and market|general and admin|other g&a|research and development|other operating|salaries|professional|insurance|rent|occupancy|provision for doubtful|depreciation(?!.*balance)|amortization(?!.*balance)|depletion(?!.*balance)|reconciled depreciation/i).slice(0, 25), pctDenIS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} />
              </Sec>
            </div>
            <div style={{ marginTop: 10 }}>
              <Sec id="t-is-nonop" no="§1c" title="Non-operating & special items" src="yahoo timeseries">
                <LTable periods={basisTbl.pl.periods} rows={matchRows(basisTbl.pl, /operating income|ebit(?!da)|net interest|interest expense|interest income|other income|other non operating|special income|gain on sale|write off|impairment|restructuring|securities amortization|earnings from equity|net non operating|total other finance|other taxes/i).slice(0, 25)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
              </Sec>
            </div>
            <div style={{ marginTop: 10 }}>
              <Sec id="t-is-bottom" no="§1d" title="Tax, net income & EPS" src="yahoo timeseries">
                <LTable periods={basisTbl.pl.periods} rows={matchRows(basisTbl.pl, /pretax|tax provision|net income(?! from)|minority|preferred stock div|basic eps|diluted eps|basic average|diluted average|dividend per share|normalized/i).slice(0, 20)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
              </Sec>
            </div>
          </div>
        )}
        {(stmtFilter === "all" || stmtFilter === "is") && !basisTbl.pl && (
          <Sec id="t-is" no="§1" title={`Income statement — ${unit}`} src="yahoo timeseries">
            <p className="muted">NO SERIES FOR THIS BASIS.</p>
          </Sec>
        )}
        {(stmtFilter === "all" || stmtFilter === "bs") && (
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <Sec id="t-bs-a" no="§2" title={`BS assets — ${unit}${pctMode ? " · % OF ASSETS" : ""}`} src="yahoo timeseries">
              {st.bs ? <LTable periods={st.pl?.periods ?? []} rows={synthesize(matchRows(st.bs, /assets|inventory|receiv|cash|ppe|goodwill|intangible|invest|prepaid|deferred/i).slice(0, 40), pctDenBS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} /> : <p className="muted">NO SERIES.</p>}
            </Sec>
            <Sec id="t-bs-l" no="§3" title={`BS liabilities & equity — ${unit}`} src="yahoo timeseries">
              {st.bs ? <LTable periods={st.pl?.periods ?? []} rows={matchRows(st.bs, /liabilit|debt|equity|payable|provision|deferred|capital|shares|retained|minority|treasury/i).slice(0, 40)} moneyFmt={mf} heat={heat} onLabelClick={handleLabelClick} /> : <p className="muted">NO SERIES.</p>}
            </Sec>
          </div>
        )}
        {(stmtFilter === "all" || stmtFilter === "cf") && basisTbl.cf && (
          <div style={{ marginTop: 10 }}>
            <Sec id="t-cf" no="§4a" title={`Cash flow from operations — ${unit}${pctMode ? " · % OF REVENUE" : ""}`} src="yahoo timeseries">
              <LTable periods={basisTbl.cf.periods} rows={synthesize(matchRows(basisTbl.cf, /operating cash flow|cash flow from continuing operating|depreciation|amortization|depletion|deferred tax|deferred income tax|stock based comp|excess tax benefit|other non cash|provision|impairment|asset impairment|operating gains|pension|equity invest|gain loss on (invest|securit)|unrealized gain|foreign currency|gain loss on sale of ppe|gain loss on sale of business|net income from continuing|taxes refund paid|interest received cfo|interest paid cfo|dividend received cfo|dividend paid cfo|change in working|change in other|change in payable|change in accrued|change in interest|change in dividend|change in income tax|change in prepaid|change in inventory|change in receivable|changes in account|cash flowsfromusedin operating|taxesrefundpaiddirect|interestreceiveddirect|interestpaiddirect|dividendsreceiveddirect|dividendspaiddirect|classesof cash|othercashpaymentsfrom|paymentsonbehalfof|paymentstosuppliers|classesofcashreceipts|othercashreceiptsfrom|receiptsfrom/i).slice(0, 40), pctDenIS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} />
            </Sec>
            <Sec id="t-cf-i" no="§4b" title={`Cash flow from investing — ${unit}`} src="yahoo timeseries" >
              <LTable periods={basisTbl.cf.periods} rows={synthesize(matchRows(basisTbl.cf, /investing cash flow|cash flow from continuing investing|net other investing|interest received cfi|dividends received cfi|capital expenditure|net ppe purchase|purchase of ppe|sale of ppe|net investment purchase|purchase of investment|sale of investment|net investment properties|purchase of investment properties|sale of investment properties|net business purchase|purchase of business|sale of business|net intangibles purchase|purchase of intangibles|sale of intangibles/i).slice(0, 30), pctDenIS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} />
            </Sec>
            <Sec id="t-cf-f" no="§4c" title={`Cash flow from financing — ${unit}`} src="yahoo timeseries" >
              <LTable periods={basisTbl.cf.periods} rows={synthesize(matchRows(basisTbl.cf, /financing cash flow|cash flow from continuing financing|net other financing|interest paid cff|proceeds from stock option|repurchase of capital stock|issuance of capital stock|net common stock|common stock issuance|common stock payments|net preferred stock|preferred stock issuance|preferred stock payments|cash dividends paid|common stock dividend|preferred stock dividend|repayment of debt|issuance of debt|net issuance payments of debt|net short term debt|short term debt issuance|short term debt payments|net long term debt|long term debt issuance|long term debt payments/i).slice(0, 30), pctDenIS)} moneyFmt={moneyOrPct} heat={heat} onLabelClick={handleLabelClick} />
            </Sec>
            <Sec id="t-cf-s" no="§4d" title="Supplemental & reconciliation" src="yahoo timeseries" >
              <LTable periods={basisTbl.cf.periods} rows={matchRows(basisTbl.cf, /free cash flow|end cash position|beginning cash position|changes in cash|effect of exchange|other cash adjustment|cash flow from discontinued|interest paid supplemental|income tax paid supplemental|foreign sales|domestic sales|adjusted geography/i).slice(0, 15)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
            </Sec>
            {basisTbl.bsNote && <p className="faint" style={{ fontSize: 11 }}>{basisTbl.bsNote}</p>}
          </div>
        )}
        {(stmtFilter === "all" || stmtFilter === "cf") && !basisTbl.cf && (
          <div style={{ marginTop: 10 }}>
            <Sec id="t-cf" no="§4" title={`Cash flow — ${unit}`} src="yahoo timeseries">
              <p className="muted">NO SERIES FOR THIS BASIS.</p>
            </Sec>
          </div>
        )}
      </div>

      <div id="t-growth">
        <Sec id="t-g" no="§5" title="Growth — YoY + CAGR" src="computed from ledger">
          {st.rat ? (
            <LTable
              periods={st.rat.periods}
              rows={[...st.rat.rows.filter((r) => /growth/i.test(r.label)),
                { label: "Revenue 4Y CAGR %", values: st.rat.periods.map(() => cagrPct(findVals(st.pl, ["total revenue", "operating revenue"]) ?? [])) },
                { label: "Net Income 4Y CAGR %", values: st.rat.periods.map(() => cagrPct(findVals(st.pl, ["net income"]) ?? [])) },
                { label: "EPS 4Y CAGR %", values: st.rat.periods.map(() => cagrPct(findVals(st.pl, ["diluted eps", "basic eps"]) ?? [])) },
                { label: "Book Value 4Y CAGR %", values: st.rat.periods.map(() => { const v = ratRow("Book Value Per Share Rs"); return cagrPct(v); }) },
              ]}
              moneyFmt={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
              heat={heat}
              onLabelClick={handleLabelClick}
            />
          ) : <p className="muted">NO RATIO SERIES.</p>}
        </Sec>
      </div>

      <div id="t-profit">
        <Sec id="t-marg" no="§6" title="Profitability & margins — hover any ratio for its formula" src="computed from ledger">
          {st.rat ? <RatiosTables rat={{ periods: st.rat.periods, rows: st.rat.rows.filter((r) => /margin|roe|roa|roce|roic|tangible|payout|retention|tax burden|interest burden|effective tax/i.test(r.label)) }} /> : <p className="muted">NO RATIOS.</p>}
        </Sec>
      </div>

      <div className="grid grid-2" id="t-lev">
        <Sec id="t-levs" no="§7" title="Leverage & solvency" src="computed from ledger">
          {st.rat ? <RatiosTables rat={{ periods: st.rat.periods, rows: st.rat.rows.filter((r) => /debt|equity ratio|interest coverage|assets to equity/i.test(r.label)) }} /> : <p className="muted">NO RATIOS.</p>}
          <p className="faint" style={{ fontSize: 11 }}>DSCR NEEDS REPAYMENT SCHEDULE — NOT ON YAHOO FEED.</p>
        </Sec>
        <Sec id="t-liqs" no="§8" title="Liquidity" src="computed from ledger">
          {st.rat ? <RatiosTables rat={{ periods: st.rat.periods, rows: st.rat.rows.filter((r) => /current ratio|quick ratio|cash ratio|working capital|net cash/i.test(r.label)) }} /> : <p className="muted">NO RATIOS.</p>}
        </Sec>
      </div>

      <div id="t-turn">
        <Sec id="t-turns" no="§9" title="Efficiency / turnover" src="computed from ledger">
          {st.rat ? <RatiosTables rat={{ periods: st.rat.periods, rows: st.rat.rows.filter((r) => /turnover|days|conversion/i.test(r.label)) }} /> : <p className="muted">NO RATIOS.</p>}
        </Sec>
      </div>

      <div id="t-ps">
        <Sec id="t-pss" no="§10" title="Per-share & shareholder" src="yahoo ledger + screener holdings">
          {st.rat ? <RatiosTables rat={{ periods: st.rat.periods, rows: st.rat.rows.filter((r) => /eps|dividend per share|book value|fcf per share|payout/i.test(r.label)) }} /> : <p className="muted">NO RATIOS.</p>}
          <p className="faint" style={{ fontSize: 11 }}>CASH EPS ≈ (NET + D&A) / SHARES · DIVIDEND YIELD IN §11 · SPLIT/BONUS TIMELINE IN §25.</p>
        </Sec>
      </div>

      <div id="t-val">
        <Sec id="t-vals" no="§11" title="Valuation multiples — FY-end prices × current shares" src="yahoo prices + ledger">
          {valRows.length ? (
            <>
              <LTable periods={valPeriods} rows={valRows} moneyFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 })} heat={heat} onLabelClick={handleLabelClick} />
              <div className="grid grid-2" style={{ marginTop: 10 }}>
                <div><p className="p-head">P/E · P/B · EV/EBITDA</p>
                  <LineChart dates={valPeriods} yFmt={(v) => `${v.toFixed(1)}x`} series={[
                    { label: "P/E", color: "#ffa028", values: valRows.find((r) => r.label === "P/E x")?.values ?? [] },
                    { label: "P/B", color: "#00d664", values: valRows.find((r) => r.label === "P/B x")?.values ?? [] },
                    { label: "EV/EBITDA", color: "#00c8ff", values: valRows.find((r) => r.label === "EV/EBITDA x")?.values ?? [] },
                  ]} />
                </div>
                <div><p className="p-head">Market cap vs EV — ₹ Cr</p>
                  <LineChart dates={valPeriods} yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })} series={[
                    { label: "MCAP", color: "#ffa028", values: valRows.find((r) => r.label === "Market Cap ₹ Cr")?.values ?? [] },
                    { label: "EV", color: "#8f7bff", values: valRows.find((r) => r.label === "Enterprise Value ₹ Cr")?.values ?? [] },
                  ]} />
                </div>
              </div>
              <p className="faint" style={{ fontSize: 11 }}>SHARES ASSUMED CONSTANT AT LATEST COUNT — SEE §13 FOR SPLIT HISTORY.</p>
            </>
          ) : <p className="muted">NEEDS 5Y PRICE HISTORY — RETRY.</p>}
        </Sec>
      </div>

      <div id="t-peer">
        <Sec id="t-peers" no="§16" title="Peer / index comparison" src="yahoo company legs (lazy)">
          {!peers && (
            <div className="toolbar">
              <button className="btn" onClick={loadPeers} disabled={peersLoading}>{peersLoading ? "LOADING PEERS…" : "LOAD SECTOR PEERS"}</button>
              <span className="faint" style={{ fontSize: 11 }}>4 SAME-SECTOR NAMES · ~10-20S FIRST LOAD (CACHED 10M)</span>
            </div>
          )}
          {peers && peers.length > 0 && (
            <div className="scrollx">
              <table className="plain">
                <thead><tr><th style={{ textAlign: "left" }}>PEER</th><th style={{ textAlign: "right" }}>MCAP CR</th><th style={{ textAlign: "right" }}>PE</th><th style={{ textAlign: "right" }}>NPM %</th><th style={{ textAlign: "right" }}>ROE %</th><th style={{ textAlign: "right" }}>D/E</th><th style={{ textAlign: "right" }}>DIV Y %</th></tr></thead>
                <tbody>
                  {peers.map((p: any) => (
                    <tr key={p.symbol}>
                      <td><strong>{p.symbol}</strong></td>
                      <td style={{ textAlign: "right" }}>{p.derived?.mktCap ? Math.round(p.derived.mktCap / 1e7).toLocaleString("en-IN") : "—"}</td>
                      <td style={{ textAlign: "right" }}>{p.derived?.trailPE ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>{p.profile?.margins?.net !== null && p.profile?.margins?.net !== undefined ? (p.profile.margins.net * 100).toFixed(1) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{p.profile?.margins?.roe !== null && p.profile?.margins?.roe !== undefined ? (p.profile.margins.roe * 100).toFixed(1) : "—"}</td>
                      <td style={{ textAlign: "right" }}>{(() => { const d = p.profile?.financials?.debt, m = p.profile?.valuation?.mktCap; return d && m ? (d / m).toFixed(2) : "—"; })()}</td>
                      <td style={{ textAlign: "right" }}>{p.derived?.yieldPct ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {peers && peers.length === 0 && <p className="muted">NO SECTOR MAPPING FOR THIS SYMBOL.</p>}
          {hist.length > 0 && bench.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="p-head">Rebased 5Y — you vs Nifty 50 (=100)</p>
              <LineChart
                dates={hist.map((b: any) => b.date)}
                yFmt={(v) => v.toFixed(0)}
                series={[
                  { label: symbol, color: "#ffa028", values: rebase(hist).filter((_, i) => i % 3 === 0) },
                  { label: "NIFTY", color: "#00c8ff", values: rebase(bench).filter((_, i) => i % 3 === 0) },
                ]}
              />
            </div>
          )}
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["Segment revenue/EBITDA/margins", "Segment capital employed & ROCE", "Inter-segment eliminations"]} need="NEEDS SEGMENT FEED (§12)" />
        </div>
      </div>

      <div id="t-qual">
        <Sec id="t-quals" no="§14" title="Quality & red flags" src="computed + ledger finder">
          <div className="grid grid-2">
            <div><p className="p-head">Accruals % (NI−OCF)/TA + OCF/NI</p>
              <LineChart
                dates={st.rat?.periods ?? []}
                yFmt={(v) => v.toFixed(1)}
                series={[
                  { label: "OCF/NI x", color: "#00d664", values: (st.pl?.periods ?? []).map((_, i) => {
                    const n = at(findVals(st.pl, ["net income"]), i), o = at(findVals(st.cf, ["cash flow from continuing operating activities", "operating cash flow"]), i);
                    return n && o !== null ? o / n : null;
                  }) },
                ]}
              />
            </div>
            <div><p className="p-head">WC vs revenue growth %</p>
              <GroupedBars
                periods={st.rat?.periods ?? []}
                fmt={(v) => `${v.toFixed(1)}%`}
                series={[
                  { label: "REV G", color: "#00d664", values: st.rat?.rows.find((r) => r.label === "Revenue Growth %")?.values ?? [] },
                  { label: "WC ₹ G", color: "#ff453a", values: (st.pl?.periods ?? []).map((_, i) => {
                    const w = st.bs ? at(findVals(st.bs, ["working capital"]), i) : null;
                    const p = st.bs ? at(findVals(st.bs, ["working capital"]), i - 1) : null;
                    return w !== null && p ? ((w - p) / Math.abs(p)) * 100 : null;
                  }) },
                ]}
              />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <p className="p-head">Contingency / provision rows on the ledger</p>
            <LTable periods={st.pl?.periods ?? []} rows={[...matchRows(st.bs, /contingen|guarantee/i), ...matchRows(st.pl, /provision|write.?off|impair/i), ...matchRows(st.cf, /provision|write.?off|impair/i)].slice(0, 20)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
          </div>
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["Auditor remarks / qualifications", "Related-party transaction flags", "Forensic deep-dive"]} need="NEEDS FILINGS FEED (SEE FOR)" />
        </div>
      </div>

      <div id="t-tax">
        <Sec id="t-taxs" no="§18" title="Tax detail" src="ledger finder + note">
          <p className="faint" style={{ fontSize: 11 }}>INDIA STATUTORY RATE ≈ 25.168% (22% + SURCHARGE + CESS) — COMPARE AGAINST EFFECTIVE BELOW.</p>
          <div style={{ marginTop: 8 }}>
            <p className="p-head">Effective tax rate % + deferred balances ₹ Cr</p>
            <LineChart
              dates={st.rat?.periods ?? []}
              yFmt={(v) => `${v.toFixed(1)}%`}
              series={[{ label: "EFF TAX", color: "#ffa028", values: st.rat?.rows.find((r) => r.label === "Effective Tax Rate %")?.values ?? [] }]}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <LTable periods={st.pl?.periods ?? []} rows={[...matchRows(st.bs, /deferred tax|tax payable|taxes receivable|mat credit/i), ...matchRows(st.pl, [/tax provision/]), ...matchRows(st.cf, [/deferred tax|income tax paid/i])].slice(0, 20)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
          </div>
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["MAT credit ledger", "Tax litigation register", "Rate-change impact notes"]} need="NEEDS FILINGS FEED" />
        </div>
      </div>

      <div id="t-wc">
        <Sec id="t-wcs" no="§19" title="Working-capital deep dive" src="computed + ledger finder">
          <div className="grid grid-2">
            <div><p className="p-head">WC as % of revenue</p>
              <LineChart
                dates={st.pl?.periods ?? []}
                yFmt={(v) => `${v.toFixed(1)}%`}
                series={[{ label: "WC/REV", color: "#00c8ff", values: (st.pl?.periods ?? []).map((_, i) => {
                  const w = st.bs ? at(findVals(st.bs, ["working capital"]), i) : null;
                  const r = at(findVals(st.pl, ["total revenue", "operating revenue"]), i);
                  return w !== null && r ? (w / r) * 100 : null;
                }) }]}
              />
            </div>
            <div><p className="p-head">DSO / DIO / DPO / CCC days</p>
              <LineChart
                dates={st.rat?.periods ?? []}
                yFmt={(v) => `${v.toFixed(0)}d`}
                series={[
                  { label: "DSO", color: "#ffa028", values: st.rat?.rows.find((r) => r.label === "Days Sales Outstanding days")?.values ?? [] },
                  { label: "DIO", color: "#00c8ff", values: st.rat?.rows.find((r) => r.label === "Days Inventory Outstanding days")?.values ?? [] },
                  { label: "CCC", color: "#ff453a", values: st.rat?.rows.find((r) => r.label === "Cash Conversion Cycle days")?.values ?? [] },
                ]}
              />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <LTable periods={st.pl?.periods ?? []} rows={[...matchRows(st.bs, /raw materials|work in process|finished goods|inventor|receiv|allowance|payable|prepaid|deferred.*(asset|revenue)/i)].slice(0, 30)} moneyFmt={mf} heat={heat} onLabelClick={handleLabelClick} />
            <p className="faint" style={{ fontSize: 11 }}>RECEIVABLES AGEING BUCKETS NOT DISCLOSED ON YAHOO — ALLOWANCE ROWS ABOVE ARE THE PROXY.</p>
          </div>
        </Sec>
      </div>

      <div id="t-alloc">
        <Sec id="t-allocs" no="§20" title="Capital allocation history" src="ledger finder + events">
          <LTable periods={st.pl?.periods ?? []} rows={[
            ...matchRows(st.cf, /capital expenditure|depreciation|amortization|purchase of ppe|sale of ppe/i),
            ...matchRows(st.cf, /repurchase|buyback|issuance|repayment|dividend/i),
            ...matchRows(st.pl, [/depreciation/, /dividend per share/]),
          ].slice(0, 30)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
          <p className="faint" style={{ fontSize: 11 }}>RIGHTS/QIP SHOW UP AS COMMON-STOCK ISSUANCE ABOVE · REFINANCING VIA ISSUANCE−REPAYMENT PAIRS.</p>
        </Sec>
      </div>

      <div id="t-est">
        <Sec id="t-ests" no="§21" title="Guidance & estimates overlay" src="yahoo earningsTrend">
          {!est ? <p className="muted">PULLING ESTIMATES…</p> : (
            <>
              <div className="scrollx">
                <table className="plain">
                  <thead><tr><th style={{ textAlign: "left" }}>PERIOD</th><th style={{ textAlign: "right" }}>EPS EST</th><th style={{ textAlign: "right" }}>REV EST</th><th style={{ textAlign: "right" }}>GROWTH %</th><th style={{ textAlign: "right" }}>REV 7D/30D</th></tr></thead>
                  <tbody>
                    {(est.earningsTrend ?? []).map((t: any, i: number) => (
                      <tr key={i}>
                        <td><strong>{t.period}</strong><div className="faint" style={{ fontSize: 10.5 }}>{t.endDate ?? ""}</div></td>
                        <td style={{ textAlign: "right" }}>{t.epsTrend?.current ?? "—"}{t.epsTrend?.low !== null && t.epsTrend?.low !== undefined ? <span className="faint"> [{t.epsTrend.low}–{t.epsTrend.high}]</span> : ""}</td>
                        <td style={{ textAlign: "right" }}>{t.revenueEstimate?.avg?.toLocaleString?.("en-IN") ?? t.revenueEstimate?.avg ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>{t.growth !== null && t.growth !== undefined ? `${(t.growth * 100).toFixed(1)}%` : "—"}</td>
                        <td style={{ textAlign: "right" }}><span className="pos">+{t.epsRevisions?.up30d ?? 0}</span> / <span className="neg">−{t.epsRevisions?.down30d ?? 0}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(est.surprise ?? []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <p className="p-head">Actual vs estimate — surprise column</p>
                  <div className="scrollx">
                    <table className="plain">
                      <thead><tr><th style={{ textAlign: "left" }}>QTR</th><th style={{ textAlign: "right" }}>ACTUAL</th><th style={{ textAlign: "right" }}>EST</th><th style={{ textAlign: "right" }}>SURPRISE</th></tr></thead>
                      <tbody>
                        {est.surprise.map((s: any, i: number) => {
                          const sp = s.epsActual !== null && s.epsEstimate ? ((s.epsActual - s.epsEstimate) / Math.abs(s.epsEstimate)) * 100 : null;
                          return (
                            <tr key={i}>
                              <td><strong>{s.quarter}</strong></td>
                              <td style={{ textAlign: "right" }}>{s.epsActual ?? "—"}</td>
                              <td style={{ textAlign: "right" }}>{s.epsEstimate ?? "—"}</td>
                              <td style={{ textAlign: "right" }}>{sp === null ? "—" : <span className={sp >= 0 ? "pos" : "neg"}>{sp >= 0 ? "BEAT +" : "MISS "}{sp.toFixed(1)}%</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {est.recommendation && (
                <div style={{ marginTop: 10 }}>
                  <p className="p-head">Street recommendation</p>
                  <HBars rows={[
                    { label: "STRONG BUY", value: est.recommendation.strongBuy ?? 0, display: String(est.recommendation.strongBuy ?? "—"), color: "#00d664" },
                    { label: "BUY", value: est.recommendation.buy ?? 0, display: String(est.recommendation.buy ?? "—"), color: "#00c8ff" },
                    { label: "HOLD", value: est.recommendation.hold ?? 0, display: String(est.recommendation.hold ?? "—"), color: "#ffa028" },
                    { label: "SELL", value: est.recommendation.sell ?? 0, display: String(est.recommendation.sell ?? "—"), color: "#ff453a" },
                    { label: "STRONG SELL", value: est.recommendation.strongSell ?? 0, display: String(est.recommendation.strongSell ?? "—"), color: "#8f7bff" },
                  ]} />
                  {est.nextEarnings && <p className="faint" style={{ fontSize: 11 }}>NEXT EARNINGS ≈ {est.nextEarnings}</p>}
                </div>
              )}
            </>
          )}
          <p className="faint" style={{ fontSize: 11 }}>MGMT GUIDANCE TEXT NEEDS CONCALL FEED — ESTIMATE REVISIONS ABOVE ARE THE PROXY.</p>
        </Sec>
      </div>

      <div id="t-notes">
        <Sec id="t-notess" no="§17" title="Notes-to-accounts finder" src="ledger row search">
          <LTable periods={st.pl?.periods ?? []} rows={[
            ...matchRows(st.pl, /other income|other.?operating|other.?non.?operating|special|unusual|discontinued|extraordinary|effect of accounting|other items|gain on sale|restructuring|write.?off|impairment|securities amortization/i),
            ...matchRows(st.pl, [/research and development/, /rent expense/]),
            ...matchRows(st.cf, [/stock based compensation/, /excess tax benefit/]),
            ...matchRows(st.bs, [/capital lease|leases|treasury stock|foreign currency translation|unrealized gain/i]),
          ].slice(0, 40)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["Prior-period restatement flags", "Related-party transaction detail", "Actuarial gains/losses schedule", "ESOP vesting schedules"]} need="NEEDS FILINGS FEED" />
        </div>
      </div>

      <div id="t-act">
        <Sec id="t-acts" no="§13/§25" title="Capital structure, holdings & actions timeline" src="screener holdings + yahoo events">
          <div className="grid grid-2">
            <div>
              <p className="p-head">Holdings % — screener quarters</p>
              {st.sh ? (
                <LineChart
                  dates={st.sh.periods}
                  yFmt={(v) => `${v.toFixed(1)}%`}
                  series={[
                    { label: "PROM", color: "#ffa028", values: findVals(st.sh, ["promoters"]) ?? [] },
                    { label: "FII", color: "#00d664", values: findVals(st.sh, ["fiis", "fii"]) ?? [] },
                    { label: "DII", color: "#8f7bff", values: findVals(st.sh, ["diis", "dii"]) ?? [] },
                    { label: "PUB", color: "#5b5b62", values: findVals(st.sh, ["public"]) ?? [] },
                  ]}
                />
              ) : <p className="muted">NO HOLDING SERIES.</p>}
              <p className="faint" style={{ fontSize: 11 }}>PLEDGED-SHARE % NOT ON EITHER FEED.</p>
            </div>
            <div>
              <p className="p-head">Shares outstanding — Yahoo count</p>
              <LineChart
                dates={st.pl?.periods ?? []}
                yFmt={(v) => `${(v / 1e9).toFixed(2)}B`}
                series={[{ label: "SH", color: "#00c8ff", values: findVals(st.pl, ["basic average shares", "diluted average shares", "share issued"]) ?? [] }]}
              />
              <p className="faint" style={{ fontSize: 11 }}>DIPS = SPLITS/BONUS — SEE TIMELINE BELOW.</p>
            </div>
          </div>
          {evts && (
            <div style={{ marginTop: 10 }}>
              <p className="p-head">Corporate actions timeline — splits + payouts (5Y)</p>
              <div className="scrollx">
                <table className="plain">
                  <thead><tr><th style={{ textAlign: "left" }}>DATE</th><th style={{ textAlign: "left" }}>EVENT</th><th style={{ textAlign: "right" }}>DETAIL</th></tr></thead>
                  <tbody>
                    {[...(evts.splits ?? []).map((s: any) => ({ d: s.date, e: "SPLIT/BONUS", x: s.ratio })),
                      ...(evts.dividends ?? []).slice(0, 12).map((d: any) => ({ d: d.date, e: "DIVIDEND", x: `₹${d.amount}` })),
                    ].sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 16).map((r: any, i: number) => (
                      <tr key={i}><td><strong>{r.d}</strong></td><td>{r.e}</td><td style={{ textAlign: "right" }}>{r.x}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="faint" style={{ fontSize: 11 }}>DEMERGERS / MA DATES NEED NEWS FEED · TTM YIELD {evts.ttmYieldPct ?? "—"}%.</p>
            </div>
          )}
        </Sec>
      </div>

      <div id="t-ctx">
        <Sec id="t-ctxs" no="§15" title="Company context" src="yahoo profile">
          <div className="grid grid-2">
            <div>
              <p className="p-head">Key management</p>
              {(coQ?.profile?.officers ?? []).length ? (
                <table className="plain"><tbody>
                  {coQ.profile.officers.map((o: any, i: number) => (
                    <tr key={i}><td><strong>{o.name}</strong></td><td style={{ textAlign: "right" }} className="muted">{o.title}</td></tr>
                  ))}
                </tbody></table>
              ) : <p className="muted">NO OFFICER DATA.</p>}
            </div>
            <div>
              <p className="p-head">Scale</p>
              <div className="kv"><span className="muted">Employees</span><strong>{(coQ?.profile?.employees ?? null)?.toLocaleString?.("en-IN") ?? "—"}</strong></div>
              <div className="kv"><span className="muted">Revenue / employee</span><strong>{(() => {
                const e = coQ?.profile?.employees, r = findVals(st.pl, ["total revenue", "operating revenue"]);
                const lr = r ? at(r, r.length - 1) : null;
                return e && lr ? `₹${Math.round(((lr as number) * 1e7) / e).toLocaleString("en-IN")}` : "—";
              })()}</strong></div>
              <div className="kv"><span className="muted">Sector / industry</span><strong>{coQ?.profile?.sector ?? "—"} / {coQ?.profile?.industry ?? "—"}</strong></div>
            </div>
          </div>
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["CSR spend history", "Credit rating history", "Forex exposure split", "KMP remuneration", "M&A/divestiture notes"]} need="NEEDS FILINGS FEED" />
        </div>
      </div>

      <div id="t-cash">
        <Sec id="t-cashs" no="§23" title="Cash & investment composition" src="ledger finder">
          <LTable periods={st.pl?.periods ?? []} rows={[...matchRows(st.bs, /cash|short.?term investment|trading securit|restricted|financial asset|held.?to.?maturity|available.?for.?sale/i)].slice(0, 20)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
          <p className="p-head" style={{ marginTop: 10 }}>Treasury contribution — interest & investment income vs PBT %</p>
          <LineChart
            dates={st.pl?.periods ?? []}
            yFmt={(v) => `${v.toFixed(1)}%`}
            series={[{ label: "TREAS/PBT", color: "#ffa028", values: (st.pl?.periods ?? []).map((_, i) => {
              const ii = at(findVals(st.pl, ["interest income", "interest income non operating", "gain on sale of security"]), i);
              const pbt = at(findVals(st.pl, ["pretax income"]), i);
              return ii !== null && pbt ? (ii / pbt) * 100 : null;
            }) }]}
          />
        </Sec>
      </div>

      <div id="t-off">
        <Sec id="t-offs" no="§24" title="Off-balance-sheet & structural" src="ledger finder">
          <LTable periods={st.pl?.periods ?? []} rows={[...matchRows(st.bs, /lease|capital lease|derivative|pension|employee benefit|provisions/i)].slice(0, 20)} moneyFmt={mf} heat={false} onLabelClick={handleLabelClick} />
        </Sec>
        <div style={{ marginTop: 10 }}>
          <Dead items={["Guarantees / LCs outstanding", "Derivative notional & hedge detail", "Pending litigation exposure", "Carbon intensity & green capex", "ESG-linked covenants"]} need="NEEDS FILINGS/ESG FEED (§24/§26)" />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">§22 · Currency & standards</p>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          REPORTING INR · USD TOGGLE USES LIVE USDINR {rate.toFixed(2)} · STANDARD IND AS (ASSUMED) ·
          YAHOO SERIES ARE CONSOLIDATED FOR NSE BLUE-CHIPS — STANDALONE NEEDS FILINGS FEED.
        </p>
      </div>

      {explLabel && (
        <div ref={explRef} style={{
          position: "fixed", left: Math.min(explPos.x, window.innerWidth - 420), top: Math.min(explPos.y, window.innerHeight - 200),
          maxWidth: 400, zIndex: 9999, background: "#121214", border: "1px solid var(--amber)", borderRadius: 3,
          padding: "12px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ color: "var(--amber)", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em" }}>{explLabel.toUpperCase()}</span>
            <button onClick={() => setExplLabel(null)} style={{ background: "none", border: "none", color: "var(--sub)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
          {explLoading
            ? <p className="muted" style={{ margin: 0, fontSize: 12 }}>LOADING…</p>
            : <p style={{ margin: 0, fontSize: 12, color: "var(--text)", lineHeight: 1.5 }}>{explText}</p>
          }
        </div>
      )}
    </div>
  );
}
