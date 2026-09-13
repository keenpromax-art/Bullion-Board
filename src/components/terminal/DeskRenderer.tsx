"use client";

import { useEffect, useRef, useState } from "react";
import { MODULE_MAP, MODULES } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete } from "@/lib/ai";
import { fmtINR, fmtPct, fmtNum } from "@/lib/utils";
import FunctionDirectory from "@/components/FunctionDirectory";
import DeskOutput from "@/components/DeskOutput";
import { NewsDesk, MarketDesk, ScreenerDesk, BacktestDesk, PolyDesk, CompanyDesk } from "@/components/ModuleDesks";
import { SectorDesk } from "@/components/SectorDesks";
import { StatementsTerminal } from "@/components/StatementsTerminal";
import { RiskTerminal } from "@/components/RiskTerminal";
import { CompanyStrip, FundaTables, DCFDesk, LBODesk, FundaMenu, StmtChartsDesk, DupontDesk, ForensicDesk, AnalyzerDesk, HistoryDesk, LinkerDesk } from "@/components/FundaDesks";
import { VolTerm, MLDossier, PairDesk, FactorDesk, DayDesk, MertonDesk, RollingRiskDesk } from "@/components/QuantDesks";
import { WikiDesk, BibleDesk, LinkDesk, AIDesk } from "@/components/ReaderDesks";
import { DVDesk, OwnDesk } from "@/components/DivOwnDesks";
import { ANRDesk, CastDesk } from "@/components/CapitalDesks";
import { ChartDesk, FrontierPanel, NetPanel, ChartPanels, ReturnsDesk } from "@/components/ChartDesks";
import { Histogram, EquityDrawdown } from "@/components/charts";
import { WatchPanel, StratMini, FundaMini, AIMini } from "./MiniDesks";
import OptionsStrategyDesk from "@/components/OptionsStrategyDesk";
import { analyseChain, calcSuggestion, expiryToDays } from "@/lib/ochain";

// Central desk dispatcher for Panel.tsx. Renders the SAME desk components
// as /module/[id] but without page chrome (no CommandBar/StatusBar, no
// 100vh assumptions). Wrapper fills its panel via .desk-fill (min-height 0,
// internal scroll) — never owns the viewport.

const NEWS_FEED: Record<string, string> = {
  "34": "company", "37": "company", "44": "finshots",
  "45": "nbfc", "46": "mint", "47": "wire",
  "41": "wire", "65": "wire", "72": "editorials",
};
const NEWS_INITQ: Record<string, string> = { "41": "BULK DEAL BLOCK DEAL", "65": "IPO GMP LISTING" };
const SCREENER_KIND: Record<string, string> = { "21": "momentum", "67": "all", "74": "swing", "75": "dip" };
const BACKTEST_CFG: Record<string, { strat: string; title: string }> = {
  "30": { strat: "mr", title: "MEAN REVERSION LAB" },
  "68": { strat: "ma", title: "STRATEGY TESTER" },
  "69": { strat: "ma", title: "MULTI-STRATEGY ARENA" },
};
const MARKET_IDS = new Set(["38", "53"]);

// Desks where a ticker is meaningless: news wires, market/macro boards,
// screeners, readers, portfolio-style tools. Panels and headers hide the
// symbol chrome for these (data flow untouched — symbol stays in spec).
export const SYMBOL_LESS = new Set([
  "21", "38", "41", "44", "45", "46", "47", "49", "51", "53",
  "65", "67", "72", "73", "74", "75",
  "101", "102", "104", "107", "108", "109", "110", "111", "114",
]);

function DeskHead({ funcId, symbol }: { funcId: string; symbol: string }) {
  const mod = MODULE_MAP[funcId];
  if (!mod) return null;
  // Symbol-less desks show no header block at all — the panel chrome
  // already names the function.
  if (!symbol || SYMBOL_LESS.has(funcId)) return null;
  return (
    <div className="desk-head">
      <span className="sec-name" style={{ fontSize: 20 }}>
        {symbol ? symbol.replace(".NS", "") : mod.label.toUpperCase()}
        <span className="suffix"> {symbol ? "<EQUITY> " : ""}{funcCode(funcId)} &lt;GO&gt;</span>
      </span>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {mod.label.toUpperCase()} · {mod.pyFn} · {mod.category.toUpperCase()}
      </div>
    </div>
  );
}

function NotesMini() {
  const [notes, setNotes] = useState(() => { try { return store.getNotes(); } catch { return []; } });
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  function add() {
    const id = notes.length ? Math.max(...notes.map((x) => x.id)) + 1 : 1;
    const now = new Date().toISOString();
    const next = [...notes, { id, title: title || "UNTITLED", content: text, ticker: null, tags: [], pinned: false, created: now, modified: now }];
    setNotes(next);
    store.setNotes(next);
    setTitle(""); setText("");
  }
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="toolbar">
        <input className="box" value={title} onChange={(e) => setTitle(e.target.value.toUpperCase())} placeholder="TITLE…" style={{ flex: 1 }} />
      </div>
      <textarea className="box" value={text} onChange={(e) => setText(e.target.value)} placeholder="THESIS…" rows={3} style={{ width: "100%" }} />
      <div><button className="btn" onClick={add}>+ NEW NOTE</button></div>
      {notes.slice(-8).reverse().map((n) => (
        <div key={n.id} className="kv"><span className="muted">#{n.id} {n.title}</span><strong style={{ fontSize: 12 }}>{n.content.slice(0, 80)}</strong></div>
      ))}
      {notes.length === 0 && <p className="muted">NO RECORDS — LOG FIRST THESIS ABOVE.</p>}
      <a href="/notes" style={{ fontSize: 12 }}>FULL NOTES DESK →</a>
    </div>
  );
}

function DirectoryMini({ symbol, onPickHere, onPickNew }: {
  symbol: string;
  onPickHere: (modId: string) => void;
  onPickNew?: (modId: string) => void;
}) {
  const [q, setQ] = useState("");
  const mods = MODULES.filter((m) => !m.hidden).filter((m) => {
    const s = q.trim().toUpperCase();
    if (!s) return true;
    return m.label.toUpperCase().includes(s) || funcCode(m.id) === s || m.id === s;
  });
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="toolbar"><input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="FILTER: NAME, FNC…" /></div>
      <FunctionDirectory
        ticker={symbol || "RELIANCE.NS"} modules={mods} total={MODULES.filter((m) => !m.hidden).length}
        onPickHere={(m) => onPickHere(m.id)}
        onPickNew={onPickNew ? (m) => onPickNew(m.id) : undefined}
      />
    </div>
  );
}

function OChainMini({ symbol }: { symbol: string }) {
  const sym = symbol && !symbol.includes(".NS") ? symbol : "NIFTY";
  const [expiry, setExpiry] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [spot, setSpot] = useState(0);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/ochain/expiry?symbol=${encodeURIComponent(sym)}&mode=Index`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "expiry failed");
        if (alive && j.expiries?.length) {
          setExpiry(j.expiries[0]);
        }
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [sym]);
  useEffect(() => {
    if (!expiry) return;
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/ochain/chain?symbol=${encodeURIComponent(sym)}&expiry=${encodeURIComponent(expiry)}&mode=Index`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "chain failed");
        if (alive) { setRows(j.rows ?? []); setSpot(j.underlying ?? 0); }
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sym, expiry]);
  const m = (() => {
    try {
      if (!rows.length || !spot) return null;
      const strikes = [...new Set(rows.map((r) => r.strike))].sort((a, b) => a - b);
      const atm = strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a), strikes[0]);
      return { a: analyseChain(rows, atm, 1000, spot), atm };
    } catch { return null; }
  })();
  const sug = m ? calcSuggestion(m.a, spot) : null;
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="cells">
        <div className="cell"><div className="lbl">Spot</div><div className="val" style={{ fontSize: 16 }}>{spot ? spot.toLocaleString("en-IN") : "—"}</div><div className="sub">{sym} · {expiry || "NO EXPIRY"}</div></div>
        <div className="cell"><div className="lbl">PCR</div><div className={`val ${(m?.a.pcr ?? 0) >= 1 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{m ? m.a.pcr : "—"}</div><div className="sub">{m ? m.a.sentiment : "OI"}</div></div>
        <div className="cell"><div className="lbl">Max pain</div><div className="val" style={{ fontSize: 16 }}>{m ? Math.round(m.a.maxPain).toLocaleString("en-IN") : "—"}</div><div className="sub">ATM {m ? m.atm.toLocaleString("en-IN") : "—"}</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{sug ? sug.action : "—"}</div><div className="sub">T-{expiry ? expiryToDays(expiry) : "?"}D</div></div>
      </div>
      {loading && <p className="muted">PULLING CHAIN…</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {rows.length > 0 && (
        <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "right" }}>CE LTP</th><th style={{ textAlign: "right" }}>CE OI</th><th>STRIKE</th><th style={{ textAlign: "right" }}>PE LTP</th><th style={{ textAlign: "right" }}>PE OI</th></tr></thead>
            <tbody>
              {rows.slice(Math.max(0, rows.findIndex((r) => r.strike === m?.atm) - 8), rows.findIndex((r) => r.strike === m?.atm) + 9).map((r) => (
                <tr key={r.strike} style={r.strike === m?.atm ? { background: "rgba(255,160,40,0.10)" } : undefined}>
                  <td style={{ textAlign: "right" }}>{Number(r.ceLTP).toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{Number(r.ceOI).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                  <td><strong className={r.strike === m?.atm ? "sec" : ""}>{r.strike.toLocaleString("en-IN")}</strong></td>
                  <td style={{ textAlign: "right" }}>{Number(r.peLTP).toFixed(1)}</td>
                  <td style={{ textAlign: "right" }}>{Number(r.peOI).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <a href={`/ochain?symbol=${encodeURIComponent(sym)}`} style={{ fontSize: 12 }}>FULL OPTION CHAIN →</a>
    </div>
  );
}

function MacroMini() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/macro").then((r) => r.json()).then((j) => { if (alive) setRows((j.rows ?? []).filter((r: any) => r.ok).slice(0, 10)); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return (
    <div className="grid" style={{ gap: 8 }}>
      {rows.length === 0 && <p className="muted">PULLING MACRO…</p>}
      {rows.map((r: any) => (
        <div key={r.id} className="kv"><span className="muted">{r.label} <span className="faint">{r.unit}</span></span><strong>{r.latest} <span className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</span></strong></div>
      ))}
      <a href="/macro" style={{ fontSize: 12 }}>FULL MACRO DESK →</a>
    </div>
  );
}

function FrameDesk({ src, label }: { src: string; label: string }) {
  const external = /^https?:\/\//i.test(src);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>{label} · {external ? "EXTERNAL APP INSIDE PANEL" : "HOSTED ROUTE INSIDE PANEL"} <a href={src} target={external ? "_blank" : undefined} rel={external ? "noopener" : undefined}>OPEN FULL →</a></p>
      <iframe src={src} title={label} style={{ width: "100%", height: 520, border: "1px solid var(--grid)", borderRadius: 3, background: "#000" }} loading="lazy" />
    </div>
  );
}

function GenericDeskContent({ id, symbol }: { id: string; symbol: string }) {
  const mod = MODULE_MAP[id];
  const code = funcCode(id);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    let alive = true;
    const my = ++seq.current;
    setLoading(true); setErr(""); setData(null);
    fetch(`/api/analysis/${id}?symbol=${encodeURIComponent(symbol)}&range=1y`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "analysis failed");
        if (alive && seq.current === my) setData(j);
      })
      .catch((e: any) => { if (alive && seq.current === my) setErr(e.message); })
      .finally(() => { if (alive && seq.current === my) setLoading(false); });
    return () => { alive = false; };
  }, [id, symbol]);
  const ind = data?.indicators ?? {};
  const risk = data?.risk ?? {};
  const closes: number[] = (data?.bars ?? []).map((b: any) => b.close);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  const livePx = data?.quote?.regularMarketPrice ?? data?.price;
  const liveChg = data?.quote?.regularMarketChangePercent ?? data?.changePct ?? 0;
  const liveUp = (liveChg ?? 0) >= 0;
  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: `You are a terminal analyst. Function ${code} (${mod?.label}). Reply in terse uppercase terminal lines.` },
        { role: "user", content: `SEC ${symbol} PX ${data?.price} RSI ${ind.rsi} MACD_H ${ind.macdHist} ADX ${ind.adx} SHARPE ${risk.sharpe}. VERDICT + 3 RISKS.` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) { setAiOut(`AI ERR: ${e.message}`); }
    finally { setAiLoading(false); }
  }
  return (
    <div className="grid" style={{ gap: 10 }}>
      {loading && <p className="muted">LOADING {code} FOR {symbol}…</p>}
      {err && <p className="neg">ERR: {err} (FEED THROTTLED — RETRY)</p>}
      {data && (
        <div className="cells">
          <div className="cell"><div className="lbl">Last</div><div className={`val ${liveUp ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{livePx !== undefined ? fmtINR(livePx) : "—"}</div><div className="sub">{liveUp ? "▲" : "▼"} {Math.abs(liveChg).toFixed(2)}%</div></div>
          <div className="cell"><div className="lbl">RSI 14</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(ind.rsi)}</div><div className="sub">WILDER</div></div>
          <div className="cell"><div className="lbl">ADX</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(ind.adx)}</div><div className="sub">TREND</div></div>
          <div className="cell"><div className="lbl">Sharpe</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(risk.sharpe)}</div><div className="sub">ANN</div></div>
          <div className="cell"><div className="lbl">Max DD</div><div className="val neg" style={{ fontSize: 15 }}>{fmtPct(risk?.maxDD?.pct, false)}</div><div className="sub">PEAK-TROUGH</div></div>
          <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 12 }}>{String(data?.extra?.signal ?? "—")}</div><div className="sub">DESK</div></div>
        </div>
      )}
      {data && closes.length > 30 && <div><p className="p-head">Growth of ₹100 + underwater</p><EquityDrawdown closes={closes} /></div>}
      {id === "70" && data && closes.length > 30 && <OptionsStrategyDesk symbol={symbol} data={data} />}
      {id === "3" && <ReturnsDesk symbol={symbol} />}
      {data?.extra && id !== "70" && <DeskOutput extra={data.extra} />}
      {data && data.series && (
        <div><ChartPanels bars={data.bars ?? []} series={data.series} />
        <div style={{ marginTop: 8 }}><p className="p-head">Daily return distribution</p><Histogram values={rets.map((r) => r * 100)} bins={24} height={100} /></div></div>
      )}
      <div>
        <p className="p-head">AI analyst — {code}</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading || !data}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button></div>
        {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}

export default function DeskRenderer({ funcId, symbol, task, onOpen, onExpand, onOpenNew }: {
  funcId: string;
  symbol: string;
  task?: string | null;
  onOpen?: (funcId: string, symbol: string) => void;
  onExpand?: () => void;
  onOpenNew?: (funcId: string, symbol: string) => void;
}) {
  const sym = symbol || "RELIANCE.NS";
  const mod = MODULE_MAP[funcId];
  const go = onOpen ?? (() => {});
  const full = onExpand ?? (() => {});

  // Compact summary views for the default no-scroll workspace.
  if (task === "MINI") {
    if (funcId === "DIR") return <WatchPanel onOpen={go} />;
    if (funcId === "70") return <StratMini symbol={sym} onFull={full} />;
    if (funcId === "12") return <FundaMini symbol={sym} onFull={full} />;
    if (funcId === "66") return <AIMini symbol={sym} onFull={full} />;
  }

  if (funcId === "DIR") return <DirectoryMini symbol={sym} onPickHere={(id) => go(id, sym)} onPickNew={onOpenNew ? (id) => onOpenNew(id, sym) : undefined} />;
  if (funcId === "NOTE") return <NotesMini />;
  // Terminal-native hosted routes: light minis for the two heaviest,
  // isolated iframes for the rest (no viewport assumptions, no rewrites).
  if (funcId === "110") return <OChainMini symbol={sym} />;
  if (funcId === "111") return <MacroMini />;
  if (funcId === "101") return <FrameDesk src={`/portfolio?symbol=${encodeURIComponent(sym)}`} label="PORTFOLIO BLOTTER" />;
  if (funcId === "102") return <FrameDesk src={`/alerts?symbol=${encodeURIComponent(sym)}`} label="PRICE ALERTS" />;
  if (funcId === "103") return <FrameDesk src={`/compare?symbol=${encodeURIComponent(sym)}`} label="SECURITY COMPARE" />;
  if (funcId === "104") return <FrameDesk src={`/corr?symbol=${encodeURIComponent(sym)}`} label="CORRELATION MATRIX" />;
  if (funcId === "105") return <FrameDesk src={`/season?symbol=${encodeURIComponent(sym)}`} label="SEASONALITY" />;
  if (funcId === "106") return <FrameDesk src={`/events?symbol=${encodeURIComponent(sym)}`} label="HISTORY & ACTIONS" />;
  if (funcId === "107") return <FrameDesk src={`/breadth?symbol=${encodeURIComponent(sym)}`} label="BREADTH & MOVERS" />;
  if (funcId === "108") return <FrameDesk src={`/calc?symbol=${encodeURIComponent(sym)}`} label="DESK CALCULATORS" />;
  if (funcId === "109") return <FrameDesk src={`/opening?symbol=${encodeURIComponent(sym)}`} label="PRE-MARKET OPENING DESK" />;
  if (funcId === "112") return <ANRDesk symbol={sym} />;
  if (funcId === "113") return <CastDesk symbol={sym} />;
  if (funcId === "114") return <FrameDesk src="https://nexus-chat-473.pages.dev/" label="NEXUS CHAT — CFA STUDY" />;

  if (!mod) return <p className="neg">UNKNOWN FUNCTION {funcId}.</p>;
  const id = funcId;

  if (NEWS_FEED[id]) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><NewsDesk symbol={sym} feed={NEWS_FEED[id]} title={mod.label.toUpperCase()} initialQ={NEWS_INITQ[id]} /></div>;
  if (id === "35") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><SectorDesk symbol={sym} /></div>;
  if (MARKET_IDS.has(id)) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><MarketDesk /></div>;
  if (SCREENER_KIND[id]) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><ScreenerDesk kind={SCREENER_KIND[id]} /></div>;
  if (id === "40") return <DVDesk symbol={sym} />;
  if (id === "39") return <OwnDesk symbol={sym} />;
  if (BACKTEST_CFG[id]) return <BacktestDesk symbol={sym} strat={BACKTEST_CFG[id].strat} title={`${BACKTEST_CFG[id].title} — ${funcCode(id)}`} />;
  if (id === "73") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><PolyDesk /></div>;
  if (id === "17") return <CompanyDesk symbol={sym} />;
  if (id === "18") return <DCFDesk symbol={sym} />;
  if (id === "19") return <LBODesk symbol={sym} />;
  if (id === "64") return <LinkerDesk symbol={sym} />;
  if (id === "6") return <MertonDesk symbol={sym} />;
  if (id === "8") return <DayDesk symbol={sym} />;
  if (id === "27" || id === "48") return <PairDesk symbol={sym} />;
  if (id === "28") return <FactorDesk symbol={sym} />;
  if (id === "51") return <WikiDesk />;
  if (id === "49") return <BibleDesk />;
  if (id === "42" || id === "43") return <LinkDesk symbol={sym} mode={id === "42" ? "charts" : "filings"} />;
  if (id === "66" || id === "71") return <AIDesk symbol={sym} mode={id === "71" ? "tasks" : "chat"} />;
  if (id === "2" || id === "4" || id === "5") return <ChartDesk symbol={sym} id={id} mode={id === "2" ? "suite" : id === "4" ? "compare" : "score"} title={mod.label.toUpperCase()} />;
  if (id === "29" || id === "57") return <FrontierPanel symbols={id === "29" ? [sym, "^NSEI"] : [sym, "^NSEI", "GC=F"]} title={`${mod.label.toUpperCase()} — ${id === "29" ? "2-ASSET" : "3-ASSET"}`} />;
  if (id === "60") return <NetPanel symbol={sym} />;
  if (id === "11") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><CompanyStrip symbol={sym} /><FundaMenu symbol={sym} /></div>;
  if (id === "13") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><CompanyStrip symbol={sym} /><StmtChartsDesk symbol={sym} /></div>;
  if (id === "14") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><DupontDesk symbol={sym} /></div>;
  if (id === "15") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><ForensicDesk symbol={sym} /></div>;
  if (id === "16") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><AnalyzerDesk symbol={sym} /></div>;
  if (id === "20") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><HistoryDesk symbol={sym} /></div>;
  if (id === "12") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><StatementsTerminal symbol={sym} /></div>;
  if (id === "23") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><RollingRiskDesk symbol={sym} /></div>;
  if (id === "22") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><RiskTerminal symbol={sym} /></div>;
  if (id === "1") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><GenericDeskContent id={id} symbol={sym} /></div>;

  return (
    <div className="grid" style={{ gap: 10 }}>
      <DeskHead funcId={id} symbol={sym} />
      <GenericDeskContent id={id} symbol={sym} />
      {task ? <div className="task-banner"><span className="badge fnc">{funcCode(id)}</span><span>TASK: <strong>{task}</strong></span></div> : null}
    </div>
  );
}
