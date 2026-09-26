"use client";

// MORE (spec §S10) — 86 desks in 7 groups, in-drawer search, ★ favorites,
// mode switch (SIMPLE/PRO/TERMINAL), Lite toggle, settings, about.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { store } from "@/lib/store";
import { droidStore } from "../lib/droidStore";
import { useMounted } from "../lib/quotes";
import type { DroidMode } from "../lib/types";
import { ALL_DESKS, DESK_GROUPS, GROUP_BLURB, GROUP_ICON, GROUP_ORDER } from "../lib/categories";
import { H, Note } from "../ui/Pills";

const MODES: Array<{ id: DroidMode; label: string; hint: string }> = [
  { id: "simple", label: "SIMPLE", hint: "5 TABS · CURATED ACTIONS · CODES HIDDEN" },
  { id: "pro", label: "PRO", hint: "EVERY DESK · DENSER CELLS · EXTRA PILLS" },
  { id: "terminal", label: "TERMINAL", hint: "THE FULL DESKTOP TERMINAL — UNCHANGED" },
];

export default function More() {
  const router = useRouter();
  const mounted = useMounted();
  const [mode, setMode] = useState<DroidMode>("simple");
  const [lite, setLite] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);

  useEffect(() => {
    if (!mounted) return;
    setMode(droidStore.getMode());
    setLite(droidStore.isLite());
    setFavs(store.getFavorites());
  }, [mounted]);

  const termMode = mounted && mode === "terminal";
  const query = q.trim().toUpperCase();

  const groups = useMemo(() => {
    if (query) {
      return GROUP_ORDER.map((g) => ({
        g,
        items: (DESK_GROUPS[g] ?? []).filter(
          (d) =>
            d.m.label.toUpperCase().includes(query) ||
            d.m.category.toUpperCase().includes(query) ||
            (termMode && d.code.toUpperCase() === query)
        ),
      })).filter((x) => x.items.length);
    }
    return GROUP_ORDER.map((g) => ({ g, items: DESK_GROUPS[g] ?? [] }));
  }, [query, termMode]);

  const favDesks = ALL_DESKS.filter((d) => favs.includes(d.m.id));

  function applyMode(m: DroidMode) {
    setMode(m);
    droidStore.setMode(m);
    if (m === "terminal") router.push("/terminal");
  }

  return (
    <div>
      <H right={<span className="dx-faint" style={{ fontSize: 10 }}>{ALL_DESKS.length} DESKS</span>}>
        ALL DESKS
      </H>

      <div className="dx-searchbar">
        <span className="dx-amber">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          placeholder="FILTER DESKS…"
          aria-label="Filter desks"
        />
      </div>

      <div className="dx-inline" style={{ marginTop: 8 }}>
        <button className={`dx-pill${open.length === GROUP_ORDER.length ? " dx-on" : ""}`} onClick={() => setOpen(GROUP_ORDER.map(String))}>
          EXPAND ALL
        </button>
        <button className="dx-pill" onClick={() => setOpen([])}>COLLAPSE</button>
        <span className="dx-spacer" />
        <Link className="dx-pill" href="/brief">☀ BRIEF</Link>
        <Link className="dx-pill" href="/notifications">♢ ALERTS</Link>
      </div>

      {favDesks.length ? (
        <>
          <H right={<span className="dx-faint" style={{ fontSize: 10 }}>FROM THE TERMINAL&apos;S ★</span>}>FAVORITES</H>
          <div className="dx-inline">
            {favDesks.map((d) => (
              <Link key={d.m.id} className="dx-pill" href={`/d/${d.m.id}`}>
                ★ {d.m.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {groups.map(({ g, items }) => {
        const isOpen = query ? true : open.includes(g);
        return (
          <div key={g} style={{ marginTop: 14 }}>
            <H
              right={
                <button
                  className="dx-btn dx-ghost"
                  style={{ minHeight: 28, fontSize: 10 }}
                  onClick={() =>
                    setOpen((o) => (o.includes(g) ? o.filter((x) => x !== g) : [...o, g]))
                  }
                >
                  {isOpen ? "HIDE" : `SHOW ${items.length}`}
                </button>
              }
            >
              {GROUP_ICON[g]} {g}
            </H>
            <div className="dx-note" style={{ marginBottom: 6 }}>{GROUP_BLURB[g]}</div>
            {isOpen ? (
              <div className="dx-list">
                {items.length ? (
                  items.map((d) => (
                    <Link key={d.m.id} href={`/d/${d.m.id}`} className="dx-row">
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <span className="dx-sym dx-ellipsis">{d.m.label}</span>
                        <span className="dx-name dx-ellipsis">{d.m.description || d.m.category}</span>
                      </span>
                      <span className="dx-right dx-fnc" style={{ fontSize: 10 }}>
                        {termMode ? d.code : "›"}
                      </span>
                    </Link>
                  ))
                ) : (
                  <div className="dx-note">NO DESK MATCHES “{query}”.</div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      <H>MODE</H>
      <div className="dx-col" style={{ gap: 6 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`dx-row${mode === m.id ? " dx-on" : ""}`}
            style={mode === m.id ? { borderColor: "var(--dx-amber)", color: "var(--dx-amber)" } : undefined}
            onClick={() => applyMode(m.id)}
          >
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="dx-sym">{mode === m.id ? "◉ " : "○ "}{m.label}</span>
              <span className="dx-name dx-ellipsis">{m.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <H>LITE</H>
      <button
        className="dx-row"
        style={lite ? { borderColor: "var(--dx-amber)", color: "var(--dx-amber)" } : undefined}
        onClick={() => {
          const v = !lite;
          setLite(v);
          droidStore.setLite(v);
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span className="dx-sym">{lite ? "◉ LITE ON" : "○ LITE OFF"}</span>
          <span className="dx-name dx-ellipsis">
            60-SECOND POLLS · NO ANIMATION · ≤300 BARS — FOR SLOW NETWORKS AND OLD PHONES.
          </span>
        </span>
      </button>

      <H>SHORTCUTS</H>
      <div className="dx-inline">
        <Link className="dx-pill" href="/terminal">▦ TERMINAL</Link>
        <Link className="dx-pill" href="/settings">⚙ SETTINGS</Link>
        <Link className="dx-pill" href="/alerts">⏰ ALERT DESK</Link>
        <Link className="dx-pill" href="/portfolio">▤ PORTFOLIO</Link>
        <Link className="dx-pill" href="/notes">✎ NOTES</Link>
        <Link className="dx-pill" href="/compare">⇄ COMPARE</Link>
      </div>

      <H>ABOUT</H>
      <Note>
        BULLION DROID IS THE MOBILE COMPANION TO BULLION BOARD — AN INDEPENDENT VISUAL AND
        FUNCTIONAL HOMAGE TO PROFESSIONAL TERMINALS. IT IS NOT AFFILIATED WITH, ENDORSED BY, OR
        CONNECTED TO ANY TERMINAL VENDOR. NO MARKS, LOGOS OR WORDMARKS OF ANY THIRD-PARTY TERMINAL
        APPEAR IN THIS PRODUCT.
      </Note>
      <Note>
        DATA: YAHOO, RSS WIRE, NSE PUBLIC ENDPOINTS (BETA) — GAPS RENDER AS {`—`}, NEVER AS A GUESS.
        NOT INVESTMENT ADVICE.
      </Note>
    </div>
  );
}
