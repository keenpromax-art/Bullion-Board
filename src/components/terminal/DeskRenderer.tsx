"use client";

import { useEffect, useRef, useState } from "react";
import { MODULE_MAP, MODULES, NEXUS_CHAT_URL, resolveFuncId } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
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
import { Histogram, EquityDrawdown, AreaChart, HBars } from "@/components/charts";
import { WatchPanel, StratMini, FundaMini, AIMini } from "./MiniDesks";
import OptionsStrategyDesk from "@/components/OptionsStrategyDesk";
import SettingsDesk from "./SettingsDesk";
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
const SCREENER_KIND: Record<string, string> = { "67": "all", "75": "dip" };
const BACKTEST_CFG: Record<string, { strat: string; title: string }> = {
  "30": { strat: "mr", title: "MEAN REVERSION LAB" },
  "68": { strat: "ma", title: "STRATEGY TESTER" },
};
const MARKET_IDS = new Set(["53"]);

// Desks where a ticker is meaningless: news wires, market/macro boards,
// screeners, readers, portfolio-style tools. Panels and headers hide the
// symbol chrome for these (data flow untouched — symbol stays in spec).
export const SYMBOL_LESS = new Set([
  "38", "41", "44", "45", "46", "47", "49", "51", "53",
  "65", "67", "72", "73", "75",
  "101", "102", "104", "107", "108", "109", "110", "111",
  "114", "SET",
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
      <div className="toolbar"><input className="box" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="FILTER: NAME, FNC…" />
        <button className="ghost" onClick={() => onPickHere("SET")} title="Open settings — API key · model · FRED">⚙ SET</button>
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
        <span className="faint" style={{ fontSize: 10.5 }}>{sym}{expiry ? ` · ${expiry}` : ""}</span>
        <a href={`/ochain?symbol=${encodeURIComponent(sym)}`} style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}>FULL OPTION CHAIN →</a>
      </div>
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
    </div>
  );
}

function MacroSpark({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <span className="faint">—</span>;
  const mn = Math.min(...data), mx = Math.max(...data);
  const up = data[data.length - 1] >= data[0];
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * 96).toFixed(1)},${(24 - 2 - ((v - mn) / (mx - mn || 1)) * 20).toFixed(1)}`).join(" ");
  return (
    <svg width={96} height={24} style={{ display: "block" }} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.5" />
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
    // indices + INR crosses — the intraday complement to monthly FRED.
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
        <span className="faint" style={{ fontSize: 10.5 }}>{liveCount > 0 ? `${liveCount} LIVE · INDIA/GLOBAL` : "INDIA/GLOBAL"}</span>
        <a href="/macro" style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}>FULL MACRO DESK →</a>
      </div>
      {loading && rows.length === 0 && <p className="muted">PULLING MACRO…</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {!loading && !err && rows.length === 0 && <p className="muted">NO MACRO ROWS — RETRY.</p>}
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
              title={`${r.label} — CLICK FOR AS-OF / YOY / TREND`}
              style={{ cursor: "pointer" }}
            >
              <span className="muted">{r.label} <span className="faint">{r.unit}</span></span>
              <strong>{r.latest} <span className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</span></strong>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "2px 0 4px 0" }}>
              <span className="faint" style={{ fontSize: 10.5 }}>AS OF {r.date ?? "—"} · YOY <span className="muted">{r.yoy ?? "—"}</span></span>
              <MacroSpark data={r.spark ?? []} />
            </div>
            {open && (
              <div className="panel" style={{ padding: "8px 10px", margin: "0 0 6px 0" }}>
                <div className="kv"><span className="muted">PREV Δ</span><strong className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</strong></div>
                <div className="kv"><span className="muted">YOY</span><strong>{r.yoy ?? "—"} <span className="faint" style={{ fontWeight: 400 }}>{r.yoyDate ? `VS ${r.yoyDate}` : ""}</span></strong></div>
                <div className="kv"><span className="muted">AS OF</span><strong>{r.date ?? "—"}</strong></div>
                {r.title && <div className="kv"><span className="muted">SERIES</span><strong style={{ fontSize: 11 }}>{r.title}</strong></div>}
                {r.freq && <div className="kv"><span className="muted">FREQ</span><strong>{r.freq}{r.seasonal ? ` · ${r.seasonal}` : ""}</strong></div>}
                <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>{r.group} · 24-OBS TREND · CLICK ROW TO COLLAPSE</p>
              </div>
            )}
          </div>
        );
      })}
      <p className="p-head" style={{ margin: "8px 0 2px 0" }}>GLOBAL MARKETS · LIVE</p>
      {mkt.length === 0 && <p className="faint" style={{ fontSize: 10.5, margin: "0 0 4px 0" }}>PULLING LIVE TAPE…</p>}
      {mkt.map((m: any) => {
        const up = (m.chgPct ?? 0) >= 0;
        const px = typeof m.price === "number" && isFinite(m.price)
          ? m.price.toLocaleString("en-IN", { maximumFractionDigits: m.price < 100 ? 2 : 0 })
          : "—";
        return (
          <div key={m.sym}>
            <div className="kv">
              <span className="muted">{m.label} <span className="faint">{m.sym.replace("=F", "").replace("^", "").replace("=X", "")}</span></span>
              <strong>{px} <span className={up ? "pos" : "neg"}>{isFinite(m.chgPct) ? `${up ? "+" : ""}${m.chgPct.toFixed(2)}%` : "—"}</span></strong>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "2px 0 4px 0" }}>
              <span className="faint" style={{ fontSize: 10.5 }}>1D · YAHOO</span>
              <MacroSpark data={m.spark ?? []} />
            </div>
          </div>
        );
      })}
      {asof && <span className="faint" style={{ fontSize: 10.5 }}>FRED AS OF {asof} · LIVE TAPE VIA YAHOO</span>}
    </div>
  );
}

function FrameDesk({ src, label }: { src: string; label: string }) {
  const external = /^https?:\/\//i.test(src);
  return (
    <div className="frame-fill">
      <p
        className="muted"
        style={{ fontSize: 12, margin: 0, minWidth: 0, overflowWrap: "anywhere", lineHeight: 1.5 }}
      >
        {label} · {external ? "EXTERNAL APP INSIDE PANEL" : "HOSTED ROUTE INSIDE PANEL"}{" "}
        <a
          href={src}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener" : undefined}
          style={{ whiteSpace: "nowrap" }}
        >
          OPEN FULL →
        </a>
      </p>
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
        title="Nexus Chat — CFA study app"
        allow="clipboard-read; clipboard-write; fullscreen"
        allowFullScreen
        loading="lazy"
      />
    </div>
  );
}

function OpeningMini({ symbol }: { symbol: string }) {
  const [snap, setSnap] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/opening");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "snapshot failed");
      setSnap(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch("/api/opening");
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "snapshot failed");
        if (alive) setSnap(j);
      } catch (e: any) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const sc = snap?.score ?? {};
  const verdict = sc.verdict ?? "NO_DATA";
  const b = snap?.breadth ?? {};
  const n = snap?.nifty ?? {};
  const intra: any[] = snap?.intraday ?? [];
  const gainers: any[] = (b.gainers ?? []).slice(0, 6);
  const losers: any[] = (b.losers ?? []).slice(0, 6);
  const tup = (v: any): [number, number, number] => [Number(v?.[0] ?? 0), Number(v?.[1] ?? 0), Number(v?.[2] ?? 0)];
  const seg = (label: string, v: [number, number, number]): [string, [number, number, number]] => [label, v];
  const segs = [
    seg("NIFTY 50", tup(b.matrix?.nifty50 ?? [b.adv ?? 0, b.dec ?? 0, b.unc ?? 0])),
    seg("NIFTY 500", tup(b.matrix?.n500)),
    seg("MIDCAP 150", tup(b.matrix?.midcap)),
    seg("SMALLCAP 250", tup(b.matrix?.smallcap)),
    seg("TOTAL MKT", tup(b.matrix?.total)),
  ].filter(([, v]) => v[0] + v[1] + v[2] > 0);
  const f2 = (v: number | null | undefined, suffix = "") =>
    v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(2)}${suffix}`;
  return (
    <div className="grid" style={{ gap: 8, minWidth: 0 }}>
      <div className="toolbar">
        <button className="pill active">● LIVE DESK</button>
        <a
          href={`/opening?symbol=${encodeURIComponent(symbol)}`}
          style={{ fontSize: 12, marginLeft: "auto", whiteSpace: "nowrap" }}
        >
          OPEN FULL →
        </a>
        <button className="ghost" style={{ padding: "3px 8px", fontSize: 10.5 }} onClick={load} disabled={loading}>
          {loading ? "LOADING…" : "↻ REFRESH"}
        </button>
      </div>
      {loading && !snap && <p className="muted">PULLING PRE-MARKET TAPE…</p>}
      {err && (
        <p className="neg">
          ERR: {err} <button className="ghost" onClick={load}>RETRY</button>
        </p>
      )}
      {snap && (
        <>
          <div
            className="panel panel-glow"
            style={{
              borderColor:
                verdict === "GREEN"
                  ? "rgba(0,214,100,0.5)"
                  : verdict === "RED"
                    ? "rgba(255,69,58,0.5)"
                    : undefined,
              minWidth: 0,
            }}
          >
            <p className="p-head">Pre-market verdict — {snap.currentSlot} IST</p>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", minWidth: 0 }}>
              <span
                style={{ fontSize: 20, fontWeight: 800, overflowWrap: "anywhere" }}
                className={verdict === "GREEN" ? "pos" : verdict === "RED" ? "neg" : "neutral"}
              >
                {verdict === "GREEN"
                  ? "● LIKELY GREEN OPEN"
                  : verdict === "RED"
                    ? "● LIKELY RED OPEN"
                    : verdict === "FLAT"
                      ? "● MIXED / FLAT OPEN"
                      : "○ NO DATA"}
              </span>
              <span className="muted">
                SCORE{" "}
                {sc.value !== null && sc.value !== undefined
                  ? `${sc.value >= 0 ? "+" : ""}${sc.value}/${sc.n}`
                  : "—"}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0 0", overflowWrap: "anywhere" }}>
              LOAD {snap.fetchedAtIST} · US {snap.usDate ?? "—"} · SGX {snap.sgxDate ?? "—"} · NIFTY {snap.niftyDate ?? "—"}
            </p>
          </div>
          <div className="cells">
            <div className="cell">
              <div className="lbl">Nifty</div>
              <div className={`val ${(n.chg ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                {n.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"}
              </div>
              <div className="sub">{f2(n.chg, "%")}</div>
            </div>
            <div className="cell">
              <div className="lbl">Nasdaq</div>
              <div className={`val ${(snap.nasdaq?.chg ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                {snap.nasdaq?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"}
              </div>
              <div className="sub">{f2(snap.nasdaq?.chg, "%")}</div>
            </div>
            <div className="cell">
              <div className="lbl">SGX</div>
              <div className={`val ${(snap.sgx?.chg ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                {snap.sgx?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"}
              </div>
              <div className="sub">NIFTY PROXY</div>
            </div>
            <div className="cell">
              <div className="lbl">VIX</div>
              <div className="val" style={{ fontSize: 15 }}>
                {snap.vix !== null && snap.vix !== undefined ? Number(snap.vix).toFixed(2) : "—"}
              </div>
              <div className="sub">{snap.vixCond ?? ""}</div>
            </div>
            <div className="cell">
              <div className="lbl">DOW</div>
              <div className={`val ${(snap.dow?.chg ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                {snap.dow?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"}
              </div>
              <div className="sub">{f2(snap.dow?.chg, "%")}</div>
            </div>
            <div className="cell">
              <div className="lbl">Global cue</div>
              <div className="val" style={{ fontSize: 13 }}>{snap.globalCue?.source ?? "—"}</div>
              <div className="sub">{f2(snap.globalCue?.chg, "%")}{snap.globalCue?.fallback ? " · PROXY" : ""}</div>
            </div>
            <div className="cell">
              <div className="lbl">Adv / Dec</div>
              <div className="val" style={{ fontSize: 15 }}>
                <span className="pos">{b.adv ?? "—"}</span> / <span className="neg">{b.dec ?? "—"}</span>
              </div>
              <div className="sub">{b.source === "NSE" ? "NSE OFFICIAL" : "YAHOO FALLBACK"}</div>
            </div>
            <div className="cell">
              <div className="lbl">Slot</div>
              <div className="val" style={{ fontSize: 13 }}>{snap.currentSlot ?? "—"}</div>
              <div className="sub">CAPTURE GRID</div>
            </div>
          </div>

          <div className="panel">
            <p className="p-head">Nifty 50 — OHLC + intraday path</p>
            <div className="cells">
              <div className="cell"><div className="lbl">Open</div><div className="val" style={{ fontSize: 14 }}>{n.open?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "—"}</div></div>
              <div className="cell"><div className="lbl">High</div><div className="val" style={{ fontSize: 14 }}>{n.high?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "—"}</div><div className="sub">day</div></div>
              <div className="cell"><div className="lbl">Low</div><div className="val" style={{ fontSize: 14 }}>{n.low?.toLocaleString("en-IN", { maximumFractionDigits: 1 }) ?? "—"}</div><div className="sub">day</div></div>
              <div className="cell"><div className="lbl">Range</div><div className="val" style={{ fontSize: 14 }}>{n.range?.toFixed(1) ?? "—"}</div><div className="sub">pts</div></div>
              <div className="cell"><div className="lbl">Bars</div><div className="val" style={{ fontSize: 14 }}>{String(intra.length)}</div><div className="sub">1H today</div></div>
            </div>
            {intra.length > 1 && (
              <div style={{ marginTop: 8 }}>
                <AreaChart values={intra.map((x) => x.close)} dates={intra.map((x) => x.time)} label="NIFTY" height={110} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
                  <span>{intra[0].time}</span><span>{intra[Math.floor(intra.length / 2)].time}</span><span>{intra[intra.length - 1].time} IST</span>
                </div>
              </div>
            )}
          </div>

          {(sc.signals ?? []).length > 0 && (
            <div className="panel">
              <p className="p-head">Signal build — every vote that makes the score</p>
              <table className="plain">
                <thead><tr><th>SIGNAL</th><th style={{ textAlign: "right" }}>READING</th><th style={{ textAlign: "right" }}>VOTE</th></tr></thead>
                <tbody>
                  {(sc.signals ?? []).map((s: any) => (
                    <tr key={s.name}>
                      <td><strong>{s.name}</strong></td>
                      <td style={{ textAlign: "right" }}>{s.value === null || s.value === undefined ? "—" : typeof s.value === "number" ? s.value.toFixed(2) : s.value}</td>
                      <td style={{ textAlign: "right" }}><span className={s.vote > 0 ? "pos" : s.vote < 0 ? "neg" : ""}>{s.vote === null ? "—" : s.vote > 0 ? "+1" : s.vote < 0 ? "−1" : "0"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel">
            <p className="p-head">Market breadth — {b.source === "NSE" ? "NSE OFFICIAL" : "YAHOO FALLBACK"} · A/D</p>
            <HBars rows={[
              { label: "ADVANCES", value: b.adv ?? 0, display: String(b.adv ?? 0), color: "#00d664" },
              { label: "DECLINES", value: b.dec ?? 0, display: String(b.dec ?? 0), color: "#ff453a" },
              { label: "UNCHANGED", value: b.unc ?? 0, display: String(b.unc ?? 0), color: "#5b5b62" },
            ]} />
            {segs.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <table className="plain">
                  <thead><tr><th>SEGMENT</th><th style={{ textAlign: "right" }}>ADV</th><th style={{ textAlign: "right" }}>DEC</th><th style={{ textAlign: "right" }}>UNCH</th><th style={{ textAlign: "right" }}>NET</th></tr></thead>
                  <tbody>
                    {segs.map(([label, v]) => (
                      <tr key={label}>
                        <td><strong>{label}</strong></td>
                        <td style={{ textAlign: "right" }} className="pos">{v[0].toLocaleString("en-IN")}</td>
                        <td style={{ textAlign: "right" }} className="neg">{v[1].toLocaleString("en-IN")}</td>
                        <td style={{ textAlign: "right" }}>{v[2].toLocaleString("en-IN")}</td>
                        <td style={{ textAlign: "right" }}><span className={v[0] - v[1] >= 0 ? "pos" : "neg"}>{v[0] - v[1] >= 0 ? "+" : ""}{(v[0] - v[1]).toLocaleString("en-IN")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {gainers.length > 0 && (
            <div className="panel">
              <p className="p-head">Top gainers</p>
              <table className="plain">
                <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th></tr></thead>
                <tbody>
                  {gainers.map((r: any) => (
                    <tr key={r.symbol}><td><span className="sec">{r.symbol}</span></td><td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td><td style={{ textAlign: "right" }} className="pos">+{r.chgPct?.toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {losers.length > 0 && (
            <div className="panel">
              <p className="p-head">Top losers</p>
              <table className="plain">
                <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th></tr></thead>
                <tbody>
                  {losers.map((r: any) => (
                    <tr key={r.symbol}><td><span className="sec">{r.symbol}</span></td><td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td><td style={{ textAlign: "right" }} className="neg">{r.chgPct?.toFixed(2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(snap.slots ?? []).length > 0 && (
            <div className="panel">
              <p className="p-head">Capture grid</p>
              <div className="pills">
                {(snap.slots ?? []).map((s: string) => (
                  <span key={s} className={`badge${s === snap.currentSlot ? " fnc" : ""}`}>{s === snap.currentSlot ? `▶ ${s}` : s}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
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
        { role: "system", content: aiSystem.genericDesk(code, mod?.label ?? code) },
        { role: "user", content: `SEC ${symbol} PX ${data?.price ?? "?"} CHG% ${liveChg?.toFixed?.(2) ?? "?"} RSI14 ${ind.rsi ?? "?"} MACD_HIST ${ind.macdHist ?? "?"} ADX ${ind.adx ?? "?"} SHARPE ${risk.sharpe ?? "?"} MAXDD% ${risk?.maxDD?.pct ?? "?"}. SIGNAL ${String(data?.extra?.signal ?? "?")}. TASK: VERDICT + EVIDENCE + 3 RISKS + INVALIDATION. ${NO_INVENT}` },
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
  if (funcId === "NOTE") return <NotesMini />;
  if (funcId === "SET") return <SettingsDesk />;
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
  if (funcId === "109") return <OpeningMini symbol={sym} />;
  if (funcId === "112") return <ANRDesk symbol={sym} />;
  if (funcId === "113") return <CastDesk symbol={sym} />;
  if (funcId === "114") return <NexusDesk />;

  if (!mod) return <p className="neg">UNKNOWN FUNCTION {funcId}.</p>;

  if (id === "38") return <FrameDesk src="/macro" label="GLOBAL MACRO DASHBOARD" />;

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
