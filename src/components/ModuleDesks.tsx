"use client";

import { useEffect, useMemo, useState } from "react";
import { chatComplete } from "@/lib/ai";
import { store } from "@/lib/store";
import { Donut, HBars, AreaChart, Histogram } from "./charts";

/* ---------------- shared ---------------- */

function useJson<T>(url: string | null): { data: T | null; err: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setLoading(true); setErr("");
    fetch(url)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "feed failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, n]);
  return { data, err, loading, reload: () => setN((x) => x + 1) };
}

function SentBadge({ label }: { label: string }) {
  const cls = label === "BULL" ? "ok" : label === "BEAR" ? "bad" : "";
  return <span className={`badge ${cls}`}><span className="dot" />{label}</span>;
}

function downloadCSV(name: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function MiniSpark({ data, w = 120, h = 28 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return <span className="faint">—</span>;
  const mn = Math.min(...data), mx = Math.max(...data);
  const up = data[data.length - 1] >= data[0];
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / (mx - mn || 1)) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <title>{`LAST ${data[data.length - 1].toLocaleString("en-IN", { maximumFractionDigits: 1 })}`}</title>
      <polyline points={pts} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.5" />
    </svg>
  );
}

/* ---------------- news wire ---------------- */

interface NewsPayload {
  symbol: string; feed: string; count: number; bull: number; bear: number; neut: number;
  sources: string[]; items: Array<{ id: string; title: string; link: string; source: string; published: string; ago: string; score: number; label: string }>;
}

function hhmm(iso: string, fallback: string): string {
  const t = Date.parse(iso ?? "");
  if (!isFinite(t)) return fallback || "—";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------------- article reader dialog ---------------- */

function ReaderPane({ item, art, loading, err, onClose, onRetry }: {
  item: { title: string; link: string; source: string; published: string; ago: string } | null;
  art: { title: string; paragraphs: string[] } | null;
  loading: boolean; err: string;
  onClose: () => void; onRetry: () => void;
}) {
  const [pts, setPts] = useState("");
  const [ptsLoading, setPtsLoading] = useState(false);
  const [ptsErr, setPtsErr] = useState("");
  const [ptsOn, setPtsOn] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function keyPoints() {
    if (!art || art.paragraphs.length === 0) return;
    setPtsLoading(true); setPtsErr(""); setPtsOn(true);
    try {
      const txt = await chatComplete([
        { role: "system", content: "Summarize the article into key points. UNDER 100 WORDS TOTAL. Terse uppercase terminal bullet lines, no preamble, no conclusion." },
        { role: "user", content: `TITLE: ${art.title}\n\n${art.paragraphs.join("\n").slice(0, 6000)}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setPts(txt);
    } catch (e: any) {
      setPtsErr(e.message);
    } finally {
      setPtsLoading(false);
    }
  }

  return (
    <div className="dlg-back" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <span className="sec">READER</span>
          <button className="ghost" style={{ padding: "2px 10px" }} onClick={onClose}>CLOSE ✕</button>
        </div>
        {!item ? <p className="muted">STORY GONE — PICK ANOTHER.</p> : (
          <>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.45 }}>{art?.title || item.title}</div>
            <div className="faint" style={{ fontSize: 11, margin: "4px 0 8px 0" }}>
              {item.source} · {item.published ? item.published.slice(0, 10) : item.ago}
              {item.link && <> · <a href={item.link} target="_blank" rel="noreferrer">OPEN ORIGINAL ↗</a></>}
            </div>
            <div className="rail-panel" style={{ marginBottom: 10 }}>
              <div className="rail-sub">Key points — under 100 words</div>
              {!ptsOn
                ? <button className="btn" style={{ padding: "6px 14px", fontSize: 12 }} onClick={keyPoints} disabled={!art}>SUMMARIZE</button>
                : ptsLoading ? <p className="muted">CRUNCHING KEY POINTS…</p>
                : ptsErr ? <p className="neg">KEY-POINTS ERR: {ptsErr} <button className="ghost" style={{ marginLeft: 6 }} onClick={keyPoints}>RETRY</button></p>
                : <pre className="ai" style={{ margin: 0 }}>{pts}</pre>}
            </div>
            <div className="dlg-body">
              {loading && <p className="muted">PULLING FULL TEXT…</p>}
              {err && <p className="neg">READER ERR: {err} <button className="ghost" style={{ marginLeft: 6 }} onClick={onRetry}>RETRY</button></p>}
              {art && art.paragraphs.map((p, i) => (
                <p key={i} style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text)", margin: "0 0 12px 0" }}>{p}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function NewsDesk({ symbol, feed, title, initialQ }: { symbol: string; feed: string; title: string; initialQ?: string }) {
  const tabs = useMemo(() => {
    const base = [
      { id: feed, label: title },
      { id: "wire", label: "ALL STORIES" },
      { id: "company", label: "COMPANY" },
      { id: "custom", label: "CUSTOM SEARCH" },
    ];
    const seen = new Set<string>();
    return base.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  }, [feed, title]);

  const [tab, setTab] = useState(feed);
  const [draft, setDraft] = useState(initialQ ?? "");
  const [appliedQ, setAppliedQ] = useState(initialQ ?? "");
  const [narrow, setNarrow] = useState("");
  const [sent, setSent] = useState<"ALL" | "BULL" | "BEAR" | "NEUT">("ALL");
  const [shown, setShown] = useState(15);
  const [read, setRead] = useState<string[]>([]);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [art, setArt] = useState<{ title: string; paragraphs: string[] } | null>(null);
  const [artLoading, setArtLoading] = useState(false);
  const [artErr, setArtErr] = useState("");

  useEffect(() => {
    try { setRead(JSON.parse(window.localStorage.getItem("iss.readNews") ?? "[]")); } catch { /* empty */ }
  }, []);
  useEffect(() => {
    setTab(feed); setDraft(initialQ ?? ""); setAppliedQ(initialQ ?? ""); setShown(15); setNarrow(""); setSent("ALL");
    setOpenId(null); setArt(null); setArtErr("");
  }, [feed, symbol, initialQ]);

  const effFeed = tab === "custom" ? "wire" : tab;
  const effQ = tab === "custom" ? appliedQ : tab === feed ? (initialQ ?? "") : "";
  const { data, err, loading, reload } = useJson<NewsPayload>(
    `/api/news?symbol=${encodeURIComponent(symbol)}&feed=${effFeed}${effQ ? `&q=${encodeURIComponent(effQ)}` : ""}`
  );

  function markRead(id: string) {
    setRead((prev) => {
      if (prev.includes(id)) return prev;
      const next = [id, ...prev].slice(0, 300);
      try { window.localStorage.setItem("iss.readNews", JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  }

  const openSeq = useState(() => ({ n: 0 }))[0];
  function openArticle(n: { id: string; title: string; link: string; source: string }) {
    if (!n.link) return;
    markRead(n.id);
    const my = ++openSeq.n;
    setOpenId(n.id); setArt(null); setArtErr(""); setArtLoading(true);
    fetch(`/api/article?url=${encodeURIComponent(n.link)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "article failed");
        if (openSeq.n === my) setArt({ title: j.title || n.title, paragraphs: j.paragraphs ?? [] });
      })
      .catch((e) => { if (openSeq.n === my) setArtErr(e.message); })
      .finally(() => { if (openSeq.n === my) setArtLoading(false); });
  }

  async function brief() {
    if (!data || data.items.length === 0) return;
    setAiLoading(true); setAiOut("");
    const lines = data.items.slice(0, 10).map((n, i) => `${i + 1}. [${n.label}] ${n.title} (${n.source})`).join("\n");
    try {
      const txt = await chatComplete([
        { role: "system", content: "You are a Bloomberg-style wire editor. Reply in terse uppercase terminal lines: 3-bullet brief + RISK line." },
        { role: "user", content: `SEC ${symbol}. HEADLINES:\n${lines}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  const items = (data?.items ?? []).filter((n) => {
    if (sent !== "ALL" && n.label !== sent) return false;
    if (narrow && !(n.title + " " + n.source).toUpperCase().includes(narrow.toUpperCase())) return false;
    return true;
  });
  const visible = items.slice(0, shown);
  const tape = (data?.items ?? []).slice(0, 8);
  const counts: Array<{ k: "ALL" | "BULL" | "BEAR" | "NEUT"; n: number }> = [
    { k: "ALL", n: (data?.items ?? []).length },
    { k: "BULL", n: data?.bull ?? 0 },
    { k: "BEAR", n: data?.bear ?? 0 },
    { k: "NEUT", n: data?.neut ?? 0 },
  ];

  return (
    <div className="top">
      <div className="top-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`top-tab${tab === t.id ? " active" : ""}`} onClick={() => { setTab(t.id); setShown(15); }}>
            {t.label}
          </button>
        ))}
        <span className="top-count">{data ? `${items.length} STORIES` : "…"}</span>
      </div>

      {tab === "custom" && (
        <div className="top-narrow">
          <span className="top-prompt">&gt;</span>
          <input
            className="top-input" value={draft} onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { setAppliedQ(draft.trim()); setShown(15); } }}
            placeholder="CUSTOM SEARCH… (E.G. RBI RATE CUT) + ENTER" spellCheck={false} autoComplete="off"
          />
          <button className="ghost" style={{ padding: "4px 12px" }} onClick={() => { setAppliedQ(draft.trim()); setShown(15); }}>RUN</button>
        </div>
      )}

      <div className="top-narrow">
        <span className="top-prompt">&lt;NARROW&gt;</span>
        <input
          className="top-input" value={narrow} onChange={(e) => { setNarrow(e.target.value.toUpperCase()); setShown(15); }}
          placeholder="FILTER THESE STORIES…" spellCheck={false} autoComplete="off"
        />
        <span className="top-show">SHOW</span>
        {counts.map((c) => (
          <button key={c.k} className={`top-check${sent === c.k ? " active" : ""}`} onClick={() => { setSent(c.k); setShown(15); }}>
            ☑ {c.k} {c.n}
          </button>
        ))}
      </div>

      <div className="top-cols">
        <div className="top-main">
          <div className="top-sec">Top Stories {title} | <span className="top-more" onClick={() => setShown((s) => s + 15)}>More »</span></div>
          {loading && <p className="muted">PULLING WIRE FOR {symbol}…</p>}
          {err && <p className="neg">ERR: {err} <button className="ghost" onClick={reload}>RETRY</button></p>}
          <ol className="top-list">
            {visible.map((n, i) => {
              const isRead = read.includes(n.id);
              return (
                <li key={n.id} className={`top-row${isRead ? " read" : ""}${openId === n.id ? " open" : ""}`}>
                  <span className="top-num">{i + 1})</span>
                  {n.link
                    ? <span className="top-head" role="link" tabIndex={0} style={{ cursor: "pointer" }}
                        onClick={() => openArticle(n)}
                        onKeyDown={(e) => { if (e.key === "Enter") openArticle(n); }}>{n.title}</span>
                    : <span className="top-head">{n.title}</span>}
                  <span className="top-src">{n.source.slice(0, 14)}</span>
                  <span className="top-time">{hhmm(n.published, n.ago)}</span>
                  {!isRead && <span className="unread" title="unread" />}
                </li>
              );
            })}
          </ol>
          {data && items.length === 0 && <p className="muted">WIRE QUIET — RETRY IN A MINUTE.</p>}
          {shown < items.length && <button className="ghost" style={{ marginTop: 8 }} onClick={() => setShown((s) => s + 15)}>MORE » ({items.length - shown} LEFT)</button>}
        </div>

        <div className="top-rail">
          <div className="rail-panel">
            <div className="rail-head">Top News</div>
            <div className="rail-sub">Insight | <span className="top-more" onClick={() => setShown((s) => s + 15)}>More »</span></div>
            {(data?.items ?? []).slice(0, 5).map((n) => (
              <div key={n.id} className="rail-link">
                &gt; {n.link
                  ? <span role="link" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => openArticle(n)}
                      onKeyDown={(e) => { if (e.key === "Enter") openArticle(n); }}>{n.title}</span>
                  : n.title}
              </div>
            ))}
          </div>
          <div className="rail-panel">
            <div className="rail-sub">First Word | <span className="top-more" onClick={() => setShown((s) => s + 15)}>More »</span></div>
            {(data?.items ?? []).slice(0, 3).map((n) => (
              <div key={n.id} className="rail-first" style={n.link ? { cursor: "pointer" } : undefined}
                onClick={() => { if (n.link) openArticle(n); }}>
                <span className="sec">{n.title}</span>
                <span className="faint"> [{hhmm(n.published, n.ago)}]</span>
              </div>
            ))}
          </div>
          <div className="rail-panel">
            <div className="rail-sub">AI Brief</div>
            <button className="btn" style={{ padding: "7px 14px", fontSize: 12 }} onClick={brief} disabled={aiLoading || !data}>RUN</button>
            {aiOut && <pre className="ai" style={{ marginTop: 8 }}>{aiOut}</pre>}
          </div>
        </div>
      </div>

      {openId && (
        <ReaderPane
          item={(data?.items ?? []).find((x: any) => x.id === openId) ?? null}
          art={art} loading={artLoading} err={artErr}
          onClose={() => { setOpenId(null); setArt(null); setArtErr(""); }}
          onRetry={() => {
            const n = (data?.items ?? []).find((x: any) => x.id === openId);
            if (n) openArticle(n);
          }}
        />
      )}

      {tape.length > 0 && (
        <div className="top-tape">
          <div className="tape-inner">
            {[...tape, ...tape].map((n, i) => (
              <span key={i} className="tape-bit">
                <strong>{n.source.slice(0, 4)}</strong> {hhmm(n.published, n.ago)} {n.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- market board ---------------- */

const BOARD_GROUPS: Array<{ title: string; syms: string[]; session: string }> = [
  { title: "INDICES", syms: ["^NSEI", "^NSEBANK", "^BSESN", "^INDIAVIX", "^GSPC", "^FTSE", "^N225", "^CNXIT"], session: "NSE" },
  { title: "COMMODITIES", syms: ["GC=F", "SI=F", "CL=F", "NG=F"], session: "GLOBAL" },
  { title: "FX", syms: ["USDINR=X", "EURINR=X", "GBPINR=X"], session: "FX" },
  { title: "CRYPTO", syms: ["BTC-USD", "ETH-USD"], session: "24/7" },
  { title: "ETF", syms: ["NIFTYBEES.NS", "GOLDBEES.NS"], session: "NSE" },
];

function sessionOpen(which: string): boolean {  const d = new Date(Date.now() + (330 + new Date().getTimezoneOffset()) * 60000);
  const mins = d.getHours() * 60 + d.getMinutes();
  const day = d.getDay();
  if (which === "24/7") return true;
  if (which === "GLOBAL") return true;
  if (day === 0 || day === 6) return false;
  if (which === "NSE") return mins >= 555 && mins < 930;
  if (which === "FX") return true;
  return true;
}

// Full-scope drill-down for one board instrument: 1Y trend, momentum
// windows, 52W positioning, volatility, drawdown, Nifty beta.
function BoardDetail({ sym, label, onClose }: { sym: string; label: string; onClose: () => void }) {
  const { data, err, loading } = useJson<{ bars: Array<{ date: string; high: number; low: number; close: number }> }>(
    `/api/history?symbol=${encodeURIComponent(sym)}&range=1y&interval=1d`
  );
  const { data: bm } = useJson<{ bars: Array<{ date: string; close: number }> }>(`/api/history?symbol=%5ENSEI&range=1y&interval=1d`);
  const bars = (data?.bars ?? []).filter((b) => isFinite(b.close));
  if (!loading && !err && bars.length < 30) {
    return <div className="panel"><p className="p-head">◆ {label} — full scope</p><p className="muted">NO HISTORY ON FEED.</p><button className="ghost" onClick={onClose}>CLOSE ✕</button></div>;
  }
  const closes = bars.map((b) => b.close);
  const last = closes.length ? closes[closes.length - 1] : NaN;
  const prev = closes.length > 1 ? closes[closes.length - 2] : last;
  const mom = (n: number) => (closes.length > n ? ((last - closes[closes.length - 1 - n]) / closes[closes.length - 1 - n]) * 100 : NaN);
  const hi = bars.length ? Math.max(...bars.map((b) => b.high)) : NaN;
  const lo = bars.length ? Math.min(...bars.map((b) => b.low)) : NaN;
  const pos = isFinite(hi) && isFinite(lo) && hi > lo ? ((last - lo) / (hi - lo)) * 100 : NaN;
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  const m = lr.length ? lr.reduce((a, b) => a + b, 0) / lr.length : 0;
  const vol = lr.length > 1 ? Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / lr.length) * Math.sqrt(252) * 100 : NaN;
  let peak = closes[0] ?? 0, dd = 0;
  for (const c of closes) { if (c > peak) peak = c; dd = Math.min(dd, (c - peak) / peak); }
  let beta: number | null = null;
  const bc = (bm?.bars ?? []).map((b) => b.close).filter(isFinite);
  if (bc.length > 70 && lr.length > 70) {
    const w = 60, sr = lr.slice(-w);
    const br: number[] = [];
    const bt = bc.slice(-w - 1);
    for (let i = 1; i < bt.length; i++) br.push(Math.log(bt[i] / bt[i - 1]));
    if (br.length === w) {
      const mb = br.reduce((a, b) => a + b, 0) / w, ms = sr.reduce((a, b) => a + b, 0) / w;
      const cov = sr.reduce((a, b, i) => a + (b - ms) * (br[i] - mb), 0) / w;
      const vb = br.reduce((a, b) => a + (b - mb) ** 2, 0) / w;
      beta = vb ? cov / vb : null;
    }
  }
  const f2 = (v: number) => (isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
  const day = prev ? ((last - prev) / prev) * 100 : NaN;
  return (
    <div className="panel panel-glow">
      <p className="p-head">◆ {label} — full scope · {sym} <button className="ghost" style={{ marginLeft: "auto", padding: "2px 10px" }} onClick={onClose}>CLOSE ✕</button></p>
      {loading && <p className="muted">PULLING 1Y TAPE FOR {label}…</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {bars.length >= 30 && (
        <>
          <div className="sec-head" style={{ marginBottom: 10 }}>
            <span className="sec-price" style={{ fontSize: 22 }}>{last.toLocaleString("en-IN", { maximumFractionDigits: last < 100 ? 2 : 0 })}</span>
            <span className={`badge ${day >= 0 ? "ok" : "bad"}`}><span className="dot" />{day >= 0 ? "▲" : "▼"} {Math.abs(day).toFixed(2)}% DAY</span>
            <span className="faint" style={{ fontSize: 11.5 }}>{bars[0]?.date} → {bars[bars.length - 1]?.date} · {bars.length} sessions</span>
          </div>
          <AreaChart values={closes} dates={bars.map((b) => b.date)} label={label} height={120} />
          <div className="cells" style={{ marginTop: 10 }}>
            <div className="cell"><div className="lbl">1MO %</div><div className={`val ${mom(21) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{f2(mom(21))}</div><div className="sub">21 sessions</div></div>
            <div className="cell"><div className="lbl">3MO %</div><div className={`val ${mom(63) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{f2(mom(63))}</div><div className="sub">63 sessions</div></div>
            <div className="cell"><div className="lbl">1Y %</div><div className={`val ${mom(252) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>{f2(mom(Math.min(252, closes.length - 1)))}</div><div className="sub">full range</div></div>
            <div className="cell"><div className="lbl">52W range</div><div className="val" style={{ fontSize: 14 }}>{isFinite(pos) ? `${pos.toFixed(0)}% up` : "—"}</div><div className="sub">{isFinite(hi) ? `HI ${hi.toLocaleString("en-IN", { maximumFractionDigits: 0 })} · LO ${lo.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : ""}</div></div>
            <div className="cell"><div className="lbl">1Y vol</div><div className="val" style={{ fontSize: 15 }}>{isFinite(vol) ? `${vol.toFixed(1)}%` : "—"}</div><div className="sub">ann · maxDD {(dd * 100).toFixed(1)}%</div></div>
            <div className="cell"><div className="lbl">Beta 60D</div><div className="val" style={{ fontSize: 15 }}>{beta !== null && isFinite(beta) ? beta.toFixed(2) : "—"}</div><div className="sub">vs nifty</div></div>
          </div>
        </>
      )}
    </div>
  );
}

export function MarketDesk() {
  const { data, err, loading } = useJson<{ rows: Array<{ sym: string; label: string; price: number; chgPct: number; spark: number[]; ok: boolean }> }>(`/api/market`);
  const [sel, setSel] = useState<string | null>(null);
  if (!data && !loading && !err) return null;
  const rows = (data?.rows ?? []).filter((r) => r.ok);
  const mChg = (r: { spark: number[] }) => {
    const s = (r.spark ?? []).filter((v) => isFinite(v));
    return s.length > 1 ? ((s[s.length - 1] - s[0]) / Math.abs(s[0] || 1)) * 100 : 0;
  };
  const bySym = (s: string) => rows.find((r) => r.sym === s);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const riskAvg = avg(["^NSEI", "^BSESN", "^GSPC", "^FTSE", "^N225", "BTC-USD", "CL=F"].map((s) => bySym(s)?.chgPct ?? NaN).filter((v) => isFinite(v)));
  const safeAvg = avg(["GC=F", "SI=F"].map((s) => bySym(s)?.chgPct ?? NaN).filter((v) => isFinite(v)));
  const score = riskAvg - safeAvg;
  const verdict = score > 0.3 ? "RISK-ON" : score < -0.3 ? "RISK-OFF" : "MIXED";
  const sorted = [...rows].sort((a, b) => b.chgPct - a.chgPct);
  const perf = [...rows].map((r) => ({ r, m: mChg(r) })).sort((a, b) => b.m - a.m);
  const selRow = rows.find((r) => r.sym === sel) ?? null;
  // Position of last close inside its 1MO spark range (0 = month low).
  const rng1mo = (spark: number[]): number => {
    const s = (spark ?? []).filter((v) => isFinite(v));
    if (s.length < 2) return NaN;
    const hi = Math.max(...s), lo = Math.min(...s);
    return hi > lo ? ((s[s.length - 1] - lo) / (hi - lo)) * 100 : NaN;
  };
  const sessions: Array<[string, boolean]> = [
    ["NSE 09:15–15:30", sessionOpen("NSE")],
    ["FX WEEKDAYS", sessionOpen("FX")],
    ["CRYPTO 24/7", sessionOpen("24/7")],
  ];

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Risk barometer — equities/crypto/crude vs gold/silver</p>
        {loading && <p className="muted">SNAPPING BOARD…</p>}
        {err && <p className="neg">ERR: {err}</p>}
        {rows.length > 0 && (<div className="cells">
          <div className="cell"><div className="lbl">Tape read</div><div className={`val ${verdict === "RISK-ON" ? "pos" : verdict === "RISK-OFF" ? "neg" : ""}`} style={{ fontSize: 19 }}>{verdict}</div><div className="sub">score {score >= 0 ? "+" : ""}{score.toFixed(2)}pp</div></div>
          <div className="cell"><div className="lbl">Risk leg</div><div className={`val ${riskAvg >= 0 ? "pos" : "neg"}`}>{riskAvg >= 0 ? "+" : ""}{riskAvg.toFixed(2)}%</div><div className="sub">avg day</div></div>
          <div className="cell"><div className="lbl">Safe leg</div><div className="val">{safeAvg >= 0 ? "+" : ""}{safeAvg.toFixed(2)}%</div><div className="sub">Au + Ag</div></div>
          <div className="cell"><div className="lbl">Best</div><div className="val pos" style={{ fontSize: 15 }}>{sorted[0]?.label ?? "—"}</div><div className="sub">{sorted[0] ? `+${sorted[0].chgPct.toFixed(2)}%` : ""}</div></div>
          <div className="cell"><div className="lbl">Worst</div><div className="val neg" style={{ fontSize: 15 }}>{sorted[sorted.length - 1]?.label ?? "—"}</div><div className="sub">{sorted[sorted.length - 1] ? `${sorted[sorted.length - 1].chgPct.toFixed(2)}%` : ""}</div></div>
          <div className="cell"><div className="lbl">Sessions IST</div><div className="val" style={{ fontSize: 12 }}>{sessions.map(([s, o]) => `${o ? "●" : "○"} ${s}`).join(" · ")}</div><div className="sub">open now</div></div>
        </div>)}
      </div>

      {rows.length > 0 && (<>
      <div className="panel">
        <p className="p-head">Heatmap — day % (intensity = magnitude) · click a tile for full scope</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))", gap: 6 }}>
          {sorted.map((r) => {
            const s = (r.spark ?? []).filter((v) => isFinite(v));
            const m1 = mChg(r);
            const hi = s.length ? Math.max(...s) : NaN;
            const lo = s.length ? Math.min(...s) : NaN;
            const last = s.length ? s[s.length - 1] : NaN;
            const rng = isFinite(hi) && isFinite(lo) && hi > lo ? ((last - lo) / (hi - lo)) * 100 : NaN;
            const w20 = s.slice(-20);
            const sma20 = w20.length ? w20.reduce((a, b) => a + b, 0) / w20.length : NaN;
            const above = isFinite(sma20) && last >= sma20;
            return (
            <div key={r.sym} onClick={() => setSel((sl) => (sl === r.sym ? null : r.sym))} title={`${r.label} — full scope`} style={{
              padding: "8px 10px", borderRadius: 3, cursor: "pointer",
              border: sel === r.sym ? "1px solid var(--amber)" : "1px solid var(--grid)",
              boxShadow: sel === r.sym ? "0 0 12px rgba(255,160,40,0.25)" : "none",
              background: r.chgPct >= 0 ? `rgba(0,214,100,${Math.min(0.35, 0.06 + Math.abs(r.chgPct) / 12)})` : `rgba(255,69,58,${Math.min(0.35, 0.06 + Math.abs(r.chgPct) / 12)})`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{sel === r.sym ? "◆ " : ""}{r.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700 }} className={r.chgPct >= 0 ? "pos" : "neg"}>
                {r.chgPct >= 0 ? "+" : ""}{r.chgPct.toFixed(2)}%
              </div>
              <div className="faint" style={{ fontSize: 10.5 }}>{r.price.toLocaleString("en-IN", { maximumFractionDigits: r.price < 100 ? 2 : 0 })}</div>
              <div style={{ fontSize: 10.5, marginTop: 3 }}>
                <span className={m1 >= 0 ? "pos" : "neg"}>1MO {m1 >= 0 ? "+" : ""}{m1.toFixed(1)}%</span>
                {" · "}<span className={above ? "pos" : "neg"} title="VS 20D AVG">{above ? "▲" : "▼"}20D</span>
              </div>
              {isFinite(rng) && (
                <div style={{ height: 3, background: "rgba(0,0,0,0.45)", borderRadius: 2, marginTop: 4, position: "relative" }} title={`1MO RANGE ${isFinite(rng) ? rng.toFixed(0) + "% UP" : ""}`}>
                  <div style={{ position: "absolute", left: `calc(${rng.toFixed(1)}% - 1px)`, top: -1.5, width: 2, height: 6, background: "#f5f5f4", borderRadius: 1 }} />
                </div>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {selRow && <BoardDetail sym={selRow.sym} label={selRow.label} onClose={() => setSel(null)} />}

      <div className="panel">
        <p className="p-head">1-month performance % · day % appended</p>
        <HBars rows={perf.map(({ r, m }) => ({
          label: r.label, value: Math.round(m * 100) / 100,
          display: `${m >= 0 ? "+" : ""}${m.toFixed(1)}% · D${r.chgPct >= 0 ? "+" : ""}${r.chgPct.toFixed(1)}%`,
          color: m >= 0 ? "#00d664" : "#ff453a",
        }))} />
      </div>

      {BOARD_GROUPS.map((g) => {
        const list = g.syms.map(bySym).filter((r): r is NonNullable<typeof r> => !!r);
        if (!list.length) return null;
        return (
          <div className="panel" key={g.title}>
            <p className="p-head">{g.title} <span className="faint">— {sessionOpen(g.session) ? "● LIVE SESSION" : "○ SHUT"}</span></p>
            <table className="plain">
              <thead><tr><th>INSTRUMENT</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>DAY %</th><th style={{ textAlign: "right" }}>1MO %</th><th style={{ textAlign: "right" }}>1MO RNG</th><th style={{ textAlign: "right" }}>1MO TREND</th></tr></thead>
              <tbody>
                {list.map((r) => {
                  const rp = rng1mo(r.spark);
                  return (
                  <tr key={r.sym} onClick={() => setSel((s) => (s === r.sym ? null : r.sym))} style={{ cursor: "pointer", background: sel === r.sym ? "rgba(255,160,40,0.07)" : undefined }} title={`${r.label} — full scope`}>
                    <td><strong>{sel === r.sym ? "◆ " : ""}{r.label}</strong> <span className="faint" style={{ fontSize: 11 }}>{r.sym}</span></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: "right" }}><span className={r.chgPct >= 0 ? "pos" : "neg"}>{r.chgPct >= 0 ? "▲" : "▼"} {Math.abs(r.chgPct).toFixed(2)}%</span></td>
                    <td style={{ textAlign: "right" }}><span className={mChg(r) >= 0 ? "pos" : "neg"}>{mChg(r) >= 0 ? "+" : ""}{mChg(r).toFixed(1)}%</span></td>
                    <td style={{ textAlign: "right" }} title="POSITION INSIDE 1MO RANGE">{isFinite(rp) ? <span className="muted">{rp.toFixed(0)}%</span> : "—"}</td>
                    <td style={{ textAlign: "right" }}><MiniSpark data={r.spark} /></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      </>)}
    </div>
  );
}

/* ---------------- screener ---------------- */

const KIND_TITLES: Record<string, string> = {
  momentum: "Momentum leaders — 20-day change",
  oversold: "Oversold RSI — bounce watch",
  dividend: "Dividend yield board",
  dip: "Drawdown dip scan — distance from 52W high",
  swing: "Swing set-ups — trend + RSI composite",
  all: "Workflow scanner — momentum / oversold / swing",
  deals: "Large deals", newcomers: "New listings",
};

export function ScreenerDesk({ kind }: { kind: string }) {
  const { data, err, loading, reload } = useJson<any>(`/api/screener?kind=${kind}`);
  const rows = data?.rows ?? [];
  const isAll = data?.kind === "all" || kind === "all";
  const momRows: any[] = data?.momentum ?? [];
  const overRows: any[] = data?.oversold ?? [];
  const swingRows: any[] = data?.swing ?? [];

  // Cross-board hits: a security on 2+ boards = higher conviction.
  const boardOf = useMemo(() => {
    const m = new Map<string, string[]>();
    const tag = (list: any[], b: string) => list.forEach((r: any) => {
      if (!r?.symbol) return;
      if (!m.has(r.symbol)) m.set(r.symbol, []);
      m.get(r.symbol)!.push(b);
    });
    tag(momRows, "MOM"); tag(overRows, "OS"); tag(swingRows, "SWG");
    return m;
  }, [data]);
  const overlaps = [...boardOf.entries()].filter(([, b]) => b.length >= 2).map(([s, b]) => ({ symbol: s, boards: b }));
  const maxMom = momRows.length ? Math.max(...momRows.map((r: any) => Math.abs(r.chg20Pct ?? 0)), 1) : 1;
  const maxSwing = swingRows.length ? Math.max(...swingRows.map((r: any) => Math.abs(r.score ?? 0)), 1) : 1;
  const short = (s: string) => String(s ?? "").replace(".NS", "");

  function exportAll() {
    const out: unknown[][] = [];
    momRows.forEach((r: any) => out.push(["MOMENTUM", short(r.symbol), r.price ?? "", r.chg20Pct ?? ""]));
    overRows.forEach((r: any) => out.push(["OVERSOLD", short(r.symbol), r.price ?? "", r.rsi14 ?? ""]));
    swingRows.forEach((r: any) => out.push(["SWING", short(r.symbol), r.price ?? "", r.score ?? ""]));
    downloadCSV(`scan-workflow.csv`, ["BOARD", "SEC", "PX", "VAL"], out);
  }

  // Single-kind chart metric: momentum -> 20D%, oversold -> mean-reversion edge (50-RSI), swing -> score.
  const chartRows = useMemo(() => {
    if (kind === "oversold") return [...rows].sort((a: any, b: any) => (a.rsi14 ?? 99) - (b.rsi14 ?? 99)).slice(0, 10).map((r: any) => ({
      label: short(r.symbol), value: 50 - (r.rsi14 ?? 50),
      display: `${(r.rsi14 ?? NaN).toFixed?.(1) ?? "—"} RSI`,
      color: (r.rsi14 ?? 99) < 30 ? "#00d664" : "#ffa028",
    }));
    if (kind === "swing") return [...rows].sort((a: any, b: any) => (b.score ?? b.chg20Pct ?? 0) - (a.score ?? a.chg20Pct ?? 0)).slice(0, 10).map((r: any) => ({
      label: short(r.symbol), value: r.score ?? r.chg20Pct ?? 0,
      display: `${(r.score ?? r.chg20Pct ?? 0).toFixed(2)}`,
      color: "#00d664",
    }));
    return [...rows].sort((a: any, b: any) => Math.abs(b.chg20Pct ?? 0) - Math.abs(a.chg20Pct ?? 0)).slice(0, 10).map((r: any) => ({
      label: short(r.symbol), value: r.chg20Pct ?? 0,
      display: `${(r.chg20Pct ?? 0).toFixed(1)}%`,
      color: (r.chg20Pct ?? 0) >= 0 ? "#00d664" : "#ff453a",
    }));
  }, [rows, kind]);

  function Bar({ pct, color }: { pct: number; color: string }) {
    const w = Math.max(4, Math.min(100, isFinite(pct) ? pct : 0));
    return (
      <div style={{ height: 3, background: "#1a1a1e", borderRadius: 2, marginTop: 4 }}>
        <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 2, marginLeft: "auto" }} />
      </div>
    );
  }

  return (
    <div className="panel">
      <p className="p-head">
        {isAll ? `SIGNAL BOARDS — NIFTY-50 · ${data?.universe ?? 50} SEC` : `${KIND_TITLES[kind] ?? kind} — NIFTY-50 UNIVERSE`}
      </p>
      {isAll && (
        <div className="muted" style={{ fontSize: 11.5, margin: "-6px 0 10px 0", letterSpacing: "0.02em" }}>
          MOM = 20D % CHG · OVERSOLD = RSI14 (BOUNCE &lt;33) · SWING = CHG20 + (50−RSI)×0.15 · <span style={{ color: "var(--amber)" }}>◆</span> = ON 2+ BOARDS
        </div>
      )}
      <div className="toolbar" style={{ marginBottom: 8 }}>
        {loading && <span className="muted">SCANNING…</span>}
        {err && <button className="ghost" onClick={reload}>RETRY</button>}
        {isAll && (momRows.length > 0) && <button className="ghost" onClick={exportAll}>↓ CSV ALL</button>}
        {!isAll && rows.length > 0 && (
          <button
            className="ghost"
            onClick={() => downloadCSV(
              `scan-${kind}.csv`,
              ["SEC", "PX", "CHG20", "RSI14", "YIELD", "OFFHI", "PATTERN"],
              rows.map((r: any) => [r.symbol, r.price, r.chg20Pct ?? "", r.rsi14 ?? "", r.yieldPct ?? "", r.offHighPct ?? "", r.pattern ?? ""])
            )}
          >↓ CSV</button>
        )}
      </div>
      {!isAll && (kind === "momentum" || kind === "swing" || kind === "oversold") && rows.length > 0 && (
        <div className="panel" style={{ marginBottom: 10 }}>
          <p className="p-head">{kind === "momentum" ? "Top 10 by 20-day move" : kind === "oversold" ? "Most stretched (lowest RSI first)" : "Top 10 swing scores"}</p>
          <HBars rows={chartRows} />
        </div>
      )}
      {loading && rows.length === 0 && momRows.length === 0 && <p className="muted">SCANNING {kind.toUpperCase()}… (50 SEC, ~10S)</p>}
      {err && <p className="neg">ERR: {err}</p>}
      {data?.notice && <p className="badge fnc" style={{ fontSize: 12 }}>{data.notice}</p>}
      {isAll ? (
        <>
          {(momRows.length > 0 || overRows.length > 0 || swingRows.length > 0) && (
            <div className="cells" style={{ marginBottom: 10 }}>
              <div className="cell"><div className="lbl">Coverage</div><div className="val" style={{ fontSize: 16 }}>{momRows.length + overRows.length + swingRows.length} <span className="faint" style={{ fontSize: 11 }}>ROWS</span></div><div className="sub">{data?.universe ?? 50} sec scanned</div></div>
              <div className="cell"><div className="lbl">Top mom 20D%</div><div className={`val ${(momRows[0]?.chg20Pct ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{momRows[0] ? `${momRows[0].chg20Pct >= 0 ? "+" : ""}${momRows[0].chg20Pct.toFixed(2)}%` : "—"}</div><div className="sub">{momRows[0] ? short(momRows[0].symbol) : ""}</div></div>
              <div className="cell"><div className="lbl">Most oversold RSI</div><div className="val pos" style={{ fontSize: 16 }}>{overRows[0]?.rsi14?.toFixed(1) ?? "—"}</div><div className="sub">{overRows[0] ? short(overRows[0].symbol) : ""}</div></div>
              <div className="cell"><div className="lbl">Top swing</div><div className="val pos" style={{ fontSize: 16 }}>{swingRows[0]?.score?.toFixed(2) ?? "—"}</div><div className="sub">{swingRows[0] ? short(swingRows[0].symbol) : ""}</div></div>
              <div className="cell"><div className="lbl">Conviction ◆</div><div className="val" style={{ fontSize: 16, color: "var(--amber)" }}>{overlaps.length}</div><div className="sub">on 2+ boards</div></div>
              <div className="cell"><div className="lbl">Read</div><div className="val" style={{ fontSize: 12 }}>MOM → OS → SWG</div><div className="sub">click sec opens desk</div></div>
            </div>
          )}
          {overlaps.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <span className="faint" style={{ fontSize: 11 }}>HIGH-CONVICTION:</span>
              {overlaps.slice(0, 8).map((o) => (
                <a key={o.symbol} href={`/module/1?symbol=${o.symbol}`} title={o.boards.join(" + ")} style={{ textDecoration: "none" }}>
                  <span className="badge fnc" style={{ fontSize: 11.5 }}>◆ {short(o.symbol)} · {o.boards.join("+")}</span>
                </a>
              ))}
            </div>
          )}
          <div className="grid grid-3">
            <div>
              <p className="p-head">Momentum <span className="faint" style={{ fontWeight: 400 }}>— 20D % ▾</span></p>
              <table className="plain">
                <thead><tr><th style={{ width: 30 }}>#</th><th>SEC</th><th style={{ textAlign: "right" }}>PX ₹</th><th style={{ textAlign: "right" }}>20D %</th></tr></thead>
                <tbody>
                  {momRows.map((r: any, i: number) => {
                    const v = r.chg20Pct ?? 0;
                    const hot = (boardOf.get(r.symbol) ?? []).length >= 2;
                    return (
                      <tr key={r.symbol}>
                        <td className="faint">{i + 1}</td>
                        <td><a href={`/module/1?symbol=${r.symbol}`} title={hot ? "ON 2+ BOARDS" : "OPEN DESK"}><span className="sec">{hot ? "◆ " : ""}{short(r.symbol)}</span></a></td>
                        <td style={{ textAlign: "right" }}>{r.price?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "▲" : "▼"} {v >= 0 ? "+" : ""}{v.toFixed(2)}%</span>
                          <Bar pct={(Math.abs(v) / maxMom) * 100} color={v >= 0 ? "#00d664" : "#ff453a"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <p className="p-head">Oversold <span className="faint" style={{ fontWeight: 400 }}>— RSI14 ▴</span></p>
              <table className="plain">
                <thead><tr><th style={{ width: 30 }}>#</th><th>SEC</th><th style={{ textAlign: "right" }}>PX ₹</th><th style={{ textAlign: "right" }}>RSI14</th></tr></thead>
                <tbody>
                  {overRows.map((r: any, i: number) => {
                    const v = r.rsi14;
                    const os = typeof v === "number" && v < 30;
                    const soft = typeof v === "number" && v >= 30 && v < 33;
                    const hot = (boardOf.get(r.symbol) ?? []).length >= 2;
                    return (
                      <tr key={r.symbol}>
                        <td className="faint">{i + 1}</td>
                        <td><a href={`/module/1?symbol=${r.symbol}`} title={hot ? "ON 2+ BOARDS" : "OPEN DESK"}><span className="sec">{hot ? "◆ " : ""}{short(r.symbol)}</span></a></td>
                        <td style={{ textAlign: "right" }}>{r.price?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={os ? "pos" : soft ? "" : "muted"} style={soft ? { color: "var(--amber)" } : undefined}>
                            {typeof v === "number" ? v.toFixed(2) : "—"}{os ? " · OS" : ""}
                          </span>
                          <Bar pct={typeof v === "number" ? ((50 - v) / 50) * 100 : 0} color={os ? "#00d664" : "#ffa028"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <p className="p-head">Swing <span className="faint" style={{ fontWeight: 400 }}>— SCORE ▾</span></p>
              <table className="plain">
                <thead><tr><th style={{ width: 30 }}>#</th><th>SEC</th><th style={{ textAlign: "right" }}>PX ₹</th><th style={{ textAlign: "right" }}>SCORE</th></tr></thead>
                <tbody>
                  {swingRows.map((r: any, i: number) => {
                    const v = r.score ?? 0;
                    const hot = (boardOf.get(r.symbol) ?? []).length >= 2;
                    return (
                      <tr key={r.symbol} style={i < 3 ? { background: "rgba(0,214,100,0.05)" } : undefined}>
                        <td className="faint">{i + 1}</td>
                        <td><a href={`/module/1?symbol=${r.symbol}`} title={hot ? "ON 2+ BOARDS" : "OPEN DESK"}><span className="sec">{hot ? "◆ " : ""}{short(r.symbol)}</span></a></td>
                        <td style={{ textAlign: "right" }}>{r.price?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                        <td style={{ textAlign: "right" }}>
                          <span className={v > 1 ? "pos" : ""}>{typeof r.score === "number" ? r.score.toFixed(2) : "—"}</span>
                          <Bar pct={(Math.abs(v) / maxSwing) * 100} color="#00d664" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            HOW TO READ — MOM green ▲ = 20-day strength, red ▼ = drag. RSI &lt;30 + OS = stretched seller, bounce watch (not a buy). SWING top-3 shaded = trend + RSI composite. ◆ names sit on 2+ boards — start there.
          </div>
        </>
      ) : rows.length > 0 ? (
        <table className="plain">
          <thead><tr><th>#</th><th>SEC</th><th style={{ textAlign: "right" }}>PX</th><th style={{ textAlign: "right" }}>20D %</th><th style={{ textAlign: "right" }}>RSI14</th><th style={{ textAlign: "right" }}>YIELD %</th><th style={{ textAlign: "right" }}>OFF-HI %</th></tr></thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={r.symbol}>
                <td className="faint">{i + 1}</td>
                <td><a href={`/module/1?symbol=${r.symbol}`}><span className="sec">{r.symbol.replace(".NS", "")}</span></a></td>
                <td style={{ textAlign: "right" }}>{r.price?.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                <td style={{ textAlign: "right" }}>{r.chg20Pct !== undefined ? <span className={r.chg20Pct >= 0 ? "pos" : "neg"}>{r.chg20Pct.toFixed(2)}</span> : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.rsi14 !== undefined && r.rsi14 !== null ? r.rsi14.toFixed(1) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.yieldPct !== undefined ? r.yieldPct.toFixed(2) : "—"}</td>
                <td style={{ textAlign: "right" }}>{r.offHighPct !== undefined ? <span className="neg">{r.offHighPct.toFixed(1)}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (!loading && !err && <p className="muted">NO ROWS.</p>)}
    </div>
  );
}

/* ---------------- backtest ---------------- */

export function BacktestDesk({ symbol, strat, title }: { symbol: string; strat: string; title: string }) {
  const params = strat === "mr" ? "strat=mr" : "strat=ma&fast=20&slow=50";
  const { data, err, loading } = useJson<any>(`/api/backtest?symbol=${encodeURIComponent(symbol)}&${params}`);
  const m = data?.metrics;
  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{title} — {symbol} · {data ? `${data.bars} BARS · ${data.numTrades ?? m?.numTrades} TRADES` : "LOADING"}</p>
        {loading && <p className="muted">RUNNING BACKTEST…</p>}
        {err && <p className="neg">ERR: {err}</p>}
        {m && (
          <div className="cells">
            <div className="cell"><div className="lbl">Strat ret</div><div className={`val ${m.totalRetPct >= 0 ? "pos" : "neg"}`}>{m.totalRetPct}%</div><div className="sub">vs buy-hold {m.buyHoldPct}%</div></div>
            <div className="cell"><div className="lbl">CAGR</div><div className="val">{m.cagrPct ?? "—"}%</div><div className="sub">ann</div></div>
            <div className="cell"><div className="lbl">Sharpe</div><div className="val">{m.sharpe}</div><div className="sub">sortino {m.sortino}</div></div>
            <div className="cell"><div className="lbl">Max DD</div><div className="val neg">{m.maxDDPct}%</div><div className="sub">drawdown</div></div>
            <div className="cell"><div className="lbl">Win rate</div><div className="val">{m.winRatePct}%</div><div className="sub">{m.numTrades} trades</div></div>
            <div className="cell"><div className="lbl">Profit F</div><div className="val">{m.profitFactor}</div><div className="sub">gross W/L</div></div>
          </div>
        )}
      </div>
      {data?.equity?.length > 10 && (
        <div className="panel">
          <p className="p-head">Equity curve + trade distribution</p>
          <AreaChart values={data.equity} height={110} />
          <div style={{ marginTop: 8 }}>
            <Histogram values={(data.trades ?? []).map((t: any) => t.retPct)} bins={16} height={80} />
          </div>
        </div>
      )}
      {data?.trades?.length > 0 && (
        <div className="panel">
          <p className="p-head">Trade log — latest first</p>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button
              className="ghost"
              onClick={() => downloadCSV(
                `trades-${symbol}.csv`,
                ["ENTRY", "EXIT", "IN", "OUT", "RET_PCT"],
                data.trades.map((t: any) => [t.entryDate, t.exitDate, t.entry, t.exit, t.retPct])
              )}
            >↓ CSV</button>
          </div>
          <table className="plain">
            <thead><tr><th>ENTRY</th><th>EXIT</th><th style={{ textAlign: "right" }}>IN</th><th style={{ textAlign: "right" }}>OUT</th><th style={{ textAlign: "right" }}>RET %</th></tr></thead>
            <tbody>
              {data.trades.map((t: any, i: number) => (
                <tr key={i}>
                  <td>{t.entryDate}</td><td>{t.exitDate}</td>
                  <td style={{ textAlign: "right" }}>{t.entry}</td><td style={{ textAlign: "right" }}>{t.exit}</td>
                  <td style={{ textAlign: "right" }}><span className={t.retPct >= 0 ? "pos" : "neg"}>{t.retPct >= 0 ? "+" : ""}{t.retPct}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- prediction markets ---------------- */

export function PolyDesk() {
  const { data, err, loading } = useJson<{ rows: Array<{ title: string; volume: number; markets: Array<{ question: string; yesPct: number | null; volume: number }> }> }>(`/api/poly`);
  return (
    <div className="grid">
      {loading && <div className="panel"><p className="muted">LOADING POLYMARKET BOOK…</p></div>}
      {err && <div className="panel"><p className="neg">ERR: {err}</p></div>}
      {(data?.rows ?? []).slice(0, 12).map((e, i) => (
        <div key={i} className="panel">
          <p className="p-head">#{i + 1} · VOL ${Math.round(e.volume).toLocaleString("en-IN")}</p>
          <p style={{ margin: "0 0 10px 0", fontWeight: 700 }}>{e.title}</p>
          {e.markets.map((m, j) => (
            <div key={j} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span className="muted">{m.question || "YES"}</span>
                <strong className={m.yesPct !== null && m.yesPct >= 50 ? "pos" : "neg"}>{m.yesPct !== null ? `${m.yesPct}%` : "—"}</strong>
              </div>
              <div style={{ height: 6, background: "#1a1a1e", borderRadius: 2, marginTop: 4 }}>
                <div style={{ width: `${m.yesPct ?? 0}%`, height: "100%", background: m.yesPct !== null && m.yesPct >= 50 ? "#00d664" : "#ff453a", borderRadius: 2 }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CompanyChart({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number; volume: number }>>([]);
  useEffect(() => {
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1y&interval=1d`)
      .then((r) => r.json())
      .then((j) => setBars(((j.bars ?? []) as any[]).map((b) => ({ date: b.date, close: b.close, volume: b.volume ?? 0 }))))
      .catch(() => {});
  }, [symbol]);
  if (bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const vols = bars.map((b) => b.volume);
  const ma = (n: number) => closes.map((_, i) => (i + 1 >= n ? closes.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n : null));
  const ma50 = ma(50), ma200 = ma(Math.min(200, closes.length));
  const W = 600, PH = 150, VH = 42, H = PH + 8 + VH;
  const mn = Math.min(...closes), mx = Math.max(...closes);
  const vmax = Math.max(...vols, 1);
  const X = (i: number) => (i / (closes.length - 1)) * W;
  const Y = (v: number) => PH - 6 - ((v - mn) / (mx - mn || 1)) * (PH - 12);
  const pts = closes.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const seg = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}` as string)).filter((s): s is string => s !== null).join(" ");
  const bw = W / closes.length;
  const last = closes[closes.length - 1];
  const l50 = ma50[ma50.length - 1] as number, l200 = ma200[ma200.length - 1] as number;
  const above = last >= l50;
  return (
    <div className="panel">
      <p className="p-head">Price · MA50/200 · volume — 1Y · {bars.length} sessions</p>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <span className="badge fnc">LAST ₹{fmtX(last, 0)}</span>
        <span className={`badge ${above ? "ok" : "bad"}`}>{above ? "▲ ABOVE MA50" : "▼ BELOW MA50"}</span>
        <span className="faint" style={{ fontSize: 11.5 }}>HI ₹{fmtX(mx, 0)} · LO ₹{fmtX(mn, 0)} · MA50 ₹{fmtX(l50, 0)} · MA200 ₹{fmtX(l200, 0)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none">
        <polygon points={`0,${PH} ${pts} ${W},${PH}`} fill="rgba(255,160,40,0.10)" />
        <polyline points={seg(ma200)} fill="none" stroke="#5b5b62" strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        <polyline points={seg(ma50)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke="#ffb000" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {vols.map((v, i) => {
          const h = Math.max(1, (v / vmax) * VH);
          return <rect key={i} x={(X(i) - bw / 2).toFixed(1)} y={(PH + 8 + VH - h).toFixed(1)} width={Math.max(0.6, bw * 0.7).toFixed(1)} height={h.toFixed(1)} fill={i === vols.length - 1 ? "#ffa028" : "#2a2a30"} />;
        })}
      </svg>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        <span style={{ color: "#ffb000" }}>— PX</span>{"  "}
        <span style={{ color: "#a1a1aa" }}>— MA50</span>{"  "}
        <span style={{ color: "#5b5b62" }}>┄ MA200</span>{"  "}
        <span className="faint">· {bars[0]?.date} → {bars[bars.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// Marker bar: where the last price sits inside a range (52W / day).
function PosBar({ v, lo, hi, loLbl, hiLbl }: { v: number | null | undefined; lo: number | null | undefined; hi: number | null | undefined; loLbl: string; hiLbl: string }) {
  if (v === null || v === undefined || lo === null || lo === undefined || hi === null || hi === undefined || !isFinite(v) || hi <= lo) return null;
  const pct = Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span className="faint">{loLbl}</span>
        <strong>{pct.toFixed(0)}% UP THE RANGE</strong>
        <span className="faint">{hiLbl}</span>
      </div>
      <div style={{ height: 5, background: "#1a1a1e", borderRadius: 2, marginTop: 4, position: "relative" }}>
        <div style={{ position: "absolute", left: `calc(${pct}% - 1px)`, top: -2, width: 2, height: 9, background: "#ffa028" }} />
      </div>
    </div>
  );
}

/* ---------------- company profile ---------------- */

/* ---------------- company profile ---------------- */

// Terminal compact-money: mirrors special.py fmt_num (T/B/Cr/L).
function fmtBig(v: number | null | undefined, cur = ""): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  const a = Math.abs(v);
  const f = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  if (a >= 1e12) return `${cur}${f(v / 1e12)}T`;
  if (a >= 1e9) return `${cur}${f(v / 1e9)}B`;
  if (a >= 1e7) return `${cur}${f(v / 1e7)}Cr`;
  if (a >= 1e5) return `${cur}${f(v / 1e5)}L`;
  return `${cur}${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function fmtPctR(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}
function fmtX(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtExDiv(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  try {
    return new Date(epoch * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase().replace(/ /g, "-");
  } catch { return "—"; }
}
function ProfKV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

// 1Y risk + events strip: all derived from history bars + earnings date.
// Renders nothing until computed; never blocks the desk on failure.
function RiskEvents({ symbol, earnDate }: { symbol: string; earnDate: number | null | undefined }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }> | null>(null);
  useEffect(() => {
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1y&interval=1d`)
      .then((r) => r.json())
      .then((j) => setBars(((j.bars ?? []) as any[]).map((b) => ({ date: b.date, close: b.close }))))
      .catch(() => setBars([]));
  }, [symbol]);
  if (!bars || bars.length < 60) return null;
  const closes = bars.map((b) => b.close);
  const lr: number[] = [];
  for (let i = 1; i < closes.length; i++) lr.push(Math.log(closes[i] / closes[i - 1]));
  const m = lr.reduce((a, b) => a + b, 0) / lr.length;
  const vol = Math.sqrt(lr.reduce((a, b) => a + (b - m) ** 2, 0) / lr.length) * Math.sqrt(252) * 100;
  let peak = closes[0], maxDD = 0;
  closes.forEach((c) => { if (c > peak) peak = c; maxDD = Math.min(maxDD, (c - peak) / peak); });
  const mean = (n: number) => { const s = closes.slice(-n); return s.reduce((a, b) => a + b, 0) / s.length; };
  const last = closes[closes.length - 1];
  const g50 = ((last - mean(50)) / mean(50)) * 100, g200 = ((last - mean(Math.min(200, closes.length))) / mean(Math.min(200, closes.length))) * 100;
  const hi = Math.max(...closes), lo = Math.min(...closes);
  const hiD = bars[closes.indexOf(hi)]?.date.slice(2) ?? "", loD = bars[closes.indexOf(lo)]?.date.slice(2) ?? "";
  const days = lr.map((r) => r * 100);
  const best = Math.max(...days), worst = Math.min(...days);
  const nowS = Date.now() / 1000;
  const earnIn = earnDate && earnDate > nowS ? Math.ceil((earnDate - nowS) / 86400) : null;
  const earnLbl = earnDate ? new Date(earnDate * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase().replace(/ /g, "-") : null;
  return (
    <div className="panel">
      <p className="p-head">Risk · 1Y + events</p>
      <div className="cells">
        <div className="cell"><div className="lbl">1Y vol ann</div><div className="val" style={{ fontSize: 16 }}>{vol.toFixed(1)}%</div><div className="sub">log-rets</div></div>
        <div className="cell"><div className="lbl">Max DD</div><div className="val neg" style={{ fontSize: 16 }}>{(maxDD * 100).toFixed(1)}%</div><div className="sub">peak-trough</div></div>
        <div className="cell"><div className="lbl">Vs MA50</div><div className={`val ${g50 >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{g50 >= 0 ? "+" : ""}{g50.toFixed(1)}%</div><div className="sub">trend gap</div></div>
        <div className="cell"><div className="lbl">Vs MA200</div><div className={`val ${g200 >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{g200 >= 0 ? "+" : ""}{g200.toFixed(1)}%</div><div className="sub">cycle gap</div></div>
        <div className="cell"><div className="lbl">Earnings</div><div className="val" style={{ fontSize: 16 }}>{earnIn !== null ? `${earnIn}D` : earnLbl ?? "—"}</div><div className="sub">{earnLbl ?? "date n/a"}</div></div>
        <div className="cell"><div className="lbl">Best / worst day</div><div className="val" style={{ fontSize: 14 }}><span className="pos">+{best.toFixed(1)}%</span> <span className="neg">{worst.toFixed(1)}%</span></div><div className="sub">HI {hiD} · LO {loD}</div></div>
      </div>
    </div>
  );
}

export function CompanyDesk({ symbol }: { symbol: string }) {
  const { data, err, loading } = useJson<any>(`/api/company?symbol=${encodeURIComponent(symbol)}`);
  const [descOpen, setDescOpen] = useState(false);
  const q = data?.quote;
  const d = data?.derived;
  const p = data?.profile;
  const pp = p?.price ?? {}, vv = p?.valuation ?? {}, dd = p?.dividends ?? {},
    ff = p?.financials ?? {}, mm = p?.margins ?? {}, hh = p?.holders ?? {};
  const chgPct = q?.regularMarketChangePercent ?? (pp.px && pp.prevClose ? ((pp.px - pp.prevClose) / pp.prevClose) * 100 : null);
  const px = pp.px ?? q?.regularMarketPrice;
  const loc = [p?.city, p?.state, p?.country].filter(Boolean).join(", ");
  const desc: string = p?.summary ?? "";
  const DESC_CUT = 420;
  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Profile — {symbol}{p?.exchange ? ` · ${p.exchange}` : ""}{p?.sector ? ` · ${String(p.sector).toUpperCase()}` : ""}</p>
        {loading && <p className="muted">PULLING PROFILE…</p>}
        {err && <p className="neg">ERR: {err}</p>}
        {(q || p) && (
          <>
            <div className="sec-head">
              <span className="sec-name">{((p?.name ?? q?.shortName ?? symbol) as string).toUpperCase()}</span>
              {px !== null && px !== undefined && (
                <span className={`sec-price ${(chgPct ?? 0) >= 0 ? "pos" : "neg"}`}>₹{Number(px).toLocaleString("en-IN")}</span>
              )}
              {chgPct !== null && chgPct !== undefined && (
                <span className={`badge ${(chgPct ?? 0) >= 0 ? "ok" : "bad"}`}><span className="dot" />{(chgPct ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(chgPct ?? 0).toFixed(2)}%</span>
              )}
            </div>
            {(p?.industry || desc) && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {[p?.sector, p?.industry].filter(Boolean).join(" · ")}
                {desc && (
                  <>
                    {" — "}{descOpen || desc.length <= DESC_CUT ? desc : `${desc.slice(0, DESC_CUT)}… `}
                    {desc.length > DESC_CUT && (
                      <button className="ghost" style={{ padding: "0 8px", fontSize: 11 }} onClick={() => setDescOpen((o) => !o)}>
                        {descOpen ? "LESS" : "MORE"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            <div className="cells" style={{ marginTop: 12 }}>
              <div className="cell"><div className="lbl">Mkt cap</div><div className="val">{d?.mktCap ? `₹${(d.mktCap / 1e7).toFixed(0)} Cr` : "—"}</div><div className="sub">live</div></div>
              <div className="cell"><div className="lbl">Trail PE</div><div className="val">{d?.trailPE ?? "—"}</div><div className="sub">fwd {d?.fwdPE ?? "—"}</div></div>
              <div className="cell"><div className="lbl">Yield</div><div className="val">{d?.yieldPct ?? "—"}%</div><div className="sub">payout {fmtPctR(dd.payout, 1)}</div></div>
              <div className="cell"><div className="lbl">Off 52W hi</div><div className="val neg">{d?.offHighPct ?? "—"}%</div><div className="sub">hi {(pp.hi52 ?? q?.fiftyTwoWeekHigh)?.toLocaleString("en-IN")}</div></div>
              <div className="cell"><div className="lbl">Off 52W lo</div><div className="val pos">+{d?.offLowPct !== null && d?.offLowPct !== undefined ? Math.abs(d.offLowPct) : "—"}%</div><div className="sub">lo {(pp.lo52 ?? q?.fiftyTwoWeekLow)?.toLocaleString("en-IN")}</div></div>
              <div className="cell"><div className="lbl">Avg vol 20D</div><div className="val">{d?.avgVol20?.toLocaleString("en-IN")}</div><div className="sub">shares</div></div>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <a href={data.links.screener} target="_blank" rel="noreferrer"><button className="ghost">SCREENER.IN ↗</button></a>
              <a href={data.links.tradingview} target="_blank" rel="noreferrer"><button className="ghost">TRADINGVIEW ↗</button></a>
              <a href={data.links.yahoo} target="_blank" rel="noreferrer"><button className="ghost">YAHOO ↗</button></a>
            </div>
          </>
        )}
      </div>

      {p && (
        <>
          <RiskEvents symbol={symbol} earnDate={p?.events?.earnDate} />
          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">Price & trading</p>
              <ProfKV k="OPEN" v={pp.open ? `₹${fmtX(pp.open)}` : "—"} />
              <ProfKV k="PREV CLOSE" v={pp.prevClose ? `₹${fmtX(pp.prevClose)}` : "—"} />
              <ProfKV k="DAY RANGE" v={pp.high && pp.low ? `₹${fmtX(pp.low)}–${fmtX(pp.high)}` : "—"} />
              <ProfKV k="52W RANGE" v={pp.hi52 && pp.lo52 ? `₹${fmtX(pp.lo52, 0)}–${fmtX(pp.hi52, 0)}` : "—"} />
              <ProfKV k="50D / 200D MA" v={`${pp.ma50 ? `₹${fmtX(pp.ma50)}` : "—"} / ${pp.ma200 ? `₹${fmtX(pp.ma200)}` : "—"}`} />
              <ProfKV k="VOLUME" v={pp.vol ? fmtBig(pp.vol) : "—"} />
              <ProfKV k="AVG VOL 3M / 10D" v={`${pp.avgVol ? fmtBig(pp.avgVol) : "—"} / ${pp.avgVol10 ? fmtBig(pp.avgVol10) : "—"}`} />
              <ProfKV k="BETA" v={fmtX(pp.beta)} />
              <PosBar v={px} lo={pp.lo52} hi={pp.hi52} loLbl={pp.lo52 ? `LO ₹${fmtX(pp.lo52, 0)}` : "LO"} hiLbl={pp.hi52 ? `HI ₹${fmtX(pp.hi52, 0)}` : "HI"} />
              <PosBar v={px} lo={pp.low} hi={pp.high} loLbl={pp.low ? `DAY LO ₹${fmtX(pp.low, 0)}` : "DAY LO"} hiLbl={pp.high ? `DAY HI ₹${fmtX(pp.high, 0)}` : "DAY HI"} />
            </div>
            <div className="panel">
              <p className="p-head">Valuation</p>
              <ProfKV k="MKT CAP" v={fmtBig(vv.mktCap, "₹")} />
              <ProfKV k="ENTERPRISE VAL" v={fmtBig(vv.ev, "₹")} />
              <ProfKV k="TRAIL / FWD PE" v={`${fmtX(vv.trailPE)} / ${fmtX(vv.fwdPE)}`} />
              <ProfKV k="PEG" v={fmtX(vv.peg)} />
              <ProfKV k="P/B · P/S" v={`${fmtX(vv.pb)} · ${fmtX(vv.ps)}`} />
              <ProfKV k="EV/EBITDA · EV/REV" v={`${fmtX(vv.evEbitda)} · ${fmtX(vv.evRev)}`} />
              <ProfKV k="TRAIL / FWD EPS" v={vv.trailEps || vv.fwdEps ? `₹${fmtX(vv.trailEps)} / ₹${fmtX(vv.fwdEps)}` : "—"} />
              <ProfKV k="BOOK VALUE" v={vv.book ? `₹${fmtX(vv.book)}` : "—"} />
              <div style={{ marginTop: 10 }}>
                <HBars rows={[
                  { label: "TRAIL PE", value: vv.trailPE ?? 0, display: fmtX(vv.trailPE), color: "#ffa028" },
                  { label: "FWD PE", value: vv.fwdPE ?? 0, display: fmtX(vv.fwdPE), color: "#ffa028" },
                  { label: "P/B", value: vv.pb ?? 0, display: fmtX(vv.pb), color: "#ffa028" },
                  { label: "P/S", value: vv.ps ?? 0, display: fmtX(vv.ps), color: "#ffa028" },
                  { label: "EV/EBITDA", value: vv.evEbitda ?? 0, display: fmtX(vv.evEbitda), color: "#ffa028" },
                ].filter((r) => r.value > 0)} />
              </div>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">Dividends</p>
              <ProfKV k="DIV RATE" v={dd.rate ? `₹${fmtX(dd.rate)}` : "—"} />
              <ProfKV k="DIV YIELD" v={fmtPctR(dd.yield)} />
              <ProfKV k="PAYOUT" v={fmtPctR(dd.payout, 1)} />
              <ProfKV k="EX-DIV" v={fmtExDiv(dd.exDiv)} />
            </div>
            <div className="panel">
              <p className="p-head">Margins & returns</p>
              <ProfKV k="GROSS MARGIN" v={fmtPctR(mm.gross, 1)} cls={(mm.gross ?? 0) > 0.3 ? "pos" : ""} />
              <ProfKV k="OPER MARGIN" v={fmtPctR(mm.oper, 1)} />
              <ProfKV k="NET MARGIN" v={fmtPctR(mm.net, 1)} cls={(mm.net ?? 0) > 0.15 ? "pos" : ""} />
              <ProfKV k="EBITDA MARGIN" v={fmtPctR(mm.ebitda, 1)} />
              <ProfKV k="ROE / ROA" v={`${fmtPctR(mm.roe, 1)} / ${fmtPctR(mm.roa, 1)}`} cls={(mm.roe ?? 0) > 0.15 ? "pos" : ""} />
            </div>
          </div>

          <div className="panel">
            <p className="p-head">Financials — TTM · ₹</p>
            <div className="grid grid-2">
              <div>
                <ProfKV k="REVENUE" v={fmtBig(ff.revenue, "₹")} />
                <ProfKV k="GROSS PROFIT" v={fmtBig(ff.gross, "₹")} />
                <ProfKV k="EBITDA" v={fmtBig(ff.ebitda, "₹")} />
                <ProfKV k="NET INCOME" v={fmtBig(ff.net, "₹")} />
                <ProfKV k="OPER CF / FCF" v={`${fmtBig(ff.ocf, "₹")} / ${fmtBig(ff.fcf, "₹")}`} />
              </div>
              <div>
                <ProfKV k="TOTAL CASH" v={fmtBig(ff.cash, "₹")} />
                <ProfKV k="TOTAL DEBT" v={fmtBig(ff.debt, "₹")} />
                <ProfKV k="REV GROWTH" v={fmtPctR(ff.revGrowth, 1)} cls={(ff.revGrowth ?? 0) >= 0 ? "pos" : "neg"} />
                <ProfKV k="EARN GROWTH" v={fmtPctR(ff.earnGrowth, 1)} cls={(ff.earnGrowth ?? 0) >= 0 ? "pos" : "neg"} />
                <ProfKV k="EARN Q-GROWTH" v={fmtPctR(ff.earnQGrowth, 1)} cls={(ff.earnQGrowth ?? 0) >= 0 ? "pos" : "neg"} />
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <HBars rows={[
                { label: "REVENUE", value: ff.revenue ?? 0, display: fmtBig(ff.revenue, "₹"), color: "#ffa028" },
                { label: "GROSS", value: ff.gross ?? 0, display: fmtBig(ff.gross, "₹"), color: "#ffa028" },
                { label: "EBITDA", value: ff.ebitda ?? 0, display: fmtBig(ff.ebitda, "₹"), color: "#ffa028" },
                { label: "NET", value: ff.net ?? 0, display: fmtBig(ff.net, "₹"), color: (ff.net ?? 0) >= 0 ? "#00d664" : "#ff453a" },
                { label: "CASH", value: ff.cash ?? 0, display: fmtBig(ff.cash, "₹"), color: "#ffa028" },
                { label: "DEBT", value: ff.debt ?? 0, display: fmtBig(ff.debt, "₹"), color: "#a1a1aa" },
              ].filter((r) => r.value > 0)} />
            </div>
          </div>

          <div className="grid grid-2">
            <div className="panel">
              <p className="p-head">Shareholding & shorts</p>
              {hh.insider !== null && hh.instit !== null && (
                <div style={{ marginBottom: 10 }}>
                  <Donut slices={[
                    { label: "PROMOTER", value: hh.insider * 100, color: "#ffa028" },
                    { label: "INSTIT", value: hh.instit * 100, color: "#00d664" },
                    { label: "PUBLIC/OTHER", value: Math.max(0, 100 - hh.insider * 100 - hh.instit * 100), color: "#5b5b62" },
                  ]} />
                </div>
              )}
              <ProfKV k="SHARES OUT" v={hh.sharesOut ? fmtBig(hh.sharesOut) : "—"} />
              <ProfKV k="FLOAT" v={hh.float ? fmtBig(hh.float) : "—"} />
              <ProfKV k="INSIDER %" v={fmtPctR(hh.insider, 1)} />
              <ProfKV k="INSTIT %" v={fmtPctR(hh.instit, 1)} />
              <ProfKV k="SHORT RATIO" v={hh.shortRatio ? fmtX(hh.shortRatio, 1) : "—"} />
              <ProfKV k="SHORT % FLOAT" v={fmtPctR(hh.shortPct)} />
            </div>
            <div className="panel">
              <p className="p-head">Corporate info</p>
              <div className="kv"><span className="muted">WEBSITE</span><strong>{p.website ? <a href={/^https?:\/\//i.test(p.website) ? p.website : `https://${p.website}`} target="_blank" rel="noreferrer">{p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")} ↗</a> : "—"}</strong></div>
              <ProfKV k="EMPLOYEES" v={p.employees ? Number(p.employees).toLocaleString("en-IN") : "—"} />
              <ProfKV k="LOCATION" v={loc || "—"} />
              {(p.officers ?? []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>MANAGEMENT</div>
                  {(p.officers ?? []).map((o: any, i: number) => (
                    <div key={i} className="kv"><span>{o.name}</span><strong className="faint" style={{ fontWeight: 500 }}>{o.title}</strong></div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      <CompanyChart symbol={symbol} />
    </div>
  );
}
