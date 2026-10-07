"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MODULE_MAP, MODULES, NEXUS_CHAT_URL, resolveFuncId } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import { DEFAULT_TARGET_KEY } from "@/lib/opening";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { fmtINR, fmtPct, fmtNum } from "@/lib/utils";
import FunctionDirectory from "@/components/FunctionDirectory";
import DeskOutput, { DeskError, ResolutionNote, toDeskErr } from "@/components/DeskOutput";
import { NewsDesk, MarketDesk, ScreenerDesk, BacktestDesk, PolyDesk, CompanyDesk } from "@/components/ModuleDesks";
import { SectorDesk } from "@/components/SectorDesks";
import { StatementsTerminal } from "@/components/StatementsTerminal";
import { RiskTerminal } from "@/components/RiskTerminal";
import { CompanyStrip, FundaTables, DCFDesk, LBODesk, FundaMenu, StmtChartsDesk, DupontDesk, ForensicDesk, AnalyzerDesk, HistoryDesk, LinkerDesk } from "@/components/FundaDesks";
import { VolTerm, MLDossier, PairDesk, FactorDesk, DayDesk, MertonDesk, RollingRiskDesk, ForecastDesk, ArimaLstmDesk, VolFrameworkDesk, GarchDesk, AdvGreeksDesk, StockGreeksDesk } from "@/components/QuantDesks";
import { WikiDesk, BibleDesk, LinkDesk, AIDesk } from "@/components/ReaderDesks";
import { DVDesk, OwnDesk } from "@/components/DivOwnDesks";
import { ANRDesk, CastDesk } from "@/components/CapitalDesks";
import { ChartDesk, FrontierPanel, NetPanel, ChartPanels, ReturnsDesk } from "@/components/ChartDesks";
import {
  DeskLive, captureSlot, readCaptureLog,
} from "@/components/OpeningDesk";
import { Histogram, EquityDrawdown } from "@/components/charts";
import { WatchPanel, StratMini, FundaMini, AIMini } from "./MiniDesks";
import OptionsStrategyDesk from "@/components/OptionsStrategyDesk";
import { CalcDesks } from "@/components/CalcDesks";
import { SeasonDesks } from "@/components/SeasonDesks";
import { BookReader } from "@/components/BookDesks";
import { NbSeasonDesk, NbSmaDesk, NbCorrDesk, NbOptDesk, NbMoversDesk, NbVolDesk, NbSectorDesk, NbIpoDesk, NbTerminalDesk } from "@/components/NotebookDesks";
import { NotesMini } from "@/components/NotesDesk";
import SettingsDesk from "./SettingsDesk";
import { analyseChain, calcSuggestion, expiryToDays } from "@/lib/ochain";

// Central desk dispatcher for Panel.tsx. Renders the SAME desk components
// as /module/[id] but without page chrome (no CommandBar/StatusBar, no
// 100vh assumptions). Wrapper fills its panel via .desk-fill (min-height 0,
// internal scroll) â€” never owns the viewport.

const NEWS_FEED: Record<string, string> = {
  "34": "company", "37": "company", "44": "finshots",
  "45": "nbfc", "46": "mint", "47": "wire",
  "41": "wire", "65": "wire", "72": "editorials",
};
const NEWS_INITQ: Record<string, string> = { "41": "BULK DEAL BLOCK DEAL", "65": "IPO GMP LISTING" };
const SCREENER_KIND: Record<string, string> = { "67": "all", "75": "dip" };
const BACKTEST_CFG: Record<string, { strat: string; title: string }> = {
  "30": { strat: "mr", title: "MEAN REVERSION LAB" },
  "68": { strat: "ma", title: "STRATEGY TESTER" },
};
const MARKET_IDS = new Set(["53"]);

// Desks where a ticker is meaningless: news wires, market/macro boards,
// screeners, readers, portfolio-style tools. Panels and headers hide the
// symbol chrome for these (data flow untouched â€” symbol stays in spec).
export const SYMBOL_LESS = new Set([
  "38", "41", "44", "45", "46", "47", "49", "51", "53",
  "65", "67", "72", "73", "75",
  "101", "102", "104", "107", "108", "109", "110", "111",
  "114", "115", "SET", "116",
  // Notebook-port universe scans: ticker is meaningless (universe pill inside).
  "76", "77", "78", "79", "80", "82", "83", "84",
]);

function DeskHead({ funcId, symbol }: { funcId: string; symbol: string }) {
  const mod = MODULE_MAP[funcId];
  if (!mod) return null;
  // Symbol-less desks show no header block at all â€” the panel chrome
  // already names the function.
  if (!symbol || SYMBOL_LESS.has(funcId)) return null;
  return (
    <div className="desk-head">
      <span className="sec-name" style={{ fontSize: 20 }}>
        {symbol ? symbol.replace(".NS", "") : mod.label.toUpperCase()}
        <span className="suffix"> {symbol ? "<EQUITY> " : ""}{funcCode(funcId)} &lt;GO&gt;</span>
      </span>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        {mod.label.toUpperCase()} Â· {mod.pyFn} Â· {mod.category.toUpperCase()}
      </div>
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
      <div className="toolbar"><input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="FILTER: NAME, FNCâ€¦" />
        <button className="ghost" onClick={() => onPickHere("SET")} title="Open settings â€” API key Â· model Â· FRED">âš™ SET</button>
      </div>
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
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="faint" style={{ fontSize: 10.5 }}>{sym}{expiry ? ` Â· ${expiry}` : ""}</span>
        <a href={`/ochain?symbol=${encodeURIComponent(sym)}`} style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}>FULL OPTION CHAIN â†’</a>
      </div>
      <div className="cells">
        <div className="cell"><div className="lbl">Spot</div><div className="val" style={{ fontSize: 16 }}>{spot ? spot.toLocaleString("en-IN") : "â€”"}</div><div className="sub">{sym} Â· {expiry || "NO EXPIRY"}</div></div>
        <div className="cell"><div className="lbl">PCR</div><div className={`val ${(m?.a.pcr ?? 0) >= 1 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{m ? m.a.pcr : "â€”"}</div><div className="sub">{m ? m.a.sentiment : "OI"}</div></div>
        <div className="cell"><div className="lbl">Max pain</div><div className="val" style={{ fontSize: 16 }}>{m ? Math.round(m.a.maxPain).toLocaleString("en-IN") : "â€”"}</div><div className="sub">ATM {m ? m.atm.toLocaleString("en-IN") : "â€”"}</div></div>
        <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 13 }}>{sug ? sug.action : "â€”"}</div><div className="sub">T-{expiry ? expiryToDays(expiry) : "?"}D</div></div>
      </div>
      {loading && <p className="muted">PULLING CHAINâ€¦</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {rows.length > 0 && (
        <div className="scrollx" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "right" }}>CE LTP</th><th style={{ textAlign: "right" }}>CE OI</th><th>STRIKE</th><th style={{ textAlign: "right" }}>PE LTP</th><th style={{ textAlign: "right" }}>PE OI</th></tr></thead>
            <tbody>
              {rows.slice(Math.max(0, rows.findIndex((r) => r.strike === m?.atm) - 8), rows.findIndex((r) => r.strike === m?.atm) + 9).map((r) => (
                <tr key={r.strike} style={r.strike === m?.atm ? { background: "color-mix(in srgb, var(--amber) 10%, transparent)" } : undefined}>
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
    </div>
  );
}

function MacroSpark({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <span className="faint">â€”</span>;
  const mn = Math.min(...data), mx = Math.max(...data);
  const up = data[data.length - 1] >= data[0];
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 96).toFixed(1)},${(24 - 2 - ((v - mn) / (mx - mn || 1)) * 20).toFixed(1)}`).join(" ");
  return (
    <svg width={96} height={24} style={{ display: "block" }} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--green)" : "var(--red)"} strokeWidth="1.5" />
    </svg>
  );
}

function MacroMini() {
  const [rows, setRows] = useState<any[]>([]);
  const [mkt, setMkt] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [asof, setAsof] = useState("");
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    let url = "/api/macro?groups=INDIA,GLOBAL";
    try {
      const fk = store.getFredKey();
      const extra = store.getMacroExtra();
      const qs = new URLSearchParams();
      qs.set("groups", "INDIA,GLOBAL");
      if (fk) qs.set("fkey", fk);
      if (extra.length) qs.set("extra", extra.join(","));
      const s = qs.toString();
      if (s) url = `/api/macro?${s}`;
    } catch { /* keyless */ }
    fetch(url).then((r) => r.json()).then((j) => {
      if (!alive) return;
      const all = (j.rows ?? []).filter((r: any) => r.ok);
      // Terminal starter panel is India-first: India + global only,
      // no US-domestic groups (full US board lives on /macro).
      const keep = all.filter((r: any) => ["INDIA", "GLOBAL", "CUSTOM"].includes(r.group));
      setRows(keep.length > 0 ? keep : all);
      setAsof((keep.length > 0 ? keep : all)?.find?.((r: any) => r.ok)?.date ?? "");
    }).catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    // Live global cross-asset tape (Yahoo): bullion, energy, US/EU/Asia
    // indices + INR crosses â€” the intraday complement to monthly FRED.
    fetch("/api/market").then((r) => r.json()).then((j) => {
      if (!alive) return;
      const want = ["GC=F", "SI=F", "CL=F", "^GSPC", "^FTSE", "^N225", "USDINR=X", "EURINR=X"];
      const bySym = new Map((j.rows ?? []).filter((r: any) => r.ok).map((r: any) => [r.sym, r]));
      setMkt(want.map((s) => bySym.get(s)).filter(Boolean));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  let lastGroup = "";
  const liveCount = rows.length + mkt.length;
  return (
    <div className="grid" style={{ gap: 4 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span className="faint" style={{ fontSize: 10.5 }}>{liveCount > 0 ? `${liveCount} LIVE Â· INDIA/GLOBAL` : "INDIA/GLOBAL"}</span>
        <a href="/macro" style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}>FULL MACRO DESK â†’</a>
      </div>
      {loading && rows.length === 0 && <p className="muted">PULLING MACROâ€¦</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO MACRO ROWS â€” RETRY.</p>}
      {rows.map((r: any) => {
        const showGroup = r.group !== lastGroup;
        lastGroup = r.group;
        const open = openId === r.id;
        return (
          <div key={r.id}>
            {showGroup && <p className="p-head" style={{ margin: "6px 0 2px 0" }}>{r.group}</p>}
            <div
              className="kv" role="button" tabIndex={0}
              onClick={() => setOpenId(open ? null : r.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(open ? null : r.id); } }}
              title={`${r.label} â€” CLICK FOR AS-OF / YOY / TREND`}
              style={{ cursor: "pointer" }}
            >
              <span className="muted">{r.label} <span className="faint">{r.unit}</span></span>
              <strong>{r.latest} <span className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</span></strong>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "2px 0 4px 0" }}>
              <span className="faint" style={{ fontSize: 10.5 }}>AS OF {r.date ?? "â€”"} Â· YOY <span className="muted">{r.yoy ?? "â€”"}</span></span>
              <MacroSpark data={r.spark ?? []} />
            </div>
            {open && (
              <div className="panel" style={{ padding: "8px 10px", margin: "0 0 6px 0" }}>
                <div className="kv"><span className="muted">PREV Î”</span><strong className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</strong></div>
                <div className="kv"><span className="muted">YOY</span><strong>{r.yoy ?? "â€”"} <span className="faint" style={{ fontWeight: 400 }}>{r.yoyDate ? `VS ${r.yoyDate}` : ""}</span></strong></div>
                <div className="kv"><span className="muted">AS OF</span><strong>{r.date ?? "â€”"}</strong></div>
                {r.title && <div className="kv"><span className="muted">SERIES</span><strong style={{ fontSize: 11 }}>{r.title}</strong></div>}
                {r.freq && <div className="kv"><span className="muted">FREQ</span><strong>{r.freq}{r.seasonal ? ` Â· ${r.seasonal}` : ""}</strong></div>}
                <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>{r.group} Â· 24-OBS TREND Â· CLICK ROW TO COLLAPSE</p>
              </div>
            )}
          </div>
        );
      })}
      <p className="p-head" style={{ margin: "8px 0 2px 0" }}>GLOBAL MARKETS Â· LIVE</p>
      {mkt.length === 0 && <p className="faint" style={{ fontSize: 10.5, margin: "0 0 4px 0" }}>PULLING LIVE TAPEâ€¦</p>}
      {mkt.map((m: any) => {
        const up = (m.chgPct ?? 0) >= 0;
        const px = typeof m.price === "number" && isFinite(m.price)
          ? m.price.toLocaleString("en-IN", { maximumFractionDigits: m.price < 100 ? 2 : 0 })
          : "â€”";
        return (
          <div key={m.sym}>
            <div className="kv">
              <span className="muted">{m.label} <span className="faint">{m.sym.replace("=F", "").replace("^", "").replace("=X", "")}</span></span>
              <strong>{px} <span className={up ? "pos" : "neg"}>{isFinite(m.chgPct) ? `${up ? "+" : ""}${m.chgPct.toFixed(2)}%` : "â€”"}</span></strong>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "2px 0 4px 0" }}>
              <span className="faint" style={{ fontSize: 10.5 }}>1D Â· YAHOO</span>
              <MacroSpark data={m.spark ?? []} />
            </div>
          </div>
        );
      })}
      {asof && <span className="faint" style={{ fontSize: 10.5 }}>FRED AS OF {asof} Â· LIVE TAPE VIA YAHOO</span>}
    </div>
  );
}

function FrameDesk({ src, label }: { src: string; label: string }) {
  return (
    <div className="frame-fill">
      <iframe
        src={src}
        title={label}
        loading="lazy"
      />
    </div>
  );
}

function NexusDesk() {
  return (
    <div className="nexus-fill">
      <iframe
        src={NEXUS_CHAT_URL}
        title="Nexus Chat â€” CFA study app"
        allow="clipboard-read; clipboard-write; fullscreen"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

function OpeningMini({ symbol }: { symbol: string }) {
  const [snap, setSnap] = useState<any>(null);
  const [board, setBoard] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [market, setMarket] = useState<string>(DEFAULT_TARGET_KEY);
  const [logRows, setLogRows] = useState<any[]>([]);
  const [logNote, setLogNote] = useState("");

  const pull = useCallback(async (key: string) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/opening?market=${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "snapshot failed");
      setSnap(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const pullBoard = useCallback(async () => {
    try {
      const r = await fetch("/api/opening/board");
      const j = await r.json();
      if (r.ok) setBoard(j);
    } catch {
      /* the rail simply stays empty; the desk is unaffected */
    }
  }, []);

  useEffect(() => {
    const k = store.getOpeningMarket();
    setMarket(k);
    setLogRows(readCaptureLog());
    pull(k);
    pullBoard();
  }, [pull, pullBoard]);

  function pickMarket(key: string) {
    if (key === market) return;
    store.setOpeningMarket(key);
    setSnap(null);
    setMarket(key);
    pull(key);
  }

  function logSlot() {
    if (!snap) return;
    const n = captureSlot(snap);
    setLogNote(n < 0 ? "LOG FAILED — STORAGE REFUSED" : `LOGGED ${snap.currentSlot ?? "—"} → ${snap.predict?.verdict ?? "—"}`);
    if (n >= 0) setLogRows(readCaptureLog());
    window.setTimeout(() => setLogNote(""), 6000);
  }

  const stale = !!snap && snap.market?.key !== market;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div className="toolbar">
        <span className="fn-tag">109 · FNC PRE</span>
        <a
          href={`/opening?symbol=${encodeURIComponent(symbol)}`}
          style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}
        >
          OPEN FULL ↗
        </a>
      </div>
      {logNote && <p className="faint" style={{ fontSize: 10.5, margin: 0 }}>{logNote}</p>}
      <DeskLive
        snap={stale ? null : snap}
        board={board}
        market={market}
        onMarket={pickMarket}
        density="compact"
        loading={busy}
        error={err}
        busy={busy}
        onRefresh={() => { pull(market); pullBoard(); }}
        onRetry={() => pull(market)}
        onLog={logSlot}
        logRows={logRows}
      />
    </div>
  );
}
function GenericDeskContent({ id, symbol }: { id: string; symbol: string }) {
  const mod = MODULE_MAP[id];
  const code = funcCode(id);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<{ message: string; code?: string; suggestion?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [retryN, setRetryN] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    let alive = true;
    const my = ++seq.current;
    setLoading(true); setErr(null); setData(null);
    fetch(`/api/analysis/${id}?symbol=${encodeURIComponent(symbol)}&range=1y`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) {
          const t: any = new Error(j.error || "analysis failed");
          t.code = j.code;
          t.suggestion = j.suggestion ?? j.suggestions?.[0]?.symbol;
          throw t;
        }
        if (alive && seq.current === my) setData(j);
      })
      .catch((e: any) => { if (alive && seq.current === my) setErr(toDeskErr(e)); })
      .finally(() => { if (alive && seq.current === my) setLoading(false); });
    return () => { alive = false; };
  }, [id, symbol, retryN]);
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
        { role: "system", content: aiSystem.genericDesk(code, mod?.label ?? code) },
        { role: "user", content: `SEC ${symbol} PX ${data?.price ?? "?"} CHG% ${liveChg?.toFixed?.(2) ?? "?"} RSI14 ${ind.rsi ?? "?"} MACD_HIST ${ind.macdHist ?? "?"} ADX ${ind.adx ?? "?"} SHARPE ${risk.sharpe ?? "?"} MAXDD% ${risk?.maxDD?.pct ?? "?"}. SIGNAL ${String(data?.extra?.signal ?? "?")}. TASK: VERDICT + EVIDENCE + 3 RISKS + INVALIDATION. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) { setAiOut(`AI ERR: ${e.message}`); }
    finally { setAiLoading(false); }
  }
  return (
    <div className="grid" style={{ gap: 10 }}>
      {data?.resolvedFrom && <ResolutionNote from={data.resolvedFrom} to={data.symbol} />}
      {loading && <p className="muted">LOADING {code} FOR {symbol}â€¦</p>}
      {err && <DeskError err={err} onRetry={() => setRetryN((n) => n + 1)} />}
      {data && (
        <div className="cells">
          <div className="cell"><div className="lbl">Last</div><div className={`val ${liveUp ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{livePx !== undefined ? fmtINR(livePx) : "â€”"}</div><div className="sub">{liveUp ? "â–²" : "â–¼"} {Math.abs(liveChg).toFixed(2)}%</div></div>
          <div className="cell"><div className="lbl">RSI 14</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(ind.rsi)}</div><div className="sub">WILDER</div></div>
          <div className="cell"><div className="lbl">ADX</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(ind.adx)}</div><div className="sub">TREND</div></div>
          <div className="cell"><div className="lbl">Sharpe</div><div className="val" style={{ fontSize: 15 }}>{fmtNum(risk.sharpe)}</div><div className="sub">ANN</div></div>
          <div className="cell"><div className="lbl">Max DD</div><div className="val neg" style={{ fontSize: 15 }}>{fmtPct(risk?.maxDD?.pct, false)}</div><div className="sub">PEAK-TROUGH</div></div>
          <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 12 }}>{String(data?.extra?.signal ?? "â€”")}</div><div className="sub">DESK</div></div>
        </div>
      )}
      {data && closes.length > 30 && <div><p className="p-head">Growth of â‚¹100 + underwater</p><EquityDrawdown closes={closes} /></div>}
      {id === "70" && data && closes.length > 30 && <OptionsStrategyDesk symbol={symbol} data={data} />}
      {id === "3" && <ReturnsDesk symbol={symbol} />}
      {data?.extra && id !== "70" && <DeskOutput extra={data.extra} />}
      {data && data.series && (
        <div><ChartPanels bars={data.bars ?? []} series={data.series} />
        <div style={{ marginTop: 8 }}><p className="p-head">Daily return distribution</p><Histogram values={rets.map((r) => r * 100)} bins={24} height={100} /></div></div>
      )}
      <div>
        <p className="p-head">AI analyst â€” {code}</p>
        <div className="toolbar"><button className="btn" onClick={askAI} disabled={aiLoading || !data}>{aiLoading ? "RUNNINGâ€¦" : `RUN AI ON ${symbol}`}</button></div>
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
  const id = resolveFuncId(funcId); // retired IDs (21/69/74) fold into survivors
  const mod = MODULE_MAP[id];
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
  if (funcId === "NOTE") return <NotesMini symbol={sym} />;
  if (funcId === "SET") return <SettingsDesk />;
  // Terminal-native hosted routes: light minis for the two heaviest,
  // isolated iframes for the rest (no viewport assumptions, no rewrites).
  if (funcId === "110") return <OChainMini symbol={sym} />;
  if (funcId === "111") return <MacroMini />;
  if (funcId === "101") return <FrameDesk src={`/portfolio?symbol=${encodeURIComponent(sym)}`} label="PORTFOLIO BLOTTER" />;
  if (funcId === "102") return <FrameDesk src={`/alerts?symbol=${encodeURIComponent(sym)}`} label="PRICE ALERTS" />;
  if (funcId === "103") return <FrameDesk src={`/compare?symbol=${encodeURIComponent(sym)}`} label="SECURITY COMPARE" />;
  if (funcId === "104") return <FrameDesk src={`/corr?symbol=${encodeURIComponent(sym)}`} label="CORRELATION MATRIX" />;
  if (funcId === "105") return <SeasonDesks symbol={sym} />;
  if (funcId === "106") return <FrameDesk src={`/events?symbol=${encodeURIComponent(sym)}`} label="HISTORY & ACTIONS" />;
  if (funcId === "107") return <FrameDesk src={`/breadth?symbol=${encodeURIComponent(sym)}`} label="BREADTH & MOVERS" />;
  if (funcId === "108") return <CalcDesks />;
  if (funcId === "109") return <OpeningMini symbol={sym} />;
  if (funcId === "112") return <ANRDesk symbol={sym} />;
  if (funcId === "113") return <CastDesk symbol={sym} />;
  if (funcId === "114") return <NexusDesk />;
  if (funcId === "115") return <BookReader />;
  if (funcId === "116") return <FrameDesk src="/universe" label="WORLD UNIVERSE" />;

  if (!mod) return <p className="neg">UNKNOWN FUNCTION {funcId}.</p>;

  if (id === "38") return <FrameDesk src="/macro" label="GLOBAL MACRO DASHBOARD" />;

  if (NEWS_FEED[id]) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><NewsDesk symbol={sym} feed={NEWS_FEED[id]} title={mod.label.toUpperCase()} initialQ={NEWS_INITQ[id]} /></div>;
  if (id === "35") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><SectorDesk symbol={sym} onOpen={onOpen ? (f, s) => onOpen(f, s) : undefined} /></div>;
  if (MARKET_IDS.has(id)) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><MarketDesk /></div>;
  if (SCREENER_KIND[id]) return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><ScreenerDesk kind={SCREENER_KIND[id]} /></div>;
  if (id === "40") return <DVDesk symbol={sym} />;
  if (id === "39") return <OwnDesk symbol={sym} />;
  if (BACKTEST_CFG[id]) return <BacktestDesk symbol={sym} strat={BACKTEST_CFG[id].strat} title={`${BACKTEST_CFG[id].title} â€” ${funcCode(id)}`} />;
  if (id === "73") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><PolyDesk /></div>;
  if (id === "17") return <CompanyDesk symbol={sym} />;
  if (id === "18") return <DCFDesk symbol={sym} />;
  if (id === "19") return <LBODesk symbol={sym} />;
  if (id === "64") return <LinkerDesk symbol={sym} />;
  if (id === "6") return <MertonDesk symbol={sym} />;
  if (id === "9") return <ForecastDesk symbol={sym} />;
  if (id === "10") return <ArimaLstmDesk symbol={sym} />;
  if (id === "24") return <GarchDesk symbol={sym} />;
  if (id === "26") return <VolFrameworkDesk symbol={sym} />;
  if (id === "36") return <AdvGreeksDesk symbol={sym} />;
  if (id === "33") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><StockGreeksDesk symbol={sym} /></div>;
  if (id === "8") return <DayDesk symbol={sym} />;
  if (id === "27" || id === "48") return <PairDesk symbol={sym} />;
  if (id === "28") return <FactorDesk symbol={sym} />;
  if (id === "51") return <WikiDesk />;
  if (id === "49") return <BibleDesk />;
  if (id === "42" || id === "43") return <LinkDesk symbol={sym} mode={id === "42" ? "charts" : "filings"} />;
  if (id === "66" || id === "71") return <AIDesk symbol={sym} mode={id === "71" ? "tasks" : "chat"} />;
  if (id === "2" || id === "4" || id === "5") return <ChartDesk symbol={sym} id={id} mode={id === "2" ? "suite" : id === "4" ? "compare" : "score"} title={mod.label.toUpperCase()} />;
  if (id === "29" || id === "57") return <FrontierPanel symbols={id === "29" ? [sym, "^NSEI"] : [sym, "^NSEI", "GC=F"]} title={`${mod.label.toUpperCase()} â€” ${id === "29" ? "2-ASSET" : "3-ASSET"}`} />;
  if (id === "60") return <NetPanel symbol={sym} />;
  if (id === "11") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><CompanyStrip symbol={sym} /><FundaMenu symbol={sym} /></div>;
  if (id === "13") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><CompanyStrip symbol={sym} /><StmtChartsDesk symbol={sym} /></div>;
  if (id === "14") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><DupontDesk symbol={sym} /></div>;
  if (id === "15") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><ForensicDesk symbol={sym} /></div>;
  if (id === "16") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><AnalyzerDesk symbol={sym} /></div>;
  if (id === "20") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><HistoryDesk symbol={sym} /></div>;
  if (id === "12") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><StatementsTerminal symbol={sym} /></div>;
  if (id === "23") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><RollingRiskDesk symbol={sym} /></div>;
  if (id === "76") return <NbSeasonDesk />;
  if (id === "77") return <NbSmaDesk />;
  if (id === "78") return <NbCorrDesk />;
  if (id === "79") return <NbOptDesk />;
  if (id === "80") return <NbMoversDesk />;
  if (id === "81") return <div className="grid" style={{ gap: 10 }}><DeskHead funcId={id} symbol={sym} /><NbVolDesk symbol={sym} /></div>;
  if (id === "82") return <NbSectorDesk />;
  if (id === "83") return <NbIpoDesk />;
  if (id === "84") return <NbTerminalDesk />;
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
