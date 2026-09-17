"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODULE_MAP } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import { calcMonteCarloDCF, calcPiotroski, calcAltmanZ, calcBeneish, calcReverseDCF } from "@/lib/fundamentals";
import { LineChart, Donut, HBars, Histogram, GroupedBars, AreaChart, BarChart } from "./charts";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";

/* ---------------- shared ---------------- */

export interface STable { periods: string[]; rows: Array<{ label: string; values: (number | null)[]; raw: string[] }> }
export interface Statements {
  symbol: string; name: string; unit: string;
  pl: STable | null; bs: STable | null; cf: STable | null; sh: STable | null;
  qtr: STable | null; qtrCF: STable | null; rat: STable | null;
  ratios?: Record<string, string>; marketCapCr?: number | null;
}

export function useStatements(symbol: string) {
  const [data, setData] = useState<Statements | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const seq = useState(() => ({ n: 0 }))[0];
  useEffect(() => {
    const my = ++seq.n;
    let alive = true;
    setLoading(true); setErr(""); setData(null);
    fetch(`/api/statements?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "statements failed");
        if (alive && seq.n === my) setData(j);
      })
      .catch((e) => { if (alive && seq.n === my) setErr(e.message); })
      .finally(() => { if (alive && seq.n === my) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  return { data, err, loading };
}

function findRow(t: STable | null, cands: string[]): { label: string; values: (number | null)[] } | null {
  if (!t) return null;
  // Yahoo-only ledger uses "Total Revenue" / "Net Income" style labels;
  // normalize spaces so "total revenue" matches "Total Revenue".
  // Prefer exact match, else shortest match — so "Net Income" wins over
  // "Net Income From Continuing Operation..." and "Operating Income" over
  // "Total Operating Income As Reported".
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lows = t.rows.map((r) => ({ r, l: norm(r.label) }));
  for (const c of cands) {
    const nc = norm(c);
    const exact = lows.find((x) => x.l === nc);
    if (exact) return exact.r;
  }
  for (const c of cands) {
    const nc = norm(c);
    const all = lows.filter((x) => x.l.includes(nc));
    if (all.length) {
      all.sort((a, b) => a.r.label.length - b.r.label.length);
      return all[0].r;
    }
  }
  return null;
}

const last = (v: (number | null)[] | undefined): number | null => {
  if (!v) return null;
  for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null && v[i] !== undefined) return v[i] as number;
  return null;
};
const prev = (v: (number | null)[] | undefined): number | null => {
  if (!v) return null;
  let seen = 0;
  for (let i = v.length - 1; i >= 0; i--) {
    if (v[i] !== null && v[i] !== undefined) { seen++; if (seen === 2) return v[i] as number; }
  }
  return null;
};

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

// Shared company/quote loader: one auto-retry after 3s + manual retry.
// Never leaves a desk stuck on a throttled first attempt.
export function useCompany(symbol: string) {
  const [q, setQ] = useState<any>(null);
  const [qErr, setQErr] = useState("");
  const [qLoading, setQLoading] = useState(true);
  const retried = useRef(false);
  const load = async (sym: string) => {
    setQErr(""); setQLoading(true);
    try {
      const r = await fetch(`/api/company?symbol=${encodeURIComponent(sym)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `company ${r.status}`);
      setQ(j);
    } catch (e: unknown) {
      setQ(null);
      setQErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setQLoading(false);
    }
  };
  useEffect(() => {
    retried.current = false;
    setQ(null);
    load(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  useEffect(() => {
    if (!qErr || retried.current) return;
    retried.current = true;
    const t = setTimeout(() => load(symbol), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qErr, symbol]);
  return { q, qErr, qLoading, retryQuote: () => { retried.current = false; setQ(null); load(symbol); } };
}

// Yahoo-only holders fallback (no promoter/FII/DII split on Yahoo).
function YahooHolders({ symbol, coQ }: { symbol: string; coQ: any }) {
  const h = coQ?.profile?.holders;
  if (!h) return <p className="muted" style={{ marginTop: 10 }}>NO HOLDING SPLIT ON YAHOO FEED.</p>;
  const pct1 = (v: any) => (typeof v === "number" && isFinite(v) ? `${(v * 100).toFixed(2)}%` : "—");
  const num = (v: any) => (typeof v === "number" && isFinite(v) ? v.toLocaleString("en-IN") : "—");
  return (
    <div style={{ marginTop: 10 }}>
      <div className="cells">
        <div className="cell"><div className="lbl">Insider (promoter proxy)</div><div className="val">{pct1(h.insider)}</div><div className="sub">major holders</div></div>
        <div className="cell"><div className="lbl">Institutions</div><div className="val">{pct1(h.instit)}</div><div className="sub">of shares out</div></div>
        <div className="cell"><div className="lbl">Shares out</div><div className="val" style={{ fontSize: 13 }}>{num(h.sharesOut)}</div><div className="sub">float {num(h.float)}</div></div>
        <div className="cell"><div className="lbl">Source</div><div className="val" style={{ fontSize: 13 }}>YAHOO</div><div className="sub">no FII/DII split</div></div>
      </div>
      <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>YAHOO HAS NO PROMOTER / FII / DII / PUBLIC SPLIT FOR {symbol} — SHOWING MAJOR-HOLDER PROXY.</p>
    </div>
  );
}

// RATIOS hover guide — RATIO_INFO promoted to shared GLOSSARY in explain.ts.
const RATIO_CATS: Array<{ head: string; labels: string[] }> = [
  {
    head: "Profitability",
    labels: [
      "Gross Margin %", "Operating Margin %", "EBIT Margin %", "EBITDA Margin %",
      "Pretax Margin %", "Net Margin %", "Effective Tax Rate %", "ROE %", "ROA %",
      "ROCE %", "ROIC %", "Return on Tangible Equity %", "Dividend Payout %", "Retention Ratio %",
    ],
  },
  {
    head: "Liquidity",
    labels: ["Current Ratio x", "Quick Ratio x", "Cash Ratio x", "Working Capital Rs Cr", "Net Cash Rs Cr"],
  },
  {
    head: "Solvency / Leverage",
    labels: [
      "Debt to Equity x", "Debt to Assets x", "Equity Ratio x", "Long Term Debt to Equity x",
      "Interest Coverage x", "Debt to EBITDA x", "Net Debt to EBITDA x", "Assets to Equity x",
    ],
  },
  {
    head: "Efficiency / Activity",
    labels: [
      "Asset Turnover x", "Equity Turnover x", "Fixed Asset Turnover x", "Working Capital Turnover x",
      "Inventory Turnover x", "Receivables Turnover x", "Payables Turnover x",
      "Days Sales Outstanding days", "Days Inventory Outstanding days",
      "Days Payable Outstanding days", "Cash Conversion Cycle days",
    ],
  },
  {
    head: "Cash Flow",
    labels: [
      "OCF Margin %", "FCF Margin %", "OCF to Net Income x", "FCF to Net Income x",
      "Capex to OCF %", "Capex to Revenue %", "Dividend to OCF %",
    ],
  },
  {
    head: "Growth (YoY)",
    labels: [
      "Revenue Growth %", "Gross Profit Growth %", "Operating Income Growth %", "Net Income Growth %",
      "EPS Diluted Growth %", "OCF Growth %", "FCF Growth %", "Total Assets Growth %", "Equity Growth %",
    ],
  },
  {
    head: "Per Share",
    labels: ["Diluted EPS Rs", "Basic EPS Rs", "Dividend Per Share Rs", "Book Value Per Share Rs", "FCF Per Share Rs"],
  },
  { head: "DuPont", labels: ["Tax Burden x", "Interest Burden x"] },
];

export function RatiosTables({ rat }: { rat: STable }) {
  const byLabel = new Map(rat.rows.map((r) => [r.label, r]));
  const seen = new Set<string>();
  const groups = RATIO_CATS.map((c) => ({
    head: c.head,
    rows: c.labels
      .map((l) => byLabel.get(l))
      .filter((r): r is STable["rows"][number] => {
        if (!r) return false;
        seen.add(r.label);
        return true;
      }),
  })).filter((g) => g.rows.length > 0);
  const rest = rat.rows.filter((r) => !seen.has(r.label));
  if (rest.length) groups.push({ head: "Other", rows: rest });
  return (
    <>
      {groups.map((g) => (
        <div className="panel" key={g.head}>
          <p className="p-head">{g.head}</p>
          <div className="scrollx">
            <table className="plain">
              <thead>
                <tr>
                  <th></th>
                  {rat.periods.map((p) => (
                    <th key={p} style={{ textAlign: "right" }}>{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.label}>
                    <td><strong data-explain={r.label}>{r.label}</strong></td>
                    {r.values.map((v, i) => (
                      <td key={i} style={{ textAlign: "right" }}>
                        {v === null || v === undefined ? "—" : v.toLocaleString("en-IN")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

export function CompanyStrip({ symbol }: { symbol: string }) {
  const [q, setQ] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/company?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (alive && !j.error) setQ(j); });
    return () => { alive = false; };
  }, [symbol]);
  if (!q) return null;
  const d = q.derived ?? {};
  return (
    <div className="cells" style={{ marginTop: 12 }}>
      <div className="cell"><div className="lbl">Mkt cap</div><div className="val">{q.quote?.marketCap ? `₹${(q.quote.marketCap / 1e7).toFixed(0)} Cr` : "—"}</div><div className="sub">live</div></div>
      <div className="cell"><div className="lbl">Trail PE</div><div className="val">{q.quote?.trailingPE ?? "—"}</div><div className="sub">fwd {q.quote?.forwardPE ?? "—"}</div></div>
      <div className="cell"><div className="lbl">Yield</div><div className="val">{d.yieldPct ?? "—"}%</div><div className="sub">dividend</div></div>
      <div className="cell"><div className="lbl">Off 52W hi</div><div className="val neg">{d.offHighPct ?? "—"}%</div><div className="sub">range pos</div></div>
      <div className="cell"><div className="lbl">Avg vol 20D</div><div className="val">{d.avgVol20?.toLocaleString("en-IN") ?? "—"}</div><div className="sub">shares</div></div>
      <div className="cell"><div className="lbl">Filings</div><div className="val" style={{ fontSize: 13 }}><a href={q.links?.screener} target="_blank" rel="noreferrer">SCREENER ↗</a></div><div className="sub">source ledger</div></div>
    </div>
  );
}

/* ---------------- statements + ratios + dupont + holdings ---------------- */

interface Kid { label: string; values: Record<string, string>; expandable: boolean }

// One expandable ledger row. "+" rows lazy-load their breakup from
// /api/schedule (screener.in drill-down); nesting caps at 3 levels.
// autoSignal > 0 (EXPAND ALL) cascades: each row opens itself and its
// children auto-load on mount.
function SchedRow({ label, vals, yoy, periods, full, symbol, section, depth, canExpand, autoSignal }: {
  label: string;
  vals: string[];
  yoy: React.ReactNode;
  periods: string[];
  full: boolean;
  symbol: string;
  section: string;
  depth: number;
  canExpand: boolean;
  autoSignal: number;
}) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const clean = label.replace(/\s*\+\s*$/, "").trim();

  function load() {
    setLoading(true); setErrMsg("");
    fetch(`/api/schedule?symbol=${encodeURIComponent(symbol)}&parent=${encodeURIComponent(clean)}&section=${encodeURIComponent(section)}`)
      .then(async (x) => {
        const j = await x.json();
        if (!x.ok) throw new Error(j.error || `breakup ${x.status}`);
        if (alive.current) setKids(j.rows ?? []);
      })
      .catch((e: any) => { if (alive.current) { setKids([]); setErrMsg(e.message || "fetch failed"); } })
      .finally(() => { if (alive.current) { setLoading(false); setOpen(true); } });
  }

  function toggle() {
    if (depth >= 3) return;
    if (open) { setOpen(false); return; }
    if (kids && !errMsg) { setOpen(true); return; }
    load();
  }

  // EXPAND ALL cascade — fires when the desk bumps autoSignal, and on
  // mount for children born from an expanded parent.
  useEffect(() => {
    if (!autoSignal || !canExpand || depth >= 3 || open || loading) return;
    if (kids && !errMsg) { setOpen(true); return; }
    if (kids === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSignal]);

  return (
    <>
      <tr>
        <td>
          <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {canExpand && depth < 3 ? (
              <button className="ghost" style={{ padding: "0 7px", fontSize: 12 }} onClick={toggle} aria-label={`expand ${label}`}>
                {loading ? "…" : open ? "−" : "+"}
              </button>
            ) : (
              <span style={{ minWidth: 6, color: "var(--faint)" }}>{depth > 0 ? "└" : ""}</span>
            )}
            {label}
          </strong>
        </td>
        {vals.map((v, i) => (
          <td key={i} style={{ textAlign: "right" }}>{v}</td>
        ))}
        {full && <td style={{ textAlign: "right" }}>{yoy}</td>}
      </tr>
      {open && errMsg && (
        <tr>
          <td colSpan={periods.length + (full ? 2 : 1)}>
            <span className="neg" style={{ paddingLeft: 34 + depth * 14 }}>BREAKUP ERR: {errMsg} </span>
            <button className="ghost" style={{ padding: "0 8px" }} onClick={load}>RETRY</button>
          </td>
        </tr>
      )}
      {open && !errMsg && kids !== null && kids.length === 0 && (
        <tr>
          <td colSpan={periods.length + (full ? 2 : 1)}>
            <span className="faint" style={{ paddingLeft: 34 + depth * 14 }}>NO BREAKUP ON FEED.</span>
          </td>
        </tr>
      )}
      {open && !errMsg && (kids ?? []).map((k) => (
        <SchedRow
          key={k.label}
          label={k.label}
          vals={periods.map((p) => k.values[p] ?? "—")}
          yoy={null}
          periods={periods}
          full={false}
          symbol={symbol}
          section={section}
          depth={depth + 1}
          canExpand={k.expandable}
          autoSignal={autoSignal}
        />
      ))}
    </>
  );
}

export function FundaTables({ symbol, full }: { symbol: string; full?: boolean }) {
  const { data, err, loading } = useStatements(symbol);
  const { q: coQ } = useCompany(symbol);
  const [ltab, setLtab] = useState<"PL" | "BS" | "CF" | "QTR" | "RAT" | "SH">("PL");
  const tabs = (
    <div className="pills">
      {(["PL", "BS", "CF", "QTR", "RAT", "SH"] as const).map((t) => (
        <button key={t} className={`pill${ltab === t ? " active" : ""}`} onClick={() => setLtab(t)}>
          {t === "PL" ? "P&L" : t === "BS" ? "BALANCE SHEET" : t === "CF" ? "CASH FLOW" : t === "QTR" ? "QUARTERS" : t === "RAT" ? "RATIOS" : "HOLDINGS"}
        </button>
      ))}
    </div>
  );
  const expandBar = full && data && !err ? (
    <div className="toolbar" style={{ marginTop: 8 }}>
      <span className="faint" style={{ fontSize: 11 }}>YAHOO LEDGER · QTR YO-Y = VS 4 QTRS AGO · RATIOS COMPUTED FROM LEDGER</span>
    </div>
  ) : null;
  // Full-ledger tab shell renders instantly; the table fills in when loaded.
  if (full && (!data || err)) {
    return (
      <div className="panel">
        <p className="p-head">Full ledger — ₹ Cr · YoY · Yahoo (yfinance) · scroll →</p>
        {tabs}
        {err
          ? <p className="neg" style={{ marginTop: 10 }}>LEDGER ERR: {err} (YAHOO THROTTLED — RETRY)</p>
          : <p className="muted" style={{ marginTop: 10 }}>PULLING LEDGER FOR {symbol}…</p>}
      </div>
    );
  }
  if (loading) return <div className="panel"><p className="muted">PULLING LEDGER FOR {symbol}…</p></div>;
  if (err) return <div className="panel"><p className="neg">LEDGER ERR: {err} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!data) return null;

  const sales = findRow(data.pl, ["sales", "revenue from operations", "total revenue", "operating revenue"]);
  const ni = findRow(data.pl, ["net profit", "profit after tax", "net income", "net income common stockholders"]);
  const cfo = findRow(data.cf, ["cash from operating activity", "net cash from operating", "operating cash flow", "cash flow from continuing operating"]);
  const assets = findRow(data.bs, ["total assets"]);
  const equity = findRow(data.bs, ["stockholders equity", "total equity gross minority interest", "common stock equity"]);
  const cap = findRow(data.bs, ["equity share capital", "share capital", "share issued", "common stock"]);
  const res = findRow(data.bs, ["reserves", "other equity", "retained earnings"]);
  const borrow = findRow(data.bs, ["borrowings", "total debt", "long term debt", "current debt"]);

  const sC = last(sales?.values), sP = prev(sales?.values);
  const nC = last(ni?.values);
  const cC = last(cfo?.values);
  const aC = last(assets?.values);
  // Yahoo-only: prefer StockholdersEquity directly; fall back to cap+reserves.
  const eqDirect = last(equity?.values);
  const eqC = eqDirect ?? (last(cap?.values) ?? 0) + (last(res?.values) ?? 0);
  const npm = sC && nC ? (nC / sC) * 100 : null;
  const at = sC && aC ? sC / aC : null;
  const em = aC && eqC ? aC / eqC : null;
  const roe = npm !== null && at !== null && em !== null ? npm * at * em : null;
  const accruals = nC !== null && cC !== null && aC ? ((nC - cC) / aC) * 100 : null;
  const yoyS = sC !== null && sP ? ((sC - sP) / Math.abs(sP)) * 100 : null;

  const prom = findRow(data.sh, ["promoters"]);
  const fii = findRow(data.sh, ["fiis", "fii"]);
  const dii = findRow(data.sh, ["diis", "dii"]);
  const pub = findRow(data.sh, ["public"]);

  const show = (t: STable | null, title: string, keep: string[] | null, bare = false, opts?: { raw?: boolean; yoy?: "annual" | "qtr" | "off"; allPeriods?: boolean }) => {
    if (!t) return null;
    const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const rows = (keep ? t.rows.filter((r) => keep.some((k) => nn(r.label).includes(nn(k)))) : t.rows).slice(0, 120);
    if (!rows.length) return null;
    const PI = (full || opts?.allPeriods) ? t.periods.length : 5;
    const periods = t.periods.slice(-PI);
    const yoyMode = opts?.yoy ?? "annual";
    const showYoy = !!full && yoyMode !== "off";
    const secMap: Record<string, string> = {
      "Profit & loss": "profit-loss",
      "Balance sheet": "balance-sheet",
      "Cash flow": "cash-flow",
      "Quarterly results": "quarters",
      "Shareholding %": "shareholding",
    };
    const sec = secMap[title] ?? "";
    // Annual: skip a trailing TTM column so YoY stays like-for-like.
    // Quarterly: true YoY — latest quarter vs 4 quarters ago.
    const yoyOf = (vals: (number | null)[]) => {
      const idx: number[] = [];
      for (let i = vals.length - 1; i >= 0; i--) {
        if (vals[i] !== null && vals[i] !== undefined) idx.push(i);
      }
      if (!idx.length) return null;
      if (yoyMode === "qtr") {
        if (idx.length < 5) return null;
        const l = vals[idx[0]] as number, p = vals[idx[4]] as number;
        if (!p) return null;
        return ((l - p) / Math.abs(p)) * 100;
      }
      let pair = idx;
      if (t.periods[t.periods.length - 1]?.toUpperCase() === "TTM") pair = idx.slice(1);
      if (pair.length < 2) return null;
      const l = vals[pair[0]] as number, p = vals[pair[1]] as number;
      if (!p) return null;
      return ((l - p) / Math.abs(p)) * 100;
    };
    const tbl = (
        <table className="plain">
          <thead><tr><th></th>{periods.map((p) => <th key={p} style={{ textAlign: "right", ...(p.toUpperCase() === "TTM" ? { color: "var(--amber)" } : {}) }}>{p}</th>)}{showYoy && <th style={{ textAlign: "right" }}>YOY %</th>}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const y = showYoy ? yoyOf(r.values) : null;
              return (
                <SchedRow
                  key={r.label}
                  label={r.label}
                  vals={opts?.raw ? r.raw.slice(-PI) : r.values.slice(-PI).map((v) => (v === null || v === undefined ? "—" : v.toLocaleString("en-IN")))}
                  yoy={y === null ? "—" : (<span className={y >= 0 ? "pos" : "neg"}>{y >= 0 ? "+" : ""}{y.toFixed(1)}</span>)}
                  periods={periods}
                  full={showYoy}
                  symbol={symbol}
                  section={sec}
                  depth={0}
                  canExpand={r.label.trim().endsWith("+")}
                  autoSignal={0}
                />
              );
            })}
          </tbody>
        </table>
    );
    if (bare) return tbl;
    return (
      <div className="panel">
        <p className="p-head">{title} — ₹ Cr{full ? " · FULL LEDGER + YOY" : ""}</p>
        {tbl}
      </div>
    );
  };

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{data.name} — ledger · {data.unit}</p>
        <div className="grid grid-2">
          <div>
            <KV k="SALES (FY)" v={sC !== null ? `₹${sC.toLocaleString("en-IN")} Cr` : "—"} />
            <KV k="SALES YOY" v={yoyS !== null ? `${yoyS >= 0 ? "+" : ""}${yoyS.toFixed(1)}%` : "—"} cls={yoyS !== null && yoyS >= 0 ? "pos" : "neg"} />
            <KV k="NET PROFIT" v={nC !== null ? `₹${nC.toLocaleString("en-IN")} Cr` : "—"} />
            <KV k="CFO" v={cC !== null ? `₹${cC.toLocaleString("en-IN")} Cr` : "—"} />
            <KV k="BORROWINGS" v={(() => { const b = last(borrow?.values); return b !== null ? `₹${b.toLocaleString("en-IN")} Cr` : "—"; })()} />
          </div>
          <div>
            <KV k="DUPONT NPM × AT × EM" v={npm !== null && at !== null && em !== null ? `${npm.toFixed(1)}% × ${at.toFixed(2)} × ${em.toFixed(2)}` : "—"} />
            <KV k="ROE (DUPONT)" v={roe !== null ? `${roe.toFixed(1)}%` : "—"} cls={roe !== null && roe > 15 ? "pos" : ""} />
            <KV k="ACCRUALS (NI−CFO)/TA" v={accruals !== null ? `${accruals.toFixed(1)}%` : "—"} cls={accruals !== null && Math.abs(accruals) > 10 ? "neg" : "pos"} />
            <KV k="PROMOTER" v={(() => { const v = last(prom?.values); return v !== null ? `${v}%` : "—"; })()} />
            <KV k="FII / DII / PUBLIC" v={`${last(fii?.values) ?? "—"} / ${last(dii?.values) ?? "—"} / ${last(pub?.values) ?? "—"}`} />
          </div>
        </div>
      </div>
      <div className="panel">
        <p className="p-head">Sales trend — ₹ Cr</p>
        {(() => {
          const s = findRow(data.pl, ["sales", "revenue from operations", "total revenue", "operating revenue"]);
          const vals = (s?.values ?? []).slice(-8);
          const pers = (data.pl?.periods ?? []).slice(-8).map((p) => p.replace("Mar ", "'"));
          const mx = Math.max(...vals.map((v) => v ?? 0), 1);
          if (!s || vals.every((v) => v === null)) return <p className="muted">NO SALES SERIES.</p>;
          return (
            <svg viewBox="0 0 400 122" style={{ width: "100%", height: 122 }}>
              {vals.map((v, i) => {
                const h = v !== null ? Math.max(3, (v / mx) * 96) : 0;
                return (
                  <g key={i}>
                    <rect x={8 + i * 49} y={108 - h} width={36} height={h} fill={i === vals.length - 1 ? "#ffa028" : "#3a3a42"} rx={2} />
                    <text x={26 + i * 49} y={119} fontSize={8.5} fill="#5b5b62" textAnchor="middle">{pers[i] ?? ""}</text>
                  </g>
                );
              })}
            </svg>
          );
        })()}
      </div>
      {full ? (
        <div className="panel">
          <p className="p-head">Full ledger — ₹ Cr · YoY · expand-all · scroll →</p>
          {tabs}
          {expandBar}
          <div className="scrollx" style={{ marginTop: 10 }}>
            {ltab === "PL" && show(data.pl, "Profit & loss", null, true)}
            {ltab === "BS" && show(data.bs, "Balance sheet", null, true)}
            {ltab === "CF" && show(data.cf, "Cash flow", null, true)}
            {ltab === "QTR" && (data.qtr
              ? show(data.qtr, "Quarterly results", null, true, { yoy: "qtr" })
              : <p className="muted" style={{ marginTop: 10 }}>NO QUARTERLY SERIES ON FEED.</p>)}
            {ltab === "RAT" && (data.rat
              ? <RatiosTables rat={data.rat} />
              : <p className="muted" style={{ marginTop: 10 }}>NO RATIO SERIES ON FEED.</p>)}
            {ltab === "SH" && (data.sh
              ? show(data.sh, "Shareholding %", null, true)
              : <YahooHolders symbol={symbol} coQ={coQ} />)}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-2">
            {show(data.pl, "Profit & loss", ["total revenue", "sales", "cost of revenue", "gross profit", "operating expense", "operating income", "operating profit", "net income", "net profit", "eps", "ebitda", "ebit"])}
            {show(data.cf, "Cash flow", ["operating cash flow", "investing cash flow", "financing cash flow", "free cash flow", "end cash position", "capital expenditure"])}
          </div>
          {show(data.bs, "Balance sheet", ["total assets", "current assets", "cash", "inventory", "receivables", "total debt", "borrowings", "long term debt", "current liabilities", "total liabilities", "stockholders equity", "retained earnings", "share issued", "working capital"])}
          {show(data.sh, "Shareholding %", ["promoters", "fiis", "diis", "public", "government"])}
        </>
      )}
      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Net margin % — full trend</p>
          {(() => {
            const s = findRow(data.pl, ["sales", "revenue from operations", "total revenue", "operating revenue"]);
            const n = findRow(data.pl, ["net profit", "profit after tax", "net income"]);
            if (!s || !n || !data.pl) return <p className="muted">NO MARGIN SERIES.</p>;
            const pers = data.pl.periods.map((p) => p.replace("Mar ", "'"));
            const vals = data.pl.periods.map((_, i) => {
              const sv = s.values[i], nv = n.values[i];
              return sv && nv !== null && sv !== 0 ? (nv / sv) * 100 : null;
            });
            return <LineChart series={[{ label: "NPM %", color: "#00d664", values: vals }]} height={110} yFmt={(v) => `${v.toFixed(0)}%`} dates={pers} xLabels={[pers[0] ?? "", pers[Math.floor(pers.length / 2)] ?? "", pers[pers.length - 1] ?? ""]} />;
          })()}
        </div>
        <div className="panel">
          <p className="p-head">Holdings — latest split</p>
          {(() => {
            const get = (c: string[]) => last(findRow(data.sh, c)?.values);
            const parts = [
              { label: "PROMOTER", value: get(["promoters"]) ?? 0, color: "#ffa028" },
              { label: "FII", value: get(["fiis", "fii"]) ?? 0, color: "#00d664" },
              { label: "DII", value: get(["diis", "dii"]) ?? 0, color: "#8f7bff" },
              { label: "PUBLIC", value: get(["public"]) ?? 0, color: "#5b5b62" },
              { label: "GOVT", value: get(["government"]) ?? 0, color: "#00c8ff" },
            ];
            if (parts.some((p) => p.value > 0)) return <Donut slices={parts} />;
            // Yahoo-only fallback: no promoter/FII/DII split — use holders %.
            const h = coQ?.profile?.holders;
            if (!h) return <p className="muted">NO HOLDING SPLIT.</p>;
            const insider = typeof h.insider === "number" ? h.insider * 100 : 0;
            const instit = typeof h.instit === "number" ? h.instit * 100 : 0;
            const other = Math.max(0, 100 - insider - instit);
            const yp = [
              { label: "INSIDER", value: Math.round(insider * 100) / 100, color: "#ffa028" },
              { label: "INSTIT", value: Math.round(instit * 100) / 100, color: "#00d664" },
              { label: "PUBLIC+", value: Math.round(other * 100) / 100, color: "#5b5b62" },
            ];
            if (!yp.some((p) => p.value > 0)) return <p className="muted">NO HOLDING SPLIT.</p>;
            return (
              <>
                <Donut slices={yp} />
                <p className="faint" style={{ fontSize: 11, marginTop: 8 }}>YAHOO HOLDERS — NO PROMOTER/FII SPLIT · {(h.sharesOut ?? 0).toLocaleString("en-IN")} SH OUT</p>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* Year A-vs-B compare for the statement charts desk. */
function ComparePanel({ symbol, periods, rev, gp, opI, net, assets, debt, equity, cashB, ocf, fcf, capex, divs, R }: {
  symbol: string;
  periods: string[];
  rev: (number | null)[]; gp: (number | null)[]; opI: (number | null)[]; net: (number | null)[];
  assets: (number | null)[]; debt: (number | null)[]; equity: (number | null)[]; cashB: (number | null)[];
  ocf: (number | null)[]; fcf: (number | null)[]; capex: (number | null)[]; divs: (number | null)[];
  R: (label: string) => (number | null)[];
}) {
  const yA = periods[Math.max(0, periods.length - 2)] ?? periods[0];
  const yB = periods[periods.length - 1] ?? periods[0];
  const iA = periods.indexOf(yA), iB = periods.indexOf(yB);
  const at = (arr: (number | null)[], i: number) => (i < 0 || i >= arr.length ? null : arr[i]);
  const crF = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const pcF = (v: number) => `${v.toFixed(2)}%`;
  const xF = (v: number) => `${v.toFixed(2)}x`;
  const rsF = (v: number) => `₹${v.toFixed(1)}`;

  interface CRow { sec: string; label: string; a: number | null; b: number | null; fmt: (v: number) => string; badUp?: boolean }
  const rows: CRow[] = [
    { sec: "P&L · ₹ Cr", label: "Revenue", a: at(rev, iA), b: at(rev, iB), fmt: crF },
    { sec: "P&L · ₹ Cr", label: "Gross Profit", a: at(gp, iA), b: at(gp, iB), fmt: crF },
    { sec: "P&L · ₹ Cr", label: "Operating Income", a: at(opI, iA), b: at(opI, iB), fmt: crF },
    { sec: "P&L · ₹ Cr", label: "Net Income", a: at(net, iA), b: at(net, iB), fmt: crF },
    { sec: "Balance · ₹ Cr", label: "Total Assets", a: at(assets, iA), b: at(assets, iB), fmt: crF },
    { sec: "Balance · ₹ Cr", label: "Total Debt", a: at(debt, iA), b: at(debt, iB), fmt: crF, badUp: true },
    { sec: "Balance · ₹ Cr", label: "Equity", a: at(equity, iA), b: at(equity, iB), fmt: crF },
    { sec: "Balance · ₹ Cr", label: "Cash", a: at(cashB, iA), b: at(cashB, iB), fmt: crF },
    { sec: "Cash flow · ₹ Cr", label: "OCF", a: at(ocf, iA), b: at(ocf, iB), fmt: crF },
    { sec: "Cash flow · ₹ Cr", label: "FCF", a: at(fcf, iA), b: at(fcf, iB), fmt: crF },
    { sec: "Cash flow · ₹ Cr", label: "Capex", a: at(capex, iA) !== null ? Math.abs(at(capex, iA)!) : null, b: at(capex, iB) !== null ? Math.abs(at(capex, iB)!) : null, fmt: crF, badUp: true },
    { sec: "Ratios", label: "Net Margin", a: at(R("Net Margin %"), iA), b: at(R("Net Margin %"), iB), fmt: pcF },
    { sec: "Ratios", label: "ROE", a: at(R("ROE %"), iA), b: at(R("ROE %"), iB), fmt: pcF },
    { sec: "Ratios", label: "ROCE", a: at(R("ROCE %"), iA), b: at(R("ROCE %"), iB), fmt: pcF },
    { sec: "Ratios", label: "Current Ratio", a: at(R("Current Ratio x"), iA), b: at(R("Current Ratio x"), iB), fmt: xF },
    { sec: "Ratios", label: "Debt to Equity", a: at(R("Debt to Equity x"), iA), b: at(R("Debt to Equity x"), iB), fmt: xF, badUp: true },
    { sec: "Ratios", label: "OCF Margin", a: at(R("OCF Margin %"), iA), b: at(R("OCF Margin %"), iB), fmt: pcF },
    { sec: "Per share · ₹", label: "Diluted EPS", a: at(R("Diluted EPS Rs"), iA), b: at(R("Diluted EPS Rs"), iB), fmt: rsF },
    { sec: "Per share · ₹", label: "BVPS", a: at(R("Book Value Per Share Rs"), iA), b: at(R("Book Value Per Share Rs"), iB), fmt: rsF },
  ];

  let lastSec = "";
  const body: JSX.Element[] = [];
  rows.forEach((r) => {
    if (r.sec !== lastSec) {
      lastSec = r.sec;
      body.push(
        <tr key={`sec-${r.sec}`}>
          <td colSpan={5}><span style={{ color: "var(--amber)", fontSize: 11, fontWeight: 700 }}>{r.sec.toUpperCase()}</span></td>
        </tr>
      );
    }
    const d = r.a !== null && r.b !== null ? r.b - r.a : null;
    const dp = d !== null && r.a ? (d / Math.abs(r.a)) * 100 : null;
    const good = d === null ? false : r.badUp ? d <= 0 : d >= 0;
    body.push(
      <tr key={r.label}>
        <td><strong>{r.label}</strong></td>
        <td style={{ textAlign: "right" }}>{r.a === null ? "—" : r.fmt(r.a)}</td>
        <td style={{ textAlign: "right" }}>{r.b === null ? "—" : r.fmt(r.b)}</td>
        <td style={{ textAlign: "right" }}>
          {d === null ? "—" : <span className={good ? "pos" : "neg"}>{d >= 0 ? "+" : ""}{r.fmt(d)}</span>}
        </td>
        <td style={{ textAlign: "right" }}>
          {dp === null || !isFinite(dp) ? "—" : <span className={good ? "pos" : "neg"}>{dp >= 0 ? "+" : ""}{dp.toFixed(1)}%</span>}
        </td>
      </tr>
    );
  });
  return (
    <div className="panel panel-glow">
      <p className="p-head">Year compare — {symbol} · {yA} vs {yB}</p>
      <div className="grid grid-2" style={{ marginTop: 10 }}>
        <div>
          <p className="p-head">P&L face-off — ₹ Cr · same metric side by side</p>
          <GroupedBars
            periods={["REVENUE", "GROSS", "OP INC", "NET"]}
            fmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            series={[
              { label: yA, color: "#5b5b62", values: [at(rev, iA), at(gp, iA), at(opI, iA), at(net, iA)] },
              { label: yB, color: "#ffa028", values: [at(rev, iB), at(gp, iB), at(opI, iB), at(net, iB)] },
            ]}
          />
        </div>
        <div>
          <p className="p-head">Balance face-off — ₹ Cr · same metric side by side</p>
          <GroupedBars
            periods={["ASSETS", "DEBT", "EQUITY", "OCF"]}
            fmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            series={[
              { label: yA, color: "#5b5b62", values: [at(assets, iA), at(debt, iA), at(equity, iA), at(ocf, iA)] },
              { label: yB, color: "#00d664", values: [at(assets, iB), at(debt, iB), at(equity, iB), at(ocf, iB)] },
            ]}
          />
        </div>
      </div>
      <div className="scrollx" style={{ marginTop: 10 }}>
        <table className="plain">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>METRIC</th>
              <th style={{ textAlign: "right" }}>{yA}</th>
              <th style={{ textAlign: "right" }}>{yB}</th>
              <th style={{ textAlign: "right" }}>Δ</th>
              <th style={{ textAlign: "right" }}>Δ %</th>
            </tr>
          </thead>
          <tbody>
            {body}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- dupont desk (module 14) ---------------- */
// Full 5-factor DuPont + Piotroski / Altman / Beneish / MC-DCF / reverse-DCF
// — every score computed from THIS company's live ledger + quote. Anything
// unavailable prints as an explicit DATA GAP; placeholder examples are never
// shown as analysis.

interface DupCheck { label: string; detail: string; st: "pass" | "fail" | "gap" }

export function DupontDesk({ symbol }: { symbol: string }) {
  const { data: st, err: stErr, loading: stLoading } = useStatements(symbol);
  const { q, qErr, qLoading, retryQuote } = useCompany(symbol);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const P = st?.pl?.periods ?? [];
  const li = P.length - 1; // latest FY
  const pi = P.length - 2; // prior FY
  const hasPrior = P.length >= 2 && pi >= 0;
  const val = (t: STable | null, cands: string[], i: number): number | null => {
    const r = findRow(t, cands);
    const v = r?.values[i];
    return typeof v === "number" && isFinite(v) ? v : null;
  };

  // ---- live quote (for Altman X4 + DCF upside) ----
  const px = typeof q?.quote?.regularMarketPrice === "number" ? q.quote.regularMarketPrice : null;
  const mcapCr = typeof q?.quote?.marketCap === "number" && isFinite(q.quote.marketCap)
    ? q.quote.marketCap / 1e7
    : typeof st?.marketCapCr === "number" ? st.marketCapCr : null;
  const holders = q?.profile?.holders;
  const sharesCr = typeof holders?.sharesOut === "number" && holders.sharesOut > 0
    ? holders.sharesOut / 1e7
    : typeof q?.quote?.sharesOutstanding === "number" && q.quote.sharesOutstanding > 0
      ? q.quote.sharesOutstanding / 1e7
      : mcapCr !== null && px ? mcapCr / px : null;

  // ---- 5-factor DuPont, latest + prior ----
  const f5 = (i: number) => {
    const sales = val(st?.pl ?? null, ["total revenue", "operating revenue"], i);
    const ebit = val(st?.pl ?? null, ["ebit"], i);
    const ebt = val(st?.pl ?? null, ["pretax income", "profit before tax"], i);
    const net = val(st?.pl ?? null, ["net income", "net profit"], i);
    const assets = val(st?.bs ?? null, ["total assets"], i);
    const eq = val(st?.bs ?? null, ["stockholders equity", "total equity gross minority interest", "common stock equity"], i);
    const taxB = sales !== null && ebt !== null && net !== null && ebt !== 0 ? net / ebt : null;
    const intB = ebt !== null && ebit !== null && ebit !== 0 ? ebt / ebit : null;
    const ebitM = sales !== null && ebit !== null && sales !== 0 ? ebit / sales : null;
    const at = sales !== null && assets !== null && assets !== 0 ? sales / assets : null;
    const em = assets !== null && eq !== null && eq !== 0 ? assets / eq : null;
    const roe = taxB !== null && intB !== null && ebitM !== null && at !== null && em !== null
      ? taxB * intB * ebitM * at * em * 100 : null;
    return { sales, net, assets, eq, taxB, intB, ebitM, at, em, roe };
  };
  const cur = li >= 0 ? f5(li) : null;
  const prv = hasPrior ? f5(pi) : null;

  const f2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  const dPP = (c: number | null, p: number | null, pct = false) => {
    if (c === null || p === null) return "—";
    const d = pct ? (c - p) * 100 : c - p;
    return `${d >= 0 ? "+" : ""}${d.toFixed(2)}${pct ? "pp" : ""}`;
  };
  const inrCr = (v: number | null) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);
  const inrPx = (v: number | null | undefined) => (typeof v === "number" && isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 })}` : "—");

  // ---- Piotroski 9 checks, real ledger (current vs prior FY) ----
  let pio: { score: number; answered: number; gaps: number; checks: DupCheck[] } | null = null;
  if (st?.pl && hasPrior) {
    const g = (t: STable | null, c: string[], i: number) => val(t, c, i);
    const niC = g(st.pl, ["net income", "net profit"], li), niP = g(st.pl, ["net income", "net profit"], pi);
    const cfoC = g(st.cf, ["cash flow from continuing operating activities", "operating cash flow"], li);
    const aC = g(st.bs, ["total assets"], li), aP = g(st.bs, ["total assets"], pi);
    const caC = g(st.bs, ["current assets"], li), caP = g(st.bs, ["current assets"], pi);
    const clC = g(st.bs, ["current liabilities"], li), clP = g(st.bs, ["current liabilities"], pi);
    const ltdC = g(st.bs, ["long term debt", "long term debt and capital lease obligation", "total debt"], li);
    const ltdP = g(st.bs, ["long term debt", "long term debt and capital lease obligation", "total debt"], pi);
    const revC = g(st.pl, ["total revenue", "operating revenue"], li), revP = g(st.pl, ["total revenue", "operating revenue"], pi);
    const gpC = g(st.pl, ["gross profit"], li), gpP = g(st.pl, ["gross profit"], pi);
    // Dilution proxy: equity share capital book value (no per-year share count on Yahoo).
    const capC = g(st.bs, ["share issued", "common stock"], li), capP = g(st.bs, ["share issued", "common stock"], pi);
    const roaC = niC !== null && aC ? niC / aC : null, roaP = niP !== null && aP ? niP / aP : null;
    const crC = caC !== null && clC ? caC / clC : null, crP = caP !== null && clP ? caP / clP : null;
    const levC = ltdC !== null && aC ? ltdC / aC : null, levP = ltdP !== null && aP ? ltdP / aP : null;
    const gmC = gpC !== null && revC ? gpC / revC : null, gmP = gpP !== null && revP ? gpP / revP : null;
    const atC = revC !== null && aC ? revC / aC : null, atP = revP !== null && aP ? revP / aP : null;
    const raw: Array<[string, string | null, boolean | null]> = [
      ["ROA > 0", roaC === null ? null : `ROA = ${(roaC * 100).toFixed(2)}%`, roaC === null ? null : roaC > 0],
      ["CFO > 0", cfoC === null ? null : `CFO = ${inrCr(cfoC)}`, cfoC === null ? null : cfoC > 0],
      ["ROA UP", roaC === null || roaP === null ? null : `Δ ROA = ${dPP(roaC, roaP, true)}`, roaC === null || roaP === null ? null : roaC > roaP],
      ["CFO > NI", niC === null || cfoC === null ? null : `CFO/NI = ${(cfoC / (niC || 1)).toFixed(2)}x`, niC === null || cfoC === null ? null : cfoC > niC],
      ["LEVERAGE DOWN", levC === null || levP === null ? null : `D/A ${(levP * 100).toFixed(1)}% → ${(levC * 100).toFixed(1)}%`, levC === null || levP === null ? null : levC < levP],
      ["CURRENT R UP", crC === null || crP === null ? null : `CR ${crP.toFixed(2)} → ${crC.toFixed(2)}`, crC === null || crP === null ? null : crC > crP],
      ["NO DILUTION", capC === null || capP === null ? null : `EQ CAP ${inrCr(capP)} → ${inrCr(capC)}`, capC === null || capP === null ? null : capC <= capP],
      ["GM UP", gmC === null || gmP === null ? null : `GM ${(gmP * 100).toFixed(1)}% → ${(gmC * 100).toFixed(1)}%`, gmC === null || gmP === null ? null : gmC > gmP],
      ["TURNOVER UP", atC === null || atP === null ? null : `AT ${atP.toFixed(2)} → ${atC.toFixed(2)}`, atC === null || atP === null ? null : atC > atP],
    ];
    const checks: DupCheck[] = raw.map(([label, detail, pass]) => ({
      label, detail: detail ?? "DATA GAP", st: pass === null ? "gap" : pass ? "pass" : "fail",
    }));
    const answered = checks.filter((c) => c.st !== "gap").length;
    pio = { score: checks.filter((c) => c.st === "pass").length, answered, gaps: 9 - answered, checks };
  }
  const pioLabel = pio
    ? `${pio.score}/9${pio.gaps ? ` · ${pio.gaps} GAP` : ""} · ${pio.score >= 8 ? "EXCEPTIONAL" : pio.score >= 7 ? "STRONG" : pio.score >= 4 ? "AVERAGE" : "WEAK"}`
    : "DATA GAP";

  // ---- Altman Z, real ledger + live market cap ----
  let alt: ReturnType<typeof calcAltmanZ> | null = null;
  let altGap = "";
  if (st?.pl && li >= 0) {
    const g = (t: STable | null, c: string[], i: number) => val(t, c, i);
    const ca = g(st.bs, ["current assets"], li), cl = g(st.bs, ["current liabilities"], li);
    const wc = ca !== null && cl !== null ? ca - cl : null;
    const ta = g(st.bs, ["total assets"], li);
    const tl = g(st.bs, ["total liabilities net minority interest", "total liabilities"], li);
    const re = g(st.bs, ["retained earnings", "reserves"], li);
    const ebit = g(st.pl, ["ebit"], li);
    const rev = g(st.pl, ["total revenue", "operating revenue"], li);
    const miss: string[] = [];
    if (wc === null) miss.push("WORK CAP");
    if (re === null) miss.push("RET EARN");
    if (ebit === null) miss.push("EBIT");
    if (ta === null) miss.push("ASSETS");
    if (tl === null) miss.push("LIAB");
    if (rev === null) miss.push("SALES");
    if (mcapCr === null) miss.push("MCAP");
    if (miss.length) altGap = `NEEDS ${miss.join(" · ")}`;
    else {
      alt = calcAltmanZ({
        niC: 0, retainedC: re!, ebitC: ebit!, workingCapital: wc!,
        totalAssets: ta!, totalLiab: tl!, revenueC: rev!, marketCap: mcapCr!,
      });
    }
  }

  // ---- Beneish M, real ledger (needs current + prior FY) ----
  let ben: { mScore: number; risk: string; cls: string; vars: Array<{ k: string; v: number | null }> } | null = null;
  if (st?.pl && hasPrior) {
    const g = (t: STable | null, c: string[], i: number) => val(t, c, i);
    const R = (c: string[]) => [g(st.pl, c, li), g(st.pl, c, pi)] as const;
    const B = (c: string[]) => [g(st.bs, c, li), g(st.bs, c, pi)] as const;
    const C = (c: string[]) => [g(st.cf, c, li), g(st.cf, c, pi)] as const;
    const [revC, revP] = R(["total revenue", "operating revenue"]);
    const [recC, recP] = B(["gross accounts receivable", "accounts receivable", "receivables"]);
    const [gpC, gpP] = R(["gross profit"]);
    const [caC, caP] = B(["current assets"]);
    const [ppeC, ppeP] = B(["net ppe", "gross ppe"]);
    const [taC, taP] = B(["total assets"]);
    const [depC, depP] = R(["reconciled depreciation", "depreciation and amortization", "depreciation"]);
    const [sgaC, sgaP] = R(["selling general and administration", "selling and marketing expense"]);
    const [niC] = R(["net income", "net profit"]);
    const [ocfC] = C(["cash flow from continuing operating activities", "operating cash flow"]);
    const [clC, clP] = B(["current liabilities"]);
    const [ltdC, ltdP] = B(["long term debt", "long term debt and capital lease obligation", "total debt"]);
    const dv = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : a / b);
    const dsri = recC !== null && revC && recP !== null && revP ? dv(recC / revC, recP / revP) : null;
    const gmi = gpC !== null && revC && gpP !== null && revP && revC !== 0 && revP !== 0
      ? dv((revP - gpP) / revP, (revC - gpC) / revC) : null;
    const aqi = caC !== null && ppeC !== null && taC && caP !== null && ppeP !== null && taP
      ? dv(1 - (caC + ppeC) / taC, 1 - (caP + ppeP) / taP) : null;
    const sgi = dv(revC, revP);
    const depi = depP !== null && ppeP !== null && depC !== null && ppeC !== null && (ppeP + depP) !== 0 && (ppeC + depC) !== 0
      ? dv(depP / (ppeP + depP), depC / (ppeC + depC)) : null;
    const sgai = sgaC !== null && revC && sgaP !== null && revP ? dv(sgaC / revC, sgaP / revP) : null;
    const lvgi = clC !== null && ltdC !== null && taC && clP !== null && ltdP !== null && taP
      ? dv((clC + ltdC) / taC, (clP + ltdP) / taP) : null;
    const tata = niC !== null && ocfC !== null && taC ? (niC - ocfC) / taC : null;
    const vars = [
      { k: "DSRI", v: dsri }, { k: "GMI", v: gmi }, { k: "AQI", v: aqi }, { k: "SGI", v: sgi },
      { k: "DEPI", v: depi }, { k: "SGAI", v: sgai }, { k: "LVGI", v: lvgi }, { k: "TATA", v: tata },
    ];
    if (vars.every((x) => x.v !== null)) {
      const r = calcBeneish({
        dsri: dsri!, gmi: gmi!, aqi: aqi!, sgi: sgi!,
        depi: depi!, sgai: sgai!, tata: tata!, lvgi: lvgi!,
      });
      ben = { mScore: r.mScore, risk: r.risk, cls: r.cssClass, vars };
    } else {
      ben = { mScore: NaN, risk: "DATA GAP", cls: "", vars };
    }
  }

  // ---- MC-DCF + reverse DCF on real FCF ----
  const ocfL = li >= 0 ? val(st?.cf ?? null, ["cash flow from continuing operating activities", "operating cash flow"], li) : null;
  const capexL = li >= 0 ? val(st?.cf ?? null, ["capital expenditure", "capital expenditure reported"], li) : null;
  const fcf = ocfL !== null && capexL !== null ? ocfL - Math.abs(capexL) : ocfL;
  const dcf = fcf !== null && sharesCr !== null && sharesCr > 0
    ? calcMonteCarloDCF(fcf * 1e7, sharesCr * 1e7, 0.12, 0.04, [0.05, 0.1, 0.15], 800, 5, 42)
    : null;
  const rdcf = px !== null && fcf !== null && sharesCr !== null && sharesCr > 0
    ? calcReverseDCF(px, fcf * 1e7, sharesCr * 1e7)
    : null;
  const upside = dcf && !dcf.error && px ? ((dcf.p50 - px) / px) * 100 : null;

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const f = (v: number | null, d = 2) => (v === null ? "?" : v.toFixed(d));
      const txt = await chatComplete([
        { role: "system", content: aiSystem.dupont() },
        {
          role: "user",
          content: `SEC ${symbol} FY${P[li] ?? "?"} ROE ${cur?.roe === null || cur?.roe === undefined ? "?" : cur.roe.toFixed(1)}% ` +
            `(TAXB ${f(cur?.taxB ?? null)} INTB ${f(cur?.intB ?? null)} EBITM ${cur?.ebitM === null || cur?.ebitM === undefined ? "?" : (cur.ebitM * 100).toFixed(1)}% AT ${f(cur?.at ?? null)} EM ${f(cur?.em ?? null)}). ` +
            `PIOTROSKI ${pio ? `${pio.score}/9` : "?"} ALTMAN ${alt ? `${alt.zScore.toFixed(2)} (${alt.zone})` : "?"} ` +
            `BENEISH ${ben && isFinite(ben.mScore) ? `${ben.mScore.toFixed(2)} (${ben.risk})` : "?"} ` +
            `DCF P50 ${dcf && !dcf.error ? dcf.p50.toFixed(0) : "?"} VS PX ${px ?? "?"} (UPSIDE ${upside === null ? "?" : upside.toFixed(1) + "%"}). ` +
            `TASK: ROE DRIVERS + WEAKEST LINK + 3 RISKS. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: unknown) {
      setAiOut(`AI ERR: ${e instanceof Error ? e.message : "fetch failed"}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (stLoading) return <div className="panel"><p className="muted">BUILDING DUPONT FOR {symbol}…</p></div>;
  if (stErr) return <div className="panel"><p className="neg">DUPONT ERR: {stErr} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!st?.pl) return null;

  const verdict = !cur || cur.roe === null
    ? { t: "DATA GAP", cls: "" }
    : cur.roe >= 15 && (cur.em ?? 9) <= 2.5 && (pio?.score ?? 0) >= 7 && alt?.zone === "SAFE ZONE"
      ? { t: "QUALITY COMPOUNDER", cls: "pos" }
      : cur.roe >= 15
        ? { t: "PROFITABLE — CHECK LEVERAGE", cls: "pos" }
        : cur.roe >= 8
          ? { t: "AVERAGE EARNER", cls: "" }
          : { t: "WEAK EARNER", cls: "neg" };

  const factors: Array<{ k: string; cur: number | null; prv: number | null; pct: boolean; fmt: (v: number | null) => string }> = [
    { k: "TAX BURDEN", cur: cur?.taxB ?? null, prv: prv?.taxB ?? null, pct: false, fmt: f2 },
    { k: "INT BURDEN", cur: cur?.intB ?? null, prv: prv?.intB ?? null, pct: false, fmt: f2 },
    { k: "EBIT MARGIN", cur: cur?.ebitM ?? null, prv: prv?.ebitM ?? null, pct: true, fmt: (v) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`) },
    { k: "ASSET T/O", cur: cur?.at ?? null, prv: prv?.at ?? null, pct: false, fmt: f2 },
    { k: "EQUITY MULT", cur: cur?.em ?? null, prv: prv?.em ?? null, pct: false, fmt: f2 },
  ];
  const hb = factors.map((x, i) => ({
    label: x.k, value: x.cur ?? NaN, display: x.fmt(x.cur),
    color: ["#00d664", "#00c8ff", "#ffa028", "#8f7bff", "#ff453a"][i],
  })).filter((r) => isFinite(r.value));

  const roeS = st.rat?.rows.find((r) => r.label === "ROE %")?.values ?? [];
  const roaS = st.rat?.rows.find((r) => r.label === "ROA %")?.values ?? [];
  const roceS = st.rat?.rows.find((r) => r.label === "ROCE %")?.values ?? [];
  const perS = (fn: (i: number) => number | null) => P.map((_, i) => fn(i));
  const sTaxB = perS((i) => {
    const n = val(st.pl, ["net income", "net profit"], i), e = val(st.pl, ["pretax income", "profit before tax"], i);
    return n !== null && e ? n / e : null;
  });
  const sIntB = perS((i) => {
    const e = val(st.pl, ["pretax income", "profit before tax"], i), b = val(st.pl, ["ebit"], i);
    return e !== null && b ? e / b : null;
  });
  const sAT = perS((i) => {
    const s = val(st.pl, ["total revenue", "operating revenue"], i), a = val(st.bs, ["total assets"], i);
    return s !== null && a ? s / a : null;
  });
  const sEM = perS((i) => {
    const a = val(st.bs, ["total assets"], i);
    const e = val(st.bs, ["stockholders equity", "total equity gross minority interest"], i);
    return a !== null && e ? a / e : null;
  });

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{st.name} — DuPont 5-factor · FY {P[li]} · ₹ Cr</p>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          ROE = TAX BURDEN × INT BURDEN × EBIT MARGIN × ASSET TURNOVER × EQUITY MULT
        </p>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Sales</div><div className="val">{inrCr(cur?.sales ?? null)}</div><div className="sub">FY {P[li]}</div></div>
          <div className="cell"><div className="lbl">Net income</div><div className="val">{inrCr(cur?.net ?? null)}</div><div className="sub">bottom line</div></div>
          <div className="cell"><div className="lbl">Equity</div><div className="val">{inrCr(cur?.eq ?? null)}</div><div className="sub">book</div></div>
          <div className="cell"><div className="lbl">ROE (5-factor)</div><div className={`val ${cur?.roe !== null && cur?.roe !== undefined && cur.roe >= 15 ? "pos" : ""}`}>{cur?.roe === null || cur?.roe === undefined ? "—" : `${cur.roe.toFixed(1)}%`}</div><div className="sub">product below</div></div>
          <div className="cell"><div className="lbl">Verdict</div><div className={`val ${verdict.cls}`} style={{ fontSize: 13 }}>{verdict.t}</div><div className="sub">F {pio?.score ?? "—"}/9 · {alt ? alt.zone : "Z GAP"} · {ben && isFinite(ben.mScore) ? ben.risk : "M GAP"}</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <HBars rows={hb} />
        </div>
        <div className="scrollx" style={{ marginTop: 10 }}>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>FACTOR</th><th style={{ textAlign: "right" }}>FY {P[li]}</th><th style={{ textAlign: "right" }}>FY {hasPrior ? P[pi] : "—"}</th><th style={{ textAlign: "right" }}>Δ</th></tr></thead>
            <tbody>
              {factors.map((x) => (
                <tr key={x.k}>
                  <td><strong>{x.k}</strong></td>
                  <td style={{ textAlign: "right" }}>{x.fmt(x.cur)}</td>
                  <td style={{ textAlign: "right" }} className="faint">{x.fmt(x.prv)}</td>
                  <td style={{ textAlign: "right" }} className={x.cur !== null && x.prv !== null ? (x.cur >= x.prv ? "pos" : "neg") : "faint"}>{dPP(x.cur, x.prv, x.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Returns % — {P[0]} → {P[li]}</p>
        <LineChart
          dates={P}
          yFmt={(v) => `${v.toFixed(1)}%`}
          series={[
            { label: `ROE ${cur?.roe === null || cur?.roe === undefined ? "—" : cur.roe.toFixed(1)}%`, color: "#ffa028", values: roeS },
            { label: "ROA", color: "#00d664", values: roaS },
            { label: "ROCE", color: "#00c8ff", values: roceS },
          ]}
        />
      </div>
      <div className="panel">
        <p className="p-head">DuPont multipliers — {P[0]} → {P[li]}</p>
        <LineChart
          dates={P}
          yFmt={(v) => v.toFixed(2)}
          series={[
            { label: "TAX B", color: "#00d664", values: sTaxB },
            { label: "INT B", color: "#00c8ff", values: sIntB },
            { label: "AT", color: "#8f7bff", values: sAT },
            { label: "EM", color: "#ff453a", values: sEM },
          ]}
        />
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Piotroski F — {pioLabel} · FY {hasPrior ? `${P[pi]}→${P[li]}` : P[li]}</p>
          {!pio ? (
            <p className="muted">NEEDS 2 FY OF LEDGER — ONLY {P.length} AVAILABLE.</p>
          ) : (
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>CHECK</th><th style={{ textAlign: "left" }}>DETAIL</th><th style={{ textAlign: "right" }}>●</th></tr></thead>
              <tbody>
                {pio.checks.map((c) => (
                  <tr key={c.label}>
                    <td><strong>{c.label}</strong></td>
                    <td style={{ fontSize: 12 }}>{c.detail}</td>
                    <td style={{ textAlign: "right" }} className={c.st === "pass" ? "pos" : c.st === "fail" ? "neg" : "faint"}>
                      {c.st === "pass" ? "● PASS" : c.st === "fail" ? "○ FAIL" : "— GAP"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="grid" style={{ gap: 10 }}>
          <div className="panel">
            <p className="p-head">Altman Z — {alt ? `${alt.zScore.toFixed(2)} · ${alt.zone}` : "DATA GAP"}</p>
            {!alt ? (
              <p className="muted">{altGap || "INCOMPLETE LEDGER."}{qErr ? ` QUOTE: ${qErr} ` : ""}{!q && !qErr ? (qLoading ? "PULLING QUOTE…" : "") : ""} {!alt && mcapCr === null && <button className="ghost" style={{ marginLeft: 6 }} onClick={retryQuote}>RETRY QUOTE</button>}</p>
            ) : (
              <table className="plain">
                <thead><tr><th style={{ textAlign: "left" }}>COMP</th><th style={{ textAlign: "right" }}>×WT</th><th style={{ textAlign: "right" }}>VALUE</th><th style={{ textAlign: "right" }}>PTS</th></tr></thead>
                <tbody>
                  {([["X1 WC/TA", 1.2, alt.X1], ["X2 RE/TA", 1.4, alt.X2], ["X3 EBIT/TA", 3.3, alt.X3], ["X4 MCAP/TL", 0.6, alt.X4], ["X5 SALES/TA", 1.0, alt.X5]] as Array<[string, number, number]>).map(([k, w, v]) => (
                    <tr key={k}>
                      <td><strong>{k}</strong></td>
                      <td style={{ textAlign: "right" }} className="faint">{w.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }}>{v.toFixed(3)}</td>
                      <td style={{ textAlign: "right" }} className={w * v >= 0 ? "pos" : "neg"}>{(w * v).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {alt && <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>Z ≥ 2.99 SAFE · 1.81–2.99 GREY · &lt; 1.81 DISTRESS · MCAP {inrCr(mcapCr)}</p>}
          </div>
          <div className="panel">
            <p className="p-head">Beneish M — {ben && isFinite(ben.mScore) ? `${ben.mScore.toFixed(2)} · ${ben.risk}` : "DATA GAP"}</p>
            {!ben ? (
              <p className="muted">NEEDS 2 FY OF LEDGER — ONLY {P.length} AVAILABLE.</p>
            ) : !isFinite(ben.mScore) ? (
              <div>
                <table className="plain">
                  <thead><tr><th style={{ textAlign: "left" }}>VAR</th><th style={{ textAlign: "right" }}>VALUE</th></tr></thead>
                  <tbody>
                    {ben.vars.map((x) => (
                      <tr key={x.k}><td><strong>{x.k}</strong></td><td style={{ textAlign: "right" }}>{x.v === null ? <span className="faint">— GAP</span> : x.v.toFixed(3)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="neg" style={{ fontSize: 12 }}>M NEEDS ALL 8 VARS — FILL GAPS FROM ANNUAL REPORT.</p>
              </div>
            ) : (
              <div>
                <div className="kv"><span className="muted">M-SCORE</span><strong className={ben.cls}>{ben.mScore.toFixed(2)}</strong></div>
                <div className="kv"><span className="muted">RISK</span><strong className={ben.cls}>{ben.risk}</strong></div>
                <div className="kv"><span className="muted">WORST VAR</span><strong>{[...ben.vars].sort((a, b) => Math.abs((b.v ?? 1) - 1) - Math.abs((a.v ?? 1) - 1))[0].k}</strong></div>
                <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>M &gt; −1.78 MANIPULATOR-LIKE · −2.22…−1.78 GREY · &lt; −2.22 CLEAN</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Monte-Carlo DCF / sh — real FCF</p>
          {!dcf ? (
            <p className="muted">NEEDS OCF − CAPEX + SHARES OUT{px === null || sharesCr === null ? " + QUOTE" : ""}. {qErr ? `QUOTE: ${qErr} ` : ""}{qLoading && !q ? "PULLING QUOTE…" : ""}</p>
          ) : dcf.error ? (
            <p className="neg">DCF: {dcf.error} (FCF {inrCr(fcf)} — ASSET-HEAVY / CAPEX CYCLE NAMES OFTEN FAIL HERE).</p>
          ) : (
            <div>
              <table className="plain">
                <thead><tr><th style={{ textAlign: "right" }}>P10</th><th style={{ textAlign: "right" }}>P25</th><th style={{ textAlign: "right" }}>P50</th><th style={{ textAlign: "right" }}>P75</th><th style={{ textAlign: "right" }}>P90</th></tr></thead>
                <tbody><tr>
                  {[dcf.p10, dcf.p25, dcf.p50, dcf.p75, dcf.p90].map((v, i) => (
                    <td key={i} style={{ textAlign: "right" }}>{i === 2 ? <strong className="sec">{inrPx(v)}</strong> : inrPx(v)}</td>
                  ))}
                </tr></tbody>
              </table>
              <div className="kv"><span className="muted">FCF BASE</span><strong>{inrCr(fcf)} · {sharesCr !== null ? `${sharesCr.toFixed(1)} Cr SH` : "—"}</strong></div>
              <div className="kv"><span className="muted">P50 VS PX {inrPx(px)}</span><strong className={upside !== null && upside >= 0 ? "pos" : "neg"}>{upside === null ? "—" : `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`}</strong></div>
              {dcf.histCounts?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <Histogram prebinned={{ counts: dcf.histCounts, edges: dcf.histEdges ?? [] }} height={90} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="panel">
          <p className="p-head">Reverse DCF — what price implies</p>
          {!rdcf || rdcf.error ? (
            <p className="muted">{rdcf?.error ? `REVERSE DCF: ${rdcf.error}.` : "NEEDS LIVE PRICE + POSITIVE FCF + SHARES."} {qErr ? `QUOTE: ${qErr}` : ""}</p>
          ) : (
            <div>
              <div className="kv"><span className="muted">IMPLIED G (5Y)</span><strong>{isFinite(rdcf.impliedGrowthPct) ? `${rdcf.impliedGrowthPct >= 0 ? "+" : ""}${rdcf.impliedGrowthPct.toFixed(1)}% P.A.` : "—"}</strong></div>
              <div className="kv"><span className="muted">VERDICT</span><strong className={rdcf.cssClass}>{rdcf.verdict}</strong></div>
              <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>AT 12% WACC / 4% TERMINAL · &gt;20% = EXPENSIVE · 10–20% FAIR · 0–10% CHEAP</p>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — DUP</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- statement analyser (module 16, stripped) ---------------- */
// The best statement analyser: health score, common-size P&L / BS / CF
// structure, key-ratio sparklines, AI analyst. Nothing else.

export function AnalyzerDesk({ symbol }: { symbol: string }) {
  const { data: st, err: stErr, loading: stLoading } = useStatements(symbol);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.statementAnalyzer() },
        { role: "user", content: `SEC ${symbol}. STRUCTURED P&L/BS/CF + RATIOS ON LEDGER. TASK: 2 STRENGTHS + 2 WEAKNESSES + 3 THINGS TO WATCH. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: unknown) {
      setAiOut(`AI ERR: ${e instanceof Error ? e.message : "fetch failed"}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (stLoading) return <div className="panel"><p className="muted">ANALYSING STATEMENTS FOR {symbol}…</p></div>;
  if (stErr) return <div className="panel"><p className="neg">ANALYSER ERR: {stErr} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!st?.pl) return null;

  const P = st.pl.periods;
  const li = P.length - 1;
  const V = (t: STable | null, cands: string[], i: number): number | null => {
    const v = findRow(t, cands)?.values[i];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const C = (t: STable | null, cands: string[]): (number | null)[] => P.map((_, i) => V(t, cands, i));
  const RR = (label: string): (number | null)[] => st.rat?.rows.find((r) => r.label === label)?.values ?? [];

  // Key series
  const rev = C(st.pl, ["total revenue", "operating revenue"]);
  const net = C(st.pl, ["net income", "net profit"]);
  const ocfS = C(st.cf, ["cash flow from continuing operating activities", "operating cash flow"]);
  const debtS = C(st.bs, ["total debt", "borrowings"]);
  const eqS = C(st.bs, ["stockholders equity", "total equity gross minority interest"]);
  const curA = C(st.bs, ["current assets"]);
  const curL = C(st.bs, ["current liabilities"]);
  const totA = C(st.bs, ["total assets"]);
  const netM = RR("Net Margin %");
  const roeS = RR("ROE %");
  const deS = RR("Debt to Equity x");
  const ocfM = RR("OCF Margin %");
  const revG = RR("Revenue Growth %");

  // ---- Health score /100 ----
  const L = (arr: (number | null)[]) => arr[li];
  let profit = 0, growth = 0, lev = 0, liq = 0, qual = 0;
  const nm = L(netM);
  profit = nm === null ? 0 : nm >= 15 ? 30 : nm >= 10 ? 24 : nm >= 5 ? 16 : nm > 0 ? 8 : 0;
  const rg = L(revG);
  const ng = (() => { const r = RR("Net Income Growth %"); return r[li] ?? null; })();
  growth = (rg !== null && rg > 0 ? 10 : 0) + (rg !== null && rg > 10 ? 4 : 0) + (ng !== null && ng > 0 ? 4 : 0) + (ng !== null && ng > 10 ? 2 : 0);
  const de = L(deS);
  lev = de === null ? 0 : de <= 0.5 ? 20 : de <= 1 ? 14 : de <= 2 ? 8 : 3;
  const cr = L(RR("Current Ratio x"));
  liq = (cr !== null && cr >= 1.5 ? 9 : cr !== null && cr >= 1.2 ? 7 : cr !== null && cr >= 1 ? 4 : 0)
    + (L(ocfM) !== null && L(ocfM)! > 10 ? 6 : L(ocfM) !== null && L(ocfM)! > 0 ? 3 : 0);
  const ocfNi = L(ocfS) !== null && L(net) ? L(ocfS)! / L(net)! : null;
  const accruals = L(net) !== null && L(ocfS) !== null && L(totA) ? ((L(net)! - L(ocfS)!) / L(totA)!) * 100 : null;
  qual = (accruals !== null && Math.abs(accruals) <= 5 ? 9 : accruals !== null && Math.abs(accruals) <= 10 ? 5 : 0)
    + (ocfNi !== null && ocfNi >= 1 ? 6 : ocfNi !== null && ocfNi >= 0.8 ? 3 : 0);
  const total = profit + growth + lev + liq + qual;
  const grade = total >= 90 ? "A+" : total >= 80 ? "A" : total >= 70 ? "B+" : total >= 60 ? "B" : total >= 40 ? "C" : total >= 20 ? "D" : "F";

  // ---- Plain-English reading ----
  const dir = (arr: (number | null)[]): string => {
    const v = arr.filter((x): x is number => x !== null);
    if (v.length < 3) return "mixed";
    const [a, b, c] = v.slice(-3);
    if (c > b && b >= a) return "improving";
    if (c < b && b <= a) return "weakening";
    if (c > b) return "recovering";
    if (c < b) return "softening";
    return "flat";
  };
  const roeL = L(roeS);
  const payoutL = (() => { const r = RR("Dividend Payout %"); return r[li] ?? null; })();
  const parts: Array<[string, number, number]> = [
    ["Profitability", profit, 30], ["Growth", growth, 20], ["Leverage", lev, 20],
    ["Liquidity", liq, 15], ["Quality", qual, 15],
  ];
  const byNorm = [...parts].sort((a, b) => b[1] / b[2] - a[1] / a[2]);
  const f0 = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
  const inr = (v: number | null) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);
  const summary: string[] = [
    `PROFIT: Keeps ₹${nm === null ? "—" : nm.toFixed(1)} of every ₹100 sales · ROE ${f0(roeL)}% · margins ${dir(netM)}.`,
    `GROWTH: Sales ${rg === null ? "—" : `${rg >= 0 ? "+" : ""}${rg.toFixed(1)}%`} · profit ${ng === null ? "—" : `${ng >= 0 ? "+" : ""}${ng.toFixed(1)}%`} last FY${rg !== null && ng !== null ? (rg > 0 && ng > 0 ? " — broad-based" : rg > 0 ? " — sales without profit" : " — shrinking") : ""}.`,
    `BALANCE: ${inr(L(debtS))} debt vs ${inr(L(eqS))} equity (D/E ${f0(de, 2)}x, comfort < 1x) · current ${f0(cr, 2)}x (healthy ≥ 1.2x).`,
    `CASH: OCF ${inr(L(ocfS))} covers profit ${ocfNi === null ? "—" : `${ocfNi.toFixed(2)}x`} (≥1x = cash-backed) · accruals ${accruals === null ? "—" : `${accruals.toFixed(1)}%`} (|x| < 5% clean)${payoutL !== null ? ` · pays out ${payoutL.toFixed(0)}%` : ""}.`,
    `VERDICT: Grade ${grade} (${total}/100) — strongest ${byNorm[0][0].toLowerCase()} (${byNorm[0][1]}/${byNorm[0][2]}), weakest ${byNorm[byNorm.length - 1][0].toLowerCase()} (${byNorm[byNorm.length - 1][1]}/${byNorm[byNorm.length - 1][2]}).`,
  ];

  // ---- Common-size tables (latest FY vs prior) ----
  const pctOf = (num: (number | null)[], den: (number | null)[], i: number) =>
    num[i] !== null && den[i] ? (num[i]! / den[i]!) * 100 : null;
  const f1 = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
  const plRows: Array<[string, (number | null)[], (v: number | null) => string]> = [
    ["Total Revenue", rev, (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Cost of Revenue", C(st.pl, ["reconciled cost of revenue", "cost of revenue"]), (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Gross Profit", C(st.pl, ["gross profit"]), (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Operating Income", C(st.pl, ["operating income", "total operating income"]), (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Interest Expense", C(st.pl, ["interest expense"]), (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Pretax Income", C(st.pl, ["pretax income"]), (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
    ["Net Income", net, (v) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`)],
  ];
  const bsTot = totA;
  const bsRows: Array<[string, (number | null)[]]> = [
    ["Current Assets", curA],
    ["Inventory", C(st.bs, ["inventory"])],
    ["Receivables", C(st.bs, ["gross accounts receivable", "accounts receivable", "receivables"])],
    ["Cash & Equivalents", C(st.bs, ["cash and cash equivalents", "cash equivalents", "cash"])],
    ["Net PPE", C(st.bs, ["net ppe"])],
    ["Current Liabilities", curL],
    ["Total Debt", debtS],
    ["Stockholders Equity", eqS],
    ["Retained Earnings", C(st.bs, ["retained earnings"])],
  ];

  const shortP = P.map((p) => p.replace("Mar ", "'"));
  const x3: [string, string, string] = [shortP[0] ?? "", shortP[Math.floor(shortP.length / 2)] ?? "", shortP[shortP.length - 1] ?? ""];

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{st.name} — financial health · FY {P[li]}</p>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Score</div><div className={`val ${total >= 70 ? "pos" : total < 40 ? "neg" : ""}`} style={{ fontSize: 20 }}>{total}/100</div><div className="sub">grade {grade}</div></div>
          <div className="cell"><div className="lbl">Profitability</div><div className="val">{profit}/30</div><div className="sub">elite &gt;15% · ok &gt;5%</div></div>
          <div className="cell"><div className="lbl">Growth</div><div className="val">{growth}/20</div><div className="sub">rev {rg === null ? "—" : `${rg.toFixed(1)}%`} · net {ng === null ? "—" : `${ng.toFixed(1)}%`}</div></div>
          <div className="cell"><div className="lbl">Leverage</div><div className="val">{lev}/20</div><div className="sub">comfort &lt;1.0x</div></div>
          <div className="cell"><div className="lbl">Liquidity</div><div className="val">{liq}/15</div><div className="sub">healthy ≥1.2x</div></div>
          <div className="cell"><div className="lbl">Quality</div><div className="val">{qual}/15</div><div className="sub">clean |acc| &lt;5%</div></div>
        </div>
        <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>WEIGHTS 30·20·20·15·15 — SINGLE-YEAR SNAPSHOT, TRENDS BELOW MATTER MORE.</p>
        <div style={{ marginTop: 10 }}>
          <HBars rows={[
            { label: "PROFITABILITY", value: profit, display: `${profit}/30`, color: "#00d664" },
            { label: "GROWTH", value: growth, display: `${growth}/20`, color: "#00c8ff" },
            { label: "LEVERAGE", value: lev, display: `${lev}/20`, color: "#ffa028" },
            { label: "LIQUIDITY", value: liq, display: `${liq}/15`, color: "#8f7bff" },
            { label: "QUALITY", value: qual, display: `${qual}/15`, color: "#ff453a" },
          ]} />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Analyst summary — what the numbers say</p>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          {summary.map((s) => (
            <div key={s.slice(0, 12)}><span style={{ color: "var(--amber)" }}>▸ </span>{s}</div>
          ))}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">P&L structure — common size (% of revenue)</p>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>LINE</th><th style={{ textAlign: "right" }}>{P[li - 1] ?? ""}</th><th style={{ textAlign: "right" }}>{P[li]}</th></tr></thead>
            <tbody>
              {plRows.map(([label, arr, fmt]) => (
                <tr key={label}>
                  <td><strong>{label}</strong><div className="faint" style={{ fontSize: 10.5 }}>{label === "Total Revenue" ? "base 100%" : f1(pctOf(arr, rev, li)) + " of sales"}</div></td>
                  <td style={{ textAlign: "right" }} className="muted">{arr[li - 1] === null || arr[li - 1] === undefined ? "—" : fmt(arr[li - 1])}</td>
                  <td style={{ textAlign: "right" }}>{arr[li] === null || arr[li] === undefined ? "—" : fmt(arr[li])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>READ: EVERY LINE AS % OF SALES — WATCH COGS CREEP AND TAX DRIFT BETWEEN YEARS.</p>
        </div>
        <div className="panel">
          <p className="p-head">Balance structure — common size (% of assets)</p>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>LINE</th><th style={{ textAlign: "right" }}>{P[li - 1] ?? ""}</th><th style={{ textAlign: "right" }}>{P[li]}</th></tr></thead>
            <tbody>
              <tr><td><strong>Total Assets</strong><div className="faint" style={{ fontSize: 10.5 }}>base 100%</div></td>
                <td style={{ textAlign: "right" }} className="muted">{bsTot[li - 1] == null ? "—" : `₹${Math.round(bsTot[li - 1]!).toLocaleString("en-IN")} Cr`}</td>
                <td style={{ textAlign: "right" }}>{bsTot[li] == null ? "—" : `₹${Math.round(bsTot[li]!).toLocaleString("en-IN")} Cr`}</td></tr>
              {bsRows.map(([label, arr]) => (
                <tr key={label}>
                  <td><strong>{label}</strong><div className="faint" style={{ fontSize: 10.5 }}>{f1(pctOf(arr, bsTot, li))} of assets</div></td>
                  <td style={{ textAlign: "right" }} className="muted">{arr[li - 1] == null ? "—" : `₹${Math.round(arr[li - 1]!).toLocaleString("en-IN")} Cr`}</td>
                  <td style={{ textAlign: "right" }}>{arr[li] == null ? "—" : `₹${Math.round(arr[li]!).toLocaleString("en-IN")} Cr`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>READ: EVERY LINE AS % OF ASSETS — RISING RECEIVABLE/INVENTORY % CAN PRECEDE WRITE-DOWNS.</p>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Cash structure — ₹ Cr + share of revenue</p>
        <GroupedBars
          periods={P}
          fmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          series={[
            { label: "OCF", color: "#00d664", values: ocfS },
            { label: "FCF", color: "#ffa028", values: C(st.cf, ["free cash flow"]) },
            { label: "CAPEX", color: "#ff453a", values: C(st.cf, ["capital expenditure", "capital expenditure reported"]) },
          ]}
        />
        <p className="faint" style={{ fontSize: 11, marginBottom: 0 }}>HEALTHY: OCF COVERS PROFIT AND CAPEX THROUGH THE CYCLE — FCF SHOULD STAY POSITIVE.</p>
      </div>

      <div className="grid grid-2">
        {[
          { t: "ROE % — spark", s: [{ label: "ROE", color: "#ffa028", values: roeS }], f: (v: number) => `${v.toFixed(1)}%` },
          { t: "Net margin % — spark", s: [{ label: "NPM", color: "#00d664", values: netM }], f: (v: number) => `${v.toFixed(1)}%` },
          { t: "Debt to equity x — spark", s: [{ label: "D/E", color: "#ff453a", values: deS }], f: (v: number) => `${v.toFixed(2)}x` },
          { t: "OCF margin % — spark", s: [{ label: "OCFM", color: "#00c8ff", values: ocfM }], f: (v: number) => `${v.toFixed(1)}%` },
        ].map((c) => (
          <div className="panel" key={c.t}>
            <p className="p-head">{c.t}</p>
            <LineChart dates={P} xLabels={x3} height={70} yFmt={c.f} series={c.s} />
          </div>
        ))}
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — SA</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- historical desk (module 20, stripped) ---------------- */
// Advanced 4-year history: everything the company did — story table, CAGRs,
// growth/profit/balance/cash arcs, capital allocation, per-year narratives.

export function HistoryDesk({ symbol }: { symbol: string }) {
  const { data: st, err: stErr, loading: stLoading } = useStatements(symbol);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const f = (v: number | null) => (v === null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
      const txt = await chatComplete([
        { role: "system", content: aiSystem.historian() },
        {
          role: "user",
          content: `SEC ${symbol}. 4Y ${P[0]}→${P[P.length - 1]}: REV CAGR ${f(cagr(rev))} NET CAGR ${f(cagr(net))} OCF CAGR ${f(cagr(ocfS))} ` +
            `LATEST NPM ${npmS[npmS.length - 1] === null || npmS[npmS.length - 1] === undefined ? "?" : `${npmS[npmS.length - 1]!.toFixed(1)}%`} ` +
            `ROE ${roeS[roeS.length - 1] === null || roeS[roeS.length - 1] === undefined ? "?" : `${roeS[roeS.length - 1]!.toFixed(1)}%`} ` +
            `DE ${deS[deS.length - 1] === null || deS[deS.length - 1] === undefined ? "?" : `${deS[deS.length - 1]!.toFixed(2)}x`} ` +
            `ALLOC 4Y OCF ${inr(sum(ocfS))} CAPEX ${inr(Math.abs(sum(capexS)))} DIV ${inr(Math.abs(sum(divS)))}. ` +
            `TASK: WHAT CHANGED + WHAT IT MEANS + WHAT TO WATCH NEXT. ${NO_INVENT}`,
        },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: unknown) {
      setAiOut(`AI ERR: ${e instanceof Error ? e.message : "fetch failed"}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (stLoading) return <div className="panel"><p className="muted">BUILDING 4-YEAR HISTORY FOR {symbol}…</p></div>;
  if (stErr) return <div className="panel"><p className="neg">HISTORY ERR: {stErr} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!st?.pl) return null;

  const Pall = st.pl.periods;
  const P = Pall.slice(-4); // last 4 fiscal years
  const off = Pall.length - P.length;
  const V = (t: STable | null, cands: string[], j: number): number | null => {
    const v = findRow(t, cands)?.values[off + j];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const C = (t: STable | null, cands: string[]): (number | null)[] => P.map((_, j) => V(t, cands, j));
  const RR = (label: string): (number | null)[] => {
    const rows = st.rat?.rows.find((r) => r.label === label)?.values ?? [];
    return P.map((_, j) => rows[off + j] ?? null);
  };

  const rev = C(st.pl, ["total revenue", "operating revenue"]);
  const gp = C(st.pl, ["gross profit"]);
  const opI = C(st.pl, ["operating income", "total operating income"]);
  const net = C(st.pl, ["net income", "net profit"]);
  const ocfS = C(st.cf, ["cash flow from continuing operating activities", "operating cash flow"]);
  const fcfS = C(st.cf, ["free cash flow"]);
  const capexS = C(st.cf, ["capital expenditure", "capital expenditure reported"]);
  const divS = C(st.cf, ["cash dividends paid", "common stock dividend paid"]);
  const assets = C(st.bs, ["total assets"]);
  const debt = C(st.bs, ["total debt", "borrowings"]);
  const equity = C(st.bs, ["stockholders equity", "total equity gross minority interest"]);
  const roeS = RR("ROE %");
  const npmS = RR("Net Margin %");
  const deS = RR("Debt to Equity x");
  const epsS = RR("Diluted EPS Rs");
  const dpsS = RR("Dividend Per Share Rs");
  const revG = RR("Revenue Growth %");
  const netG = RR("Net Income Growth %");

  const cagr = (arr: (number | null)[]): number | null => {
    const f = arr.filter((x): x is number => x !== null);
    if (f.length < 2) return null;
    const a = f[0], b = f[f.length - 1];
    if (a <= 0 || b <= 0) return null;
    return (Math.pow(b / a, 1 / (f.length - 1)) - 1) * 100;
  };
  const sum = (arr: (number | null)[]): number => arr.reduce<number>((s, v) => s + (v ?? 0), 0);
  const last2 = (arr: (number | null)[]): [number | null, number | null] => {
    const f = arr.map((v, i) => ({ v, i })).filter((x) => x.v !== null);
    if (f.length < 1) return [null, null];
    if (f.length < 2) return [null, f[f.length - 1].v];
    return [f[f.length - 2].v, f[f.length - 1].v];
  };
  const yoyLast = (arr: (number | null)[]): number | null => {
    const [p, c] = last2(arr);
    if (p === null || c === null || !p) return null;
    return ((c - p) / Math.abs(p)) * 100;
  };
  // Growth-quality verdict from the three CAGRs.
  const revC = cagr(rev), netC = cagr(net), ocfC = cagr(ocfS);
  const arc = revC === null || netC === null
    ? { t: "DATA GAP", cls: "" }
    : netC > revC && revC > 0
      ? { t: "MARGIN EXPANSION — PROFIT OUTGREW SALES", cls: "pos" }
      : revC > 0 && netC <= 0
        ? { t: "MARGIN SQUEEZE — SALES UP, PROFIT DOWN", cls: "neg" }
        : ocfC !== null && netC > 0 && ocfC <= 0
          ? { t: "CASH LAGGED PROFIT — WATCH RECEIVABLES", cls: "neg" }
          : revC > 10 && netC > 10
            ? { t: "BROAD-BASED GROWTH", cls: "pos" }
            : { t: "MIXED ARC — READ YEAR NOTES", cls: "" };
  const L = (arr: (number | null)[]) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i] as number;
    return null;
  };
  const fcfConv = sum(ocfS) !== 0 ? (sum(fcfS) / sum(ocfS)) * 100 : null;
  const payout = sum(net) !== 0 ? (Math.abs(sum(divS)) / Math.abs(sum(net))) * 100 : null;
  const f1 = (v: number | null, suf = "") => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suf}`);
  const inr = (v: number | null) => (v === null ? "—" : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);

  const shortP = P.map((p) => p.replace("Mar ", "'"));
  const x3: [string, string, string] = [shortP[0] ?? "", shortP[Math.floor(shortP.length / 2)] ?? "", shortP[shortP.length - 1] ?? ""];
  const crF = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // Capital allocation over the window
  const ocfTot = sum(ocfS), capexTot = Math.abs(sum(capexS)), divTot = Math.abs(sum(divS));
  const dLast: number | null = debt.length ? debt[debt.length - 1] as number | null : null;
  const dFirst: number | null = debt.length ? (debt[0] as number | null) : null;
  const eLast: number | null = equity.length ? equity[equity.length - 1] as number | null : null;
  const eFirst: number | null = equity.length ? (equity[0] as number | null) : null;
  const debtChg: number | null = dLast !== null && dFirst !== null ? dLast - dFirst : null;
  const eqChg: number | null = eLast !== null && eFirst !== null ? eLast - eFirst : null;

  // Per-year narratives
  const stories = P.map((p, j) => {
    const bits: string[] = [];
    const rj: number | null = rev[j] as number | null;
    const nj: number | null = net[j] as number | null;
    const oj: number | null = ocfS[j] as number | null;
    if (j > 0) {
      const rgj: number | null = revG[j] as number | null;
      const ngj: number | null = netG[j] as number | null;
      if (rgj !== null) bits.push(`sales ${rgj >= 0 ? "+" : ""}${rgj.toFixed(1)}%`);
      if (ngj !== null) bits.push(`profit ${ngj >= 0 ? "+" : ""}${ngj.toFixed(1)}%`);
    } else bits.push(`base year ${inr(rj)} sales`);
    const nmj: number | null = npmS[j] as number | null;
    if (nmj !== null) bits.push(`kept ₹${nmj.toFixed(1)} per ₹100`);
    if (oj !== null && nj) bits.push(oj >= nj ? "cash-backed" : "cash lagged profit");
    if (j > 0) {
      const dj: number | null = debt[j] as number | null;
      const dp: number | null = debt[j - 1] as number | null;
      if (dj !== null && dp !== null) {
        const d = dj - dp;
        if (Math.abs(d) > 1) bits.push(d > 0 ? `borrowed +${inr(d)}` : `repaid ${inr(Math.abs(d))}`);
      }
    }
    const dj2: number | null = dpsS[j] as number | null;
    if (dj2) bits.push(`DPS ₹${dj2.toFixed(1)}`);
    return { p, text: bits.join(" · ") };
  });

  const storyRows: Array<[string, (number | null)[], (v: number | null) => string]> = [
    ["Revenue ₹ Cr", rev, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["Net Income ₹ Cr", net, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["OCF ₹ Cr", ocfS, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["FCF ₹ Cr", fcfS, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["Assets ₹ Cr", assets, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["Debt ₹ Cr", debt, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["Equity ₹ Cr", equity, (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"))],
    ["EPS ₹", epsS, (v) => (v === null ? "—" : v.toFixed(1))],
    ["ROE %", roeS, (v) => (v === null ? "—" : v.toFixed(1))],
    ["D/E x", deS, (v) => (v === null ? "—" : v.toFixed(2))],
  ];

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{st.name} — 4-year story · {P[0]} → {P[P.length - 1]}</p>
        <div className="cells" style={{ marginBottom: 10 }}>
          <div className="cell"><div className="lbl">Revenue</div><div className="val" style={{ fontSize: 15 }}>{inr(L(rev))}</div><div className="sub">CAGR {f1(revC, "%")}</div></div>
          <div className="cell"><div className="lbl">Net income</div><div className="val" style={{ fontSize: 15 }}>{inr(L(net))}</div><div className="sub">CAGR {f1(netC, "%")}</div></div>
          <div className="cell"><div className="lbl">OCF / FCF</div><div className="val" style={{ fontSize: 15 }}>{inr(L(ocfS))} / {inr(L(fcfS))}</div><div className="sub">conv {fcfConv === null ? "—" : `${fcfConv.toFixed(0)}%`}</div></div>
          <div className="cell"><div className="lbl">ROE</div><div className={`val ${ (L(roeS) ?? 0) >= 15 ? "pos" : ""}`} style={{ fontSize: 15 }}>{L(roeS) === null ? "—" : `${L(roeS)!.toFixed(1)}%`}</div><div className="sub">D/E {L(deS) === null ? "—" : `${L(deS)!.toFixed(2)}x`}</div></div>
          <div className="cell"><div className="lbl">EPS</div><div className="val" style={{ fontSize: 15 }}>{L(epsS) === null ? "—" : `₹${L(epsS)!.toFixed(1)}`}</div><div className="sub">diluted</div></div>
          <div className="cell"><div className="lbl">Arc</div><div className={`val ${arc.cls}`} style={{ fontSize: 12 }}>{arc.t}</div><div className="sub">rev {f1(revC, "%")} · net {f1(netC, "%")}</div></div>
        </div>
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>LINE</th>{shortP.map((p) => <th key={p} style={{ textAlign: "right" }}>{p}</th>)}<th style={{ textAlign: "right" }}>YOY</th><th style={{ textAlign: "right", color: "var(--amber)" }}>4Y CAGR</th></tr></thead>
            <tbody>
              {storyRows.map(([label, arr, fmt]) => (
                <tr key={label}>
                  <td><strong>{label}</strong></td>
                  {arr.map((v, j) => <td key={j} style={{ textAlign: "right" }}>{fmt(v)}</td>)}
                  <td style={{ textAlign: "right" }}>{(() => { const y = yoyLast(arr); return <span className={y !== null && y >= 0 ? "pos" : "neg"}>{f1(y, "%")}</span>; })()}</td>
                  <td style={{ textAlign: "right" }}>{(() => { const c = cagr(arr); return <span className={c !== null && c >= 0 ? "pos" : "neg"}>{f1(c, "%")}</span>; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>— = NOT REPORTED FOR THAT FY ON YAHOO · CAGR USES FIRST→LAST AVAILABLE</p>
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Growth engine — YoY %</p>
          <GroupedBars
            periods={P}
            fmt={(v) => `${v.toFixed(1)}%`}
            series={[
              { label: "REV", color: "#00d664", values: revG },
              { label: "NET", color: "#ffa028", values: netG },
              { label: "OCF", color: "#00c8ff", values: RR("OCF Growth %") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Profitability arc — margins + returns %</p>
          <LineChart
            dates={P} xLabels={x3} yFmt={(v) => `${v.toFixed(1)}%`}
            series={[
              { label: "NPM", color: "#00d664", values: npmS },
              { label: "ROE", color: "#ffa028", values: roeS },
              { label: "ROCE", color: "#00c8ff", values: RR("ROCE %") },
            ]}
          />
        </div>
      </div>

      <div className="duo">
        <div className="panel">
          <p className="p-head">Balance evolution — ₹ Cr</p>
          <GroupedBars periods={P} fmt={crF} series={[
            { label: "ASSETS", color: "#00d664", values: assets },
            { label: "DEBT", color: "#ff453a", values: debt },
            { label: "EQUITY", color: "#8f7bff", values: equity },
          ]} />
        </div>
        <div className="panel">
          <p className="p-head">Cash journey — ₹ Cr</p>
          <GroupedBars periods={P} fmt={crF} series={[
            { label: "OCF", color: "#00d664", values: ocfS },
            { label: "FCF", color: "#ffa028", values: fcfS },
            { label: "CAPEX", color: "#ff453a", values: capexS },
          ]} />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Capital allocation — where 4 years of cash went (₹ Cr totals)</p>
        <HBars rows={[
          { label: "OCF GENERATED", value: ocfTot, display: inr(ocfTot), color: "#00d664" },
          { label: "CAPEX SPENT", value: capexTot, display: inr(capexTot), color: "#ff453a" },
          { label: "DIVIDENDS PAID", value: divTot, display: inr(divTot), color: "#ffa028" },
          { label: "NET DEBT CHANGE", value: debtChg ?? 0, display: debtChg === null ? "—" : `${debtChg >= 0 ? "+" : ""}${inr(Math.abs(debtChg))}${debtChg >= 0 ? " borrowed" : " repaid"}`, color: "#8f7bff" },
          { label: "EQUITY BUILT", value: eqChg ?? 0, display: eqChg === null ? "—" : `${eqChg >= 0 ? "+" : ""}${inr(Math.abs(eqChg))}`, color: "#00c8ff" },
        ]} />
        <div className="kv" style={{ marginTop: 8 }}><span className="muted">FCF CONVERSION (4Y FCF/OCF)</span><strong className={fcfConv !== null && fcfConv >= 50 ? "pos" : fcfConv !== null && fcfConv < 0 ? "neg" : ""}>{fcfConv === null ? "—" : `${fcfConv.toFixed(0)}%`}</strong></div>
        <div className="kv"><span className="muted">PAYOUT (4Y DIV/PROFIT)</span><strong>{payout === null || !isFinite(payout) ? "—" : `${payout.toFixed(0)}%`}</strong></div>
      </div>

      <div className="panel">
        <p className="p-head">Year by year — what the company did</p>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          {stories.map((s) => (
            <div key={s.p}><strong style={{ color: "var(--amber)" }}>{s.p}</strong><span className="faint"> — </span>{s.text}</div>
          ))}
        </div>
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — HI</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- forensic desk (module 15, stripped) ---------------- */
// Advanced forensic analyser computed from the REAL Yahoo ledger —
// Beneish 8-variable, Altman, Piotroski, Sloan accruals, growth
// divergences, and an auto-generated red-flag board. No price charts.

export function ForensicDesk({ symbol }: { symbol: string }) {
  const { data: st, err: stErr, loading: stLoading } = useStatements(symbol);
  const { q: coQ } = useCompany(symbol);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.forensic() },
        { role: "user", content: `SEC ${symbol}. BENEISH/ALTMAN/PIOTROSKI + ACCRUALS + DIVERGENCES ON LEDGER. TASK: TOP 3 MANIPULATION RISKS + WHAT TO VERIFY IN ANNUAL REPORT. CONSERVATIVE — FLAG, DON'T ACCUSE. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: unknown) {
      setAiOut(`AI ERR: ${e instanceof Error ? e.message : "fetch failed"}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (stLoading) return <div className="panel"><p className="muted">RUNNING FORENSICS FOR {symbol}…</p></div>;
  if (stErr) return <div className="panel"><p className="neg">FORENSIC ERR: {stErr} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!st?.pl) return null;

  const P = st.pl.periods;
  const AV = (t: STable | null, cands: string[], i: number): number | null => {
    const r = findRow(t, cands);
    const v = r?.values[i];
    return typeof v === "number" && isFinite(v) ? v : null;
  };
  const S = (t: STable | null, cands: string[]): (number | null)[] =>
    P.map((_, i) => AV(t, cands, i));
  const dv = (a: number | null, b: number | null) =>
    a === null || b === null || !b ? null : a / b;

  // Ledger series (₹ Cr)
  const rev = S(st.pl, ["total revenue", "operating revenue"]);
  const recv = S(st.bs, ["gross accounts receivable", "accounts receivable", "receivables"]);
  const cogs = S(st.pl, ["reconciled cost of revenue", "cost of revenue"]);
  const gprof = S(st.pl, ["gross profit"]);
  const sga = S(st.pl, ["selling general and administration", "selling and marketing expense"]);
  const dep = S(st.pl, ["reconciled depreciation", "depreciation and amortization", "depreciation"]);
  const ca = S(st.bs, ["current assets"]);
  const ppe = S(st.bs, ["net ppe", "gross ppe"]);
  const cl = S(st.bs, ["current liabilities"]);
  const ltd = S(st.bs, ["long term debt", "long term debt and capital lease obligation"]);
  const curDebt = S(st.bs, ["current debt", "current debt and capital lease obligation"]);
  const totL = S(st.bs, ["total liabilities net minority interest", "total liabilities"]);
  const totA = S(st.bs, ["total assets"]);
  const ni = S(st.pl, ["net income", "net income common stockholders"]);
  const ocfA = S(st.cf, ["cash flow from continuing operating activities", "operating cash flow"]);
  const ebitA = S(st.pl, ["ebit"]);
  const retE = S(st.bs, ["retained earnings"]);
  const wcA = S(st.bs, ["working capital"]);
  const invA = S(st.bs, ["inventory"]);
  const capexA = S(st.cf, ["capital expenditure", "capital expenditure reported"]);
  const sharesA = S(st.pl, ["basic average shares", "diluted average shares"]);
  const mcap = coQ?.quote?.marketCap ?? coQ?.profile?.valuation?.mktCap ?? null;

  const n = P.length;
  const idx = P.map((_, i) => i).slice(1); // needs prior year

  // ---- Beneish per period ----
  interface BV { dsri: number | null; gmi: number | null; aqi: number | null; sgi: number | null; depi: number | null; sgai: number | null; tata: number | null; lvgi: number | null; m: number | null }
  const ben: (BV | null)[] = P.map((_, i) => {
    if (i === 0) return null;
    const p = i - 1;
    const dsri = dv(dv(recv[i], rev[i]), dv(recv[p], rev[p]));
    const gmC = rev[i] && cogs[i] !== null ? (rev[i]! - cogs[i]!) / rev[i]! : null;
    const gmP = rev[p] && cogs[p] !== null ? (rev[p]! - cogs[p]!) / rev[p]! : null;
    const gmi = dv(gmP, gmC);
    const aqC = totA[i] && ca[i] !== null && ppe[i] !== null ? 1 - (ca[i]! + ppe[i]!) / totA[i]! : null;
    const aqP = totA[p] && ca[p] !== null && ppe[p] !== null ? 1 - (ca[p]! + ppe[p]!) / totA[p]! : null;
    const aqi = dv(aqC, aqP);
    const sgi = dv(rev[i], rev[p]);
    const depR = (d: number | null, pp: number | null) => (d !== null && pp !== null && pp + d ? d / (pp + d) : null);
    const depi = dv(depR(dep[p], ppe[p]), depR(dep[i], ppe[i]));
    const sgai = dv(dv(sga[i], rev[i]), dv(sga[p], rev[p]));
    const tata = totA[i] && ni[i] !== null && ocfA[i] !== null ? (ni[i]! - ocfA[i]!) / totA[i]! : null;
    const lev = (c: number | null, l: number | null, a: number | null) => (c !== null && l !== null && a ? (c + l) / a : null);
    const lvgi = dv(lev(cl[i], ltd[i], totA[i]), lev(cl[p], ltd[p], totA[p]));
    const parts = [dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi];
    if (parts.some((v) => v === null)) return { dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi, m: null };
    const m = calcBeneish({ dsri: dsri!, gmi: gmi!, aqi: aqi!, sgi: sgi!, depi: depi!, sgai: sgai!, tata: tata!, lvgi: lvgi! }).mScore;
    return { dsri, gmi, aqi, sgi, depi, sgai, tata, lvgi, m };
  });
  const mSeries = ben.map((b) => (b?.m === null || b?.m === undefined ? null : Math.round(b.m * 100) / 100));
  const bL = ben[n - 1];
  const mL = bL?.m ?? null;
  const mZone = mL === null ? "NO DATA" : mL > -1.78 ? "HIGH MANIPULATION RISK" : mL > -2.22 ? "GREY ZONE" : "LOW RISK";

  // ---- Altman per period (X4 needs market cap — latest only if quote missing history) ----
  const zSeries = P.map((_, i) => {
    const wc = wcA[i] ?? (ca[i] !== null && cl[i] !== null ? ca[i]! - cl[i]! : null);
    if (wc === null || !totA[i] || retE[i] === null || ebitA[i] === null || !totL[i] || !rev[i] || !mcap) return null;
    return calcAltmanZ({
      niC: ni[i] ?? 0, retainedC: retE[i]!, ebitC: ebitA[i]!,
      workingCapital: wc, totalAssets: totA[i]!, totalLiab: totL[i]!,
      revenueC: rev[i]!, marketCap: mcap,
    }).zScore;
  });
  const zL = zSeries[n - 1];
  const zZone = zL === null ? "NO DATA" : zL >= 2.99 ? "SAFE ZONE" : zL >= 1.81 ? "GREY ZONE" : "DISTRESS ZONE";

  // ---- Piotroski real: latest + trend ----
  const pScore = (i: number): { score: number; checks: any[] } | null => {
    if (i === 0) return null;
    const p = i - 1;
    const g = (arr: (number | null)[], k: number) => arr[k];
    const req = [ni[i], ni[p], ocfA[i], totA[i], totA[p], ca[i], ca[p], cl[i], cl[p], ltd[i], ltd[p], rev[i], rev[p], gprof[i], gprof[p], sharesA[i], sharesA[p]];
    if (req.some((v) => v === null)) return null;
    return calcPiotroski({
      niC: ni[i]!, niP: ni[p]!, cfoC: ocfA[i]!,
      assetsC: totA[i]!, assetsP: totA[p]!,
      caC: ca[i]!, caP: ca[p]!, clC: cl[i]!, clP: cl[p]!,
      ltdC: ltd[i]!, ltdP: ltd[p]!,
      revC: rev[i]!, revP: rev[p]!, gpC: gprof[i]!, gpP: gprof[p]!,
      sharesC: sharesA[i]!, sharesP: sharesA[p]!,
    });
  };
  const pLat = pScore(n - 1);
  const pTrend = P.map((_, i) => (i === 0 ? null : pScore(i)?.score ?? null));

  // ---- Sloan accruals + quality ----
  const accruals = P.map((_, i) => (ni[i] !== null && ocfA[i] !== null && totA[i] ? ((ni[i]! - ocfA[i]!) / totA[i]!) * 100 : null));
  const ocfNi = P.map((_, i) => (ocfA[i] !== null && ni[i] ? ocfA[i]! / ni[i]! : null));
  const revG = P.map((_, i) => (i === 0 || !rev[i - 1] ? null : ((rev[i]! - rev[i - 1]!) / Math.abs(rev[i - 1]!)) * 100));
  const recvG = P.map((_, i) => (i === 0 || !recv[i - 1] ? null : ((recv[i]! - recv[i - 1]!) / Math.abs(recv[i - 1]!)) * 100));
  const invG = P.map((_, i) => (i === 0 || !invA[i - 1] ? null : ((invA[i]! - invA[i - 1]!) / Math.abs(invA[i - 1]!)) * 100));

  // ---- Red-flag board ----
  interface Flag { label: string; detail: string; sev: "red" | "amber" | "green" }
  const flags: Flag[] = [];
  const push = (label: string, detail: string, sev: Flag["sev"]) => flags.push({ label, detail, sev });
  const r2 = (v: number | null) => (v === null ? "—" : v.toFixed(2));
  if (mL !== null) push("Beneish M", `M = ${mL.toFixed(2)} (${mZone})`, mL > -1.78 ? "red" : mL > -2.22 ? "amber" : "green");
  if (zL !== null) push("Altman Z", `Z = ${zL.toFixed(2)} (${zZone})`, zL < 1.81 ? "red" : zL < 2.99 ? "amber" : "green");
  if (pLat) push("Piotroski F", `${pLat.score}/9 ${pLat.score >= 7 ? "STRONG" : pLat.score >= 4 ? "AVERAGE" : "WEAK"}`, pLat.score >= 7 ? "green" : pLat.score >= 4 ? "amber" : "red");
  const accL = accruals[n - 1];
  if (accL !== null) push("Sloan Accruals", `(NI−OCF)/TA = ${accL.toFixed(1)}%`, Math.abs(accL) > 10 ? "red" : Math.abs(accL) > 5 ? "amber" : "green");
  const ocfNiL = ocfNi[n - 1];
  if (ocfNiL !== null) push("Cash Conversion", `OCF/NI = ${ocfNiL.toFixed(2)}x`, ocfNiL < 0.8 ? "red" : ocfNiL < 1 ? "amber" : "green");
  const dsriL = bL?.dsri ?? null;
  if (dsriL !== null) push("DSRI", `DSRI = ${r2(dsriL)}`, dsriL > 1.2 ? "red" : dsriL > 1.05 ? "amber" : "green");
  const tataL = bL?.tata ?? null;
  if (tataL !== null) push("TATA", `TATA = ${r2(tataL)}`, Math.abs(tataL) > 0.05 ? "red" : Math.abs(tataL) > 0.02 ? "amber" : "green");
  const rgL = revG[n - 1], rcgL = recvG[n - 1];
  if (rgL !== null && rcgL !== null) {
    const gap = rcgL - rgL;
    push("Sales vs Receivables", `REV ${rgL.toFixed(1)}% vs RECV ${rcgL.toFixed(1)}% (gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}pp)`, gap > 10 ? "red" : gap > 5 ? "amber" : "green");
  }
  const igL = invG[n - 1];
  if (igL !== null && rgL !== null) {
    const gap = igL - rgL;
    push("Sales vs Inventory", `REV ${rgL.toFixed(1)}% vs INV ${igL.toFixed(1)}% (gap ${gap >= 0 ? "+" : ""}${gap.toFixed(1)}pp)`, gap > 15 ? "red" : gap > 8 ? "amber" : "green");
  }
  const lvgiL = bL?.lvgi ?? null;
  if (lvgiL !== null) push("Leverage Shift (LVGI)", `LVGI = ${r2(lvgiL)}`, lvgiL > 1.1 ? "amber" : "green");
  const reds = flags.filter((f) => f.sev === "red").length;
  const ambers = flags.filter((f) => f.sev === "amber").length;
  const verdict = reds > 0 ? "HIGH RISK" : ambers > 1 ? "MODERATE RISK" : "LOW RISK";
  const verdictCls = reds > 0 ? "neg" : ambers > 1 ? "" : "pos";

  const shortP = P.map((p) => p.replace("Mar ", "'"));
  const x3: [string, string, string] = [shortP[0] ?? "", shortP[Math.floor(shortP.length / 2)] ?? "", shortP[shortP.length - 1] ?? ""];
  const varRow = (label: string, get: (b: BV | null) => number | null | undefined, thresh: string) => {
    const v = bL ? get(bL) : null;
    return [label, v === null || v === undefined ? "—" : v.toFixed(3), thresh];
  };

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{st.name} — forensic verdict · FY {P[n - 1]} · real ledger</p>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Verdict</div><div className={`val ${verdictCls}`} style={{ fontSize: 16 }}>{verdict}</div><div className="sub">{reds} red · {ambers} amber</div></div>
          <div className="cell"><div className="lbl">Beneish M</div><div className={`val ${mL !== null && mL > -1.78 ? "neg" : "pos"}`}>{mL === null ? "—" : mL.toFixed(2)}</div><div className="sub">{mZone}</div></div>
          <div className="cell"><div className="lbl">Altman Z</div><div className={`val ${zL !== null && zL < 1.81 ? "neg" : ""}`}>{zL === null ? "—" : zL.toFixed(2)}</div><div className="sub">{zZone}</div></div>
          <div className="cell"><div className="lbl">Piotroski F</div><div className={`val ${(pLat?.score ?? 0) >= 7 ? "pos" : (pLat?.score ?? 0) < 4 ? "neg" : ""}`}>{pLat ? `${pLat.score}/9` : "—"}</div><div className="sub">real checks</div></div>
          <div className="cell"><div className="lbl">Accruals</div><div className={`val ${accL !== null && Math.abs(accL) > 10 ? "neg" : "pos"}`}>{accL === null ? "—" : `${accL.toFixed(1)}%`}</div><div className="sub">(NI−OCF)/TA</div></div>
          <div className="cell"><div className="lbl">OCF / NI</div><div className={`val ${ocfNiL !== null && ocfNiL < 0.8 ? "neg" : "pos"}`}>{ocfNiL === null ? "—" : `${ocfNiL.toFixed(2)}x`}</div><div className="sub">cash-backed?</div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Beneish 8 variables — FY {P[n - 1]}</p>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>VAR</th><th style={{ textAlign: "right" }}>VALUE</th><th style={{ textAlign: "right" }}>WATCH</th></tr></thead>
            <tbody>
              {[
                varRow("DSRI", (b) => b?.dsri, "> 1.10"),
                varRow("GMI", (b) => b?.gmi, "> 1.10"),
                varRow("AQI", (b) => b?.aqi, "> 1.10"),
                varRow("SGI", (b) => b?.sgi, "> 1.20"),
                varRow("DEPI", (b) => b?.depi, "> 1.10"),
                varRow("SGAI", (b) => b?.sgai, "> 1.05"),
                varRow("TATA", (b) => b?.tata, "|x| > .05"),
                varRow("LVGI", (b) => b?.lvgi, "> 1.10"),
              ].map(([l, v, w]) => (
                <tr key={l as string}>
                  <td><strong data-explain={l as string}>{l}</strong></td>
                  <td style={{ textAlign: "right" }}>{v}</td>
                  <td style={{ textAlign: "right" }} className="faint">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="faint" style={{ fontSize: 11 }}>M = −4.84 + .92·DSRI + .528·GMI + .404·AQI + .892·SGI + .115·DEPI − .172·SGAI + 4.679·TATA − .327·LVGI · FLAG &gt; −1.78</p>
        </div>
        <div className="panel">
          <p className="p-head">Beneish M — trend (flag −1.78)</p>
          <LineChart dates={P} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[{ label: "M", color: "#ff453a", values: mSeries }]} />
          <div style={{ marginTop: 8 }}>
            <p className="p-head">Altman Z — trend</p>
            <LineChart dates={P} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[{ label: "Z", color: "#00d664", values: zSeries.map((v) => (v === null ? null : Math.round(v * 100) / 100)) }]} />
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Piotroski F — {pLat ? `${pLat.score}/9 · ${pLat.score >= 7 ? "STRONG" : pLat.score >= 4 ? "AVERAGE" : "WEAK"}` : "NO DATA"} · real checks</p>
          {pLat ? (
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>CHECK</th><th style={{ textAlign: "right" }}>DETAIL</th><th style={{ textAlign: "right" }}></th></tr></thead>
              <tbody>
                {pLat.checks.map((c: any) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td style={{ textAlign: "right" }} className="muted">{c.detail}</td>
                    <td style={{ textAlign: "right" }} className={c.pass ? "pos" : "neg"}>{c.pass ? "✓ PASS" : "✗ FAIL"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">INSUFFICIENT LEDGER FIELDS.</p>
          )}
        </div>
        <div className="grid" style={{ gap: 10 }}>
          <div className="panel">
            <p className="p-head">Piotroski score — trend /9</p>
            <LineChart dates={P} xLabels={x3} yFmt={(v) => v.toFixed(0)} series={[{ label: "F", color: "#ffa028", values: pTrend }]} />
          </div>
          <div className="panel">
            <p className="p-head">Sloan accruals % — (NI−OCF)/TA</p>
            <BarChart values={accruals.map((v) => (v === null ? null : Math.round(v * 100) / 100))} labels={P} posColor="#ff453a" negColor="#00d664" />
            <p className="faint" style={{ fontSize: 11 }}>|ACCRUALS| &gt; 10% = RED · OCF SHOULD COVER EARNINGS</p>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Revenue vs receivables growth % — stuffing check</p>
          <GroupedBars
            periods={P}
            fmt={(v) => `${v.toFixed(1)}%`}
            series={[
              { label: "REV G", color: "#00d664", values: revG.map((v) => (v === null ? null : Math.round(v * 100) / 100)) },
              { label: "RECV G", color: "#ff453a", values: recvG.map((v) => (v === null ? null : Math.round(v * 100) / 100)) },
              { label: "INV G", color: "#ffa028", values: invG.map((v) => (v === null ? null : Math.round(v * 100) / 100)) },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Cash vs profit — OCF vs Net ₹ Cr</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            series={[
              { label: "OCF", color: "#00d664", values: ocfA },
              { label: "NET", color: "#ffa028", values: ni },
            ]}
          />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Red-flag board — {reds} red · {ambers} amber · {flags.filter((f) => f.sev === "green").length} green</p>
        <table className="plain">
          <thead><tr><th style={{ textAlign: "left" }}>FLAG</th><th style={{ textAlign: "right" }}>READING</th><th style={{ textAlign: "right" }}>STATE</th></tr></thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.label}>
                <td><strong>{f.label}</strong></td>
                <td style={{ textAlign: "right" }} className="muted">{f.detail}</td>
                <td style={{ textAlign: "right" }} className={f.sev === "red" ? "neg" : f.sev === "amber" ? "" : "pos"}>
                  {f.sev === "red" ? "● RED" : f.sev === "amber" ? "● AMBER" : "● GREEN"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — FOR</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

/* ---------------- statement charts (module 13) ---------------- */
// Every visual the Yahoo ledger can support: P&L scale + margins + growth,
// balance-sheet scale + leverage, cash-flow + earnings quality + capex,
// returns + liquidity + efficiency, quarterly, per-share, holdings.

export function StmtChartsDesk({ symbol }: { symbol: string }) {
  const { data, err, loading } = useStatements(symbol);
  if (loading) return <div className="panel"><p className="muted">BUILDING STATEMENT CHARTS FOR {symbol}…</p></div>;
  if (err) return <div className="panel"><p className="neg">CHARTS ERR: {err} (YAHOO THROTTLED — RETRY)</p></div>;
  if (!data?.pl) return null;

  const P = data.pl.periods;
  const short = P.map((p) => p.replace("Mar ", "'").replace("Jun ", "Jn ").replace("Sep ", "Sp ").replace("Dec ", "Dc "));
  const x3: [string, string, string] = [short[0] ?? "", short[Math.floor(short.length / 2)] ?? "", short[short.length - 1] ?? ""];
  const cr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")} Cr`;
  const crFmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  const pct1 = (v: number) => `${v.toFixed(1)}%`;

  const L = (t: STable | null, cands: string[]): (number | null)[] => findRow(t, cands)?.values ?? P.map(() => null);
  const R = (label: string): (number | null)[] =>
    data.rat?.rows.find((r) => r.label === label)?.values ?? P.map(() => null);

  // P&L
  const rev = L(data.pl, ["total revenue", "operating revenue", "sales"]);
  const gp = L(data.pl, ["gross profit"]);
  const opI = L(data.pl, ["operating income", "total operating income", "operating profit"]);
  const net = L(data.pl, ["net income", "net profit"]);
  // Balance
  const assets = L(data.bs, ["total assets"]);
  const debt = L(data.bs, ["total debt", "borrowings"]);
  const equity = L(data.bs, ["stockholders equity", "total equity gross minority interest", "share issued"]);
  const cashB = L(data.bs, ["cash and cash equivalents", "cash equivalents", "cash financial", "cash"]);
  // Cash flow
  const ocf = L(data.cf, ["cash flow from continuing operating activities", "operating cash flow"]);
  const icf = L(data.cf, ["cash flow from continuing investing activities", "investing cash flow"]);
  const fcf = L(data.cf, ["free cash flow"]);
  const capex = L(data.cf, ["capital expenditure", "capital expenditure reported", "purchase of ppe"]);
  const divs = L(data.cf, ["cash dividends paid", "common stock dividend paid", "dividend paid"]);
  // Quarterly
  const QP = data.qtr?.periods ?? [];
  const qShort = QP.map((p) => p.replace("Mar ", "'").replace("Jun ", "Jn ").replace("Sep ", "Sp ").replace("Dec ", "Dc "));
  const qrev = findRow(data.qtr, ["total revenue", "operating revenue", "sales"])?.values ?? [];
  const qnet = findRow(data.qtr, ["net income", "net profit"])?.values ?? [];
  // Holdings trend (screener quarterly %)
  const HP = data.sh?.periods ?? [];
  const hShort = HP.map((p) => p.replace("Mar ", "'").replace("Jun ", "Jn ").replace("Sep ", "Sp ").replace("Dec ", "Dc "));
  const hRow = (c: string[]) => findRow(data.sh, c)?.values ?? [];

  return (
    <div className="grid">
      <ComparePanel
        symbol={symbol}
        periods={P}
        rev={rev} gp={gp} opI={opI} net={net}
        assets={assets} debt={debt} equity={equity} cashB={cashB}
        ocf={ocf} fcf={fcf} capex={capex} divs={divs}
        R={R}
      />
      <div className="panel">
        <p className="p-head">P&L scale — ₹ Cr</p>
        <GroupedBars
          periods={P}
          series={[
            { label: "REVENUE", color: "#ffa028", values: rev },
            { label: "GROSS", color: "#00d664", values: gp },
            { label: "OP INC", color: "#00c8ff", values: opI },
            { label: "NET", color: "#8f7bff", values: net },
          ]}
          fmt={crFmt}
        />
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Margins % — trend</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={pct1}
            series={[
              { label: "GROSS", color: "#00d664", values: R("Gross Margin %") },
              { label: "OP", color: "#00c8ff", values: R("Operating Margin %") },
              { label: "NET", color: "#ffa028", values: R("Net Margin %") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Growth YoY %</p>
          <GroupedBars
            periods={P}
            fmt={pct1}
            series={[
              { label: "REVENUE", color: "#00d664", values: R("Revenue Growth %") },
              { label: "NET INC", color: "#ffa028", values: R("Net Income Growth %") },
              { label: "OCF", color: "#00c8ff", values: R("OCF Growth %") },
            ]}
          />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Balance sheet — ₹ Cr</p>
        <GroupedBars
          periods={P}
          fmt={crFmt}
          series={[
            { label: "ASSETS", color: "#00d664", values: assets },
            { label: "DEBT", color: "#ff453a", values: debt },
            { label: "EQUITY", color: "#8f7bff", values: equity },
            { label: "CASH", color: "#00c8ff", values: cashB },
          ]}
        />
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Leverage x</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={(v) => `${v.toFixed(2)}x`}
            series={[
              { label: "D/E", color: "#ff453a", values: R("Debt to Equity x") },
              { label: "A/E", color: "#ffa028", values: R("Assets to Equity x") },
              { label: "INT COV", color: "#00d664", values: R("Interest Coverage x") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Liquidity x</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={(v) => `${v.toFixed(2)}x`}
            series={[
              { label: "CURRENT", color: "#00d664", values: R("Current Ratio x") },
              { label: "QUICK", color: "#00c8ff", values: R("Quick Ratio x") },
              { label: "CASH", color: "#ffa028", values: R("Cash Ratio x") },
            ]}
          />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Cash flow — ₹ Cr · green in / red out</p>
        <GroupedBars
          periods={P}
          fmt={crFmt}
          series={[
            { label: "OCF", color: "#00d664", values: ocf },
            { label: "ICF", color: "#8f7bff", values: icf },
            { label: "FCF", color: "#ffa028", values: fcf },
          ]}
        />
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Earnings quality — OCF vs Net ₹ Cr</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={crFmt}
            series={[
              { label: "OCF", color: "#00d664", values: ocf },
              { label: "NET", color: "#ffa028", values: net },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Capex & dividends — ₹ Cr</p>
          <GroupedBars
            periods={P}
            fmt={crFmt}
            series={[
              { label: "OCF", color: "#00d664", values: ocf },
              { label: "CAPEX", color: "#ff453a", values: capex },
              { label: "DIVS", color: "#8f7bff", values: divs },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Returns % — trend</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={pct1}
            series={[
              { label: "ROE", color: "#ffa028", values: R("ROE %") },
              { label: "ROA", color: "#00d664", values: R("ROA %") },
              { label: "ROCE", color: "#00c8ff", values: R("ROCE %") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Efficiency — turnover x</p>
          <LineChart
            dates={P}
            xLabels={x3}
            yFmt={(v) => `${v.toFixed(2)}x`}
            series={[
              { label: "ASSET T/O", color: "#00d664", values: R("Asset Turnover x") },
              { label: "INV T/O", color: "#00c8ff", values: R("Inventory Turnover x") },
              { label: "REC T/O", color: "#ffa028", values: R("Receivables Turnover x") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Cash cycle — days locked</p>
          <GroupedBars
            periods={P}
            fmt={(v) => `${v.toFixed(1)}d`}
            series={[
              { label: "DSO", color: "#ffa028", values: R("Days Sales Outstanding days") },
              { label: "DIO", color: "#00c8ff", values: R("Days Inventory Outstanding days") },
              { label: "CCC", color: "#ff453a", values: R("Cash Conversion Cycle days") },
            ]}
          />
        </div>
      </div>

      {QP.length > 0 && (
        <div className="panel">
          <p className="p-head">Quarterly — revenue vs net ₹ Cr</p>
          <GroupedBars
            periods={QP}
            fmt={crFmt}
            series={[
              { label: "Q REV", color: "#ffa028", values: qrev },
              { label: "Q NET", color: "#00d664", values: qnet },
            ]}
          />
        </div>
      )}

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Per share — EPS / DPS ₹</p>
          <GroupedBars
            periods={P}
            fmt={(v) => `₹${v.toFixed(1)}`}
            series={[
              { label: "DIL EPS", color: "#00d664", values: R("Diluted EPS Rs") },
              { label: "DPS", color: "#ffa028", values: R("Dividend Per Share Rs") },
            ]}
          />
        </div>
        <div className="panel">
          <p className="p-head">Book value per share ₹</p>
          <AreaChart values={R("Book Value Per Share Rs")} label="BVPS" dates={P} fmt={(v) => `₹${v.toFixed(0)}`} />
          <p className="faint" style={{ fontSize: 11 }}>{qShort.length ? `QTR COVER ${qShort[0]} → ${qShort[qShort.length - 1]}` : `LAST ${cr(net[net.length - 1] ?? 0)} NET`}</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Holdings — latest split</p>
          {(() => {
            const get = (c: string[]) => last(findRow(data.sh, c)?.values);
            const parts = [
              { label: "PROMOTER", value: get(["promoters"]) ?? 0, color: "#ffa028" },
              { label: "FII", value: get(["fiis", "fii"]) ?? 0, color: "#00d664" },
              { label: "DII", value: get(["diis", "dii"]) ?? 0, color: "#8f7bff" },
              { label: "PUBLIC", value: get(["public"]) ?? 0, color: "#5b5b62" },
              { label: "GOVT", value: get(["government"]) ?? 0, color: "#00c8ff" },
            ];
            if (!parts.some((p) => p.value > 0)) return <p className="muted">NO HOLDING SPLIT.</p>;
            return <Donut slices={parts} />;
          })()}
        </div>
        <div className="panel">
          <p className="p-head">Holdings trend % — screener quarters</p>
          {HP.length ? (
            <LineChart
              dates={HP}
              xLabels={[hShort[0] ?? "", hShort[Math.floor(hShort.length / 2)] ?? "", hShort[hShort.length - 1] ?? ""]}
              yFmt={pct1}
              series={[
                { label: "PROM", color: "#ffa028", values: hRow(["promoters"]) },
                { label: "FII", color: "#00d664", values: hRow(["fiis", "fii"]) },
                { label: "DII", color: "#8f7bff", values: hRow(["diis", "dii"]) },
                { label: "PUB", color: "#5b5b62", values: hRow(["public"]) },
              ]}
            />
          ) : (
            <p className="muted">NO HOLDING TREND.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- fundamental gateway menu ---------------- */

const FUNDA_SECTIONS: Array<{ head: string; ids: string[] }> = [
  { head: "Company Overview", ids: ["17", "43", "37"] },
  { head: "Statements & Ledger", ids: ["12", "13", "64", "16"] },
  { head: "Valuation", ids: ["18", "19", "14"] },
  { head: "Quality & Risk", ids: ["15", "39", "20"] },
  { head: "Market & Peers", ids: ["35", "103", "38"] },
  { head: "Research AI", ids: ["66", "71"] },
];

const FUNDA_DEAD: Array<{ code: string; label: string; why: string }> = [
  { code: "EE", label: "Earnings & Estimates", why: "NEEDS CONSENSUS FEED" },
  { code: "CRPR", label: "Credit Rating Profile", why: "NEEDS RATINGS FEED" },
];

export function FundaMenu({ symbol }: { symbol: string }) {
  const router = useRouter();
  let n = 0;
  return (
    <div className="panel panel-glow">
      <p className="p-head">Main menu of terminal functions › Fundamental › Analyze {symbol}</p>
      <div className="grid grid-2">
        {FUNDA_SECTIONS.map((s) => (
          <div key={s.head}>
            <p className="p-head">{s.head}</p>
            {s.ids.map((id) => {
              const m = MODULE_MAP[id];
              if (!m) return null;
              n++;
              return (
                <div key={id} className="fnrow" onClick={() => router.push(`${m.route}?symbol=${encodeURIComponent(symbol)}`)}>
                  <span className="faint" style={{ minWidth: 26 }}>{n})</span>
                  <span className="badge fnc">{funcCode(id)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong>{m.label.toUpperCase()}</strong>
                    <span className="faint" style={{ fontSize: 11 }}> · {m.description.slice(0, 72)}</span>
                  </span>
                  <span className="sec">›</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {FUNDA_DEAD.map((d) => (
          <div key={d.code} className="fnrow dead">
            <span className="faint" style={{ minWidth: 26 }}>·</span>
            <span className="badge">{d.code}</span>
            <span style={{ flex: 1 }}><strong className="faint">{d.label.toUpperCase()}</strong></span>
            <span className="badge bad">{d.why}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- interactive DCF ---------------- */

export function DCFDesk({ symbol }: { symbol: string }) {
  const { data: st } = useStatements(symbol);
  const { q, qErr, qLoading, retryQuote } = useCompany(symbol);
  const [g, setG] = useState("12");
  const [mg, setMg] = useState("");
  const [tax, setTax] = useState("");
  const [dna, setDna] = useState("");
  const [capex, setCapex] = useState("6");
  const [wc, setWc] = useState("10");
  const [rf, setRf] = useState("7");
  const [beta, setBeta] = useState("1");
  const [erp, setErp] = useState("6");
  const [rd, setRd] = useState("9");
  const [dw, setDw] = useState("20");
  const [tg, setTg] = useState("4");
  const [nd, setNd] = useState("");
  const filled = useRef(false);

  const num = (rows: Array<{ label: string; values: (number | null)[] }> | undefined, cands: string[]): number | null => {
    if (!rows) return null;
    const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = rows.find((r) => cands.some((c) => nn(r.label).includes(nn(c))));
    if (!hit) return null;
    for (let i = hit.values.length - 1; i >= 0; i--) if (hit.values[i] !== null) return hit.values[i];
    return null;
  };
  const sales = st?.pl ? num(st.pl.rows, ["sales", "revenue from operations", "total revenue", "operating revenue"]) : null;
  const op = st?.pl ? num(st.pl.rows, ["operating profit", "operating income", "total operating income"]) : null;
  const pbt = st?.pl ? num(st.pl.rows, ["profit before tax", "pretax income"]) : null;
  const ni = st?.pl ? num(st.pl.rows, ["net profit", "profit after tax", "net income"]) : null;
  const dep = st?.pl ? num(st.pl.rows, ["depreciation"]) : null;
  const borrow = st?.bs ? num(st.bs.rows, ["borrowings", "total debt", "long term debt"]) : null;
  const cash = st?.bs ? num(st.bs.rows, ["cash", "bank balance", "cash and cash equivalents"]) : null;

  // Fresh symbol → clear autofills so the new ledger refills them.
  useEffect(() => {
    filled.current = false;
    setMg(""); setTax(""); setDna(""); setNd("");
  }, [symbol]);

  useEffect(() => {
    if (filled.current || !st) return;
    if (sales && op) setMg(((op / sales) * 100).toFixed(1));
    if (pbt && ni && pbt !== 0) setTax((((pbt - ni) / pbt) * 100).toFixed(1));
    if (sales && dep) setDna(((dep / sales) * 100).toFixed(1));
    if (borrow !== null) setNd(String(Math.round(borrow - (cash ?? 0))));
    filled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  const P = (s: string) => parseFloat(s);
  const price = q?.quote?.regularMarketPrice ?? 0;
  const stMcapCr = typeof st?.marketCapCr === "number" ? (st.marketCapCr as number) : null;
  // Yahoo v7 often omits marketCap for NSE names — fall back to screener ledger.
  const mc = q?.quote?.marketCap ?? (stMcapCr !== null ? stMcapCr * 1e7 : 0);

  type Model = {
    rev: number[]; ebit: number[]; nopat: number[]; da: number[]; cx: number[];
    dwc: number[]; fcf: number[]; df: number[]; pv: number[];
    tv: number; pvTv: number; ev: number; eqCr: number; fv: number;
    wacc: number; re: number; upside: number; shares: number;
    sensW: number[]; sensT: number[]; sens: (number | null)[][];
    scen: Array<{ name: string; fv: number; upside: number }>;
    mc: any;
  } | { error: string };

  let m: Model | null = null;
  const gr = P(g) / 100, mgn = P(mg) / 100, tx = P(tax) / 100;
  const dnaP = P(dna) / 100, cxP = P(capex) / 100, wcP = P(wc) / 100;
  const t = P(tg) / 100;
  const re = P(rf) / 100 + P(beta) * (P(erp) / 100);
  const wacc = (1 - P(dw) / 100) * re + (P(dw) / 100) * (P(rd) / 100) * (1 - tx);
  const ndCr = P(nd);
  const ready = sales && sales > 0 && [gr, mgn, tx, dnaP, cxP, wcP, t, re, wacc, ndCr].every(isFinite) && price > 0 && mc > 0;

  if (!ready) {
    m = { error: !price || !mc ? "QUOTE MISSING — RETRY" : !sales ? "LEDGER LOADING…" : "CHECK INPUTS (WACC MUST EXCEED TERMINAL G)" };
  } else if (wacc <= t) {
    m = { error: "WACC MUST EXCEED TERMINAL G" };
  } else {
    const shares = mc / price;
    const fairAt = (w2: number, t2: number, g2: number, m2: number): number | null => {
      if (!(w2 > t2)) return null;
      let r0 = sales as number;
      const rr: number[] = [];
      for (let i = 0; i < 5; i++) { r0 *= 1 + g2; rr.push(r0); }
      const ff = rr.map((r, i) => {
        const e = r * m2, n2 = e * (1 - tx);
        return n2 + r * dnaP - r * cxP - (r - (i ? rr[i - 1] : (sales as number))) * wcP;
      });
      const d2 = [1, 2, 3, 4, 5].map((y) => 1 / Math.pow(1 + w2, y));
      const pv2 = ff.reduce((s, f, i) => s + f * d2[i], 0);
      const tv2 = (ff[4] * (1 + t2)) / (w2 - t2);
      return ((pv2 + tv2 * d2[4] - ndCr) * 1e7) / shares;
    };
    let r0 = sales as number;
    const rev: number[] = [];
    for (let i = 0; i < 5; i++) { r0 *= 1 + gr; rev.push(r0); }
    const ebit = rev.map((r) => r * mgn);
    const nopat = ebit.map((e) => e * (1 - tx));
    const da = rev.map((r) => r * dnaP);
    const cx = rev.map((r) => r * cxP);
    const dwc = rev.map((r, i) => (r - (i ? rev[i - 1] : (sales as number))) * wcP);
    const fcf = nopat.map((n2, i) => n2 + da[i] - cx[i] - dwc[i]);
    const df = [1, 2, 3, 4, 5].map((y) => 1 / Math.pow(1 + wacc, y));
    const pv = fcf.map((f, i) => f * df[i]);
    const tv = (fcf[4] * (1 + t)) / (wacc - t);
    const pvTv = tv * df[4];
    const ev = pv.reduce((a, b) => a + b, 0) + pvTv;
    const eqCr = ev - ndCr;
    const fv = (eqCr * 1e7) / shares;
    const sensW = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => wacc + d);
    const sensT = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => t + d);
    const sens = sensW.map((w2) => sensT.map((t2) => fairAt(w2, t2, gr, mgn)));
    const scen = [
      { name: "BEAR", fv: fairAt(wacc, t, gr - 0.04, mgn - 0.03) ?? NaN, upside: 0 },
      { name: "BASE", fv, upside: 0 },
      { name: "BULL", fv: fairAt(wacc, t, gr + 0.04, mgn + 0.03) ?? NaN, upside: 0 },
    ].map((s) => ({ ...s, upside: isFinite(s.fv) ? ((s.fv - price) / price) * 100 : NaN }));
    const mcRes: any = calcMonteCarloDCF(fcf[0] * 1e7, shares, wacc, t, [gr - 0.05, gr, gr + 0.05], 800, 5, 42);
    m = {
      rev, ebit, nopat, da, cx, dwc, fcf, df, pv, tv, pvTv, ev, eqCr, fv,
      wacc, re, upside: ((fv - price) / price) * 100, shares,
      sensW, sensT, sens, scen, mc: { ...mcRes, price },
    };
  }

  const F = (label: string, v: string, set: (s: string) => void) => (
    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>{label}
      <input className="box" value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" />
    </label>
  );
  const cr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Institutional DCF — {symbol} · sales ₹{sales !== null ? Math.round(sales).toLocaleString("en-IN") : "—"} Cr · live</p>
        <p className="p-head">Operating drivers</p>
        <div className="grid grid-4">
          {F("REV GROWTH %", g, setG)}
          {F("EBIT MGN %", mg, setMg)}
          {F("TAX %", tax, setTax)}
          {F("D&A % SALES", dna, setDna)}
          {F("CAPEX % SALES", capex, setCapex)}
          {F("ΔWC % ΔSALES", wc, setWc)}
          {F("TERMINAL G %", tg, setTg)}
          {F("NET DEBT ₹ CR", nd, setNd)}
        </div>
        <p className="p-head" style={{ marginTop: 12 }}>WACC build</p>
        <div className="grid grid-4">
          {F("RISK-FREE %", rf, setRf)}
          {F("BETA", beta, setBeta)}
          {F("ERP %", erp, setErp)}
          {F("COST OF DEBT %", rd, setRd)}
          {F("DEBT WEIGHT %", dw, setDw)}
        </div>
        {"error" in (m ?? {}) ? (
          qLoading ? (
            <p className="muted" style={{ marginTop: 10 }}>PRICING QUOTE…</p>
          ) : (
            <p className="neg" style={{ marginTop: 10 }}>
              {(m as { error: string }).error}
              {qErr ? <span className="faint"> ({qErr})</span> : null}{" "}
              <button className="ghost" style={{ marginLeft: 8 }} onClick={retryQuote}>RETRY QUOTE</button>
            </p>
          )
        ) : (
          (() => {
            const mm = m as Exclude<Model, { error: string }>;
            const projRows: Array<[string, number[]]> = [
              ["Revenue", mm.rev], ["EBIT", mm.ebit], ["NOPAT", mm.nopat],
              ["+ D&A", mm.da], ["− Capex", mm.cx], ["− ΔWC", mm.dwc],
              ["FCF", mm.fcf], ["DF", mm.df], ["PV(FCF)", mm.pv],
            ];
            return (
              <>
                <div className="cells" style={{ marginTop: 12 }}>
                  <div className="cell"><div className="lbl">Cost of equity</div><div className="val">{(mm.re * 100).toFixed(1)}%</div><div className="sub">rf + β·erp</div></div>
                  <div className="cell"><div className="lbl">WACC</div><div className="val">{(mm.wacc * 100).toFixed(1)}%</div><div className="sub">blended</div></div>
                  <div className="cell"><div className="lbl">EV</div><div className="val">{cr(mm.ev)} Cr</div><div className="sub">PV FCF + TV</div></div>
                  <div className="cell"><div className="lbl">Fair / sh</div><div className={`val ${mm.upside >= 0 ? "pos" : "neg"}`}>₹{Math.round(mm.fv).toLocaleString("en-IN")}</div><div className="sub">{mm.upside >= 0 ? "+" : ""}{mm.upside.toFixed(1)}% vs ₹{Math.round(price).toLocaleString("en-IN")}</div></div>
                  <div className="cell"><div className="lbl">TV share</div><div className="val">{((mm.pvTv / mm.ev) * 100).toFixed(0)}%</div><div className="sub">of EV</div></div>
                  <div className="cell"><div className="lbl">MC P50</div><div className="val">{isFinite(mm.mc.p50) ? `₹${Math.round(mm.mc.p50).toLocaleString("en-IN")}` : "—"}</div><div className="sub">{mm.mc.nPaths?.toLocaleString("en-IN")} paths</div></div>
                </div>

                <div className="panel" style={{ marginTop: 10 }}>
                  <p className="p-head">Projection — ₹ Cr</p>
                  <div className="scrollx">
                    <table className="plain">
                      <thead><tr><th></th>{[1, 2, 3, 4, 5].map((y) => <th key={y} style={{ textAlign: "right" }}>Y{y}</th>)}</tr></thead>
                      <tbody>
                        {projRows.map(([label, arr]) => (
                          <tr key={label}>
                            <td><strong>{label}</strong></td>
                            {arr.map((v, i) => <td key={i} style={{ textAlign: "right" }}>{label === "DF" ? v.toFixed(3) : Math.round(v).toLocaleString("en-IN")}</td>)}
                          </tr>
                        ))}
                        <tr>
                          <td><strong>Terminal value</strong></td>
                          <td colSpan={3} style={{ textAlign: "right" }} className="faint">TV {cr(mm.tv)} Cr · PV {cr(mm.pvTv)} Cr</td>
                          <td style={{ textAlign: "right" }}>EQ {cr(mm.eqCr)} Cr</td>
                          <td style={{ textAlign: "right" }} className="faint">{(mm.shares / 1e7).toFixed(1)} Cr sh</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="grid grid-2" style={{ marginTop: 10 }}>
                  <div className="panel">
                    <p className="p-head">Sensitivity — fair/sh · WACC ↓ × term-g →</p>
                    <table className="plain">
                      <thead><tr><th></th>{mm.sensT.map((t2) => <th key={t2} style={{ textAlign: "right" }}>{(t2 * 100).toFixed(1)}%</th>)}</tr></thead>
                      <tbody>
                        {mm.sensW.map((w2, i) => (
                          <tr key={w2}>
                            <td><strong>{(w2 * 100).toFixed(1)}%</strong></td>
                            {mm.sens[i].map((v, j) => (
                              <td key={j} style={{
                                textAlign: "right",
                                background: v === null ? "transparent" : v >= price ? "rgba(0,214,100,0.10)" : "rgba(255,69,58,0.10)",
                                outline: i === 2 && j === 2 ? "1px solid #ffa028" : "none",
                              }}>
                                {v === null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid" style={{ gap: 10 }}>
                    <div className="panel">
                      <p className="p-head">Scenarios</p>
                      <table className="plain">
                        <thead><tr><th></th><th style={{ textAlign: "right" }}>FAIR</th><th style={{ textAlign: "right" }}>UPSIDE</th></tr></thead>
                        <tbody>
                          {mm.scen.map((s) => (
                            <tr key={s.name}>
                              <td><strong>{s.name}</strong><span className="faint" style={{ fontSize: 11 }}> {s.name === "BASE" ? "" : s.name === "BEAR" ? "g−4·m−3" : "g+4·m+3"}</span></td>
                              <td style={{ textAlign: "right" }}>{isFinite(s.fv) ? `₹${Math.round(s.fv).toLocaleString("en-IN")}` : "—"}</td>
                              <td style={{ textAlign: "right" }}><span className={s.upside >= 0 ? "pos" : "neg"}>{isFinite(s.upside) ? `${s.upside >= 0 ? "+" : ""}${s.upside.toFixed(1)}%` : "—"}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="panel">
                      <p className="p-head">Monte-Carlo value histogram</p>
                      {mm.mc.histCounts?.length > 0
                        ? <Histogram prebinned={{ counts: mm.mc.histCounts, edges: mm.mc.histEdges ?? [] }} height={100} />
                        : <p className="muted">NO DISTRIBUTION.</p>}
                    </div>
                  </div>
                </div>

                <div className="panel" style={{ marginTop: 10 }}>
                  <p className="p-head">Fair value vs price</p>
                  <HBars rows={[
                    { label: "P10", value: mm.mc.p10, display: isFinite(mm.mc.p10) ? `₹${Math.round(mm.mc.p10).toLocaleString("en-IN")}` : "—", color: "#5b5b62" },
                    { label: "P50 FAIR", value: mm.mc.p50, display: isFinite(mm.mc.p50) ? `₹${Math.round(mm.mc.p50).toLocaleString("en-IN")}` : "—", color: "#ffa028" },
                    { label: "MODEL FAIR", value: mm.fv, display: `₹${Math.round(mm.fv).toLocaleString("en-IN")}`, color: "#00d664" },
                    { label: "PRICE", value: price, display: `₹${Math.round(price).toLocaleString("en-IN")}`, color: "#00c8ff" },
                  ]} />
                </div>
              </>
            );
          })()
        )}
      </div>
      <FundaTables symbol={symbol} />
    </div>
  );
}

/* ---------------- interactive LBO ---------------- */

export function LBODesk({ symbol }: { symbol: string }) {
  const { q, qErr, qLoading, retryQuote } = useCompany(symbol);
  const { data: st } = useStatements(symbol);
  const [debt, setDebt] = useState("60");
  const [rate, setRate] = useState("11");
  const [growth, setGrowth] = useState("10");
  const [margin, setMargin] = useState("");
  const [dnaP, setDnaP] = useState("");
  const [capexP, setCapexP] = useState("8");
  const [years, setYears] = useState("5");
  const [mult, setMult] = useState("12");
  const filled = useRef(false);

  const num = (rows: Array<{ label: string; values: (number | null)[] }> | undefined, cands: string[]): number | null => {
    if (!rows) return null;
    const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = rows.find((r) => cands.some((c) => nn(r.label).includes(nn(c))));
    if (!hit) return null;
    for (let i = hit.values.length - 1; i >= 0; i--) if (hit.values[i] !== null) return hit.values[i];
    return null;
  };
  const sales = st?.pl ? num(st.pl.rows, ["sales", "revenue from operations", "total revenue", "operating revenue"]) : null;
  const op = st?.pl ? num(st.pl.rows, ["operating profit", "operating income", "total operating income"]) : null;
  const dep = st?.pl ? num(st.pl.rows, ["depreciation"]) : null;

  useEffect(() => {
    filled.current = false;
    setMargin(""); setDnaP("");
  }, [symbol]);

  useEffect(() => {
    if (filled.current || !st || !sales) return;
    if (op) setMargin(((op / sales) * 100).toFixed(1));
    if (dep) setDnaP(((dep / sales) * 100).toFixed(1));
    filled.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  const P = (s: string) => parseFloat(s);
  const stMcapCr = typeof st?.marketCapCr === "number" ? (st.marketCapCr as number) : null;
  const ev = ((q?.quote?.marketCap ?? (stMcapCr !== null ? stMcapCr * 1e7 : 0)) as number) / 1e7;
  const dPct = P(debt) / 100, rt = P(rate) / 100, gr = P(growth) / 100;
  const mg = P(margin) / 100, dnP = P(dnaP) / 100, cxP = P(capexP) / 100;
  const ny = Math.max(1, Math.min(10, Math.round(P(years) || 5)));
  const mx = P(mult);
  const TAX = 0.25, FEES = 0.02, SNR = 0.7, SNR_SPREAD = 0.03;

  type LBOSchedRow = {
    y: number; rev: number; ebitda: number; intS: number; intJ: number;
    tax: number; fcf: number; payJ: number; payS: number;
    endS: number; endJ: number; dscr: number;
  };

  type LBOModel = {
    debt0: number; eqIn: number; fees: number;
    sched: LBOSchedRow[];
    exitEV: number; exitEq: number; moic: number; irr: number; ebitdaN: number; debtN: number;
    sensD: number[]; sensM: number[]; sens: (number | null)[][];
  } | null;

  let m: LBOModel = null;
  const ready = ev > 0 && sales && sales > 0 && [dPct, rt, gr, mg, dnP, cxP, mx].every(isFinite) && dPct > 0 && dPct < 1;
  if (ready) {
    const runModel = (d: number, exitM: number) => {
      const uses = ev * (1 + FEES);
      let sBal = uses * d * SNR, jBal = uses * d * (1 - SNR);
      const eqIn = uses * (1 - d);
      let rev = sales as number;
      const rows: LBOSchedRow[] = [];
      for (let y = 1; y <= ny; y++) {
        rev *= 1 + gr;
        const ebitda = rev * mg;
        const dna = rev * dnP;
        const intS = sBal * rt, intJ = jBal * (rt + SNR_SPREAD);
        const ebt = ebitda - dna - intS - intJ;
        const tax = Math.max(0, ebt * TAX);
        const fcf = ebitda - intS - intJ - tax - dna - rev * cxP - (rev - rev / (1 + gr)) * 0.1;
        let payJ = Math.min(jBal, Math.max(0, fcf));
        const left = Math.max(0, fcf - payJ);
        const payS = Math.min(sBal, left);
        sBal -= payS; jBal -= payJ;
        rows.push({
          y, rev, ebitda, intS, intJ, tax, fcf, payJ, payS,
          endS: sBal, endJ: jBal,
          dscr: intS + intJ > 0 ? ebitda / (intS + intJ) : Infinity,
        });
      }
      const ebitdaN = rows[ny - 1].ebitda;
      const debtN = rows[ny - 1].endS + rows[ny - 1].endJ;
      const exitEV = ebitdaN * exitM;
      const exitEq = exitEV - debtN;
      const moic = eqIn > 0 && exitEq > 0 ? exitEq / eqIn : NaN;
      return { rows, exitEV, exitEq, moic, irr: isFinite(moic) && moic > 0 ? Math.pow(moic, 1 / ny) - 1 : NaN, ebitdaN, debtN, eqIn, uses, sBal0: uses * d * SNR, jBal0: uses * d * (1 - SNR) };
    };
    const base = runModel(dPct, mx);
    const sensD = [0.4, 0.5, 0.6, 0.7];
    const sensM = [8, 10, 12, 14];
    m = {
      debt0: base.sBal0 + base.jBal0, eqIn: base.eqIn, fees: ev * FEES,
      sched: base.rows, exitEV: base.exitEV, exitEq: base.exitEq,
      moic: base.moic, irr: base.irr, ebitdaN: base.ebitdaN, debtN: base.debtN,
      sensD, sensM,
      sens: sensD.map((d2) => sensM.map((m2) => {
        const r = runModel(d2, m2);
        return isFinite(r.irr) ? r.irr : null;
      })),
    };
  }

  const F = (label: string, v: string, set: (s: string) => void) => (
    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>{label}
      <input className="box" value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" />
    </label>
  );
  const cr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  // Compact lakh-crore for squeezed cells: ₹10,53,468 Cr → ₹10.53L Cr.
  const crC = (v: number) => (Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L Cr` : `${cr(v)} Cr`);
  // Integer formatter that never prints "-0".
  const fmt0 = (v: number) => (Math.round(v) + 0).toLocaleString("en-IN");

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Institutional LBO — {symbol} · EV {cr(ev)} Cr · SALES {sales !== null ? `${cr(sales)} Cr` : "—"} · live</p>
        <div className="grid grid-4">
          {F("DEBT %", debt, setDebt)}
          {F("SENIOR RATE %", rate, setRate)}
          {F("REV GROWTH %", growth, setGrowth)}
          {F("EBITDA MGN %", margin, setMargin)}
          {F("D&A % SALES", dnaP, setDnaP)}
          {F("CAPEX % SALES", capexP, setCapexP)}
          {F("YEARS", years, setYears)}
          {F("EXIT × EBITDA", mult, setMult)}
        </div>
        {!m ? (
          qLoading ? (
            <p className="muted" style={{ marginTop: 10 }}>LEDGER/QUOTE LOADING…</p>
          ) : (
            <p className="neg" style={{ marginTop: 10 }}>
              {!ev || !sales ? `LEDGER/QUOTE ${qErr ? `FAILED — ${qErr}` : "LOADING…"}` : "CHECK INPUTS"}
              {qErr && <button className="ghost" style={{ marginLeft: 8 }} onClick={retryQuote}>RETRY QUOTE</button>}
            </p>
          )
        ) : (
          <>
            {(() => {
              const y1 = m.sched[0];
              const cov1 = y1 && (y1.intS + y1.intJ) > 0 ? y1.ebitda / (y1.intS + y1.intJ) : NaN;
              const bust = !isFinite(cov1) || cov1 < 1;
              const hurdle = isFinite(m.irr) && m.irr >= 0.2;
              return (
                <p className={bust ? "neg" : hurdle ? "pos" : "muted"} style={{ marginTop: 12, fontSize: 12.5 }}>
                  {bust
                    ? `✕ STRUCTURE FAILS Y1 — INTEREST ${cr(y1.intS + y1.intJ)} Cr EXCEEDS EBITDA ${cr(y1.ebitda)} Cr (COVER ${isFinite(cov1) ? cov1.toFixed(2) : "—"}×). CUT DEBT %, SENIOR RATE, OR RAISE MARGIN — NO DEBT PAYS DOWN UNTIL FCF TURNS POSITIVE.`
                    : hurdle
                      ? `✓ CLEARS 20% HURDLE — IRR ${(m.irr * 100).toFixed(1)}%, MOIC ${m.moic.toFixed(2)}×, Y1 COVER ${cov1.toFixed(2)}×.`
                      : `○ PAYS DOWN BUT MISSES 20% HURDLE — IRR ${isFinite(m.irr) ? `${(m.irr * 100).toFixed(1)}%` : "—"}, Y1 COVER ${cov1.toFixed(2)}×. RAISE GROWTH/MARGIN/EXIT OR CUT DEBT %.`}
                </p>
              );
            })()}
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="panel">
                <p className="p-head">Sources & uses — ₹ Cr</p>
                <table className="plain">
                  <thead><tr><th>SOURCES</th><th style={{ textAlign: "right" }}>AMT</th><th style={{ textAlign: "right" }}>%</th></tr></thead>
                  <tbody>
                    <tr><td>Senior debt @ {rate}%</td><td style={{ textAlign: "right" }}>{cr(m.debt0 * SNR)}</td><td style={{ textAlign: "right" }}>{(dPct * SNR * 100).toFixed(0)}</td></tr>
                    <tr><td>Junior debt @ {(rt * 100 + 3).toFixed(1)}%</td><td style={{ textAlign: "right" }}>{cr(m.debt0 * (1 - SNR))}</td><td style={{ textAlign: "right" }}>{(dPct * (1 - SNR) * 100).toFixed(0)}</td></tr>
                    <tr><td>Sponsor equity</td><td style={{ textAlign: "right" }}>{cr(m.eqIn)}</td><td style={{ textAlign: "right" }}>{((m.eqIn / (m.debt0 + m.eqIn)) * 100).toFixed(0)}</td></tr>
                    <tr><td><strong>USES: EV + {(FEES * 100).toFixed(0)}% fees</strong></td><td style={{ textAlign: "right" }}><strong>{cr(m.debt0 + m.eqIn)}</strong></td><td style={{ textAlign: "right" }}>100</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="cells">
                <div className="cell"><div className="lbl">IRR</div><div className={`val ${m.irr > 0.2 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{isFinite(m.irr) ? `${(m.irr * 100).toFixed(1)}%` : "—"}</div><div className="sub">hurdle 20%</div></div>
                <div className="cell"><div className="lbl">MOIC</div><div className="val" style={{ fontSize: 16 }}>{isFinite(m.moic) ? `${m.moic.toFixed(2)}×` : "—"}</div><div className="sub">cash-on-cash</div></div>
                <div className="cell"><div className="lbl">Exit equity</div><div className="val" style={{ fontSize: 15 }}>{m.exitEq > 0 ? crC(m.exitEq) : "—"}</div><div className="sub">EV {crC(m.exitEV)}</div></div>
                <div className="cell"><div className="lbl">Debt @ exit</div><div className="val" style={{ fontSize: 15 }}>{crC(m.debtN)}</div><div className="sub">paid down</div></div>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 10 }}>
              <p className="p-head">Debt schedule — ₹ Cr · 100% FCF sweep, junior first</p>
              <div className="scrollx">
                <table className="plain">
                  <thead><tr><th></th>{m.sched.map((r) => <th key={r.y} style={{ textAlign: "right" }}>Y{r.y}</th>)}</tr></thead>
                  <tbody>
                    {([
                      ["Revenue", (r: LBOSchedRow) => r.rev],
                      ["EBITDA", (r: LBOSchedRow) => r.ebitda],
                      ["Interest", (r: LBOSchedRow) => -(r.intS + r.intJ)],
                      ["Tax", (r: LBOSchedRow) => -r.tax],
                      ["FCF", (r: LBOSchedRow) => r.fcf],
                      ["Pay junior", (r: LBOSchedRow) => -r.payJ],
                      ["Pay senior", (r: LBOSchedRow) => -r.payS],
                      ["End debt", (r: LBOSchedRow) => r.endS + r.endJ],
                      ["DSCR", (r: LBOSchedRow) => r.dscr],
                    ] as Array<[string, (r: LBOSchedRow) => number]>).map(([label, fn]) => (
                      <tr key={label}>
                        <td><strong>{label}</strong></td>
                        {m.sched.map((r) => {
                          const v = fn(r);
                          return (
                            <td key={r.y} style={{ textAlign: "right" }}>
                              {label === "DSCR" ? (isFinite(v) ? `${v.toFixed(1)}×` : "—") : fmt0(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="panel" style={{ marginTop: 10 }}>
              <p className="p-head">Sensitivity — IRR · debt % ↓ × exit mult →</p>
              <table className="plain">
                <thead><tr><th></th>{m.sensM.map((x) => <th key={x} style={{ textAlign: "right" }}>{x}×</th>)}</tr></thead>
                <tbody>
                  {m.sensD.map((d2, i) => (
                    <tr key={d2}>
                      <td><strong>{Math.round(d2 * 100)}%</strong></td>
                      {m.sens[i].map((v, j) => (
                        <td key={j} style={{
                          textAlign: "right",
                          background: v === null || !isFinite(v) ? "transparent" : v >= 0.2 ? "rgba(0,214,100,0.10)" : "rgba(255,69,58,0.10)",
                        }}>
                          {v === null || !isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      <FundaTables symbol={symbol} />
    </div>
  );
}

/* ---------------- three-statement linker ---------------- */

function useSchedule(symbol: string, parent: string, section: string) {
  const [rows, setRows] = useState<Array<{ label: string; values: Record<string, string> }>>([]);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setDone(false); setRows([]);
    fetch(`/api/schedule?symbol=${encodeURIComponent(symbol)}&parent=${encodeURIComponent(parent)}&section=${encodeURIComponent(section)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setRows(j.rows ?? []); setDone(true); } })
      .catch(() => { if (alive) setDone(true); });
    return () => { alive = false; };
  }, [symbol, parent, section]);
  return { rows, done };
}

const parseINR = (s: string | undefined): number => {
  if (!s) return 0;
  const t = s.trim();
  if (!t || t === "—" || t === "-") return 0;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[(),]/g, ""));
  return isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
};
const latestAnnual = (periods: string[]): string => {
  const a = periods.filter((p) => !/TTM/i.test(p));
  return a[a.length - 1] ?? periods[periods.length - 1] ?? "";
};
const fmtCr0 = (v: number | null | undefined): string =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${Math.round(v).toLocaleString("en-IN")}`;

type WFStep = { label: string; delta: number; kind: "flow" | "sub" | "total" };

function Waterfall({ steps }: { steps: WFStep[] }) {
  const cum: number[] = [0];
  steps.forEach((s) => cum.push(s.kind === "flow" ? cum[cum.length - 1] + s.delta : s.delta));
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum);
  const W = 760, Y0 = 12, Y1 = 206, H = 300, X0 = 8, PW = W - 16;
  const n = steps.length;
  const Y = (v: number) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const bw = PW / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      <line x1={X0} x2={W - 8} y1={Y(0)} y2={Y(0)} stroke="#26262b" strokeWidth="1" />
      {steps.map((s, i) => {
        const c0 = s.kind === "flow" ? cum[i] : 0, c1 = cum[i + 1];
        const top = Y(Math.max(c0, c1)), h = Math.max(2, Math.abs(Y(c0) - Y(c1)));
        const x = X0 + i * bw + bw * 0.19, w = bw * 0.62;
        const fill = s.kind !== "flow" ? "#ffa028" : s.delta >= 0 ? "#00d664" : "#ff453a";
        return (
          <g key={i}>
            <title>{s.label}: {fmtCr0(s.kind === "flow" ? s.delta : c1)} Cr</title>
            <rect x={x.toFixed(1)} y={top.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} fill={fill} opacity={s.kind === "flow" ? 0.85 : 0.95} rx={1} />
            <text x={(x + w / 2).toFixed(1)} y={(top - 4).toFixed(1)} fontSize="9" fill="#f5f5f4" textAnchor="middle" style={{ fontVariantNumeric: "tabular-nums" }}>
              {s.kind === "flow" ? (s.delta >= 0 ? "+" : "") + fmtCr0(s.delta) : fmtCr0(c1)}
            </text>
            <text x={(x + w / 2).toFixed(1)} y={(Y1 + 12).toFixed(1)} fontSize="9" fill="#a1a1aa" textAnchor="end" transform={`rotate(-38 ${(x + w / 2).toFixed(1)} ${(Y1 + 12).toFixed(1)})`}>{s.label}</text>
            {i < n - 1 && <line x1={x + w} x2={X0 + (i + 1) * bw + bw * 0.19} y1={Y(cum[i + 1])} y2={Y(cum[i + 1])} stroke="#5b5b62" strokeWidth="1" strokeDasharray="3 3" />}
          </g>
        );
      })}
    </svg>
  );
}

const TUTOR: Array<[string, string]> = [
  ["NPAT → OCF", "Profit counts credit sales and ignores timing. Add back non-cash (D&A), subtract cash stuck in receivables/inventory, add supplier funding (payables), pay taxes in cash — that is OCF."],
  ["D&A ADD-BACK", "Depreciation cut IS profit but no cash left the building. It reappears as +D&A in OCF and quietly shrinks net block on the BS."],
  ["WORKING CAPITAL", "Receivables/inventory UP = cash trapped (red). Payables UP = suppliers funding you (green). WC burn with rising sales is normal; without sales it is a red flag."],
  ["CAPEX → PPE", "Fixed-asset purchases leave via Investing CF and land in gross block; the IS only ever sees depreciation. ΔPPE ≈ purchases − depreciation − disposals."],
  ["DEBT WALKS", "Borrowings on the BS should move with CFF debt issued − repaid. Interest hits the IS; principal never touches profit — only cash."],
  ["DIVIDENDS & BALANCE", "Dividends leave via Financing CF and shrink retained earnings — never OCF. Assets must equal liabilities + equity; any plug is revaluation/OCI worth investigating."],
];

export function LinkerDesk({ symbol }: { symbol: string }) {
  const { data, err, loading } = useStatements(symbol);
  const cfo = useSchedule(symbol, "Cash from Operating Activity", "cash-flow");
  const cfi = useSchedule(symbol, "Cash from Investing Activity", "cash-flow");
  const cff = useSchedule(symbol, "Cash from Financing Activity", "cash-flow");

  if (loading) return <div className="panel"><p className="muted">BUILDING LINKER FOR {symbol}…</p></div>;
  if (err) return <div className="panel"><p className="neg">LINKER ERR: {err}</p></div>;
  if (!data?.pl || !data?.bs || !data?.cf) return <div className="panel"><p className="muted">LEDGER INCOMPLETE — RETRY.</p></div>;

  const per = latestAnnual(data.pl.periods);
  const AP = (t: STable | null, cands: string[], back = 0): number => {
    const r = findRow(t, cands);
    if (!r || !t) return 0;
    let idx = t.periods.indexOf(per);
    if (idx < 0) idx = t.periods.length - 1;
    const v = r.values[idx - back];
    return typeof v === "number" ? v : 0;
  };
  const K = (rows: Array<{ label: string; values: Record<string, string> }>, pats: RegExp[]): number =>
    rows.filter((r) => pats.some((p) => p.test(r.label))).reduce((s, r) => s + parseINR(r.values[per]), 0);

  // IS / BS / CF anchors (₹ Cr, latest FY — Yahoo/yfinance labels)
  const sales = AP(data.pl, ["sales", "revenue from operations", "total revenue", "operating revenue"]);
  const op = AP(data.pl, ["operating profit", "operating income", "total operating income"]);
  const ebt = AP(data.pl, ["profit before tax", "pretax income"]);
  const interest = Math.abs(AP(data.pl, ["interest"]));
  const depIS = Math.abs(AP(data.pl, ["depreciation"]));
  const npat = AP(data.pl, ["net profit", "profit after tax", "net income"]);
  const ebit = ebt + interest;
  const res = AP(data.bs, ["reserves", "other equity", "retained earnings"]), resP = AP(data.bs, ["reserves", "other equity", "retained earnings"], 1);
  const borrow = AP(data.bs, ["borrowings", "total debt", "long term debt"]), borrowP = AP(data.bs, ["borrowings", "total debt", "long term debt"], 1);
  const fixA = AP(data.bs, ["fixed assets", "net ppe", "gross ppe"]), fixAP = AP(data.bs, ["fixed assets", "net ppe", "gross ppe"], 1);
  const cwip = AP(data.bs, ["cwip", "construction in progress"]), cwipP = AP(data.bs, ["cwip", "construction in progress"], 1);
  const totA = AP(data.bs, ["total assets"]), totL = AP(data.bs, ["total liabilities"]);
  const equity = totL - borrow - AP(data.bs, ["other liabilities"]);
  const ocf = AP(data.cf, ["cash from operating activity", "operating cash flow", "cash flow from continuing operating"]);
  const icf = AP(data.cf, ["cash from investing activity", "investing cash flow", "cash flow from continuing investing"]);
  const fcffin = AP(data.cf, ["cash from financing activity", "financing cash flow", "cash flow from continuing financing"]);
  const netCash = AP(data.cf, ["net cash flow", "changes in cash", "change in cash"]);
  const fcfRep = AP(data.cf, ["free cash flow", "free cash flow"]);

  // Indirect-method walk from live breakups
  const pfo = K(cfo.rows, [/profit from operations/i]);
  const rec = K(cfo.rows, [/receiv/i]);
  const invW = K(cfo.rows, [/invent/i]);
  const pay = K(cfo.rows, [/payable/i]);
  const taxP = K(cfo.rows, [/direct tax/i]);
  const nonCash = pfo - npat;
  const ocfCalc = npat + nonCash + rec + invW + pay + taxP;
  const capexNet = K(cfi.rows, [/fixed asset/i]);
  const capexBuy = K(cfi.rows, [/fixed assets purchased/i]);
  const invNet = K(cfi.rows, [/invest/i]);
  const icfOther = icf - capexNet - invNet;
  const debtNet = K(cff.rows, [/borrowings|financial liabilit/i]);
  const divP = K(cff.rows, [/dividend/i]);
  const intF = K(cff.rows, [/interest/i]);
  const cffOther = fcffin - debtNet - divP - intF;
  const netCalc = ocfCalc + icf + fcffin;

  const steps: WFStep[] = [
    { label: "NPAT", delta: npat, kind: "flow" },
    { label: "NON-CASH", delta: nonCash, kind: "flow" },
    { label: "RECEIV", delta: rec, kind: "flow" },
    { label: "INVENT", delta: invW, kind: "flow" },
    { label: "PAYABLE", delta: pay, kind: "flow" },
    { label: "TAX PAID", delta: taxP, kind: "flow" },
    { label: "OCF", delta: ocfCalc, kind: "sub" },
    { label: "CAPEX NET", delta: capexNet, kind: "flow" },
    { label: "INV NET", delta: invNet, kind: "flow" },
    { label: "OTH INV", delta: icfOther, kind: "flow" },
    { label: "ICF", delta: icf, kind: "sub" },
    { label: "DEBT NET", delta: debtNet, kind: "flow" },
    { label: "DIVIDEND", delta: divP, kind: "flow" },
    { label: "INT PAID", delta: intF, kind: "flow" },
    { label: "OTH FIN", delta: cffOther, kind: "flow" },
    { label: "CFF", delta: fcffin, kind: "sub" },
    { label: "NET ΔCASH", delta: netCalc, kind: "total" },
  ];

  // Golden-link identity checks
  const dRes = res - resP, dBorrow = borrow - borrowP, dPPE = (fixA + cwip) - (fixAP + cwipP);
  const checks: Array<{ link: string; lhs: number; rhs: number; why: string }> = [
    { link: "BS IDENTITY", lhs: totA, rhs: totL, why: "Assets must equal liabilities + equity (screener's Total Liabilities already includes equity)." },
    { link: "NPAT → RESERVES", lhs: dRes, rhs: npat + divP, why: "Reserves grow by profit kept after dividends; the gap is buybacks/OCI." },
    { link: "OCF WALK", lhs: ocf, rhs: ocfCalc, why: "Ops profit ± WC − taxes must foot to reported OCF." },
    { link: "CAPEX → PPE", lhs: dPPE, rhs: capexNet - depIS, why: "Δ block ≈ purchases − depreciation − disposals; gaps are revaluations/acquisitions." },
    { link: "DEBT WALK", lhs: dBorrow, rhs: debtNet, why: "BS borrowings should move with CFF debt issued − repaid." },
    { link: "NET CASH", lhs: netCash, rhs: netCalc, why: "OCF + ICF + CFF must equal the reported net change in cash." },
  ];

  // DuPont 5-factor + quality
  const taxB = ebt ? npat / ebt : 0, intB = ebit ? ebt / ebit : 0;
  const ebitM = sales ? ebit / sales : 0, at = totA ? sales / totA : 0, em = equity ? totA / equity : 0;
  const roe5 = taxB * intB * ebitM * at * em * 100;
  const roeD = equity ? (npat / equity) * 100 : 0;
  const ocfNpat = npat ? ocf / npat : 0;
  const accruals = totA ? ((npat - ocf) / totA) * 100 : 0;
  const fcfM = sales ? (fcfRep / sales) * 100 : 0;
  const capexOcf = ocf ? (Math.abs(capexBuy) / ocf) * 100 : 0;

  // 5Y OCF vs NPAT vs FCF trend
  const pers5 = data.pl.periods.filter((p) => !/TTM/i.test(p)).slice(-5);
  const SV = (t: STable | null, cands: string[], p: string): number => {
    const r = findRow(t, cands);
    const v = r ? r.values[(t as STable).periods.indexOf(p)] : null;
    return typeof v === "number" ? v : 0;
  };
  const trend = pers5.map((p) => ({
    p: p.replace("Mar ", "'"),
    npat: SV(data.pl, ["net profit", "profit after tax", "net income"], p),
    ocf: SV(data.cf, ["cash from operating activity", "operating cash flow"], p),
    fcf: SV(data.cf, ["free cash flow", "free cash flow"], p),
  }));
  const tMax = Math.max(1, ...trend.flatMap((t) => [t.npat, t.ocf, t.fcf]));

  const schedBusy = !cfo.done || !cfi.done || !cff.done;
  const step = (k: string, v: string, cls?: string) => <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{data.name} — linker · FY {per} · ₹ Cr</p>
        <div className="cells">
          <div className="cell"><div className="lbl">NPAT (IS)</div><div className="val">₹{fmtCr0(npat)} Cr</div><div className="sub">starting point</div></div>
          <div className="cell"><div className="lbl">OCF (CFS)</div><div className={`val ${ocf >= 0 ? "pos" : "neg"}`}>₹{fmtCr0(ocf)} Cr</div><div className="sub">cash earned</div></div>
          <div className="cell"><div className="lbl">Net Δcash</div><div className={`val ${netCash >= 0 ? "pos" : "neg"}`}>₹{fmtCr0(netCash)} Cr</div><div className="sub">ending point</div></div>
          <div className="cell"><div className="lbl">OCF / NPAT</div><div className={`val ${ocfNpat >= 1 ? "pos" : ocfNpat < 0.7 ? "neg" : ""}`}>{ocfNpat.toFixed(2)}×</div><div className="sub">&gt;1 = cash-backed</div></div>
          <div className="cell"><div className="lbl">Balance plug</div><div className={`val ${Math.abs(totA - totL) < 1 ? "pos" : "neg"}`}>{fmtCr0(totA - totL)}</div><div className="sub">A − (L+E)</div></div>
          <div className="cell"><div className="lbl">Breakups</div><div className="val" style={{ fontSize: 13 }}>{schedBusy ? "LOADING…" : "OCF·ICF·CFF ✓"}</div><div className="sub">live schedules</div></div>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Cash bridge — NPAT → net Δcash · FY {per} · green in / red out / amber subtotal</p>
        <Waterfall steps={steps} />
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
          READ LEFT→RIGHT: profit, ± non-cash and working capital, − taxes = OCF. Then investing, then financing. Amber bars are the three statements shaking hands.
        </p>
      </div>

      <div className="panel">
        <p className="p-head">Golden-link checks — does it foot?</p>
        <table className="plain">
          <thead><tr><th>LINK</th><th style={{ textAlign: "right" }}>LHS</th><th style={{ textAlign: "right" }}>RHS</th><th style={{ textAlign: "right" }}>GAP</th><th style={{ textAlign: "right" }}>STATUS</th></tr></thead>
          <tbody>
            {checks.map((c) => {
              const gap = c.lhs - c.rhs;
              const scale = Math.max(Math.abs(c.lhs), Math.abs(c.rhs), 1);
              const pass = Math.abs(gap) / scale < 0.02;
              return (
                <tr key={c.link} title={c.why}>
                  <td><strong>{c.link}</strong><div className="faint" style={{ fontSize: 11 }}>{c.why}</div></td>
                  <td style={{ textAlign: "right" }}>{fmtCr0(c.lhs)}</td>
                  <td style={{ textAlign: "right" }}>{fmtCr0(c.rhs)}</td>
                  <td style={{ textAlign: "right" }}><span className={pass ? "pos" : "neg"}>{gap >= 0 ? "+" : ""}{fmtCr0(gap)}</span></td>
                  <td style={{ textAlign: "right" }}><span className={`badge ${pass ? "ok" : "bad"}`}>{pass ? "✓ FOOTS" : "! GAP"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">DuPont 5-factor — ROE {roe5.toFixed(1)}% (direct {roeD.toFixed(1)}%)</p>
          {step("TAX BURDEN NPAT/EBT", taxB.toFixed(3))}
          {step("INTEREST BURDEN EBT/EBIT", intB.toFixed(3))}
          {step("EBIT MARGIN", `${(ebitM * 100).toFixed(1)}%`)}
          {step("ASSET TURNOVER", `${at.toFixed(2)}×`)}
          {step("EQUITY MULTIPLIER", `${em.toFixed(2)}×`)}
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>ROE = product × 100. Weak link glows first: here it is {(ebitM < 0.15 ? "MARGIN" : at < 0.5 ? "TURNOVER" : em > 2.5 ? "LEVERAGE" : "TAX/INTEREST DRAG")}.</p>
        </div>
        <div className="panel">
          <p className="p-head">Earnings quality</p>
          {step("OCF / NPAT", `${ocfNpat.toFixed(2)}×`, ocfNpat >= 1 ? "pos" : "neg")}
          {step("ACCRUALS (NI−CFO)/TA", `${accruals >= 0 ? "+" : ""}${accruals.toFixed(1)}%`, Math.abs(accruals) > 10 ? "neg" : "pos")}
          {step("FCF MARGIN", `${fcfM.toFixed(1)}%`)}
          {step("CAPEX / OCF", `${capexOcf.toFixed(0)}%`, capexOcf > 80 ? "neg" : "")}
          {step("PAYOUT (DIV/NPAT)", divP && npat ? `${(Math.abs(divP) / Math.abs(npat) * 100).toFixed(1)}%` : "—")}
          <div style={{ marginTop: 10 }}>
            <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>5Y OCF vs NPAT vs FCF — ₹ Cr</div>
            <svg viewBox="0 0 400 120" style={{ width: "100%", display: "block" }}>
              {trend.map((t, i) => {
                const gx = 12 + i * 78;
                const bars: Array<[number, string]> = [[t.npat, "#ffa028"], [t.ocf, "#00d664"], [t.fcf, "#00c8ff"]];
                return (
                  <g key={t.p}>
                    {bars.map(([v, c], j) => {
                      const h = Math.max(2, (Math.abs(v) / tMax) * 88);
                      return <rect key={j} x={gx + j * 22} y={104 - h} width={18} height={h} fill={c} opacity="0.9" rx={1}><title>{t.p} {fmtCr0(v)}</title></rect>;
                    })}
                    <text x={gx + 31} y={116} fontSize="9" fill="#5b5b62" textAnchor="middle">{t.p}</text>
                  </g>
                );
              })}
            </svg>
            <div className="muted" style={{ fontSize: 11 }}><span style={{ color: "#ffa028" }}>■ NPAT</span>{"  "}<span style={{ color: "#00d664" }}>■ OCF</span>{"  "}<span style={{ color: "#00c8ff" }}>■ FCF</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        {TUTOR.map(([h, b]) => (
          <div key={h} className="panel">
            <p className="p-head">{h}</p>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>{b}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- AI fundamental chat helper ---------------- */

export function useFundAI(symbol: string, context: string) {
  const [out, setOut] = useState("");
  const [loading, setLoading] = useState(false);
  async function ask(question: string) {
    setLoading(true); setOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.fundaHelper() },
        { role: "user", content: `SEC ${symbol}. LEDGER EXCERPT (USE ONLY THIS):\n${context.slice(0, 3000)}\nQ: ${question}\n${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setOut(txt);
    } catch (e: any) {
      setOut(`AI ERR: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }
  return { out, loading, ask };
}
