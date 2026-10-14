"use client";

// DESK BRIDGE (spec §S11) — every one of the 86 desks, full screen, on a phone.
// Host bar: back · desk title+code · ticker picker · overflow (TERMINAL / AI).
// DeskRenderer keeps its own panel chrome; nothing is forked.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { MODULE_MAP } from "@/lib/modules";
import { funcCode } from "@/lib/terminal";
// Single source of truth for "this desk has no ticker" — same set the terminal
// panel header uses (Panel.tsx). Imported for its value only; the renderer
// below still loads dynamically so the host paints a skeleton first.
import { SYMBOL_LESS } from "@/components/terminal/DeskRenderer";
import { store } from "@/lib/store";
import { droidStore } from "../lib/droidStore";
import { useApi, useMounted } from "../lib/quotes";
import { localSymbols } from "../lib/search";
import { ErrorState, Note, Skeleton } from "../ui/Pills";
import Sheet, { ActionList } from "../ui/Sheet";

const DeskRenderer = dynamic(() => import("@/components/terminal/DeskRenderer"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 12 }}>
      <Skeleton rows={4} height={96} />
    </div>
  ),
});

export default function DeskBridge({ funcId, initialSymbol }: { funcId: string; initialSymbol?: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const [symbol, setSymbol] = useState(initialSymbol ?? "");
  const [menu, setMenu] = useState(false);
  const [pick, setPick] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!mounted || symbol) return;
    try {
      setSymbol(store.getTicker() || "RELIANCE.NS");
    } catch {
      setSymbol("RELIANCE.NS");
    }
  }, [mounted, symbol]);

  const mod = MODULE_MAP[funcId];
  const code = useMemo(() => (mod ? funcCode(mod.id) : ""), [mod]);
  const symbolLess = mod ? SYMBOL_LESS.has(mod.id) : true;

  const lookup = useApi<{ rows?: Array<{ symbol: string; name: string; exch: string }> }>(
    `/api/lookup?q=${encodeURIComponent(q.trim())}`,
    pick && q.trim().length >= 2
  );

  /**
   * What GO and Enter would actually load.
   *
   * Resolution is deliberately permissive and local: the local index first (it
   * knows NIFTY, GOLD, and every watchlist name), then the suffix the user typed,
   * then a plain `.NS` guess. It deliberately does NOT require a lookup hit -
   * refusing to apply a valid ticker because the search index has not heard of it
   * is the wrong failure, and the desk downstream already says when a price is
   * missing.
   */
  const typed = useMemo(() => {
    const raw = q.trim().toUpperCase();
    if (!raw) return null;
    const hit = localSymbols(raw, 1)[0];
    if (hit) return hit.symbol;
    if (/[.=^]/.test(raw)) return raw;                    // IDEA.NS, GC=F, ^NSEI
    return `${raw}.NS`;
  }, [q]);

  /**
   * Suggestions, with the NSE line first when one is available.
   *
   * `/api/lookup` returns US and NSE matches interleaved, so typing IDEA put
   * "IDEA (INVENT VENTURES, INC.)" above Vodafone Idea — tapping the top row
   * silently loaded a different company. This is a whole board, so the home
   * exchange wins ties, and an exact match on the typed text always floats.
   */
  const ordered = useMemo(() => {
    const rows = lookup.data?.rows ?? [];
    const raw = q.trim().toUpperCase();
    const score = (r: { symbol: string }) => {
      let s = 0;
      if (r.symbol.toUpperCase() === raw || r.symbol.toUpperCase() === typed) s += 1000;
      if (r.symbol.endsWith(".NS")) s += 100;            // this is an NSE board
      if (r.symbol.startsWith("^") || r.symbol.includes("=")) s += 80;
      return s;
    };
    return [...rows].sort((a, b) => score(b) - score(a));
  }, [lookup.data, q, typed]);

  const commit = useCallback((s: string) => {
    setSymbol(s);
    setPick(false);
    setQ("");
    droidStore.pushRecent(s);
    try {
      store.setTicker(s);
    } catch {
      /* storage unavailable */
    }
  }, []);

  if (!mod) {
    return (
      <div className="dx">
        <div className="dx-page">
          <ErrorState
            what={`DESK ${funcId}`}
            detail="NO SUCH DESK ID — THE REGISTRY DOES NOT KNOW THIS FUNCTION."
            retry={() => router.push("/more")}
          />
          <button className="dx-btn" style={{ marginTop: 10 }} onClick={() => router.push("/more")}>
            BACK TO ALL DESKS
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dx" id="droid-root">
      <div className="dx-bridge">
        <div className="dx-bridge-bar">
          <button className="dx-iconbtn" aria-label="Back" onClick={() => router.back()}>
            ←
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="dx-ellipsis" style={{ fontSize: 12.5, letterSpacing: "0.05em" }}>
              {mod.label.toUpperCase()}
            </div>
            <div className="dx-faint" style={{ fontSize: 9.5, letterSpacing: "0.08em" }}>
              {code} · {mod.category.toUpperCase()}
            </div>
          </div>
          {!symbolLess ? (
            <button
              className="dx-btn dx-ghost"
              style={{ minHeight: 34, fontSize: 11 }}
              onClick={() => setPick(true)}
            >
              {symbol ? symbol.replace(/\.(NS|BO)$/, "") : "PICK SYMBOL"} ▾
            </button>
          ) : (
            <span className="dx-badge dx-mute">UNIVERSE</span>
          )}
          <button className="dx-iconbtn" aria-label="More" onClick={() => setMenu(true)}>
            ⋯
          </button>
        </div>

        <div className="dx-bridge-body" style={{ paddingTop: 8 }}>
          <DeskRenderer
            funcId={funcId}
            symbol={symbol}
            onOpen={(nextId, nextSym) => {
              if (nextSym) setSymbol(nextSym);
              if (nextId && nextId !== funcId) router.push(`/d/${nextId}?symbol=${encodeURIComponent(nextSym || symbol)}`);
            }}
            onOpenNew={(nextId, nextSym) => {
              router.push(`/d/${nextId}?symbol=${encodeURIComponent(nextSym || symbol)}`);
            }}
          />
          <div className="dx-inline" style={{ marginTop: 12 }}>
            <button className="dx-pill" onClick={() => setPick(true)}>◈ CHANGE SYMBOL</button>
            <button className="dx-pill" onClick={() => setMenu(true)}>⋯ MORE</button>
            <button className="dx-pill" onClick={() => router.push("/more")}>☰ ALL DESKS</button>
          </div>
          <Note>
            THIS IS THE SAME DESK CODE THE TERMINAL RUNS — NO MOBILE FORK, NO CAPABILITY GAP. DATA
            GAPS RENDER THE DESK&apos;S OWN {`—`} CAVEATS.
          </Note>
        </div>
      </div>

      <Sheet open={menu} onClose={() => setMenu(false)} title={`${mod.label.toUpperCase()} · ${code}`} half>
        <ActionList
          onPick={(k) => {
            setMenu(false);
            if (k === "terminal") {
              if (symbol) {
                try {
                  store.setTicker(symbol);
                } catch {
                  /* ignore */
                }
              }
              router.push("/terminal");
            }
            if (k === "ai") router.push(`/ai?q=${encodeURIComponent(`${mod.label}${symbol ? ` for ${symbol.replace(/\.(NS|BO)$/, "")}` : ""}`)}`);
            if (k === "sec" && !symbolLess) router.push(`/s/${encodeURIComponent(symbol)}`);
            if (k === "res" && !symbolLess) router.push(`/research/${encodeURIComponent(symbol)}`);
            if (k === "more") router.push("/more");
          }}
          items={[
            { key: "terminal", label: "OPEN IN TERMINAL", icon: "▦" },
            { key: "ai", label: "ASK AI ABOUT THIS DESK", icon: "✦" },
            ...(symbolLess ? [] : [
              { key: "sec", label: "SECURITY PAGE", icon: "◈" },
              { key: "res", label: "RESEARCH MODE", icon: "▤" },
            ]),
            { key: "more", label: "ALL DESKS", icon: "☰" },
          ]}
        />
      </Sheet>

      <Sheet open={pick} onClose={() => setPick(false)} title="PICK SYMBOL">
        <div className="dx-searchbar">
          <span className="dx-amber">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              // Enter commits. On a phone keyboard the GO key is often missing or
              // off-screen, and before this the ONLY way to apply what you typed
              // was to tap a suggestion row - which does not exist while the
              // lookup is still in flight. The field was a dead end.
              if (e.key === "Enter") {
                e.preventDefault();
                if (typed) commit(typed);
              }
            }}
            placeholder="TYPE A SYMBOL"
            aria-label="Symbol"
            autoFocus
          />
          {typed && (
            <button
              className="dx-btn"
              style={{ minHeight: 32, padding: "0 12px", fontSize: 11.5 }}
              onClick={() => commit(typed)}
            >
              GO
            </button>
          )}
        </div>

        {typed && (
          <div className="dx-note" style={{ marginTop: 8 }}>
            ENTER OR GO LOADS {typed}
            {typed !== q.trim().toUpperCase() ? ` — YOU TYPED ${q.trim().toUpperCase()}` : ""}
          </div>
        )}

        <div className="dx-list" style={{ marginTop: 10 }}>
          {lookup.loading && q.trim().length >= 2 && <div className="dx-note">SEARCHING…</div>}
          {!lookup.loading && lookup.error && q.trim().length >= 2 && (
            <div className="dx-note">
              LOOKUP FAILED ({lookup.error}) — ENTER OR GO STILL APPLIES WHAT YOU TYPED.
            </div>
          )}
          {ordered.map((r) => (
            <button key={r.symbol} className="dx-row" onClick={() => commit(r.symbol)}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym">{r.symbol}</span>
                <span className="dx-name dx-ellipsis">{r.name}</span>
              </span>
              <span className="dx-right dx-faint" style={{ fontSize: 10 }}>{r.exch}</span>
            </button>
          ))}
          {!lookup.loading && q.trim().length >= 2 && !ordered.length && (
            <div className="dx-note">
              NO MATCH IN THE INDEX. IF THE TICKER IS CORRECT, ENTER OR GO LOADS IT ANYWAY — THE DESK WILL SAY SO IF
              YAHOO HAS NO PRICE FOR IT.
            </div>
          )}
          {!q.trim() ? (
            <>
              <div className="dx-note">RECENT</div>
              {(mounted ? droidStore.getRecents() : []).map((s) => (
                <button key={s} className="dx-row" onClick={() => commit(s)}>
                  <span className="dx-sym">{s}</span>
                  <span className="dx-right dx-faint" style={{ fontSize: 10 }}>USE</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
