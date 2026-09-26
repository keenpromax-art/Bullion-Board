"use client";

// SEARCH (spec §S7) — the command line, replaced. Deterministic intent router
// first (codes, labels, NL patterns, local index), live /api/lookup second,
// AI hand-off last. Results are SECURITY rows (8 quick actions) and DESK rows.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { droidStore } from "../lib/droidStore";
import { localSymbols, matchDesks, parseIntent, suggest } from "../lib/search";
import type { Intent, DroidMode } from "../lib/types";
import { useApi, useMounted } from "../lib/quotes";
import { H, Note, Skeleton } from "../ui/Pills";
import Sheet, { ActionList } from "../ui/Sheet";

interface LookupResp {
  rows?: Array<{ symbol: string; name: string; exch: string; type: string }>;
}

const QUICK = ["NIFTY", "GOLD", "RELIANCE", "OPTION CHAIN", "BRIEF", "MOVERS"];

export default function Search() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState<Intent | null>(null);
  const [live, setLive] = useState(false);
  const [menuSym, setMenuSym] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const mounted = useMounted();
  const [mode, setMode] = useState<DroidMode>("simple");
  useEffect(() => {
    if (mounted) setMode(droidStore.getMode());
  }, [mounted]);
  const recents = useMemo(() => (mounted ? droidStore.getRecents() : []), [mounted]);
  const favSymbols = useMemo(() => (mounted ? droidStore.getLists()[0]?.symbols.slice(0, 4) ?? [] : []), [mounted]);

  const trim = q.trim().toUpperCase();
  const loc = useMemo(() => (trim ? { symbols: localSymbols(trim, 6), desks: matchDesks(trim, 6) } : { symbols: [], desks: [] }), [trim]);
  const sugg = useMemo(() => (trim ? suggest(trim, 6) : { symbols: [], desks: [] }), [trim]);

  // live lookup only when the local index has nothing to show
  const needLive = live && trim.length >= 2 && !loc.symbols.length;
  const lookup = useApi<LookupResp>(`/api/lookup?q=${encodeURIComponent(trim)}`, needLive);
  const liveRows = needLive ? lookup.data?.rows ?? [] : [];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const my = ++seq.current;
    setLive(false);
    setErr("");
    const t = window.setTimeout(() => {
      if (seq.current !== my) return;
      if (!trim) return;
      if (loc.symbols.length || loc.desks.length) return;
      setLive(true);
    }, 260);
    return () => window.clearTimeout(t);
  }, [trim, loc.symbols.length, loc.desks.length]);

  function goIntent(it: Intent) {
    if (it.kind === "security" && it.symbol) {
      droidStore.pushRecent(it.symbol);
      router.push(`/s/${encodeURIComponent(it.symbol)}${it.tab ? `?tab=${it.tab}` : ""}`);
      return;
    }
    if (it.kind === "desk" && it.funcId) {
      router.push(`/d/${it.funcId}${it.symbol ? `?symbol=${encodeURIComponent(it.symbol)}` : ""}`);
      return;
    }
    if (it.kind === "compare") {
      router.push(`/research?compare=${(it.symbols ?? []).map(encodeURIComponent).join(",")}`);
      return;
    }
    if (it.kind === "brief") {
      router.push("/brief");
      return;
    }
    if (it.kind === "ai") {
      router.push(`/ai?q=${encodeURIComponent(it.query ?? "")}`);
      return;
    }
    setErr("NO MATCH — TRY A SYMBOL, A DESK NAME, OR A FUNCTION CODE.");
  }

  function run(text?: string) {
    const t = (text ?? q).trim();
    if (!t) return;
    const it = parseIntent(t);
    if (it) {
      setSubmitted(it);
      goIntent(it);
      return;
    }
    setErr("NOTHING MATCHED — ASK THE AI OR TRY A SHORTER QUERY.");
  }

  const showSuggestions = !!trim && !submitted;

  return (
    <div>
      <div className="dx-searchbar">
        <span className="dx-amber">⌕</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="SYMBOL · DESK · CODE · QUESTION"
          aria-label="Search"
          enterKeyHint="search"
        />
        {q ? (
          <button className="dx-amber" style={{ background: "none", border: 0 }} onClick={() => setQ("")} aria-label="Clear">
            ✕
          </button>
        ) : null}
      </div>

      {err ? <div className="dx-note" style={{ color: "var(--dx-red)" }}>{err}</div> : null}

      {!trim ? (
        <>
          <H>RECENT</H>
          <div className="dx-inline">
            {recents.length ? (
              recents.map((s) => (
                <button key={s} className="dx-pill" onClick={() => run(s)}>
                  {s.replace(/\.(NS|BO)$/, "")}
                </button>
              ))
            ) : (
              <span className="dx-note">NOTHING YET — YOUR RECENT SYMBOLS APPEAR HERE.</span>
            )}
          </div>
          <H>TRY</H>
          <div className="dx-inline">
            {QUICK.map((s) => (
              <button key={s} className="dx-pill" onClick={() => run(s)}>
                {s}
              </button>
            ))}
          </div>
          <H>DESKS YOU OPEN MOST</H>
          <div className="dx-inline">
            {favSymbols.length ? (
              favSymbols.map((s) => (
                <button key={s} className="dx-pill" onClick={() => run(s)}>
                  {s.replace(/\.(NS|BO)$/, "")}
                </button>
              ))
            ) : (
              <span className="dx-note">STAR A SYMBOL TO PIN IT HERE.</span>
            )}
          </div>
          <Note>
            THE ROUTER IS LOCAL AND DETERMINISTIC: FUNCTION CODES (E.G. "RELIANCE FS"), DESK LABELS,
            AND PHRASES LIKE "COMPARE GOLD AND SILVER" ALL RESOLVE WITHOUT A NETWORK CALL.
          </Note>
        </>
      ) : null}

      {showSuggestions ? (
        <>
          {sugg.symbols.length ? (
            <>
              <H>SECURITIES</H>
              <div className="dx-list">
                {sugg.symbols.map((h) => (
                  <button
                    key={h.symbol}
                    className="dx-row"
                    onClick={() => {
                      droidStore.pushRecent(h.symbol);
                      router.push(`/s/${encodeURIComponent(h.symbol)}`);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenuSym(h.symbol);
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span className="dx-sym">{h.symbol}</span>
                      <span className="dx-name dx-ellipsis">{h.base}</span>
                    </span>
                    <span className="dx-right dx-faint" style={{ fontSize: 10 }}>OPEN ›</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {sugg.desks.length ? (
            <>
              <H>DESKS</H>
              <div className="dx-list">
                {sugg.desks.map((d) => (
                  <button key={d.m.id} className="dx-row" onClick={() => router.push(`/d/${d.m.id}`)}>
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span className="dx-sym">{d.m.label}</span>
                      <span className="dx-name">{d.m.category}{mode === "terminal" ? ` · ${d.code}` : ""}</span>
                    </span>
                    <span className="dx-right dx-fnc" style={{ fontSize: 10 }}>{mode === "terminal" ? d.code : "›"}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {live && lookup.loading && !lookup.data ? <Skeleton rows={3} height={52} /> : null}
          {liveRows.length ? (
            <>
              <H>LIVE LOOKUP</H>
              <div className="dx-list">
                {liveRows.map((r) => (
                  <button
                    key={r.symbol}
                    className="dx-row"
                    onClick={() => {
                      droidStore.pushRecent(r.symbol);
                      router.push(`/s/${encodeURIComponent(r.symbol)}`);
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span className="dx-sym">{r.symbol}</span>
                      <span className="dx-name dx-ellipsis">{r.name}</span>
                    </span>
                    <span className="dx-right dx-faint" style={{ fontSize: 10 }}>{r.exch}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {live && !lookup.loading && !liveRows.length ? (
            <div className="dx-state">
              <div className="dx-state-t">NO LOCAL OR LIVE MATCH</div>
              <div className="dx-state-d">ASK THE AI INSTEAD — IT SEES THE SAME TAPE.</div>
              <button
                className="dx-btn"
                onClick={() => router.push(`/ai?q=${encodeURIComponent(trim)}`)}
              >
                ASK BULLION DROID ✦
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      <Sheet open={!!menuSym} onClose={() => setMenuSym(null)} title={menuSym ? menuSym.replace(/\.(NS|BO)$/, "") : ""} half>
        <ActionList
          onPick={(k) => {
            const s = menuSym;
            setMenuSym(null);
            if (!s) return;
            if (k === "open") router.push(`/s/${encodeURIComponent(s)}`);
            if (k === "chart") router.push(`/s/${encodeURIComponent(s)}?tab=chart`);
            if (k === "news") router.push(`/s/${encodeURIComponent(s)}?tab=news`);
            if (k === "research") router.push(`/research/${encodeURIComponent(s)}`);
            if (k === "chain") router.push(`/d/110?symbol=${encodeURIComponent(s)}`);
            if (k === "terminal") {
              store.setTicker(s);
              router.push("/terminal");
            }
          }}
          items={[
            { key: "open", label: "OPEN SECURITY", icon: "◈" },
            { key: "chart", label: "CHART", icon: "⌂" },
            { key: "research", label: "RESEARCH MODE", icon: "▤" },
            { key: "news", label: "NEWS", icon: "▣" },
            { key: "chain", label: "OPTION CHAIN DESK", icon: "⬡" },
            { key: "terminal", label: "OPEN IN TERMINAL", icon: "▦" },
          ]}
        />
      </Sheet>
    </div>
  );
}
