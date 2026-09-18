"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";

interface MRow {
  id: string; label: string; group: string; unit: string;
  latest?: string; date?: string; chg?: string; chgSign?: number;
  yoy?: string; yoyDate?: string | null; spark?: number[]; ok: boolean;
}

const GROUPS = ["US GROWTH", "US LABOR", "US INFLATION", "US RATES", "US MONEY", "US STATES", "US EXTERNAL", "US SENTIMENT", "INDIA", "GLOBAL", "CUSTOM"];

const CADENCE: Array<[string, string, string]> = [
  ["NFP + UNEMPLOYMENT", "MONTHLY · FIRST FRIDAY", "HIGHEST VOL — FX + RATES"],
  ["CPI", "MONTHLY · MID-MONTH", "RATE-CUT PRICING"],
  ["CORE PCE", "MONTHLY · LATE MONTH", "FED'S PREFERRED GAUGE"],
  ["PPI", "MONTHLY · MID-MONTH", "LEADS CPI"],
  ["JOBLESS CLAIMS", "WEEKLY · THURSDAY", "REAL-TIME LABOR PULSE"],
  ["HOUSING STARTS", "MONTHLY · MID-MONTH", "RATE-SENSITIVE GROWTH LEAD"],
  ["30Y MORTGAGE", "WEEKLY · THURSDAY", "HOUSING AFFORDABILITY ANCHOR"],
  ["M1 / M2", "MONTHLY · LATE MONTH", "LIQUIDITY BACKDROP"],
  ["RETAIL SALES", "MONTHLY · MID-MONTH", "70% OF US GDP"],
  ["ISM PMI", "MONTHLY · 1ST BUSINESS DAY", ">50 = EXPANSION · NO FREE FEED"],
  ["FOMC DECISION", "8× YEARLY", "STATEMENT + DOTS > VOTE"],
  ["RBI MPC", "6× YEARLY", "REPO + STANCE"],
];

function nextNFP(): string {
  const now = new Date();
  for (let m = 0; m < 2; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1);
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
    if (d.getTime() > now.getTime()) {
      return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).toUpperCase();
    }
  }
  return "—";
}

function Spark({ data }: { data: number[] }) {  if (!data || data.length < 2) return <span className="faint">—</span>;
  const mn = Math.min(...data), mx = Math.max(...data);
  const up = data[data.length - 1] >= data[0];
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 120).toFixed(1)},${(28 - 2 - ((v - mn) / (mx - mn || 1)) * 24).toFixed(1)}`).join(" ");
  return (
    <svg width={120} height={28} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.5" />
    </svg>
  );
}

const INDICATOR_INFO: Record<string, { title: string; what: string; why: string; freq: string; source: string }> = {
  PAYEMS: { title: "NFP PAYROLLS", what: "Total nonfarm payrolls — net new jobs added in the US economy.", why: "Broadest labor market gauge. A strong print = hawkish Fed, risk-on; weak = dovish, recession risk. Moves equities, bonds, FX within seconds.", freq: "MONTHLY · FIRST FRIDAY", source: "BLS · establishment survey" },
  UNRATE: { title: "UNEMPLOYMENT RATE", what: "Percentage of the labor force that is jobless and actively seeking work.", why: "Below 4% = tight labor market, wage pressure. Rising trend = weakening economy. Lagging indicator but drives Fed policy.", freq: "MONTHLY · WITH NFP", source: "BLS · household survey" },
  CPIAUCSL: { title: "CPI", what: "Consumer Price Index — measures change in prices paid by urban consumers for a basket of goods & services.", why: "Headline inflation gauge. Above target = hawkish pressure; below = rate-cut hopes. Energy/food swings cause noise — core strips those.", freq: "MONTHLY · MID-MONTH", source: "BLS" },
  PCEPILFE: { title: "CORE PCE", what: "Personal Consumption Expenditures price index excluding food & energy — the Fed's preferred inflation measure.", why: "What the Fed targets at 2%. Sticky above 2% = rates stay higher for longer. Key for FOMC dot plot and forward guidance.", freq: "MONTHLY · LATE MONTH", source: "BEA" },
  PPIACO: { title: "PPI", what: "Producer Price Index — measures price changes received by domestic producers for their output.", why: "Leading indicator for CPI — wholesale cost pressures filter to consumers with a lag. Rising PPI = future CPI upside.", freq: "MONTHLY · MID-MONTH", source: "BLS" },
  PPIFIS: { title: "PPI FINAL DEMAND", what: "PPI for final demand goods & services — the headline PPI series.", why: "Same as PPI but the primary published series. Watch for pipeline inflation building at producer level.", freq: "MONTHLY · MID-MONTH", source: "BLS" },
  CPILFESL: { title: "CORE CPI IDX", what: "CPI excluding food & energy — strips volatile components for underlying inflation trend.", why: "More persistent than headline. Drives the 'sticky inflation' narrative. Key input for real rate calculations.", freq: "MONTHLY · WITH CPI", source: "BLS" },
  CPIAUCNS: { title: "CPI NSA IDX", what: "CPI not seasonally adjusted — raw index level without seasonal adjustments.", why: "Used for indexation (TIPS, Social Security). Not for month-over-month analysis — seasonal patterns dominate.", freq: "MONTHLY · WITH CPI", source: "BLS" },
  PCEPI: { title: "PCE DEFLATOR", what: "Headline PCE price index including food & energy.", why: "Broad inflation measure. Divergence from core PCE signals energy/food shocks affecting consumption.", freq: "MONTHLY · WITH CORE PCE", source: "BEA" },
  GDPCTPI: { title: "GDP PRICE IDX", what: "GDP deflator — broadest inflation gauge covering all domestically produced goods & services.", why: "Catches inflation CPI/PCE miss (government spending, exports). Useful for long-run real GDP calculations.", freq: "QUARTERLY", source: "BEA" },
  CES0500000003: { title: "AVG HOURLY EARNINGS", what: "Average hourly earnings of all employees on private nonfarm payrolls.", why: "Wage growth proxy. Rising = inflationary pressure via wages-prices spiral. Impacts consumer spending outlook.", freq: "MONTHLY · WITH NFP", source: "BLS · establishment survey" },
  ICSA: { title: "JOBLESS CLAIMS", what: "Initial unemployment insurance claims — new filings for unemployment benefits.", why: "Real-time labor market pulse. Spike above 300K = red flag for economy. Weekly, so most timely labor data available.", freq: "WEEKLY · THURSDAY", source: "DOL" },
  RSAFS: { title: "RETAIL SALES", what: "Advance retail and food services sales — total receipts at retail and food services stores.", why: "Consumer spending = ~70% of US GDP. Strong sales = growth resilient; weakness = demand cracking. Watch control group for GDP impact.", freq: "MONTHLY · MID-MONTH", source: "Census Bureau" },
  INDPRO: { title: "IND PRODUCTION", what: "Industrial Production Index — output of factories, mines, and utilities.", why: "Manufacturing/growth gauge. Below 100 = below pre-pandemic trend. Declining trend = recession signal.", freq: "MONTHLY · MID-MONTH", source: "Fed" },
  GACDISA066MSFRBNY: { title: "EMPIRE MFG IDX", what: "NY Fed Empire State Manufacturing Survey — diffusion index of business conditions in NY state.", why: "Regional manufacturing pulse. >0 = expansion, <0 = contraction. Leading indicator for national ISM PMI.", freq: "MONTHLY · 1ST BUSINESS DAY", source: "NY Fed" },
  GDP: { title: "GDP SAAR", what: "Gross Domestic Product, seasonally adjusted annual rate — total value of all goods & services produced.", why: "The headline growth number. Positive = expansion, negative = recession. Market moves on surprise vs prior estimate.", freq: "QUARTERLY", source: "BEA" },
  BOPGSTB: { title: "TRADE BALANCE", what: "Trade balance — exports minus imports of goods & services.", why: "Widening deficit = USD strength headwind, capital inflows. Narrowing = potential growth drag from net exports.", freq: "MONTHLY", source: "Census / BEA" },
  UMCSENT: { title: "MICHIGAN SENTIMENT", what: "University of Michigan Consumer Sentiment Index — survey of consumer confidence.", why: "Forward-looking spending gauge. Low sentiment = cautious consumers = slower growth. Inflation expectations component watched by Fed.", freq: "MONTHLY · MID & END", source: "U. of Michigan" },
  CPALTT01INM659N: { title: "INDIA CPI", what: "India Consumer Price Index — measures inflation for Indian consumers.", why: "RBI's primary inflation target gauge. Above 6% upper band = hawkish RBI; below = rate cut room. Drives India bond/equity flows.", freq: "MONTHLY · MID-MONTH", source: "MOSPI · India" },
  IRSTCI01INM156N: { title: "INDIA CALL RATE", what: "India overnight call money rate — interbank lending rate proxy for policy stance.", why: "Reflects RBI liquidity management. Above repo = tight; below = surplus. Signals money market stress or ease.", freq: "MONTHLY", source: "RBI" },
};

function IndicatorTooltip({ series, event, anchor }: { series: string; event: string; anchor: { x: number; y: number } | null }) {
  if (!anchor) return null;
  const info = INDICATOR_INFO[series];
  const title = info?.title ?? event;
  const what = info?.what ?? "Economic release tracked by FRED.";
  const why = info?.why ?? "Market impact depends on surprise vs consensus.";
  const freq = info?.freq ?? "";
  const source = info?.source ?? "FRED";
  return (
    <div style={{
      position: "fixed", left: anchor.x + 12, top: anchor.y - 8, zIndex: 9999,
      maxWidth: 380, minWidth: 280, background: "#0a0a0c", border: "1px solid #ffa028",
      borderRadius: 3, padding: "10px 12px", fontFamily: "var(--mono)", fontSize: 12,
      lineHeight: 1.55, color: "#c9c9cf", pointerEvents: "none",
      boxShadow: "0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,160,40,0.15)",
    }}>
      <div style={{ color: "#ffa028", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <div style={{ marginBottom: 5 }}><span style={{ color: "#666" }}>WHAT: </span>{what}</div>
      <div style={{ marginBottom: 5 }}><span style={{ color: "#666" }}>WHY IT MATTERS: </span>{why}</div>
      {freq && <div style={{ marginBottom: 3 }}><span style={{ color: "#666" }}>CADENCE: </span>{freq}</div>}
      <div style={{ color: "#555", fontSize: 10, marginTop: 4 }}>SOURCE: {source}</div>
    </div>
  );
}

interface CalRow {
  date: string; inDays: number; timeET: string; timeIST: string;
  event: string; group: string; imp: string; period: string;
  prior: string; actual: string; series: string; release: string; statik?: boolean;
}

function downloadCalCSV(name: string, rows: CalRow[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [["DATE", "IN_DAYS", "TIME_ET", "TIME_IST", "EVENT", "PERIOD", "PRIOR", "ACTUAL", "IMP", "GROUP", "SERIES"],
    ...rows.map((r) => [r.date, String(r.inDays), r.timeET, r.timeIST, r.event, r.period, r.prior, r.actual, r.imp, r.group, r.series])]
    .map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Terminal ECO-style agenda: FRED official release dates + prior/actual.
// Custom calendar = group + importance + text filters; needs FRED key
// (server env key works — override in SETTINGS).
function EcoCalendar() {
  const [up, setUp] = useState<CalRow[]>([]);
  const [rec, setRec] = useState<CalRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [grp, setGrp] = useState("ALL");
  const [imp, setImp] = useState("ALL");
  const [narrow, setNarrow] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [tipSeries, setTipSeries] = useState<string | null>(null);
  const [tipEvent, setTipEvent] = useState("");
  const [tipAnchor, setTipAnchor] = useState<{ x: number; y: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showExplain, setShowExplain] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    const fk = store.getFredKey();
    fetch(`/api/macro/calendar${fk ? `?fkey=${encodeURIComponent(fk)}` : ""}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "calendar failed");
        if (alive) { setUp(j.upcoming ?? []); setRec(j.recent ?? []); }
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const groups = ["ALL", ...Array.from(new Set([...up, ...rec].map((r) => r.group)))];
  const pass = (r: CalRow) =>
    (grp === "ALL" || r.group === grp) &&
    (imp === "ALL" || r.imp === imp) &&
    (!narrow || (r.event + " " + r.series).toUpperCase().includes(narrow.toUpperCase()));
  const upF = up.filter(pass), recF = rec.filter(pass);
  const inLbl = (d: number) => (d === 0 ? "TODAY" : d > 0 ? `D-${d}` : `D+${Math.abs(d)}`);

  const askAI = useCallback(async () => {
    setAiLoading(true); setAiOut("");
    try {
      const upcoming = upF.slice(0, 10).map((r) => `${r.event} ${r.series} ACT=${r.actual} PRIOR=${r.prior} IMP=${r.imp} IN=${r.inDays}d`).join("; ");
      const recent = recF.slice(0, 5).map((r) => `${r.event} ${r.series} ACT=${r.actual} PRIOR=${r.prior}`).join("; ");
      const txt = await chatComplete([
        { role: "system", content: aiSystem.macroCalendar() },
        { role: "user", content: `UPCOMING: ${upcoming || "NONE"}. RECENT: ${recent || "NONE"}. TASK: KEY THEME + TOP 3 EVENTS + SURPRISES READ + 2 RISKS. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) { setAiOut(`AI ERR: ${e.message}`); }
    finally { setAiLoading(false); }
  }, [upF, recF]);

  const tbl = (rows: CalRow[], showIn: boolean) => (
    <table className="plain">
      <thead><tr>
        {showIn && <th>IN</th>}<th>DATE</th><th>TIME ET</th><th>TIME IST</th><th>EVENT</th>
        <th>PERIOD</th><th style={{ textAlign: "right" }}>PRIOR</th><th style={{ textAlign: "right" }}>ACTUAL</th><th style={{ textAlign: "right" }}>IMP</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.date}-${r.series}-${i}`}>
            {showIn && (
              <td>{r.inDays === 0
                ? <span className="badge fnc">TODAY</span>
                : <span className={r.inDays <= 3 ? "sec" : "faint"}>{inLbl(r.inDays)}</span>}</td>
            )}
            <td style={{ whiteSpace: "nowrap" }}>{r.date.slice(5).replace("-", "/")}<span className="faint"> {r.date.slice(0, 4)}</span></td>
            <td className="faint">{r.timeET}</td>
            <td className="faint">{r.timeIST}</td>
            <td
              onMouseEnter={(e) => {
                if (!showExplain) return;
                if (tipTimer.current) clearTimeout(tipTimer.current);
                const rect = e.currentTarget.getBoundingClientRect();
                setTipSeries(r.series); setTipEvent(r.event);
                setTipAnchor({ x: rect.right + 4, y: rect.top });
              }}
              onMouseLeave={() => {
                tipTimer.current = setTimeout(() => { setTipSeries(null); setTipAnchor(null); }, 120);
              }}
              style={{ cursor: showExplain ? "help" : undefined }}
            >
              <strong>{r.event}</strong>{r.statik && <span className="faint" style={{ fontSize: 10 }}> · STATIC</span>}<div className="faint" style={{ fontSize: 10.5 }}>{r.series}</div>
            </td>
            <td>{r.period}</td>
            <td style={{ textAlign: "right" }} className="muted">{r.prior}</td>
            <td style={{ textAlign: "right" }}>{r.actual === "—" ? <span className="faint">—</span> : <strong className="sec">{r.actual}</strong>}</td>
            <td style={{ textAlign: "right" }}>{r.imp === "HIGH" ? <span className="badge bad">HIGH</span> : r.imp === "MED" ? <span className="badge fnc">MED</span> : <span className="faint">LOW</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="panel panel-glow">
      <p className="p-head">Economic calendar — ECO · FRED release dates{up.length + rec.length > 0 ? ` · ${upF.length + recF.length} EVENTS` : ""}</p>
      <div className="toolbar">
        <div className="pills">
          {groups.map((g) => (
            <button key={g} className={`pill${grp === g ? " active" : ""}`} onClick={() => setGrp(g)}>{g.replace("US ", "")}</button>
          ))}
        </div>
        <div className="pills">
          {["ALL", "HIGH"].map((v) => (
            <button key={v} className={`pill${imp === v ? " active" : ""}`} onClick={() => setImp(v)}>{v === "ALL" ? "ALL IMP" : "★ HIGH"}</button>
          ))}
        </div>
        <input
          className="box" value={narrow} onChange={(e) => setNarrow(e.target.value.toUpperCase())}
          placeholder="<NARROW> (E.G. CPI)" style={{ maxWidth: 220 }} spellCheck={false} autoComplete="off"
        />
        {(upF.length > 0 || recF.length > 0) && (
          <button className="ghost" onClick={() => downloadCalCSV("eco-calendar.csv", [...upF, ...recF])}>↓ CSV</button>
        )}
        <button className={`pill${showExplain ? " active" : ""}`} onClick={() => setShowExplain(!showExplain)}>{showExplain ? "EXPLAIN ● ON" : "EXPLAIN OFF"}</button>
      </div>
      {loading && <p className="muted">PULLING RELEASE SCHEDULE…</p>}
      {err && <p className="neg">ERR: {err} — {err.includes("FRED key") ? <a href="/settings">SET KEY IN SETTINGS ↗</a> : "RETRY"}</p>}
      {!loading && !err && upF.length === 0 && recF.length === 0 && <p className="muted">NO EVENTS FOR THIS FILTER.</p>}
      {upF.length > 0 && (
        <>
          <p className="p-head" style={{ marginTop: 10 }}>Upcoming — next 45 days</p>
          <div style={{ overflowX: "auto" }}>{tbl(upF, true)}</div>
        </>
      )}
      {recF.length > 0 && (
        <>
          <p className="p-head" style={{ marginTop: 10 }}>Recent — past 14 days</p>
          <div style={{ overflowX: "auto" }}>{tbl(recF, false)}</div>
        </>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
        SURV(M) OMITTED — NO FREE CONSENSUS FEED EXISTS ON FRED. TIMES = TYPICAL ET RELEASE TIMES (STATIC). PERIOD = REPORTED MONTH DERIVED FROM RELEASE DATE.
      </p>
      <div style={{ borderTop: "1px solid #26262b", marginTop: 10, paddingTop: 10 }}>
        <p className="p-head">AI analyst — ECO</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : "RUN AI ON CALENDAR"}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
      {showExplain && <IndicatorTooltip series={tipSeries ?? ""} event={tipEvent} anchor={tipAnchor} />}
    </div>
  );
}

interface MxCell { v: number | null; d: string | null }
interface MxRow { c: string; gdp: MxCell; cpi: MxCell; une: MxCell; rate: MxCell }

const MX_VIEWS = ["ALL", "GDP", "CPI", "LABOR", "RATES"] as const;

function shiftISO(iso: string, months: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return s > today ? today : s;
}
const mxDate = (d: string | null) => (d ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : "—");
const mxVal = (v: number | null) => (v === null ? "—" : `${v.toFixed(v % 1 === 0 ? 1 : 2)}%`);

// Global Economic Matrix (ECMX): countries × indicators as of a chosen
// date. Steppers walk history; view pills = custom views.
function EcmxMatrix() {
  const t = new Date();
  const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const [asof, setAsof] = useState(today);
  const [rows, setRows] = useState<MxRow[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<string>("ALL");

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/macro/matrix?asof=${asof}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "matrix failed");
        if (alive) setRows(j.rows ?? []);
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [asof]);

  const extremes = (k: keyof MxRow) => {
    const vs = rows.map((r) => (r[k] as MxCell).v).filter((v): v is number => v !== null);
    if (!vs.length) return { hi: null as number | null, lo: null as number | null };
    return { hi: Math.max(...vs), lo: Math.min(...vs) };
  };
  const ex = { gdp: extremes("gdp"), cpi: extremes("cpi"), une: extremes("une"), rate: extremes("rate") };
  const cell = (r: MxRow, k: "gdp" | "cpi" | "une" | "rate", invert = false) => {
    const c = r[k];
    if (c.v === null) return <><span className="faint">—</span> <span className="faint" style={{ fontSize: 11 }}>—</span></>;
    const e = ex[k];
    const best = e.hi !== null && c.v === e.hi, worst = e.lo !== null && c.v === e.lo;
    const good = invert ? worst : best, bad = invert ? best : worst;
    return (
      <>
        <span className={good ? "pos" : bad ? "neg" : ""} style={{ fontVariantNumeric: "tabular-nums" }}>
          {good ? "▲ " : bad ? "▼ " : ""}{mxVal(c.v)}
        </span>{" "}
        <span className="faint" style={{ fontSize: 11 }}>{mxDate(c.d)}</span>
      </>
    );
  };
  const show = (k: string) => view === "ALL" || view === k;

  return (
    <div className="panel">
      <p className="p-head">Global economic matrix — ECMX · as of {asof}{rows.length > 0 ? ` · ${rows.length} countries` : ""}</p>
      <div className="toolbar">
        <div className="pills">
          <button className="pill" onClick={() => setAsof((a) => shiftISO(a, -12))} title="-1 year">««</button>
          <button className="pill" onClick={() => setAsof((a) => shiftISO(a, -1))} title="-1 month">«</button>
          <button className="pill" onClick={() => setAsof((a) => shiftISO(a, 1))} title="+1 month">»</button>
          <button className="pill" onClick={() => setAsof(today)} title="today">»» TODAY</button>
        </div>
        <div className="pills">
          {MX_VIEWS.map((v) => (
            <button key={v} className={`pill${view === v ? " active" : ""}`} onClick={() => setView(v)}>{v}</button>
          ))}
        </div>
        {loading && <span className="muted">LOADING MATRIX…</span>}
      </div>
      {err && <p className="neg">ERR: {err}</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="plain">
            <thead><tr>
              <th>COUNTRY</th>
              {show("GDP") && <th style={{ textAlign: "right" }}>REAL GDP YOY</th>}
              {show("CPI") && <th style={{ textAlign: "right" }}>CPI YOY</th>}
              {show("LABOR") && <th style={{ textAlign: "right" }}>UNEMPLOYMENT</th>}
              {show("RATES") && <th style={{ textAlign: "right" }}>CENTRAL RATE</th>}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.c}>
                  <td><strong className="sec">{r.c.toUpperCase()}</strong></td>
                  {show("GDP") && <td style={{ textAlign: "right" }}>{cell(r, "gdp")}</td>}
                  {show("CPI") && <td style={{ textAlign: "right" }}>{cell(r, "cpi", true)}</td>}
                  {show("LABOR") && <td style={{ textAlign: "right" }}>{cell(r, "une", true)}</td>}
                  {show("RATES") && <td style={{ textAlign: "right" }}>{cell(r, "rate")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>
        YOY COMPUTED FROM FRED LEVELS (US GDP NATIVE YOY; JP/CA/AU/IN CPI = WORLD BANK ANNUAL). ▲▼ = COLUMN BEST/WORST — INVERTED FOR CPI/UNEMPLOYMENT (LOWER = HEALTHIER). UK CPI: NO LIVE FRED SERIES (OECD VINTAGES END MAR-2025).
      </p>
    </div>
  );
}

interface FcRow { label: string; unit: string; hist: Record<string, number>; fwd: Record<string, number> }

// Economic Forecasts (ECFC): annual history + FOMC SEP medians (US).
// Country pills switch the whole table; non-US prints history only.
// Clicking a row graphs that indicator below (history solid, FWD dashed).
function EcfcForecasts() {
  const [country, setCountry] = useState("us");
  const [countries, setCountries] = useState<Array<{ slug: string; label: string }>>([]);
  const [countryLabel, setCountryLabel] = useState("UNITED STATES");
  const [years, setYears] = useState<number[]>([]);
  const [fwdYears, setFwdYears] = useState<number[]>([]);
  const [rows, setRows] = useState<FcRow[]>([]);
  const [note, setNote] = useState("");
  const [foot, setFoot] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    const fk = store.getFredKey();
    const qs = new URLSearchParams({ country });
    if (fk) qs.set("fkey", fk);
    fetch(`/api/macro/forecasts?${qs.toString()}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "forecasts failed");
        if (alive) {
          setYears(j.histYears ?? []); setFwdYears(j.fwdYears ?? []);
          setRows(j.rows ?? []); setNote(j.fwdNote ?? "");
          setFoot(j.foot ?? "");
          if (j.countries?.length) setCountries(j.countries);
          if (j.countryLabel) setCountryLabel(j.countryLabel);
          setActive(0); setHover(null);
        }
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [country]);

  const showHist = years.slice(-8);
  const row = rows[active];
  const f = (v: number | undefined, unit: string) => {
    if (v === undefined) return "—";
    return unit === "K" ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : `${v.toFixed(1)}${unit === "%" ? "%" : ""}`;
  };

  // Chart points: history then forwards, continuous line split by style.
  const hx = showHist.filter((y) => row?.hist[y] !== undefined);
  const fx = fwdYears.filter((y) => row?.fwd[y] !== undefined);
  const allX = [...hx, ...fx];
  const allV = [...hx.map((y) => row.hist[y]), ...fx.map((y) => row.fwd[y])];
  const lo = allV.length ? Math.min(...allV) : 0, hi = allV.length ? Math.max(...allV) : 1;
  const W = 640, H = 130;
  const X = (i: number) => (i / Math.max(allX.length - 1, 1)) * (W - 8) + 4;
  const Y = (v: number) => H - 16 - ((v - lo) / (hi - lo || 1)) * (H - 32);
  const splitAt = hx.length - 1;
  const histPts = hx.map((_, i) => `${X(i).toFixed(1)},${Y(allV[i]).toFixed(1)}`).join(" ");
  const fwdPts = [splitAt, ...fx.map((_, j) => splitAt + 1 + j)].map((i) => `${X(i).toFixed(1)},${Y(allV[i]).toFixed(1)}`).join(" ");

  return (
    <div className="panel">
      <p className="p-head">Economic forecasts — ECFC · {countryLabel} · click a row to graph{note ? ` · ${note}` : ""}</p>
      <div className="toolbar">
        <div className="pills">
          {countries.map((c) => (
            <button key={c.slug} className={`pill${country === c.slug ? " active" : ""}`} onClick={() => setCountry(c.slug)}>
              {c.slug === "us" ? "US" : c.label.replace("UNITED ", "")}
            </button>
          ))}
        </div>
        {loading && <span className="muted">PULLING HISTORY + SEP…</span>}
      </div>
      {err && <p className="neg">ERR: {err}</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="plain">
            <thead><tr>
              <th>INDICATOR</th>
              {showHist.map((y) => <th key={y} style={{ textAlign: "right" }}>{y}</th>)}
              {fx.map((y) => <th key={`f${y}`} style={{ textAlign: "right", color: "var(--amber)" }}>{y}F</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => {
                const hasFwd = fx.some((y) => r.fwd[y] !== undefined);
                return (
                  <tr key={r.label} onClick={() => { setActive(i); setHover(null); }} style={{ cursor: "pointer", background: i === active ? "rgba(255,160,40,0.07)" : undefined }}>
                    <td><strong className={i === active ? "sec" : ""}>{i + 1}) {r.label}</strong> <span className="faint" style={{ fontSize: 10.5 }}>{r.unit}{hasFwd ? " · FWD" : ""}</span></td>
                    {showHist.map((y) => (
                      <td key={y} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.hist[y] === undefined ? <span className="faint">—</span> : <span className={r.unit === "%" && r.label.includes("UNEMP") ? "" : r.hist[y] >= 0 ? "pos" : "neg"}>{f(r.hist[y], r.unit)}</span>}
                      </td>
                    ))}
                    {fx.map((y) => (
                      <td key={`f${y}`} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {r.fwd[y] === undefined ? <span className="faint">—</span> : <strong style={{ color: "var(--amber)" }}>{f(r.fwd[y], r.unit)}</strong>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {row && allX.length > 1 && (
        <div style={{ marginTop: 10 }}>
          <p className="p-head">{row.label} — {row.unit}{fx.length > 0 ? " · solid = history · dashed = SEP" : ""}</p>
          <svg
            viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", cursor: "crosshair" }} preserveAspectRatio="none"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.round(((e.clientX - rect.left) / Math.max(rect.width, 1)) * (allX.length - 1));
              setHover(Math.max(0, Math.min(allX.length - 1, i)));
            }}
            onMouseLeave={() => setHover(null)}
          >
            <polyline points={histPts} fill="none" stroke="#ffa028" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
            {fx.length > 0 && <polyline points={fwdPts} fill="none" stroke="#00c8ff" strokeWidth="1.6" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
            {allX.map((y, i) => (
              <circle key={y} cx={X(i)} cy={Y(allV[i])} r={hover === i ? 4 : 2} fill={i > splitAt ? "#00c8ff" : "#ffa028"} />
            ))}
            {hover !== null && (
              <g>
                <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <text x={Math.min(X(hover) + 8, W - 118)} y="14" fontSize="11" fill="#f5f5f4" fontWeight="700">
                  {allX[hover]}{hover > splitAt ? "F" : ""} · {f(allV[hover], row.unit)}
                </text>
              </g>
            )}
            <text x="4" y={H - 4} fontSize="9" fill="#5b5b62">{allX[0]}</text>
            <text x={W - 4} y={H - 4} fontSize="9" fill="#5b5b62" textAnchor="end">{allX[allX.length - 1]}F</text>
          </svg>
        </div>
      )}
      <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>{foot || "HIST = ANNUAL AVG OF FRED OBS (YOY WHERE MARKED)."}</p>
    </div>
  );
}

export default function MacroPage() {  const [rows, setRows] = useState<MRow[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [keyed, setKeyed] = useState(false);
  const [sq, setSq] = useState("");
  const [sres, setSres] = useState<Array<{ id: string; title: string; units: string; frequency: string }>>([]);
  const [smsg, setSmsg] = useState("");

  function loadBoard() {
    setLoading(true); setErr("");
    const params = new URLSearchParams();
    const fk = store.getFredKey();
    if (fk) params.set("fkey", fk);
    const extra = store.getMacroExtra();
    if (extra.length) params.set("extra", extra.join(","));
    const qs = params.toString();
    fetch(`/api/macro${qs ? `?${qs}` : ""}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "macro failed");
        setRows(j.rows ?? []);
        setTotal(j.of ?? 0);
        setKeyed(!!j.keyed);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadBoard(); }, []);

  async function search() {
    const q = sq.trim();
    if (!q) return;
    setSmsg("SEARCHING…");
    setSres([]);
    try {
      const params = new URLSearchParams({ q });
      const fk = store.getFredKey();
      if (fk) params.set("fkey", fk);
      const r = await fetch(`/api/macro/search?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "search failed");
      setSres(j.results ?? []);
      setSmsg(j.results?.length ? "" : "NO MATCHES — TRY FEWER WORDS.");
    } catch (e: any) {
      setSmsg(e.message);
    }
  }

  function addSeries(id: string) {
    const cur = store.getMacroExtra();
    if (!cur.includes(id)) store.setMacroExtra([...cur, id].slice(0, 8));
    setSq(""); setSres([]); setSmsg(`PINNED ${id} — RELOADING BOARD…`);
    loadBoard();
  }

  function dropSeries(id: string) {
    store.setMacroExtra(store.getMacroExtra().filter((x) => x !== id));
    loadBoard();
  }

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId="111" symbol={store.getTicker()} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }}>TERMINAL ▦</a>
          </div>
        </div>
        <div className="panel panel-glow">
          <p className="p-head">Macro indicators — FRED feed · {rows.filter((r) => r.ok).length}/{total} live{keyed ? " · KEYED META" : ""}</p>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 4px 0" }}>
            MARKETS PRICE THE <span className="sec">SURPRISE VS CONSENSUS</span>, NOT THE LEVEL · NEXT NFP: <span className="sec">{nextNFP()}</span>
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <input
              className="box" value={sq} onChange={(e) => setSq(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") search(); }}
              placeholder="FIND SERIES… (E.G. ISM PMI) + ENTER — NEEDS FRED KEY"
              style={{ flex: 2 }}
            />
            <button className="ghost" onClick={search}>SEARCH</button>
            {smsg && <span className="muted" style={{ fontSize: 12 }}>{smsg}</span>}
          </div>
          {sres.length > 0 && (
            <table className="plain" style={{ marginTop: 8 }}>
              <thead><tr><th>ID</th><th>TITLE</th><th>UNITS</th><th style={{ textAlign: "right" }}>ADD</th></tr></thead>
              <tbody>
                {sres.map((s) => (
                  <tr key={s.id}>
                    <td><span className="sec">{s.id}</span></td>
                    <td style={{ fontSize: 12 }}>{s.title.slice(0, 90)}</td>
                    <td className="faint" style={{ fontSize: 11 }}>{s.units} · {s.frequency}</td>
                    <td style={{ textAlign: "right" }}><button className="ghost" style={{ padding: "4px 10px" }} onClick={() => addSeries(s.id)}>+ PIN</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {store.getMacroExtra().length > 0 && (
            <div className="pills" style={{ marginTop: 8 }}>
              <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>PINNED:</span>
              {store.getMacroExtra().map((id) => (
                <span key={id} className="badge cat" style={{ padding: "6px 8px" }}>
                  {id} <a href="#" onClick={(e) => { e.preventDefault(); dropSeries(id); }} style={{ color: "inherit" }}>✕</a>
                </span>
              ))}
            </div>
          )}
          {loading && <p className="muted">PULLING FRED…</p>}
          {err && <p className="neg">ERR: {err}</p>}
        </div>

        <EcoCalendar />

        <EcmxMatrix />

        <EcfcForecasts />

        {GROUPS.map((g) => {
          const list = rows.filter((r) => r.group === g && r.ok);
          if (!list.length) return null;
          return (
            <div className="panel" key={g}>
              <p className="p-head">{g}</p>
              <table className="plain">
                <thead><tr><th>INDICATOR</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>PREV Δ</th><th style={{ textAlign: "right" }}>YOY</th><th style={{ textAlign: "right" }}>AS OF</th><th style={{ textAlign: "right" }}>2Y TREND</th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id}>
                      <td><strong>{r.label}</strong> <span className="faint" style={{ fontSize: 11 }}>{r.unit}</span></td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}><strong>{r.latest}</strong></td>
                      <td style={{ textAlign: "right" }}><span className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</span></td>
                      <td style={{ textAlign: "right" }} className="muted">{r.yoy}</td>
                      <td style={{ textAlign: "right", fontSize: 11 }} className="faint">{r.date}</td>
                      <td style={{ textAlign: "right" }}><Spark data={r.spark ?? []} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}

        <div className="panel">
          <p className="p-head">Release cadence — when volatility lands</p>
          <table className="plain">
            <thead><tr><th>RELEASE</th><th>CADENCE</th><th style={{ textAlign: "right" }}>WHY IT MOVES</th></tr></thead>
            <tbody>
              {CADENCE.map(([a, b, c]) => (
                <tr key={a}>
                  <td><strong className="sec">{a}</strong></td>
                  <td>{b}</td>
                  <td style={{ textAlign: "right" }} className="muted">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11.5 }}>
            RULE OF THUMB: GOOD DATA CAN SPOOK EQUITIES IF IT KEEPS HAWKS HIGHER-FOR-LONGER · WATCH YIELD CURVE (10Y−2Y ABOVE) FOR RECESSION SIGNAL.
          </p>
        </div>
      </main>
      <StatusBar extra="MACRO" />
    </>
  );
}
