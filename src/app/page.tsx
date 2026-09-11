"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MODULES, CATEGORIES } from "@/lib/modules";
import { WATCHLIST, DEFAULT_TICKER } from "@/lib/watchlist";
import { normalizeTicker } from "@/lib/utils";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { LineChart, BarChart, useHoverIndex, HoverTip } from "@/components/charts";
import { sma, ema, rsi, macd, bollinger, stochastic } from "@/lib/indicators";

interface QuoteResp {
  symbol: string; shortName: string; regularMarketPrice: number;
  regularMarketChange: number; regularMarketChangePercent: number;
}

const TAPE = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "TATAMOTORS.NS", "SUNPHARMA.NS"];

const MACRO_PICKS = ["FEDFUNDS", "DGS10", "T10Y2Y", "CPIAUCSL", "UNRATE", "GACDISA066MSFRBNY"];

// Market overview — index tape + breadth + risk read, right under the strip.
// Feeds: /api/market (index day %) + /api/breadth (Nifty-50 adv/dec).
function MarketOverview({ ticker }: { ticker: string }) {
  const [mkt, setMkt] = useState<Array<{ sym: string; label: string; price: number; chgPct: number; ok: boolean }>>([]);
  const [br, setBr] = useState<{ adv: number; dec: number; unch: number; count: number; pctAbove20: number; top: Array<{ symbol: string; dayChgPct: number }>; bottom: Array<{ symbol: string; dayChgPct: number }> } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/market").then((r) => r.json()).then((j) => { if (alive) setMkt((j.rows ?? []).filter((r: any) => r.ok)); }).catch(() => {});
    fetch("/api/breadth").then((r) => r.json()).then((j) => { if (alive && !j.error) setBr(j); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const by = (label: string) => mkt.find((r) => r.label === label);
  const nifty = by("NIFTY 50"), sensex = by("SENSEX"), bank = by("BANK NIFTY"), vix = by("INDIA VIX");
  const avg = (labels: string[]) => {
    const xs = labels.map((l) => by(l)?.chgPct).filter((v): v is number => typeof v === "number" && isFinite(v));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  const riskAvg = avg(["NIFTY 50", "SENSEX", "S&P 500", "FTSE 100", "NIKKEI", "BITCOIN", "CRUDE"]);
  const safeAvg = avg(["GOLD", "SILVER"]);
  const score = riskAvg - safeAvg;
  const verdict = !isFinite(score) ? null : score > 0.3 ? "RISK-ON" : score < -0.3 ? "RISK-OFF" : "MIXED";
  const dp = (v: number | undefined) => (v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
  const idx = (r: { price: number; chgPct: number } | undefined) => (
    <>
      <div className={`val ${(r?.chgPct ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{r ? dp(r.chgPct) : "—"}</div>
      <div className="sub">{r ? r.price.toLocaleString("en-IN", { maximumFractionDigits: r.price < 100 ? 2 : 0 }) : "day %"}</div>
    </>
  );
  return (
    <div className="panel">
      <p className="p-head">Market overview <a href={`/module/53?symbol=${encodeURIComponent(ticker)}`} style={{ marginLeft: 8 }}>FULL DESK →</a></p>
      {mkt.length === 0 && !br && <p className="muted">PULLING MARKET…</p>}
      {(mkt.length > 0 || br) && (
        <div className="cells">
          <div className="cell"><div className="lbl">Nifty 50</div>{idx(nifty)}</div>
          <div className="cell"><div className="lbl">Sensex</div>{idx(sensex)}</div>
          <div className="cell"><div className="lbl">Bank Nifty</div>{idx(bank)}</div>
          <div className="cell">
            <div className="lbl">India VIX</div>
            <div className="val" style={{ fontSize: 16 }}>{vix ? vix.price.toFixed(1) : "—"}</div>
            <div className="sub">{vix ? <span className={vix.chgPct >= 0 ? "neg" : "pos"}>{dp(vix.chgPct)} fear</span> : "vol gauge"}</div>
          </div>
          <div className="cell">
            <div className="lbl">Breadth N50</div>
            <div className="val" style={{ fontSize: 16 }}>
              {br ? <><span className="pos">{br.adv}▲</span> <span className="faint">/</span> <span className="neg">{br.dec}▼</span></> : "—"}
            </div>
            <div className="sub">{br ? `${br.pctAbove20}% above 20D` : "adv / dec"}</div>
          </div>
          <div className="cell">
            <div className="lbl">Tape read</div>
            <div className={`val ${verdict === "RISK-ON" ? "pos" : verdict === "RISK-OFF" ? "neg" : ""}`} style={{ fontSize: 16 }}>{verdict ?? "—"}</div>
            <div className="sub">
              {br && br.top[0] ? `▲ ${br.top[0].symbol.replace(".NS", "")} ${br.top[0].dayChgPct >= 0 ? "+" : ""}${br.top[0].dayChgPct.toFixed(1)}%` : ""}
              {br && br.bottom[0] ? ` · ▼ ${br.bottom[0].symbol.replace(".NS", "")} ${br.bottom[0].dayChgPct.toFixed(1)}%` : "risk vs gold"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MacroStrip() {  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/macro")
      .then((r) => r.json())
      .then((j) => { if (alive) setRows((j.rows ?? []).filter((r: any) => r.ok)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const cells = MACRO_PICKS.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  return (
    <div className="panel">
      <p className="p-head">Macro — key reads <a href="/macro" style={{ marginLeft: 8 }}>FULL DESK →</a></p>
      {cells.length === 0 && <p className="muted">PULLING MACRO…</p>}
      {cells.length > 0 && (
      <div className="cells">
        {cells.map((r: any) => (
          <div className="cell" key={r.id}>
            <div className="lbl">{r.label}</div>
            <div className="val" style={{ fontSize: 16 }}>{r.latest} <span className="faint" style={{ fontSize: 11 }}>{r.unit}</span></div>
            <div className="sub"><span className={(r.chgSign ?? 0) >= 0 ? "pos" : "neg"}>{r.chg}</span> · {r.date}</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

const CW = 640;

function CandleChart({ bars, overlays, dates, height = 190, showVol }: {
  bars: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
  overlays: Array<{ label: string; color: string; values: (number | null)[]; dashed?: boolean }>;
  dates: string[];
  height?: number;
  showVol?: boolean;
}) {
  const n = bars.length;
  const { hover, bind } = useHoverIndex(n);
  if (!n) return <p className="muted">NO BARS.</p>;
  const volH = showVol ? 36 : 0;
  const priceH = height;
  const H = priceH + volH;
  const lows = bars.map((b) => b.low), highs = bars.map((b) => b.high);
  const ov = overlays.flatMap((o) => o.values).filter((v): v is number => v !== null && isFinite(v));
  let mn = Math.min(...lows, ...(ov.length ? [Math.min(...ov)] : [Infinity]));
  let mx = Math.max(...highs, ...(ov.length ? [Math.max(...ov)] : [-Infinity]));
  if (!isFinite(mn) || !isFinite(mx) || mx - mn < 1e-9) { mn -= 1; mx += 1; }
  const pad = (mx - mn) * 0.06;
  mn -= pad; mx += pad;
  const bw = CW / n;
  const bodyW = Math.max(1.5, Math.min(14, bw * 0.62));
  const yOf = (v: number) => 6 + (1 - (v - mn) / (mx - mn)) * (priceH - 12);
  const xOf = (i: number) => (i + 0.5) * bw;
  const f1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 });
  const segs = (vals: (number | null)[]) => {
    const out: string[] = [];
    let cur: string[] = [];
    vals.forEach((v, i) => {
      if (v === null || !isFinite(v)) { if (cur.length > 1) out.push(cur.join(" ")); cur = []; return; }
      cur.push(`${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`);
    });
    if (cur.length > 1) out.push(cur.join(" "));
    return out;
  };
  const last = bars[n - 1];
  const lastY = yOf(last.close);
  const maxVol = Math.max(...bars.map((b) => b.volume || 0), 1);
  const hb = hover !== null ? bars[hover] : null;
  const prev = hover !== null ? bars[Math.max(hover - 1, 0)] : null;
  const chg = hb && prev && prev.close ? ((hb.close - prev.close) / prev.close) * 100 : 0;
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${CW} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none" {...bind}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={CW} y1={priceH * f} y2={priceH * f} stroke="#1e1e24" strokeWidth="1" />)}
          {showVol && bars.map((b, i) => {
            const h = Math.max(1.5, ((b.volume || 0) / maxVol) * (volH - 4));
            return <rect key={i} x={i * bw + 0.5} y={priceH + volH - h} width={Math.max(1, bw - 1)} height={h} fill={b.close >= b.open ? "#00d664" : "#ff453a"} opacity={hover === null || hover === i ? 0.45 : 0.15} />;
          })}
          {bars.map((b, i) => {
            const up = b.close >= b.open;
            const c = up ? "#00d664" : "#ff453a";
            const yO = yOf(b.open), yC = yOf(b.close);
            const top = Math.min(yO, yC);
            const h = Math.max(1.2, Math.abs(yC - yO));
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} opacity={dim ? 0.35 : 1}>
                <line x1={xOf(i)} x2={xOf(i)} y1={yOf(b.high)} y2={yOf(b.low)} stroke={c} strokeWidth={Math.max(1, bodyW * 0.22)} />
                <rect x={xOf(i) - bodyW / 2} y={top} width={bodyW} height={h} rx="1" fill={c} />
              </g>
            );
          })}
          {overlays.map((o) => segs(o.values).map((d, k) => (
            <polyline key={`${o.label}${k}`} points={d} fill="none" stroke={o.color} strokeWidth="1.8" strokeDasharray={o.dashed ? "5 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
          )))}
          <line x1="0" x2={CW} y1={lastY} y2={lastY} stroke="#f5f5f4" strokeWidth="1" strokeDasharray="4 3" opacity="0.55" />
          {hover !== null && (
            <g>
              <line x1={xOf(hover)} x2={xOf(hover)} y1="0" y2={H} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.9" />
              <circle cx={xOf(hover)} cy={yOf(bars[hover].close)} r="4.5" fill="#ffb000" stroke="#000" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>
        {hover !== null && hb && (
          <HoverTip
            idx={hover} count={n} date={dates[hover]}
            rows={[
              { label: "OPEN", color: "#a1a1aa", text: f1(hb.open) },
              { label: "HIGH", color: "#00d664", text: f1(hb.high) },
              { label: "LOW", color: "#ff453a", text: f1(hb.low) },
              { label: "CLOSE", color: "#ffb000", text: f1(hb.close) },
              { label: "CHG", color: chg >= 0 ? "#00d664" : "#ff453a", text: `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` },
              ...overlays.map((o) => {
                const v = o.values[hover];
                return { label: o.label, color: o.color, text: v === null || !isFinite(v) ? "—" : f1(v) };
              }),
            ]}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4 }} className="faint">
        <span>▲ {f1(mx - pad)}</span>
        <span>LAST {f1(last.close)}</span>
        <span>▼ {f1(mn + pad)}</span>
      </div>
      <div className="pills" style={{ marginTop: 8, gap: 8 }}>
        <span className="badge" style={{ color: last.close >= last.open ? "#00d664" : "#ff453a" }}>■ {n} CANDLES</span>
        {overlays.map((o) => {
          let lv: number | null = null;
          for (let i = o.values.length - 1; i >= 0; i--) { const v = o.values[i]; if (v !== null && isFinite(v)) { lv = v; break; } }
          return <span key={o.label} className="badge" style={{ color: o.color }}>■ {o.label} {lv === null ? "—" : f1(lv)}</span>;
        })}
      </div>
    </div>
  );
}

function HeroChart({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"CANDLES" | "LINES">("CANDLES");
  const [range, setRange] = useState<"3mo" | "6mo" | "1y">("6mo");
  const [showPrice, setShowPrice] = useState(true);
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showEMA20, setShowEMA20] = useState(false);
  const [showBB, setShowBB] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const [showStoch, setShowStoch] = useState(false);
  const [showVol, setShowVol] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=1d`)
      .then((r) => r.json())
      .then((j) => {
        if (alive) setBars(((j.bars ?? []) as any[]).map((b) => ({ date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 })));
      })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, range]);

  const closes = bars.map((b) => b.close);
  const dates = bars.map((b) => b.date);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const e20 = ema(closes, 20);
  const bb = bollinger(closes, 20, 2);
  const r14 = rsi(closes, 14);
  const mc = macd(closes, 12, 26, 9);
  const st = stochastic(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14, 3);
  const priceSeries = [
    ...(showPrice ? [{ label: "PRICE", color: "#ffb000", values: closes }] : []),
    ...(showSMA20 ? [{ label: "SMA20", color: "#00d664", values: s20 }] : []),
    ...(showSMA50 ? [{ label: "SMA50", color: "#8f7bff", values: s50 }] : []),
    ...(showEMA20 ? [{ label: "EMA20", color: "#00c8ff", values: e20 }] : []),
    ...(showBB ? [
      { label: "BB-UP", color: "#5b5b62", values: bb.upper, dashed: true },
      { label: "BB-LO", color: "#5b5b62", values: bb.lower, dashed: true },
    ] : []),
  ];
  const pills: Array<[string, boolean, (v: boolean) => void]> = [
    ["PRICE", showPrice, setShowPrice],
    ["SMA20", showSMA20, setShowSMA20],
    ["SMA50", showSMA50, setShowSMA50],
    ["EMA20", showEMA20, setShowEMA20],
    ["BB 20·2", showBB, setShowBB],
    ["RSI", showRSI, setShowRSI],
    ["MACD", showMACD, setShowMACD],
    ["STOCH", showStoch, setShowStoch],
    ["VOL", showVol, setShowVol],
  ];
  const x3: [string, string, string] = [dates[0] ?? "", dates[Math.floor(dates.length / 2)] ?? "", dates[dates.length - 1] ?? ""];

  const candleOverlays = [
    ...(showSMA20 ? [{ label: "SMA20", color: "#00d664", values: s20 }] : []),
    ...(showSMA50 ? [{ label: "SMA50", color: "#8f7bff", values: s50 }] : []),
    ...(showEMA20 ? [{ label: "EMA20", color: "#00c8ff", values: e20 }] : []),
    ...(showBB ? [
      { label: "BB-UP", color: "#5b5b62", values: bb.upper, dashed: true },
      { label: "BB-LO", color: "#5b5b62", values: bb.lower, dashed: true },
    ] : []),
  ];
  const rangeLabel = range === "3mo" ? "3M" : range === "1y" ? "1Y" : "6M";

  return (
    <div className="panel">
      <p className="p-head">
        Trend — {rangeLabel} {dates.length > 1 ? <span className="faint">— {dates[0]} → {dates[dates.length - 1]}</span> : null}
      </p>
      <div className="pills" style={{ marginBottom: 8 }}>
        {(["CANDLES", "LINES"] as const).map((m) => (
          <button key={m} className={`pill${mode === m ? " active" : ""}`} onClick={() => setMode(m)}>{m === "CANDLES" ? "🕯 CANDLES" : "LINE"}</button>
        ))}
        <span className="faint" style={{ alignSelf: "center" }}>|</span>
        {(["3mo", "6mo", "1y"] as const).map((r) => (
          <button key={r} className={`pill${range === r ? " active" : ""}`} onClick={() => setRange(r)}>{r === "3mo" ? "3M" : r === "1y" ? "1Y" : "6M"}</button>
        ))}
        <span className="faint" style={{ alignSelf: "center" }}>|</span>
        {pills.map(([label, on, set]) => (
          <button key={label} className={`pill${on ? " active" : ""}`} onClick={() => set(!on)}>{mode === "CANDLES" && label === "PRICE" ? "🕯 OHLC" : label}</button>
        ))}
      </div>
      {loading && <p className="muted">PLOTTING {symbol}…</p>}
      {!loading && mode === "CANDLES" && (showPrice || candleOverlays.length > 0) && bars.length > 1 && (
        <CandleChart
          bars={showPrice ? bars : bars.map((b) => ({ ...b, open: b.close, high: b.close, low: b.close }))}
          overlays={candleOverlays} dates={dates} height={190} showVol={showVol}
        />
      )}
      {!loading && mode === "LINES" && priceSeries.length > 0 && (
        <LineChart
          series={priceSeries} height={150}
          yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          dates={dates}
        />
      )}
      {!loading && priceSeries.length === 0 && (mode === "LINES" || (!showPrice && candleOverlays.length === 0)) && (
        <p className="muted">ALL PRICE LAYERS OFF — TOGGLE ONE BACK ON.</p>
      )}
      {showRSI && !loading && (
        <div style={{ marginTop: 10 }}>
          <LineChart
            series={[{ label: "RSI 14", color: "#8f7bff", values: r14 }]}
            height={90} yFmt={(v) => v.toFixed(0)} dates={dates} xLabels={x3}
          />
        </div>
      )}
      {showMACD && !loading && (
        <div style={{ marginTop: 10 }}>
          <LineChart
            series={[
              { label: "MACD", color: "#ffa028", values: mc.line },
              { label: "SIGNAL", color: "#a1a1aa", values: mc.signal },
            ]}
            height={90} yFmt={(v) => v.toFixed(2)} dates={dates} xLabels={x3}
          />
        </div>
      )}
      {showStoch && !loading && (
        <div style={{ marginTop: 10 }}>
          <LineChart
            series={[
              { label: "%K", color: "#00d664", values: st.pctK },
              { label: "%D", color: "#ff453a", values: st.pctD },
            ]}
            height={90} yFmt={(v) => v.toFixed(0)} dates={dates} xLabels={x3}
          />
        </div>
      )}
      {showVol && !loading && (
        <div style={{ marginTop: 10 }}>
          <BarChart values={bars.map((b) => b.volume)} labels={dates} height={80} posColor="#5b5b62" negColor="#5b5b62" />
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [ticker, setTicker] = useState(DEFAULT_TICKER);
  const [q, setQ] = useState<QuoteResp | null>(null);
  const [cat, setCat] = useState("All");
  const [search, setSearch] = useState("");
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    setTicker(store.getTicker());
    setWatch(store.getWatchlist());
  }, []);

  useEffect(() => {
    store.setTicker(ticker);
    let alive = true;
    fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setQ(j.error ? null : j); })
      .catch(() => { if (alive) setQ(null); });
    return () => { alive = false; };
  }, [ticker]);

  const filtered = useMemo(() => {
    const s = search.trim().toUpperCase();
    return MODULES.filter((m) =>
      !m.hidden &&
      (cat === "All" || m.category === cat) &&
      (s === "" ||
        m.label.toUpperCase().includes(s) ||
        m.description.toUpperCase().includes(s) ||
        funcCode(m.id) === s ||
        m.id === s)
    );
  }, [cat, search]);

  const tickHits = useMemo(() => {
    const s = search.trim().toUpperCase();
    if (!s || s.length < 2) return [];
    return WATCHLIST.filter((w) => w.includes(s)).slice(0, 6);
  }, [search]);

  const strip = watch.length > 0 ? watch.slice(0, 10) : TAPE;
  const up = (q?.regularMarketChangePercent ?? 0) >= 0;

  return (
    <>
      <CommandBar ticker={ticker} onTicker={setTicker} />
      <div className="securities">
        <a href="/opening" style={{ textDecoration: "none" }} title="Pre-Market Opening Desk"><button className="sec-item fn">▮ PRE</button></a>
        <a href="/ochain" style={{ textDecoration: "none" }} title="NSE Option Chain"><button className="sec-item fn">▮ OC</button></a>
        <span className="strip-sep">|</span>
        {strip.map((t) => (
          <button key={t} className={`sec-item${t === ticker ? " active" : ""}`} onClick={() => setTicker(t)}>
            {t}
          </button>
        ))}
        <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>{WATCHLIST.length.toLocaleString("en-IN")} SEC LISTED</span>
      </div>

      <main className="container grid">
        <div className="panel panel-glow">
          <div className="sec-head">
            <span className="sec-name">{ticker.replace(".NS", "")}<span className="suffix"> {ticker.endsWith(".NS") ? "NS" : ""} &lt;EQUITY&gt;</span></span>
            <span className={`sec-price ${up ? "pos" : "neg"}`}>
              {q ? `₹${q.regularMarketPrice?.toLocaleString("en-IN")}` : "----.--"}
            </span>
            <span className={`badge ${up ? "ok" : "bad"}`}><span className="dot" />{q ? `${up ? "▲" : "▼"} ${Math.abs(q.regularMarketChangePercent).toFixed(2)}%` : "NO FEED"}</span>
            <button className="ghost" style={{ marginLeft: "auto" }} onClick={() => {
              const w = store.getWatchlist();
              if (!w.includes(ticker)) { const n = [...w, ticker]; store.setWatchlist(n); setWatch(n); }
            }}>+ WATCH</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {q?.shortName ?? "LOADING SECURITY…"} · {MODULES.length} FUNCTIONS · {CATEGORIES.length} DESKS · TYPE <span className="sec">TICKER FNC</span> ABOVE + ENTER
          </div>
          <div className="cells" style={{ marginTop: 12 }}>
            <div className="cell"><div className="lbl">Last</div><div className={`val ${up ? "pos" : "neg"}`}>{q ? q.regularMarketPrice?.toLocaleString("en-IN") : "—"}</div><div className="sub">INR · NSE</div></div>
            <div className="cell"><div className="lbl">Net Chg</div><div className={`val ${up ? "pos" : "neg"}`}>{q ? `${up ? "+" : ""}${q.regularMarketChange?.toFixed(2)}` : "—"}</div><div className="sub">day</div></div>
            <div className="cell"><div className="lbl">Functions</div><div className="val">{MODULES.length}</div><div className="sub">FNC codes live</div></div>
            <div className="cell"><div className="lbl">Desks</div><div className="val">{CATEGORIES.length}</div><div className="sub">coverage</div></div>
            <div className="cell"><div className="lbl">Watchlist</div><div className="val">{watch.length}</div><div className="sub">this terminal</div></div>
            <div className="cell"><div className="lbl">Feed</div><div className="val pos" style={{ fontSize: 15 }}>● LIVE</div><div className="sub">yahoo finance</div></div>
          </div>
        </div>

        <HeroChart symbol={ticker} />

        <MarketOverview ticker={ticker} />

        <MacroStrip />

        <div className="panel">
          <p className="p-head">Function directory — {filtered.length}/{MODULES.filter((m) => !m.hidden).length}</p>
          <div className="toolbar">
            <input className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="FILTER: NAME, FNC (GP/FA/DCF) OR TICKER…" />
          </div>
          <div className="pills" style={{ marginTop: 8 }}>
            {["All", ...CATEGORIES].map((c) => (
              <button key={c} className={`pill${cat === c ? " active" : ""}`} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
          {tickHits.length > 0 && (
            <div className="pills" style={{ marginTop: 8 }}>
              <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>SEC:</span>
              {tickHits.map((s) => (
                <button key={s} className="pill" onClick={() => setTicker(s)}>{s}</button>
              ))}
            </div>
          )}
          <table className="fntbl" style={{ marginTop: 10 }}>
            <thead><tr><th style={{ width: 70 }}>FNC</th><th style={{ width: 220 }}>Desk</th><th>Description</th></tr></thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} onClick={() => router.push(`${m.route}?symbol=${encodeURIComponent(ticker)}`)}>
                  <td className="fnc">{funcCode(m.id)}</td>
                  <td className="desk">{m.label}</td>
                  <td className="desc">{m.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
      <StatusBar ticker={ticker} extra={`${filtered.length} FNC SHOWN`} />
    </>
  );
}
