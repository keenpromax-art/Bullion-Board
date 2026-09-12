"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";

interface TapeItem { symbol: string; price: number | null; chgPct: number | null; ok: boolean }

const FALLBACK = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", "^NSEI", "GC=F", "BTC-USD"];

export default function TickerTape({ onPick, onFeed }: { onPick: (sym: string) => void; onFeed: (ok: boolean | null) => void }) {
  const [items, setItems] = useState<TapeItem[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    let symbols: string[];
    try {
      const w = store.getWatchlist();
      symbols = (w.length > 0 ? w.slice(0, 12) : FALLBACK).slice(0, 14);
    } catch { symbols = FALLBACK; }
    // Respect existing quote caching: single batch per mount + 60s refresh
    // (QUOTE_TTL=60s in src/lib/yahoo.ts) — no extra polling loop.
    async function pull() {
      onFeed(null);
      try {
        const rows = await Promise.all(symbols.map(async (s) => {
          try {
            const r = await fetch(`/api/quote?symbol=${encodeURIComponent(s)}`);
            const j = await r.json();
            if (j.error || j.regularMarketPrice === undefined) return { symbol: s, price: null, chgPct: null, ok: false };
            return { symbol: s, price: j.regularMarketPrice, chgPct: j.regularMarketChangePercent ?? 0, ok: true };
          } catch { return { symbol: s, price: null, chgPct: null, ok: false }; }
        }));
        if (!alive) return;
        setItems(rows);
        onFeed(rows.some((r) => r.ok) ? true : false);
      } catch {
        if (alive) { setItems(symbols.map((s) => ({ symbol: s, price: null, chgPct: null, ok: false }))); onFeed(false); }
      }
    }
    pull();
    const t = setInterval(pull, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [onFeed]);

  const seq = items.length > 0 ? items : FALLBACK.map((s) => ({ symbol: s, price: null, chgPct: null, ok: false }));
  const doubled = [...seq, ...seq];

  return (
    <div
      className="term-tape"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="marquee"
      aria-label="Watchlist ticker tape"
    >
      <div className="tape-inner" style={paused ? { animationPlayState: "paused" } : undefined}>
        {doubled.map((it, i) => {
          const up = (it.chgPct ?? 0) >= 0;
          return (
            <button
              key={`${it.symbol}-${i}`}
              className="tape-bit tape-btn"
              onClick={() => onPick(it.symbol)}
              title={`${it.symbol} — open in focused panel`}
            >
              <strong>{it.symbol.replace(".NS", "")}</strong>
              {"  "}
              <span>{it.price !== null ? it.price.toLocaleString("en-IN", { maximumFractionDigits: it.price < 100 ? 2 : 0 }) : "—"}</span>
              {"  "}
              {it.chgPct !== null ? (
                <span className={up ? "pos" : "neg"}>{up ? "▲" : "▼"} {Math.abs(it.chgPct).toFixed(2)}%</span>
              ) : <span className="faint">NO FEED</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
