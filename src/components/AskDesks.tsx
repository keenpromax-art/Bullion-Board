"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, aiSystem } from "@/lib/ai";
import { store } from "@/lib/store";
import { LegInput } from "./QuantDesks";

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
}

// Live market context for an event question: focused ticker quote, board
// snapshot (Nifty/Sensex/Bank/VIX/FX/commodities) + fresh headlines.
async function buildContext(ticker: string, question: string): Promise<Ctx> {
  const empty: Ctx = { tickerLine: `SEC ${ticker} (QUOTE UNAVAILABLE)`, board: "BOARD UNAVAILABLE", headlines: [] };
  try {
    const [q, m] = await Promise.all([
      fetch(`/api/quote?symbol=${encodeURIComponent(ticker)}`).then((r) => r.json()).catch(() => null),
      fetch("/api/market").then((r) => r.json()).catch(() => null),
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
    return { tickerLine, board, headlines: feeds.slice(0, 8) };
  } catch {
    return empty;
  }
}

export function AskDesk({ symbol }: { symbol: string }) {
  const [ticker, setTicker] = useState(symbol);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctxLine, setCtxLine] = useState("");
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
    setCtxLine("SNAPPING MARKET CONTEXT…");
    setBusy(true);
    abort.current = new AbortController();
    try {
      const ctx = await buildContext(tick, question);
      setCtxLine(`${ctx.tickerLine}`);
      const user = `QUESTION: ${question}\nFOCUS: ${tick}\nLIVE BOARD: ${ctx.board}\nHEADLINES:\n${ctx.headlines.length ? ctx.headlines.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(NO FRESH HEADLINES — SAY SO IF IT MATTERS)"}`;
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
      {(answer || busy) && (
        <div ref={ansRef} style={{ maxHeight: 460, overflowY: "auto" }}>
          <pre className="ai">{answer}{busy ? "▊" : ""}</pre>
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
