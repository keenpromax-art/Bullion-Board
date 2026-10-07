"use client";

// WATCHLIST (spec §S3) — multi-list, filter chips, swipe actions, long-press
// menu, add-symbol lookup, sort. Persists to bb.droid.watchlists.v1 and keeps
// the terminal store's main list in sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { droidStore, DEFAULT_LIST_ID } from "../lib/droidStore";
import { useQuotes } from "../lib/quotes";
import type { WatchList } from "../lib/types";
import { chg, dir, num } from "../lib/format";
import { EmptyState, ErrorState, H, Note, Skeleton } from "../ui/Pills";
import Sheet, { ActionList } from "../ui/Sheet";
import SwipeRow from "../ui/SwipeRow";
import AlertSheet from "../ui/AlertSheet";

type Filter = "all" | "gainers" | "losers" | "events";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "gainers", label: "GAINERS" },
  { id: "losers", label: "LOSERS" },
  { id: "events", label: "EVENTS" },
];

interface LookupRow {
  symbol: string;
  name: string;
  exch: string;
  type: string;
}

export default function Watchlist() {
  const router = useRouter();
  const [lists, setLists] = useState<WatchList[]>([]);
  const [listId, setListId] = useState(DEFAULT_LIST_ID);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LookupRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [alertFor, setAlertFor] = useState<string | null>(null);
  const [listMenu, setListMenu] = useState(false);
  const [newName, setNewName] = useState("");
  const [removed, setRemoved] = useState<string[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const l = droidStore.getLists();
    setLists(l);
    setListId(l[0]?.id ?? DEFAULT_LIST_ID);
  }, []);

  const active = useMemo(() => lists.find((l) => l.id === listId) ?? lists[0] ?? null, [lists, listId]);

  const [tick, setTick] = useState(0);
  const symbols = useMemo(() => active?.symbols ?? [], [active, tick]);
  const quotes = useQuotes(symbols);

  const rows = useMemo(() => {
    const map = quotes.data ?? {};
    let out = symbols.map((s) => ({ sym: s, q: map[s] }));
    if (filter === "gainers") out = out.filter((r) => (r.q?.regularMarketChangePercent ?? 0) > 0);
    if (filter === "losers") out = out.filter((r) => (r.q?.regularMarketChangePercent ?? 0) < 0);
    if (filter === "events") {
      let alerted: string[] = [];
      try {
        alerted = store.getAlerts().filter((a) => a.active).map((a) => a.symbol);
      } catch {
        alerted = [];
      }
      out = out.filter((r) => alerted.includes(r.sym));
    }
    return out;
  }, [symbols, quotes.data, filter]);

  const addSymbol = useCallback(
    (sym: string) => {
      droidStore.toggleSymbol(listId, sym);
      setLists(droidStore.getLists());
      setTick((t) => t + 1);
      setQuery("");
      setHits([]);
      setAddOpen(false);
    },
    [listId]
  );

  const removeSymbol = useCallback(
    (sym: string) => {
      droidStore.toggleSymbol(listId, sym);
      setLists(droidStore.getLists());
      setTick((t) => t + 1);
      setRemoved((r) => [...r, sym]);
      window.setTimeout(() => setRemoved((r) => r.filter((s) => s !== sym)), 2500);
    },
    [listId]
  );

  // debounced live lookup while the add sheet is open
  useEffect(() => {
    const q = query.trim().toUpperCase();
    if (!q) {
      setHits([]);
      return;
    }
    const my = ++seq.current;
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/lookup?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (seq.current !== my) return;
        setHits((j.rows ?? []).slice(0, 8));
      } catch {
        if (seq.current === my) setHits([]);
      }
    }, 240);
    return () => window.clearTimeout(t);
  }, [query]);

  const open = (sym: string) => {
    droidStore.pushRecent(sym);
    router.push(`/s/${encodeURIComponent(sym)}`);
  };

  return (
    <div>
      <H right={<button className="dx-btn dx-ghost" style={{ minHeight: 30, fontSize: 10 }} onClick={() => setListMenu(true)}>LISTS ⚙</button>}>
        {active ? active.name : "WATCHLIST"}
      </H>

      <div className="dx-pills">
        {lists.map((l) => (
          <button key={l.id} className={`dx-pill${l.id === listId ? " dx-on" : ""}`} onClick={() => setListId(l.id)}>
            {l.name} · {l.symbols.length}
          </button>
        ))}
        <button className="dx-pill" onClick={() => setListMenu(true)} aria-label="New list">
          ＋
        </button>
      </div>

      <div style={{ marginTop: 10 }} className="dx-inline">
        {FILTERS.map((f) => (
          <button key={f.id} className={`dx-pill${filter === f.id ? " dx-on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <span className="dx-spacer" />
        <button className="dx-pill" onClick={() => setAddOpen(true)}>＋ ADD</button>
      </div>

      <div className="dx-list" style={{ marginTop: 10 }}>
        {quotes.loading && !quotes.data ? (
          <Skeleton rows={4} height={54} />
        ) : quotes.error && !quotes.data ? (
          <ErrorState what="WATCHLIST QUOTES" retry={quotes.refresh} detail={quotes.error} />
        ) : !active || !active.symbols.length ? (
          <EmptyState
            title="EMPTY LIST"
            desc="ADD SYMBOLS WITH THE ＋ ADD BUTTON — OR STAR ONE FROM ANY SECURITY PAGE."
            action={<button className="dx-btn" onClick={() => setAddOpen(true)}>ADD A SYMBOL</button>}
          />
        ) : !rows.length ? (
          <EmptyState title={`NO ${filter.toUpperCase()} HERE`} desc="SWITCH THE FILTER TO SEE THE FULL LIST." />
        ) : (
          rows.map(({ sym, q }) => (
            <SwipeRow
              key={sym}
              onTap={() => open(sym)}
              onLongPress={() => setMenuFor(sym)}
              actions={[
                { key: "chart", label: "CHART", color: "var(--amber)", onClick: () => open(sym) },
                {
                  key: "news",
                  label: "NEWS",
                  /* A neutral action wants a NEUTRAL fill. This was --grid, which
                     is a hairline colour: white ink on #d3d7e0 in light mode
                     measured 1.5:1 and the button rendered as a blank gap in the
                     swipe rail. --sub carries an ink that clears AA either way. */
                  color: "var(--sub)",
                  onClick: () => router.push(`/s/${encodeURIComponent(sym)}?tab=news`),
                },
                { key: "alert", label: "ALERT", color: "var(--amber-deep)", onClick: () => setAlertFor(sym) },
                { key: "remove", label: "REMOVE", color: "var(--red)", onClick: () => removeSymbol(sym) },
              ]}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym dx-ellipsis">{sym.replace(/\.(NS|BO)$/, "")}</span>
                <span className="dx-name dx-ellipsis">{q?.shortName ?? ""}</span>
              </span>
              <span className="dx-right">
                <span className="dx-px">{q ? num(q.regularMarketPrice, 2) : "—"}</span>
                <span className={`dx-chg ${dir(q?.regularMarketChangePercent)}`}>
                  {q ? chg(q.regularMarketChangePercent) : "—"}
                </span>
              </span>
            </SwipeRow>
          ))
        )}
      </div>

      <Note>
        SWIPE A ROW LEFT FOR CHART · NEWS · ALERT · REMOVE — OR LONG-PRESS FOR THE FULL MENU.
        {removed.length ? ` REMOVED ${removed.join(", ")} (TAP ＋ TO RE-ADD).` : ""}
      </Note>

      {/* long-press action sheet */}
      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? menuFor.replace(/\.(NS|BO)$/, "") : ""} half>
        <ActionList
          onPick={(k) => {
            const sym = menuFor;
            setMenuFor(null);
            if (!sym) return;
            if (k === "analyze") open(sym);
            if (k === "chart") open(sym);
            if (k === "news") router.push(`/s/${encodeURIComponent(sym)}?tab=news`);
            if (k === "alert") setAlertFor(sym);
            if (k === "note") router.push("/notes");
            if (k === "options") router.push(`/d/110?symbol=${encodeURIComponent(sym)}`);
            if (k === "compare") router.push(`/research?compare=${encodeURIComponent(sym)}`);
            if (k === "remove") removeSymbol(sym);
          }}
          items={[
            { key: "analyze", label: "ANALYZE", icon: "◈" },
            { key: "chart", label: "OPEN CHART", icon: "📈" },
            { key: "news", label: "LATEST NEWS", icon: "📰" },
            { key: "alert", label: "SET PRICE ALERT", icon: "⏰" },
            { key: "options", label: "OPTION CHAIN", icon: "🔗" },
            { key: "compare", label: "COMPARE", icon: "⇄" },
            { key: "note", label: "ADD NOTE", icon: "✎" },
            { key: "remove", label: "REMOVE FROM LIST", icon: "✕", danger: true },
          ]}
        />
      </Sheet>

      {/* add symbol */}
      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title={`ADD TO ${active?.name ?? "LIST"}`}>
        <div className="dx-searchbar">
          <span className="dx-amber">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="TYPE A SYMBOL OR COMPANY"
            aria-label="Search symbol"
          />
        </div>
        <div className="dx-list" style={{ marginTop: 10 }}>
          {hits.map((h) => (
            <button key={h.symbol} className="dx-row" onClick={() => addSymbol(h.symbol)}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span className="dx-sym">{h.symbol}</span>
                <span className="dx-name dx-ellipsis">{h.name}</span>
              </span>
              <span className="dx-right dx-faint" style={{ fontSize: 10 }}>{h.exch}</span>
            </button>
          ))}
          {!hits.length && query ? <div className="dx-note">NO MATCH YET — KEEP TYPING.</div> : null}
        </div>
      </Sheet>

      {/* list manager */}
      <Sheet open={listMenu} onClose={() => setListMenu(false)} title="WATCHLISTS">
        <div className="dx-col">
          {lists.map((l) => (
            <div key={l.id} className="dx-inline">
              <button
                className={`dx-pill${l.id === listId ? " dx-on" : ""}`}
                style={{ flex: 1, justifyContent: "flex-start" }}
                onClick={() => {
                  setListId(l.id);
                  setListMenu(false);
                }}
              >
                {l.name} · {l.symbols.length}
              </button>
              {lists.length > 1 ? (
                <button
                  className="dx-btn dx-danger"
                  style={{ minHeight: 34, fontSize: 11 }}
                  onClick={() => {
                    const next = droidStore.deleteList(l.id);
                    setLists(next);
                    setListId(next[0].id);
                  }}
                >
                  DEL
                </button>
              ) : null}
            </div>
          ))}
          <div className="dx-divider" />
          <div className="dx-searchbar">
            <span className="dx-amber">＋</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value.toUpperCase())}
              placeholder="NEW LIST NAME"
              aria-label="New list name"
            />
          </div>
          <button
            className="dx-btn"
            onClick={() => {
              if (!newName.trim()) return;
              const next = droidStore.createList(newName.trim());
              setLists(next);
              setListId(next[next.length - 1].id);
              setNewName("");
            }}
          >
            CREATE LIST
          </button>
        </div>
      </Sheet>

      <AlertSheet open={!!alertFor} onClose={() => setAlertFor(null)} symbol={alertFor ?? ""} current={alertFor ? quotes.data?.[alertFor]?.regularMarketPrice : null} />
    </div>
  );
}
