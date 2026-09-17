"use client";

import { useEffect, useState } from "react";

export const TOUR_KEY = "bb.tour.seen.v1";

export function hasSeenTour(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return !!window.localStorage.getItem(TOUR_KEY);
  } catch {
    return true;
  }
}

export function markTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUR_KEY, "1");
  } catch { /* ignore */ }
}

// First run = fresh browser: no saved workspace (current shell key nor the
// pre-desktop legacy key) and the tour was never dismissed.
export function isFirstRun(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(TOUR_KEY)) return false;
    if (window.localStorage.getItem("bb.workspace.shell.v1")) return false;
    if (window.localStorage.getItem("bb.workspace.active.v2")) return false;
    return true;
  } catch {
    return false;
  }
}

interface TourStep {
  title: string;
  body: string;
  // CSS selector inside .term-root to ring with the amber spotlight.
  spot?: string;
}

const STEPS: TourStep[] = [
  {
    title: "▮ WELCOME — 60-SECOND TOUR",
    body: "THIS IS A BLOOMBERG-STYLE NSE TERMINAL: LIVE QUOTES, QUANT DESKS, OPTIONS, FUNDAMENTALS AND AI — DRIVEN BY SHORT COMMANDS, NOT MENUS. FOUR PANELS BELOW ARE YOUR STARTER DASHBOARD.",
    spot: ".term-work",
  },
  {
    title: "▮ 1/7 · COMMAND LINE — THE <GO> KEY",
    body: "TYPE `RELIANCE STRAT` + ENTER TO LOAD A DESK. BARE `STRAT` REUSES THE FOCUSED SYMBOL · `MENU` = BACK TO DIRECTORY · `CANCEL` = CLOSE PANEL · `?` = FULL SYNTAX · CLICK THE TAPE OR USE ↑↓ HISTORY.",
    spot: ".term-cmdbar",
  },
  {
    title: "▮ 2/7 · TICKER TAPE — LIVE PRICES",
    body: "STREAMING WATCHLIST PRICES (GREEN ▲ / RED ▼). CLICK ANY SYMBOL TO LOAD IT INTO THE FOCUSED PANEL. HOVER PAUSES THE SCROLL.",
    spot: ".term-tape",
  },
  {
    title: "▮ 3/7 · PANELS — YOUR WORKSPACE",
    body: "CLICK A PANEL TO FOCUS IT (AMBER = FOCUSED). DOUBLE-CLICK A HEADER TO MAXIMIZE · RIGHT-CLICK FOR ACTIONS · DRAG HEADERS TO REORDER · DRAG THE THIN DIVIDERS TO RESIZE. THE ⚙ STRIP BELOW EVERY PANEL HOLDS QUICK SETTINGS.",
    spot: ".term-work",
  },
  {
    title: "▮ 4/7 · FUNCTION KEYS F1–F12",
    body: "ONE TAP LOADS A DESK INTO THE FOCUSED PANEL: F2 CHART · F4 FUNDAMENTALS · F5 STRATEGY · F6 OPTION CHAIN · F8 MACRO · F9 NEWS · F11 AI CHAT. PHYSICAL F-KEYS WORK TOO.",
    spot: ".term-fkeys",
  },
  {
    title: "▮ 5/7 · EXPLAIN MODE — UNDERSTAND ANY TERM",
    body: "PRESS ALT+E TO TOGGLE EXPLAIN MODE. ANY LABEL, METRIC, OR HEADER BECOMES CLICKABLE — CLICK IT TO GET AN INSTANT GLOSSARY DEFINITION OR STREAMED AI EXPLANATION. TEXT SELECTION SHOWS AN 'EXPLAIN' CHIP TOO. THE STATUS BAR SHOWS WHEN EXPLAIN MODE IS ON.",
    spot: ".term-status",
  },
  {
    title: "▮ 6/7 · STATUS BAR — SAVE + DESKS",
    body: "WORKSPACE = SAVE / LOAD / RENAME LAYOUTS · DESKS = VIRTUAL DESKTOPS (MAX 6, DOUBLE-CLICK RENAME, RIGHT-CLICK CLOSE) · LAYOUT SWITCH · + PANEL (SPLITS THE FOCUSED SIDE IN 2-UP) · ⚙ SET OPENS SETTINGS · ? TOUR REPLAYS THIS.",
    spot: ".term-status",
  },
  {
    title: "▮ 7/7 · YOUR STARTER DASHBOARD",
    body: "TOP-LEFT MACRO BOARD · TOP-RIGHT FUNCTION MENU (EVERY DESK LIVES HERE) · BOTTOM-LEFT RELIANCE TECHNICALS · BOTTOM-RIGHT NEWS WIRE. EVERYTHING IS CLICKABLE — GO EXPLORE.",
    spot: ".term-work",
  },
];

export default function Tour({ onDone }: { onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];

  // Amber spotlight ring follows the step's target region.
  useEffect(() => {
    const prev = document.querySelectorAll(".tour-spot");
    prev.forEach((el) => el.classList.remove("tour-spot"));
    if (step.spot) {
      document.querySelectorAll(step.spot).forEach((el) => el.classList.add("tour-spot"));
    }
    return () => {
      document.querySelectorAll(".tour-spot").forEach((el) => el.classList.remove("tour-spot"));
    };
  }, [idx, step.spot]);

  function close() {
    markTourSeen();
    onDone();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); setIdx((i) => Math.min(i + 1, STEPS.length - 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = idx === STEPS.length - 1;

  return (
    <>
      <div className="tour-backdrop" aria-hidden="true" />
      <div className="tour-card" role="dialog" aria-modal="true" aria-label="Terminal tour">
        <p className="tour-title">{step.title}</p>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot${i === idx ? " active" : ""}${i < idx ? " done" : ""}`} />
          ))}
        </div>
        <div className="toolbar tour-btns">
          <button className="ghost" onClick={close} title="Skip the tour (Esc)">SKIP ✕</button>
          <span style={{ flex: 1 }} />
          {idx > 0 && <button className="ghost" onClick={() => setIdx((i) => i - 1)} title="Previous (←)">← BACK</button>}
          {!last
            ? <button className="btn" onClick={() => setIdx((i) => i + 1)} title="Next (→)">NEXT →</button>
            : <button className="btn" onClick={close} title="Finish and open the dashboard">OPEN DASHBOARD ▸</button>}
        </div>
      </div>
    </>
  );
}
