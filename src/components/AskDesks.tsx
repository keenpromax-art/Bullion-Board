"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, aiSystem } from "@/lib/ai";
import { store } from "@/lib/store";
import { LegInput } from "./QuantDesks";
import { LineChart, BarChart } from "./charts";
import { runSectorRank, rankerDigest, type RankResult } from "@/lib/sectorRank";

// Blueprint routing: project-like prompts that need live computation run a
// deterministic tool first — the AI then interprets real numbers.
function wantsRanker(question: string): boolean {
  const q = question.toLowerCase();
  return q.includes("sector") && (q.includes("rotat") || q.includes("rank") || q.includes("roc") || q.includes("relative") || q.includes("momentum"));
}

const IDEAS = [
  "HOW DO G20 SUMMITS MOVE THE INDIAN MARKET?",
  "WHAT IF RBI HIKES 25BPS — IMPACT ON {T}?",
  "FED RATE CUT: WHO WINS ON DALAL STREET?",
  "CRUDE +20%: EFFECT ON {T} AND NIFTY?",
  "BUDGET WEEK PLAYBOOK FOR {T}?",
];

interface Ctx {
  tickerLine: string;
  board: string;
  headlines: string[];
  series: string;
}

// Downsample to ≤12 points for chart blocks.
function slim<T>(arr: T[]): T[] {
  if (arr.length <= 12) return arr;
  const out: T[] = [];
  for (let i = 0; i < 12; i++) out.push(arr[Math.floor((i * (arr.length - 1)) / 11)]);
  return out;
}

// Live market context for an event question: focused ticker quote, board
// snapshot (Nifty/Sensex/Bank/VIX/FX/commodities) + fresh headlines +
// 60D close series the AI may chart (never anything else).

// Live market context for an event question: focused ticker quote, board
// snapshot (Nifty/Sensex/Bank/VIX/FX/commodities) + fresh headlines.
async function buildContext(ticker: string, question: string): Promise<Ctx> {
  const empty: Ctx = { tickerLine: `SEC ${ticker} (QUOTE UNAVAILABLE)`, board: "BOARD UNAVAILABLE", headlines: [], series: "(NO SERIES)" };
  try {
    const [q, m, ht, hn] = await Promise.all([
      fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null),
      fetch("/api/market").then((r) => r.json()).catch(() => null),
      fetch(`/api/history?symbol=${encodeURIComponent(ticker)}&range=3mo&interval=1d`).then((r) => r.json()).catch(() => null),
      fetch(`/api/history?symbol=${encodeURIComponent("^NSEI")}&range=3mo&interval=1d`).then((r) => r.json()).catch(() => null),
    ]);
    const tickerLine = q && q.regularMarketPrice !== undefined && !q.error
      ? `SEC ${ticker} ${q.shortName ?? ""} @ ₹${q.regularMarketPrice} (${Number(q.regularMarketChangePercent ?? 0).toFixed(2)}%)`
      : empty.tickerLine;
    let board = empty.board;
    if (m?.rows?.length) {
      const want = ["^NSEI", "^BSESN", "^NSEBANK", "^INDIAVIX", "USDINR=X", "GC=F", "CL=F"];
      const bySym = new Map((m.rows as any[]).map((r) => [r.sym, r]));
      const bits = want
        .map((s) => bySym.get(s))
        .filter((r) => r && r.ok && isFinite(r.price))
        .map((r) => `${r.label} ${Number(r.price).toLocaleString("en-IN", { maximumFractionDigits: r.price < 200 ? 2 : 0 })} (${r.chgPct >= 0 ? "+" : ""}${Number(r.chgPct).toFixed(2)}%)`);
      if (bits.length) board = bits.join(" · ");
    }
    // Headlines: company feed for the ticker + broad wire for the theme.
    const keywords = question.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !["WHAT", "HOW", "DOES", "WITH", "FROM", "THIS", "THAT", "WILL", "EFFECT", "AFFECT", "MARKET", "INDIAN", "INDIA", "STOCK", "SHARE"].includes(w))
      .slice(0, 3);
    const feeds: string[] = [];
    try {
      const c = await fetch(`/api/news?symbol=${encodeURIComponent(ticker)}&feed=company`).then((r) => r.json()).catch(() => null);
      for (const n of (c?.items ?? []).slice(0, 4)) feeds.push(`[${n.source ?? "WIRE"}] ${n.title}`);
    } catch { /* wire gaps are fine */ }
    if (keywords.length) {
      try {
        const w = await fetch(`/api/news?symbol=${encodeURIComponent(ticker)}&feed=wire&q=${encodeURIComponent(keywords.join(" "))}`).then((r) => r.json()).catch(() => null);
        for (const n of (w?.items ?? []).slice(0, 6)) {
          const line = `[${n.source ?? "WIRE"}] ${n.title}`;
          if (!feeds.includes(line)) feeds.push(line);
        }
      } catch { /* ignore */ }
    }
    // 60D close series the model may chart (downsampled to ≤12 points).
    const tc: number[] = ((ht?.bars ?? []) as any[]).map((b) => b.close).filter((v: any) => typeof v === "number" && isFinite(v) && v > 0).slice(-60);
    const nc: number[] = ((hn?.bars ?? []) as any[]).map((b) => b.close).filter((v: any) => typeof v === "number" && isFinite(v) && v > 0).slice(-60);
    const f2 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 });
    const series = tc.length >= 12
      ? `TICKER 60D CLOSES ₹ (oldest→newest, chartable): [${slim(tc).map(f2).join(", ")}]\nNIFTY 60D CLOSES (oldest→newest, chartable): [${slim(nc).map(f2).join(", ")}]`
      : "(NO SERIES)";
    return { tickerLine, board, headlines: feeds.slice(0, 8), series };
  } catch {
    return empty;
  }
}

// ---------- notebook renderer: prose + executable chart/table blocks ----------

const PALETTE = ["#ffa028", "#a1a1aa", "#00d664", "#ff453a", "#00c8ff", "#ffb000"];

function pickColor(name: unknown, i: number): string {
  const s = String(name ?? "").toUpperCase();
  if (s.includes("AMBER") || s.includes("ORANGE")) return "#ffa028";
  if (s.includes("GREY") || s.includes("GRAY")) return "#a1a1aa";
  if (s.includes("GREEN")) return "#00d664";
  if (s.includes("RED")) return "#ff453a";
  if (s.includes("BLUE") || s.includes("CYAN")) return "#00c8ff";
  if (s.includes("YELLOW")) return "#ffb000";
  return PALETTE[i % PALETTE.length];
}

function renderChartBody(body: string, key: number): React.ReactNode {
  let spec: any = null;
  try {
    spec = JSON.parse(body.trim().replace(/^```|```$/g, "").trim());
  } catch { return null; }
  const series = Array.isArray(spec?.series) ? spec.series.slice(0, 3) : [];
  const clean = series
    .map((s: any, i: number) => ({
      label: String(s?.label ?? `S${i + 1}`).toUpperCase().slice(0, 18),
      color: pickColor(s?.color, i),
      values: Array.isArray(s?.values) ? s.values.slice(0, 12).map((v: any) => (typeof v === "number" && isFinite(v) ? v : null)) : [],
    }))
    .filter((s: any) => s.values.some((v: any) => v !== null));
  if (!clean.length) return null;
  const labels = Array.isArray(spec?.labels) ? spec.labels.slice(0, 12).map((l: any) => String(l)) : [];
  const title = String(spec?.title ?? "CHART").toUpperCase().slice(0, 60);
  return (
    <div key={key} className="panel">
      <p className="p-head">{title}</p>
      {String(spec?.type ?? "line").toLowerCase() === "bar" && clean.length === 1 ? (
        <BarChart values={clean[0].values.map((v: any) => v ?? 0)} labels={labels.length === clean[0].values.length ? labels : clean[0].values.map((_: any, i: number) => `#${i + 1}`)} height={120} />
      ) : (
        <LineChart
          series={clean} height={150}
          dates={labels.length === clean[0].values.length ? labels : undefined}
          yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) < 100 ? 2 : 0 })}
        />
      )}
    </div>
  );
}

function renderTableBody(body: string, key: number): React.ReactNode {
  const rows = body.split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === "")))
    .filter((r) => r.length > 1 && !/^[-:\s|]+$/.test(r.join("")))
    .slice(0, 14);
  if (rows.length < 2) return null;
  const [head, ...rest] = rows;
  return (
    <div key={key} className="scrollx">
      <table className="plain">
        <thead><tr>{head.map((h, i) => <th key={i} style={i > 0 ? { textAlign: "right" } : undefined}>{h.toUpperCase().slice(0, 28)}</th>)}</tr></thead>
        <tbody>
          {rest.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={j > 0 ? { textAlign: "right" } : undefined}>{j === 0 ? <strong>{c.slice(0, 40)}</strong> : c.slice(0, 40)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderAnswer(text: string, streaming: boolean): React.ReactNode {
  const out: React.ReactNode[] = [];
  const re = /```(chart|table)\s*\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text)) !== null) {
    const prose = text.slice(last, m.index).trim();
    if (prose) out.push(<pre key={k++} className="ai" style={{ margin: 0 }}>{prose}</pre>);
    const node = m[1] === "chart" ? renderChartBody(m[2], k++) : renderTableBody(m[2], k++);
    if (node) out.push(node);
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail || streaming) out.push(<pre key={k++} className="ai" style={{ margin: 0 }}>{tail}{streaming ? "▊" : ""}</pre>);
  return <div className="grid" style={{ gap: 10 }}>{out}</div>;
}

export function AskDesk({ symbol }: { symbol: string }) {
  const [ticker, setTicker] = useState(symbol);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctxLine, setCtxLine] = useState("");
  const [rank, setRank] = useState<RankResult | null>(null);
  const [rankBusy, setRankBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const ansRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTicker(symbol); }, [symbol]);
  useEffect(() => {
    if (ansRef.current) ansRef.current.scrollTop = ansRef.current.scrollHeight;
  }, [answer]);

  async function run(raw?: string) {
    const question = (raw ?? q).trim();
    if (!question || busy) return;
    const tick = ticker.trim().toUpperCase() || symbol;
    setQ("");
    setAnswer("");
    setRank(null);
    setCtxLine("SNAPPING MARKET CONTEXT…");
    setBusy(true);
    abort.current = new AbortController();
    try {
      // Blueprint tool first: deterministic scan the AI will interpret.
      let digest = "";
      if (wantsRanker(question)) {
        setRankBusy(true);
        try {
          const res = await runSectorRank((m) => setCtxLine(m));
          setRank(res);
          digest = `\n${rankerDigest(res)}\nINSTRUCTION: THE SECTOR SCAN ABOVE WAS ALREADY RUN ON LIVE DATA — INTERPRET ITS RANKS, DO NOT RECOMPUTE. CITE ITS NUMBERS.`;
        } catch (e: any) {
          digest = `\nSECTOR SCAN FAILED: ${e.message} — REASON FROM MECHANICS, SAY THE SCAN IS DOWN.`;
        } finally {
          setRankBusy(false);
        }
      }
      const ctx = await buildContext(tick, question);
      setCtxLine(`${ctx.tickerLine}`);
      const user = `QUESTION: ${question}\nFOCUS: ${tick}\nLIVE BOARD: ${ctx.board}\n${ctx.series}\nHEADLINES:\n${ctx.headlines.length ? ctx.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(NO FRESH HEADLINES — SAY SO IF IT MATTERS)"}${digest}`;
      let full = "";
      await streamChat(
        [
          { role: "system", content: aiSystem.ask() },
          { role: "user", content: user },
        ],
        {
          model: store.getORModel(),
          apiKey: store.getORKey(),
          signal: abort.current.signal,
          onToken: (t) => {
            full += t;
            setAnswer(full);
          },
        }
      );
      if (!full) throw new Error("empty reply");
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "STOPPED." : `AI ERR: ${e.message}`;
      setAnswer((prev) => prev || msg);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="toolbar">
        <div style={{ flex: 1, minWidth: 160, display: "flex" }}>
          <LegInput value={ticker} onChange={setTicker} onRun={() => run()} label="FOCUS TICKER… (BLANK = MARKET-WIDE)" />
        </div>
      </div>
      <div className="toolbar">
        <textarea
          className="box" rows={2} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); run(); } e.stopPropagation(); }}
          placeholder="ASK, e.g. HOW DO G20 SUMMITS MOVE INDIAN MARKETS? + ENTER"
          aria-label="Event question" style={{ flex: 1, resize: "none" }}
        />
        {busy
          ? <button className="ghost" onClick={() => abort.current?.abort()}>STOP</button>
          : <button className="btn" onClick={() => run()}>ASK AI</button>}
      </div>
      <div className="pills">
        {IDEAS.map((s) => {
          const text = s.replaceAll("{T}", (ticker.trim() || symbol).replace(".NS", ""));
          return <button key={s} className="pill" style={{ fontSize: 11 }} onClick={() => run(text)}>{text}</button>;
        })}
      </div>
      {ctxLine && <p className="faint" style={{ fontSize: 11, margin: 0 }}>CTX · {ctxLine}</p>}
      {rankBusy && <p className="muted">RUNNING SECTOR SCAN — 9 LIVE FEEDS…</p>}
      {rank && (
        <div className="panel">
          <p className="p-head">Sector ranker — RS vs Nifty · ROC excess · 200D filter · as of {rank.asof}</p>
          <div className="scrollx">
            <table className="plain">
              <thead><tr>
                <th style={{ textAlign: "left" }}>#</th><th style={{ textAlign: "left" }}>SECTOR</th>
                <th style={{ textAlign: "right" }}>RS</th><th style={{ textAlign: "right" }}>MOM</th>
                <th style={{ textAlign: "right" }}>R21</th><th style={{ textAlign: "right" }}>R63</th>
                <th style={{ textAlign: "right" }}>R252</th><th style={{ textAlign: "right" }}>EXC63</th>
                <th style={{ textAlign: "right" }}>200D</th><th style={{ textAlign: "right" }}>SCORE</th>
              </tr></thead>
              <tbody>
                {rank.rows.map((r) => {
                  const f1 = (v: number | null, d = 1) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);
                  return (
                    <tr key={r.key} className={r.rank <= 3 ? "active" : ""}>
                      <td className="faint">{r.rank}</td>
                      <td><strong className={r.rank === 1 ? "sec" : ""}>{r.label}</strong></td>
                      <td style={{ textAlign: "right" }} className={r.rsRatio !== null && r.rsRatio >= 100 ? "pos" : "neg"}>{r.rsRatio === null ? "—" : r.rsRatio.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }} className={r.rsMom !== null && r.rsMom >= 0 ? "pos" : "neg"}>{f1(r.rsMom)}</td>
                      <td style={{ textAlign: "right" }}>{f1(r.roc21)}</td>
                      <td style={{ textAlign: "right" }}>{f1(r.roc63)}</td>
                      <td style={{ textAlign: "right" }}>{f1(r.roc252)}</td>
                      <td style={{ textAlign: "right" }} className={r.exc63 !== null && r.exc63 >= 0 ? "pos" : "neg"}>{f1(r.exc63)}</td>
                      <td style={{ textAlign: "right" }}>{r.above200 === null ? "—" : r.above200 ? <span className="pos">▲</span> : <span className="neg">▼</span>}</td>
                      <td style={{ textAlign: "right" }}><strong>{r.score === null ? "—" : f1(r.score)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8 }}>
            <p className="p-head">RS ratio curves — top 4 vs 100 = Nifty</p>
            <LineChart
              series={rank.rows.slice(0, 4).map((r, i) => ({
                label: r.label,
                color: ["#ffa028", "#00d664", "#00c8ff", "#a1a1aa"][i % 4],
                values: r.curve,
              }))}
              height={130}
              yFmt={(v) => v.toFixed(0)}
            />
          </div>
          {rank.failed.length > 0 && <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>FEEDS DOWN: {rank.failed.join(", ")} — RANKED THE REST</p>}
        </div>
      )}
      {(answer || busy) && (
        <div ref={ansRef} style={{ maxHeight: 560, overflowY: "auto" }}>
          {renderAnswer(answer, busy)}
        </div>
      )}
      {!answer && !busy && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          EVENT-IMPACT DESK — LIVE QUOTE + BOARD + HEADLINES AUTO-ATTACHED · STREAMING · HISTORY STAYS IN THIS TAB ONLY.
        </p>
      )}
    </div>
  );
}
