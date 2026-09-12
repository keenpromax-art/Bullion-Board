"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MODULE_MAP } from "@/lib/modules";
import { normalizeTicker, fmtINR, fmtPct, fmtNum } from "@/lib/utils";
import { funcCode } from "@/lib/terminal";
import { chatComplete } from "@/lib/ai";
import { store } from "@/lib/store";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import OpenInWorkspace from "@/components/terminal/OpenInWorkspace";
import DeskOutput from "@/components/DeskOutput";
import { NewsDesk, MarketDesk, ScreenerDesk, BacktestDesk, PolyDesk, CompanyDesk } from "@/components/ModuleDesks";
import { SectorDesk } from "@/components/SectorDesks";
import { StatementsTerminal } from "@/components/StatementsTerminal";
import { RiskTerminal } from "@/components/RiskTerminal";
import { CompanyStrip, FundaTables, DCFDesk, LBODesk, FundaMenu, StmtChartsDesk, DupontDesk, ForensicDesk, AnalyzerDesk, HistoryDesk } from "@/components/FundaDesks";
import { VolTerm, MLDossier, PairDesk, FactorDesk, DayDesk, MertonDesk, RollingRiskDesk } from "@/components/QuantDesks";
import { WikiDesk, BibleDesk, ReaderDesk, LinkDesk, AIDesk } from "@/components/ReaderDesks";
import { DVDesk, OwnDesk } from "@/components/DivOwnDesks";
import { ChartDesk, FrontierPanel, NetPanel, ChartPanels, ReturnsDesk } from "@/components/ChartDesks";
import { LineChart, BarChart, AreaChart, HBars, Histogram, Donut, EquityDrawdown, ChartPanel } from "@/components/charts";
import OptionsStrategyDesk from "@/components/OptionsStrategyDesk";

const NEWS_FEED: Record<string, string> = {
  "34": "company", "37": "company", "44": "finshots",
  "45": "nbfc", "46": "mint", "47": "wire",
  "41": "wire", "65": "wire", "72": "editorials",
};
const NEWS_INITQ: Record<string, string> = {
  "41": "BULK DEAL BLOCK DEAL",
  "65": "IPO GMP LISTING",
};
const SCREENER_KIND: Record<string, string> = {
  "21": "momentum", "67": "all",
  "74": "swing", "75": "dip",
};
const BACKTEST_CFG: Record<string, { strat: string; title: string }> = {
  "30": { strat: "mr", title: "MEAN REVERSION LAB" },
  "68": { strat: "ma", title: "STRATEGY TESTER" },
  "69": { strat: "ma", title: "MULTI-STRATEGY ARENA" },
};
const MARKET_IDS = new Set(["38", "53"]);

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

function AreaSpark({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data);
  const W = 600, H = 110;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const up = data[data.length - 1] >= data[0];
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill="rgba(255,160,40,0.10)" />
      <polyline points={pts.join(" ")} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="2" />
    </svg>
  );
}

function Shell({ code, symbol, onTicker, status, children, task, funcId }: {
  code: string; symbol: string; onTicker: (t: string) => void; status: string; children: React.ReactNode; task?: string | null; funcId?: string;
}) {
  return (
    <>
      <CommandBar ticker={symbol} funcId={code} onTicker={onTicker} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <OpenInWorkspace funcId={funcId ?? code} symbol={symbol} task={task} />
            <a href="/terminal" className="ghost" style={{ padding: "9px 16px", textDecoration: "none" }} title="Multi-panel terminal workspace">TERMINAL ▦</a>
            <span className="muted" style={{ fontSize: 12 }}>DEEP LINK — SAME DESK IS AVAILABLE AS A WORKSPACE PANEL</span>
          </div>
        </div>
        {task ? (
          <div className="panel">
            <div className="task-banner" style={{ marginTop: 0 }}>
              <span className="badge fnc">{code}</span>
              <span>
                TASK: <strong>{task}</strong>
                <span className="faint"> · {symbol} · SCROLL TO THIS SECTION BELOW</span>
              </span>
              <a href="/" style={{ marginLeft: "auto", fontSize: 11 }}>MENU ›</a>
            </div>
          </div>
        ) : null}
        {children}
      </main>
      <StatusBar ticker={symbol} extra={task ? `${status} · ${task}` : status} />
    </>
  );
}

function useSymParam(): string {
  const sp = useSearchParams();
  const q = sp.get("symbol");
  return normalizeTicker(q || store.getTicker());
}

function useTaskParam(): string | null {
  const sp = useSearchParams();
  const t = sp.get("task");
  return t ? t.toUpperCase().slice(0, 40) : null;
}

export default function ModulePage({ params }: { params: { id: string } }) {
  return (
    <Suspense fallback={<main className="container"><p className="muted">LOADING DESK…</p></main>}>
      <Inner id={params.id} />
    </Suspense>
  );
}

function Inner({ id }: { id: string }) {
  const mod = MODULE_MAP[id];
  const code = funcCode(id);
  const symParam = useSymParam();
  const task = useTaskParam();
  const router = useRouter();
  const [symbol, setSymbol] = useState(symParam);

  // Follow the URL on client-side desk hops (?symbol= changes without remount).
  useEffect(() => { setSymbol(symParam); }, [symParam, id]);
  useEffect(() => { store.setTicker(symbol); }, [symbol]);

  // Terminal-native desks live on their own routes — bounce there (keep symbol+task).
  useEffect(() => {
    if (mod && mod.route !== `/module/${id}`) {
      const qs = new URLSearchParams();
      if (symbol) qs.set("symbol", symbol);
      if (task) qs.set("task", task);
      router.replace(qs.toString() ? `${mod.route}?${qs.toString()}` : mod.route);
    }
  }, [mod, id, router, symbol, task]);

  if (!mod) return <main className="container"><p>UNKNOWN FUNCTION.</p><a href="/">← DIRECTORY</a></main>;
  const status = `${code} ${mod.label.toUpperCase()}`;

  if (NEWS_FEED[id]) {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · {id === "44" ? "LIVE FINSHOTS RSS + SITE SEARCH" : id === "72" ? "LIVE EDITORIAL RSS + SITE SEARCH" : "LIVE YAHOO + GOOGLE-NEWS RSS"} · LEXICON SENTIMENT</div>
        </div>
        <NewsDesk symbol={symbol} feed={NEWS_FEED[id]} title={mod.label.toUpperCase()} initialQ={NEWS_INITQ[id]} />
      </Shell>
    );
  }

  if (id === "35") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <p className="p-head">{mod.label} — {code} &lt;GO&gt;</p>
          <div className="muted" style={{ fontSize: 12 }}>{mod.pyFn} · PEER MOMENTUM / BREADTH / ROTATION · AUTO-SECTOR FOR {symbol} · CLICK A SECURITY TO OPEN ITS DESK</div>
        </div>
        <SectorDesk symbol={symbol} />
      </Shell>
    );
  }

  if (MARKET_IDS.has(id)) {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <p className="p-head">{mod.label} — {code} &lt;GO&gt;</p>
          <div className="muted" style={{ fontSize: 12 }}>{mod.pyFn} · LIVE INDICES / COMMODITIES / FX</div>
        </div>
        <MarketDesk />
      </Shell>
    );
  }

  if (SCREENER_KIND[id]) {
    const isWorkflow = SCREENER_KIND[id] === "all";
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <p className="p-head">{mod.label} — {code} &lt;GO&gt;</p>
          <div className="muted" style={{ fontSize: 12 }}>{mod.pyFn} · LIVE NIFTY-50 SCAN{isWorkflow ? " · 3 BOARDS: MOM 20D% / RSI14 / SWING" : ""} · CLICK A SECURITY TO OPEN ITS DESK</div>
        </div>
        <ScreenerDesk kind={SCREENER_KIND[id]} />
      </Shell>
    );
  }

  if (id === "40") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <DVDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "39") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <OwnDesk symbol={symbol} />
      </Shell>
    );
  }

  if (BACKTEST_CFG[id]) {
    const cfg = BACKTEST_CFG[id];
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <BacktestDesk symbol={symbol} strat={cfg.strat} title={`${cfg.title} — ${code}`} />
      </Shell>
    );
  }

  if (id === "73") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <p className="p-head">{mod.label} — {code} &lt;GO&gt;</p>
          <div className="muted" style={{ fontSize: 12 }}>{mod.pyFn} · LIVE POLYMARKET BOOK · SORTED BY VOLUME</div>
        </div>
        <PolyDesk />
      </Shell>
    );
  }

  if (id === "17") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <CompanyDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "18") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <DCFDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "19") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <LBODesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "6") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <MertonDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "8") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <DayDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "27" || id === "48") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <PairDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "28") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <FactorDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "51") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <WikiDesk />
      </Shell>
    );
  }

  if (id === "49") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <BibleDesk />
      </Shell>
    );
  }

  if (id === "50") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <ReaderDesk />
      </Shell>
    );
  }

  if (id === "42" || id === "43") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <LinkDesk symbol={symbol} mode={id === "42" ? "charts" : "filings"} />
      </Shell>
    );
  }

  if (id === "66" || id === "71") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <AIDesk symbol={symbol} mode={id === "71" ? "tasks" : "chat"} />
      </Shell>
    );
  }

  if (id === "2" || id === "4" || id === "5") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <ChartDesk symbol={symbol} id={id} mode={id === "2" ? "suite" : id === "4" ? "compare" : "score"} title={mod.label.toUpperCase()} />
      </Shell>
    );
  }

  if (id === "29" || id === "57") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <FrontierPanel
          symbols={id === "29" ? [symbol, "^NSEI"] : [symbol, "^NSEI", "GC=F"]}
          title={`${mod.label.toUpperCase()} — ${id === "29" ? "2-ASSET" : "3-ASSET"}`}
        />
      </Shell>
    );
  }

  if (id === "60") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <NetPanel symbol={symbol} />
      </Shell>
    );
  }

  if (id === "11") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · PICK A FUNCTION TO OPEN ITS DESK</div>
          <CompanyStrip symbol={symbol} />
        </div>
        <FundaMenu symbol={symbol} />
      </Shell>
    );
  }

  if (id === "13") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · YAHOO LEDGER + SCREENER HOLDINGS · ALL STATEMENT CHARTS</div>
          <CompanyStrip symbol={symbol} />
        </div>
        <StmtChartsDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "14") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · DUPONT + QUALITY SCORES</div>
        </div>
        <DupontDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "15") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · REAL-LEDGER FORENSICS</div>
        </div>
        <ForensicDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "16") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · HEALTH SCORE + STRUCTURE</div>
        </div>
        <AnalyzerDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "20") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · 4-YEAR EVERYTHING</div>
        </div>
        <HistoryDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "12") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · 27-POINT TERMINAL · YAHOO + SCREENER HOLDINGS</div>
        </div>
        <StatementsTerminal symbol={symbol} />
      </Shell>
    );
  }

  if (id === "23") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · 3Y + NIFTY · 63D WINDOW</div>
        </div>
        <RollingRiskDesk symbol={symbol} />
      </Shell>
    );
  }

  if (id === "22") {
    return (
      <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · 12-POINT RISK TERMINAL</div>
        </div>
        <RiskTerminal symbol={symbol} />
      </Shell>
    );
  }

  return <GenericDesk id={id} code={code} symbol={symbol} setSymbol={setSymbol} status={status} task={task} />;
}

function GenericDesk({ id, code, symbol, setSymbol, status, task }: {
  id: string; code: string; symbol: string; setSymbol: (t: string) => void; status: string; task?: string | null;
}) {
  const mod = MODULE_MAP[id];
  const cat = mod.category;
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const seq = useRef(0);

  // Guarded load — a slow earlier request can never overwrite a newer symbol.
  async function load(sym: string) {
    const my = ++seq.current;
    setLoading(true); setErr(""); setData(null);
    try {
      const r = await fetch(`/api/analysis/${id}?symbol=${encodeURIComponent(sym)}&range=1y`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "analysis failed");
      if (seq.current === my) setData(j);
    } catch (e: any) {
      if (seq.current === my) setErr(e.message);
    } finally {
      if (seq.current === my) setLoading(false);
    }
  }

  useEffect(() => { if (symbol) load(symbol); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, id]);

  const ind = data?.indicators ?? {};
  const risk = data?.risk ?? {};
  const closes: number[] = (data?.bars ?? []).map((b: any) => b.close);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  const chg = data?.changePct ?? 0;
  const up = chg >= 0;
  // Live quote wins over the daily close; AS OF always shows the data date.
  const livePx = data?.quote?.regularMarketPrice ?? data?.price;
  const liveChg = data?.quote?.regularMarketChangePercent ?? chg;
  const isLive = !!(data?.quote && data.quote.regularMarketPrice);
  const liveUp = liveChg >= 0;
  const asOf = data?.asOf ?? data?.bars?.[data.bars.length - 1]?.date ?? "";
  const signal = String(data?.extra?.signal ?? data?.extra?.options?.side ?? "—");

  const isFunda = cat === "Fundamental" || cat === "Valuation";
  const isVol = cat === "Options" || cat === "Risk";
  const isML = cat === "ML";
  const isQuant = !isFunda && !isVol && !isML;

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const isOpt70 = id === "70";
      const o = data?.extra?.options;
      const user = isOpt70
        ? `OPTIONS STRATEGY DESK ${symbol} PX ${data?.price} RSI ${ind.rsi} MACD_H ${ind.macdHist} ADX ${ind.adx} HV10/30/252 ${(o?.hv10 * 100)?.toFixed(1)}/${(o?.hv30 * 100)?.toFixed(1)}/${(o?.hv252 * 100)?.toFixed(1)} REGIME ${o?.regime} BIAS ${o?.trendBias} SIDE ${o?.side} EXP_MOVE ${o?.expectedMove1sd?.toFixed(0)}. PICK BEST OF 15 (LONG C/P, SPREADS, STRADDLE/STRANGLE, CONDOR, BUTTERFLY, JADE, BACKSPREADS) FOR THIS REGIME. GIVE: 1) TOP PICK + WHY, 2) STRIKES/DTE, 3) GREEKS RISK, 4) ADJUST/STOP.`
        : `SEC ${symbol} PX ${data?.price} RSI ${ind.rsi} MACD_H ${ind.macdHist} ADX ${ind.adx} SHARPE ${risk.sharpe} MAXDD ${risk?.maxDD?.pct}%. VERDICT + 3 RISKS.`;
      const txt = await chatComplete([
        { role: "system", content: isOpt70 ? `You are a senior derivatives quant. Function ${code} (${mod.label}). Reply in terse uppercase terminal lines. Risk-first: theta, IV crush, stops before upside.` : `You are a terminal analyst. Function ${code} (${mod.label}). Reply in terse uppercase terminal lines.` },
        { role: "user", content: user },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Shell code={code} symbol={symbol} onTicker={setSymbol} status={status} task={task} funcId={id}>
      <div className="panel panel-glow">
        <div className="sec-head">
          <span className="sec-name">{symbol.replace(".NS", "")}<span className="suffix"> &lt;EQUITY&gt; {code} &lt;GO&gt;</span></span>
          {data && (
            <>
              <span className={`sec-price ${liveUp ? "pos" : "neg"}`}>{fmtINR(livePx)}</span>
              <span className={`badge ${liveUp ? "ok" : "bad"}`}><span className="dot" />{liveUp ? "▲" : "▼"} {Math.abs(liveChg).toFixed(2)}%</span>
            </>
          )}
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{mod.label.toUpperCase()} · {mod.pyFn} · {cat.toUpperCase()} · AS OF {asOf}{isLive ? " · LIVE" : ""}</div>
        {loading && <p className="muted">LOADING {code} FOR {symbol}…</p>}
        {err && <p className="neg">ERR: {err} (FEED THROTTLED — RETRY)</p>}
        {data && (
          <div className="cells" style={{ marginTop: 12 }}>
            <div className="cell"><div className="lbl">RSI 14</div><div className="val">{fmtNum(ind.rsi)}</div><div className="sub">WILDER</div></div>
            <div className="cell"><div className="lbl">MACD HIST</div><div className="val">{fmtNum(ind.macdHist, 3)}</div><div className="sub">12/26/9</div></div>
            <div className="cell"><div className="lbl">ADX</div><div className="val">{fmtNum(ind.adx)}</div><div className="sub">TREND</div></div>
            <div className="cell"><div className="lbl">SHARPE</div><div className={`val ${risk.sharpe >= 1 ? "pos" : risk.sharpe < 0 ? "neg" : ""}`}>{fmtNum(risk.sharpe)}</div><div className="sub">ANN</div></div>
            <div className="cell"><div className="lbl">MAX DD</div><div className="val neg">{fmtPct(risk?.maxDD?.pct, false)}</div><div className="sub">PEAK-TROUGH</div></div>
            <div className="cell"><div className="lbl">SIGNAL</div><div className="val" style={{ fontSize: 14 }}>{signal}</div><div className="sub">DESK</div></div>
          </div>
        )}
        {isFunda && <CompanyStrip symbol={symbol} />}
      </div>

      {data && closes.length > 30 && cat !== "Options" && (
        <div className="panel">
          <p className="p-head">Growth of ₹100 + underwater</p>
          <EquityDrawdown closes={closes} />
        </div>
      )}

      {id === "70" && data && closes.length > 30 && (
        <OptionsStrategyDesk symbol={symbol} data={data} />
      )}

      {id === "3" && <ReturnsDesk symbol={symbol} />}

      {isFunda && <FundaTables symbol={symbol} full={id === "12"} />}

      {isQuant && data && (
        <div className="grid grid-2">
          <div className="panel">
            <p className="p-head">Momentum</p>
            <KV k="STOCH K/D" v={`${fmtNum(ind.stochK)} / ${fmtNum(ind.stochD)}`} />
            <KV k="STOCH RSI" v={fmtNum(ind.stochRsi)} />
            <KV k="WILL %R" v={fmtNum(ind.willr)} />
            <KV k="MFI" v={fmtNum(ind.mfi)} />
            <KV k="BB %B" v={fmtNum(ind.bbPctB)} />
            <KV k="ATR" v={fmtNum(ind.atr)} />
          </div>
          <div className="panel">
            <p className="p-head">Risk</p>
            <KV k="SORTINO" v={fmtNum(risk.sortino)} />
            <KV k="VAR95 D" v={fmtPct((risk?.varCvar?.VaR ?? NaN) * 100, false)} />
            <KV k="CVAR95 D" v={fmtPct((risk?.varCvar?.CVaR ?? NaN) * 100, false)} />
            <KV k="HURST" v={fmtNum(risk.hurst, 3)} />
            <KV k="PROFIT F" v={fmtNum(risk.profitFactor)} />
            <KV k="PREV CLOSE" v={fmtINR(data.prevClose)} />
          </div>
        </div>
      )}

      {isQuant && data && data.series && (
        <>
          <ChartPanels bars={data.bars ?? []} series={data.series} />
          <div className="panel">
            <p className="p-head">Daily return distribution</p>
            <Histogram values={rets.map((r) => r * 100)} bins={24} height={100} />
          </div>
        </>
      )}

      {(isVol || isML) && id !== "70" && data && closes.length > 0 && (
        <div className="grid grid-2">
          <VolTerm closes={closes} />
          {isML && <MLDossier id={id} closes={closes} />}
          {isVol && (
            <div className="panel">
              <p className="p-head">Risk read</p>
              <KV k="SORTINO" v={fmtNum(risk.sortino)} />
              <KV k="MAX DD" v={fmtPct(risk?.maxDD?.pct, false)} cls="neg" />
              <KV k="VAR95 D" v={fmtPct((risk?.varCvar?.VaR ?? NaN) * 100, false)} />
              <KV k="HURST" v={fmtNum(risk.hurst, 3)} />
            </div>
          )}
        </div>
      )}

      {data?.extra && id !== "70" && <DeskOutput extra={data.extra} />}

      <div className="panel">
        <p className="p-head">AI analyst — {code}</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading || !data}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </Shell>
  );
}
