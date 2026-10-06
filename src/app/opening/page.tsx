"use client";

import { useCallback, useEffect, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { store } from "@/lib/store";
import { DEFAULT_TARGET_KEY } from "@/lib/opening";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import {
  DeskLive, captureSlot, readCaptureLog,
} from "@/components/OpeningDesk";
import type { BoardWire, HistoryWire, OpeningSnap } from "@/components/OpeningDesk";
import { ScorecardPanels } from "@/components/OpeningScorecard";

// Module 109 / FNC PRE — the pre-market opening desk.
//
// This page is a HOST, not a desk: it owns the market selection, the two
// fetches (one deep snapshot + one shallow board of every market) and the AI
// block. The desk itself is `DeskLive`, which the terminal workspace panel
// renders too, so the two surfaces cannot drift apart.

export default function OpeningPage() {
  const [tab, setTab] = useState<"live" | "score">("live");
  const [ticker, setTicker] = useState("RELIANCE.NS");
  const [market, setMarket] = useState(DEFAULT_TARGET_KEY);
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState<OpeningSnap | null>(null);
  const [board, setBoard] = useState<BoardWire | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [boardBusy, setBoardBusy] = useState(false);
  const [logRows, setLogRows] = useState<any[]>([]);
  const [logNote, setLogNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  // ---- fetches ----
  const load = useCallback(async (key: string) => {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/opening?market=${encodeURIComponent(key)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "snapshot failed");
      setSnap(j as OpeningSnap);
    } catch (e: any) {
      setErr(e.message || "snapshot failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadBoard = useCallback(async () => {
    setBoardBusy(true);
    try {
      const r = await fetch("/api/opening/board");
      const j = await r.json();
      if (r.ok) setBoard(j as BoardWire);
    } catch {
      /* the rail degrades to nothing; the desk itself is unaffected */
    } finally {
      setBoardBusy(false);
    }
  }, []);

  useEffect(() => {
    setMarket(store.getOpeningMarket());
    setTicker(store.getTicker());
    setLogRows(readCaptureLog());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load(market);
  }, [ready, market, load]);

  useEffect(() => {
    if (ready) loadBoard();
  }, [ready, loadBoard]);

  // Switching market clears the snapshot, so one market's numbers can never sit
  // under another market's label while the new tape is in flight.
  function pickMarket(key: string) {
    if (key === market) return;
    store.setOpeningMarket(key);
    setSnap(null);
    setAiOut("");
    setMarket(key);
  }

  function logSlot() {
    if (!snap) return;
    const n = captureSlot(snap);
    if (n < 0) {
      setLogNote("LOG FAILED — BROWSER STORAGE REFUSED THE WRITE");
    } else {
      setLogRows(readCaptureLog());
      setLogNote(`LOGGED ${snap.currentSlot ?? "—"} → ${snap.predict?.verdict ?? "—"} (${n} ROWS)`);
    }
    window.setTimeout(() => setLogNote(""), 6000);
  }

  // ---- AI analyst ----
  const askAI = async () => {
    if (!snap?.predict) return;
    const p = snap.predict;
    const fc = snap.forecast;
    const m = snap.market;
    const legs = p.legs
      .map((l) => `${l.short}=${l.chg === null ? (l.tail ? "TAIL_REJECTED" : "NO_TAPE") : `${l.chg.toFixed(2)}% (vote ${l.vote?.toFixed(2) ?? "—"}, weight ${l.applied.toFixed(3)}${l.stale ? ", stale x1/4" : ""}${l.priorOnly ? ", prior close" : ""})`}`)
      .join(", ");
    const groups = Object.entries(p.groups ?? {})
      .map(([g, e]) => `${g}=${e && e.edge !== null ? e.edge.toFixed(3) : "—"}`)
      .join(", ");
    const facts = [
      `MARKET=${m?.label ?? "—"} (${m?.venue ?? "—"}, ${m?.mode ?? "—"}, ${m?.calibrated ? "FITTED ON THIS INDEX" : "NOT FITTED — TRANSFERRED FIT"})`,
      m?.legOverlap ? `CIRCULARITY_WARNING: THIS INDEX IS ALSO THE \`${m.legOverlap}\` LEG IN THE ENGINE` : "",
      `TARGET=${snap.target ?? "—"}`,
      `PHASE=${snap.phase ?? "—"}`,
      `CALL=${p.verdict} EDGE=${p.edge ?? "—"} CONF=${p.confidence} COVERAGE=${p.coverage} STALE_SHARE=${p.staleShare} LEGS=${p.legsUsed}/${p.legCount}`,
      `REGIME=${p.regime ?? "—"} BAND=${p.band ?? "—"} GATE=±${p.gate ?? "0.25"}% CONFLICT=${p.conflict ? "YES" : "NO"}`,
      fc ? `FORECAST_GAP=${fc.expectedGapPct ?? "—"}% (${fc.expectedGapPts ?? "—"} PTS) P_UP=${fc.probUp} P_DIRECTIONAL=${fc.probDirectional}` : "FORECAST: UNAVAILABLE",
      fc ? `FORECAST_MODEL: GAP = ${fc.interceptPct} + ${fc.slopePctPerEdge} x EDGE, RESIDUAL_SD=${fc.residualSdPct}%` : "",
      snap.model ? `MODEL_VALIDATION: ${snap.model.sessions} SESSIONS (${snap.model.sample}), OOS SIGN AGREE ${snap.model.oosSignAgreement}% VS ${snap.model.oosBenchmark}% BENCHMARK, SPREAD ${snap.model.oosSpreadPct}%` : "",
      `INDIA_VIX=${snap.vix?.last ?? "—"} (${snap.vix?.chg !== null && snap.vix?.chg !== undefined ? `${snap.vix.chg.toFixed(2)}%` : "—"})`,
      `${m?.label ?? "INDEX"}_OPEN_GAP=${snap.gap?.gapPct !== null && snap.gap?.gapPct !== undefined ? `${snap.gap.gapPct.toFixed(2)}%` : "NOT_OPENED"}`,
      snap.confirm?.forecastErrPct !== null && snap.confirm?.forecastErrPct !== undefined
        ? `FORECAST_ERROR=${snap.confirm.forecastErrPct.toFixed(2)}% (${snap.confirm.forecastErrPts} PTS)`
        : "",
      `LEGS: ${legs}`,
      `FACTOR_EDGES: ${groups}`,
      snap.confirm ? `CONFIRM=${snap.confirm.state} — ${snap.confirm.headline}` : "",
      (snap.caveats ?? []).length ? `CAVEATS: ${(snap.caveats ?? []).join(" | ")}` : "CAVEATS: none",
    ].filter(Boolean);
    setAiLoading(true);
    setAiOut("");
    try {
      const r = await chatComplete(
        [
          { role: "system", content: aiSystem.preMarket() },
          { role: "user", content: `${NO_INVENT}\n\n${facts.join("\n")}` },
        ],
        { apiKey: store.getORKey(), model: store.getORModel() }
      );
      setAiOut(r);
    } catch {
      setAiOut("AI UNAVAILABLE.");
    }
    setAiLoading(false);
  };

  const stale = !!snap && snap.market?.key !== market;

  const aiBlock = (
    <div className="pre-card accent">
      <span className="pre-card-h">AI analyst on this call</span>
      {aiOut ? (
        <p className="pre-card-b" style={{ whiteSpace: "pre-wrap" }}>{aiOut}</p>
      ) : (
        <>
          <p className="pre-card-b">
            Runs the pre-market strategist over the published wire: the call, the forecast, every leg&apos;s reading,
            vote and applied weight, the factor edges and the caveats. It is told not to re-derive or override the
            engine — if the desk says stand aside, it says stand aside.
          </p>
          <div>
            <button className="btn" onClick={askAI} disabled={aiLoading || !snap?.predict}>
              {aiLoading ? "Analysing…" : "Run AI on this call"}
            </button>
          </div>
        </>
      )}
    </div>
  );

  if (tab === "score") {
    return (
      <>
        <CommandBar ticker={ticker} onTicker={() => {}} />
        <main className="container grid">
          <Scorecard />
        </main>
        <StatusBar extra="PRE" />
      </>
    );
  }

  return (
    <>
      <CommandBar ticker={ticker} onTicker={() => {}} />
      <main className="container">
        <div className="pre-shell" style={{ padding: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="pre-seg">
              <button className="on" aria-pressed>● Live desk</button>
              <button onClick={() => setTab("score")} aria-pressed={false}>Accuracy scorecard</button>
            </span>
            <span className="pre-rail-label">
              SCORECARD REBUILDS THE ENGINE ON THE NIFTY 50 SERIES ONLY — IT IS THE FIT FOR THE INDEX MARKED
              `FITTED`, AND NO OTHER INDEX HAS HAD THIS RUN AGAINST IT
            </span>
            {boardBusy && <span className="pre-rail-label" style={{ marginLeft: "auto" }}>BOARD REFRESHING…</span>}
            {logNote && <span className="pre-rail-label" style={{ marginLeft: "auto" }}>{logNote}</span>}
          </div>
        </div>

        <DeskLive
          snap={stale ? null : snap}
          board={board}
          market={market}
          onMarket={pickMarket}
          density="full"
          loading={busy}
          error={err}
          busy={busy}
          onRefresh={() => { load(market); loadBoard(); }}
          onRetry={() => load(market)}
          onLog={logSlot}
          logRows={logRows}
          extraTop={aiBlock}
        />
      </main>
      <StatusBar extra="PRE" />
    </>
  );
}

/* ---------------- scorecard tab ---------------- */

function Scorecard() {
  const [data, setData] = useState<HistoryWire | null>(null);
  const [err, setErr] = useState("");
  const [days, setDays] = useState(800);

  useEffect(() => {
    let alive = true;
    setErr("");
    fetch(`/api/opening/history?days=${days}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "backfill failed");
        if (alive) setData(j);
      })
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [days]);

  return (
    <div className="grid">
      <div className="panel">
        <div className="toolbar">
          <span className="muted" style={{ fontSize: 11.5, marginRight: 8 }}>
            BACKFILL WINDOW — REBUILT SESSION BY SESSION FROM ONLY PRINTS EACH MARKET HAD ALREADY PRODUCED
          </span>
          {[500, 800].map((d) => (
            <button key={d} className={`pill${days === d ? " active" : ""}`} onClick={() => setDays(d)}>{d} DAYS</button>
          ))}
        </div>
      </div>
      {err && (
        <div className="panel">
          <p className="neg" style={{ margin: 0 }}>ERR: {err} <button className="ghost" onClick={() => setDays((x) => x)}>RETRY</button></p>
        </div>
      )}
      {!data && !err && (
        <div className="panel"><p className="muted" style={{ margin: 0 }}>BACKFILLING — ONE DAILY SERIES PER LEG, ~10 REQUESTS…</p></div>
      )}
      {data && <ScorecardPanels h={data} />}
    </div>
  );
}