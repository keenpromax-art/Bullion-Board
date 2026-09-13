"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/store";

interface TapeItem {
  symbol: string;
  price: number | null;
  chg: number | null;
  chgPct: number | null;
  currency: string | null;
  ok: boolean;
}

// Diversified cross-asset default: NSE leaders + domestic/global indices +
// commodities + FX + crypto. Used when the watchlist is empty, and as
// fillers appended after user symbols so the loop never looks repetitive.
const DEFAULT_TAPE = [
  // NSE large caps
  "RELIANCE.NS",
  "HDFCBANK.NS",
  "ICICIBANK.NS",
  "INFY.NS",
  "TCS.NS",
  "SBIN.NS",
  // Indices — domestic + global
  "^NSEI",
  "^NSEBANK",
  "^BSESN",
  "^GSPC",
  "^IXIC",
  // Commodities
  "GC=F",
  "SI=F",
  "CL=F",
  // FX
  "INR=X",
  "EURUSD=X",
  // Crypto
  "BTC-USD",
  "ETH-USD",
];

const MIN_ITEMS = 16;
const MAX_ITEMS = 22;

const FRIENDLY: Record<string, string> = {
  "^NSEI": "NIFTY",
  "^NSEBANK": "BANKNIFTY",
  "^BSESN": "SENSEX",
  "^GSPC": "S&P500",
  "^IXIC": "NASDAQ",
  "GC=F": "GOLD",
  "SI=F": "SILVER",
  "CL=F": "CRUDE",
  "INR=X": "USDINR",
  "EURUSD=X": "EURUSD",
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
};

function short(sym: string): string {
  const up = sym.toUpperCase();
  if (FRIENDLY[up]) return FRIENDLY[up];
  return sym.replace(".NS", "").replace(".BO", "").replace("^", "").replace("=F", "").replace("=X", "").replace("-USD", "");
}

function assetClass(sym: string): string {
  const up = sym.toUpperCase();
  if (/-USD$/.test(up)) return "CRYPTO";
  if (up.endsWith("=X")) return "FX";
  if (up.endsWith("=F")) return "COMMODITY";
  if (up.startsWith("^")) return "INDEX";
  return "NSE";
}

function fmtPrice(v: number, sym: string): string {
  const up = sym.toUpperCase();
  // FX: EURUSD needs 4dp, USDINR 2dp
  if (up.endsWith("=X")) {
    const dec = v < 10 ? 4 : 2;
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // Crypto: BTC-style large prints need no decimals
  if (/-USD$/.test(up)) {
    const dec = v < 100 ? 2 : 0;
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // Futures: crude/gold/silver
  if (up.endsWith("=F")) {
    const dec = v < 500 ? 2 : 1;
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  // US indices
  if (up.startsWith("^") && !up.includes("NSE") && !up.includes("BSE")) {
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // NSE equities + domestic indices
  return v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 });
}

function fmtChg(v: number, sym: string): string {
  const sign = v >= 0 ? "+" : "−";
  const abs = Math.abs(v);
  const up = sym.toUpperCase();
  let dec = 2;
  if (up.endsWith("=X") && abs < 10) dec = 4;
  else if (/-USD$/.test(up) && abs >= 100) dec = 0;
  else if (up.endsWith("=F") && abs >= 500) dec = 1;
  else if (!up.endsWith("=X") && !/-USD$/.test(up) && !up.endsWith("=F") && abs >= 100) dec = 0;
  return `${sign}${abs.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

function buildSymbols(): string[] {
  let user: string[] = [];
  try {
    const w = store.getWatchlist();
    if (Array.isArray(w)) user = w.filter((s) => typeof s === "string" && s.trim());
  } catch { user = []; }
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const k = s.trim().toUpperCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(s.trim().toUpperCase());
  };
  user.forEach(push);
  // Top up with diversified defaults so short watchlists still span
  // equities, indices, commodities, FX and crypto.
  const target = Math.min(MAX_ITEMS, Math.max(user.length, DEFAULT_TAPE.length, MIN_ITEMS));
  for (const s of DEFAULT_TAPE) {
    if (out.length >= target) break;
    push(s);
  }
  // Hard cap to bound /api/quote fan-out per refresh.
  return (out.length > 0 ? out : [...DEFAULT_TAPE]).slice(0, MAX_ITEMS);
}

export default function TickerTape({ onPick, onFeed }: { onPick: (sym: string) => void; onFeed: (ok: boolean | null) => void }) {
  const [items, setItems] = useState<TapeItem[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let alive = true;
    const symbols = buildSymbols();
    // Respect existing quote caching: single batch per mount + 60s refresh
    // (QUOTE_TTL=60s in src/lib/yahoo.ts) — no extra polling loop.
    async function pull() {
      onFeed(null);
      try {
        const rows: TapeItem[] = await Promise.all(symbols.map(async (s) => {
          try {
            const r = await fetch(`/api/quote?symbol=${encodeURIComponent(s)}`);
            const j = await r.json();
            if (j.error || j.regularMarketPrice === undefined) {
              return { symbol: s, price: null, chg: null, chgPct: null, currency: null, ok: false };
            }
            return {
              symbol: s,
              price: j.regularMarketPrice,
              chg: j.regularMarketChange ?? null,
              chgPct: j.regularMarketChangePercent ?? 0,
              currency: j.currency ?? null,
              ok: true,
            };
          } catch {
            return { symbol: s, price: null, chg: null, chgPct: null, currency: null, ok: false };
          }
        }));
        if (!alive) return;
        setItems(rows);
        onFeed(rows.some((r) => r.ok) ? true : false);
      } catch {
        if (alive) {
          setItems(symbols.map((s) => ({ symbol: s, price: null, chg: null, chgPct: null, currency: null, ok: false })));
          onFeed(false);
        }
      }
    }
    pull();
    const t = setInterval(pull, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [onFeed]);

  const seq = items.length > 0 ? items : buildSymbols().map((s) => ({ symbol: s, price: null, chg: null, chgPct: null, currency: null, ok: false }));
  const loaded = items.length > 0;
  const allDown = loaded && seq.every((r) => !r.ok);
  const doubled = [...seq, ...seq];
  // Keep scroll speed readable as the list grows (~4s per symbol).
  const duration = `${Math.max(28, seq.length * 4)}s`;

  if (allDown) {
    return (
      <div className="term-tape" role="marquee" aria-label="Watchlist ticker tape">
        <div className="tape-track tape-static">
          <span className="tape-item">
            <span className="sym">YAHOO FEED DOWN</span>
            <span className="faint">RETRYING EVERY 60S — TAPE RESUMES WHEN QUOTES LAND</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="term-tape"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="marquee"
      aria-label="Watchlist ticker tape"
    >
      <div
        className="tape-track"
        style={{ animationDuration: duration, ...(paused ? { animationPlayState: "paused" as const } : {}) }}
      >
        {doubled.map((it, i) => {
          const up = (it.chgPct ?? 0) >= 0;
          const down = it.price === null || it.chgPct === null;
          const cls = down ? "N/A" : assetClass(it.symbol);
          const tip = down
            ? `${it.symbol} (${cls}) — quote offline`
            : `${it.symbol} (${cls}) · ${fmtPrice(it.price as number, it.symbol)} ${fmtChg(it.chg ?? 0, it.symbol)} (${(it.chgPct as number) >= 0 ? "+" : "−"}${Math.abs(it.chgPct as number).toFixed(2)}%) — open in focused panel`;
          return (
            <button
              key={`${it.symbol}-${i}`}
              className="tape-item"
              onClick={() => onPick(it.symbol)}
              title={tip}
            >
              <span className="sym">{short(it.symbol)}</span>
              {down ? (
                <span className="faint">{loaded ? "OFFLINE" : "…"}</span>
              ) : (
                <>
                  <span className="px">{fmtPrice(it.price as number, it.symbol)}</span>
                  <span className={up ? "up" : "down"}>
                    {up ? "▲" : "▼"} {it.chg !== null ? `${fmtChg(it.chg, it.symbol)} ` : ""}({up ? "+" : "−"}{Math.abs(it.chgPct as number).toFixed(2)}%)
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
