"use client";

import { useEffect, useMemo, useState } from "react";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { AreaChart } from "@/components/charts";
import { store } from "@/lib/store";
import {
  BreadthPanel, Caveats, Cell, ConfirmBanner, ForecastPanel, LegBuild, MoversTable,
  OpeningSnap, SlotGrid, VerdictBanner, f2, f3, toneClass,
} from "@/components/OpeningDesk";
import { ScorecardPanels } from "@/components/OpeningScorecard";
import type { HistoryWire, NiftyWire } from "@/components/OpeningDesk";

/* ---------------- live tab ---------------- */

function LiveTab({ snap }: { snap: OpeningSnap }) {
  const intra = snap.intraday ?? [];
  const n: NiftyWire = snap.nifty ?? {};

  function logSnapshot() {
    try {
      const raw = window.localStorage.getItem("iss.opening.log");
      const log = raw ? JSON.parse(raw) : [];
      log.push({
        at: snap.fetchedAtIST, slot: snap.currentSlot, phase: snap.phase,
        edge: snap.predict?.edge, verdict: snap.predict?.verdict,
        prob: snap.predict?.probUp, coverage: snap.predict?.coverage,
        regime: snap.predict?.regime, conflict: snap.predict?.conflict,
        nifty: n.last, gap: snap.gap?.gapPct,
      });
      window.localStorage.setItem("iss.opening.log", JSON.stringify(log.slice(-500)));
      alert(`LOGGED ${snap.currentSlot} → ${snap.predict?.verdict ?? "—"} (${log.length} ROWS)`);
    } catch {
      alert("LOG FAILED (QUOTA?)");
    }
  }

  return (
    <div className="grid">
      <VerdictBanner snap={snap} />
      <ForecastPanel snap={snap} />

      <div className="panel">
        <p className="p-head">Overnight tape — the legs that are live before the bell</p>
        <div className="cells">
          <Cell lbl="E-MINI S&P (ES)" val={fmt(snap.predict?.legs.find((l) => l.key === "ES")?.last)} sub={legSub(snap, "ES")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "ES")?.chg)} />
          <Cell lbl="E-MINI NQ (NQ)" val={fmt(snap.predict?.legs.find((l) => l.key === "NQ")?.last)} sub={legSub(snap, "NQ")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "NQ")?.chg)} />
          <Cell lbl="E-MINI DOW (YM)" val={fmt(snap.predict?.legs.find((l) => l.key === "YM")?.last)} sub={legSub(snap, "YM")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "YM")?.chg)} />
          <Cell lbl="NIKKEI 225" val={fmt(snap.predict?.legs.find((l) => l.key === "N225")?.last)} sub={legSub(snap, "N225")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "N225")?.chg)} />
          <Cell lbl="HANG SENG" val={fmt(snap.predict?.legs.find((l) => l.key === "HSI")?.last)} sub={legSub(snap, "HSI")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "HSI")?.chg)} />
          <Cell lbl="STRAITS TIMES" val={fmt(snap.predict?.legs.find((l) => l.key === "STI")?.last)} sub={legSub(snap, "STI")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "STI")?.chg)} />
        </div>
        <div className="cells" style={{ marginTop: 8 }}>
          <Cell lbl="S&P 500 CASH" val={fmt(snap.predict?.legs.find((l) => l.key === "SPX")?.last)} sub={legSub(snap, "SPX")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "SPX")?.chg)} />
          <Cell lbl="NASDAQ CASH" val={fmt(snap.predict?.legs.find((l) => l.key === "NDX")?.last)} sub={legSub(snap, "NDX")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "NDX")?.chg)} />
          <Cell lbl="DOW CASH" val={fmt(snap.predict?.legs.find((l) => l.key === "DJI")?.last)} sub={legSub(snap, "DJI")} cls={toneClass(snap.predict?.legs.find((l) => l.key === "DJI")?.chg)} />
          <Cell lbl="USD/INR" val={fmt(snap.predict?.legs.find((l) => l.key === "USDINR")?.last, 3)} sub={legSub(snap, "USDINR") + " · INVERTED"} cls={toneClass(-(snap.predict?.legs.find((l) => l.key === "USDINR")?.chg ?? 0))} />
        </div>
        <div className="cells" style={{ marginTop: 8 }}>
          <Cell lbl="WTI CRUDE" val={fmt(snap.predict?.legs.find((l) => l.key === "CRUDE")?.last)} sub={legSub(snap, "CRUDE") + " · INVERTED"} cls={toneClass(-(snap.predict?.legs.find((l) => l.key === "CRUDE")?.chg ?? 0))} />
          <Cell lbl="GOLD" val={fmt(snap.predict?.legs.find((l) => l.key === "GOLD")?.last)} sub={legSub(snap, "GOLD") + " · NOT INVERTED"} cls={toneClass(snap.predict?.legs.find((l) => l.key === "GOLD")?.chg)} />
          <Cell lbl="DOLLAR INDEX" val={fmt(snap.predict?.legs.find((l) => l.key === "DXY")?.last)} sub={legSub(snap, "DXY") + " · INVERTED"} cls={toneClass(-(snap.predict?.legs.find((l) => l.key === "DXY")?.chg ?? 0))} />
          <Cell lbl="US 10-YEAR" val={fmt(snap.predict?.legs.find((l) => l.key === "UST10Y")?.last, 3)} sub={legSub(snap, "UST10Y") + " · INVERTED"} cls={toneClass(-(snap.predict?.legs.find((l) => l.key === "UST10Y")?.chg ?? 0))} />
          <Cell lbl="VIX" val={fmt(snap.predict?.legs.find((l) => l.key === "USVIX")?.last, 2)} sub={legSub(snap, "USVIX") + " · INVERTED"} cls={toneClass(-(snap.predict?.legs.find((l) => l.key === "USVIX")?.chg ?? 0))} />
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>
          EACH LEG IS READ ONLY INSIDE ITS OWN MARKET&apos;S TRADING HOURS. The 24H instruments and the three Asian
          indices are read live mid-session; the US cash legs are shut at the bell, so they contribute the last
          completed US session — the freshest US print available at 08:45 IST, not a stale one. The prior-close
          legs are marked PRIOR CLOSE in the leg build so a shut market is never mistaken for a dead feed.
        </p>
      </div>

      <LegBuild score={snap.predict!} />
      <Caveats snap={snap} />
      <ConfirmBanner snap={snap} />

      <div className="panel">
        <p className="p-head">Nifty 50 — OHLC + intraday path</p>
        <div className="cells">
          <Cell lbl="Last" val={fmt(n.last)} sub={f2(n.chg, "%")} cls={toneClass(n.chg)} />
          <Cell lbl="Open" val={fmt(n.open)} sub="TODAY 09:15 IST" />
          <Cell lbl="High" val={fmt(n.high)} sub="DAY" />
          <Cell lbl="Low" val={fmt(n.low)} sub="DAY" />
          <Cell lbl="Range" val={n.range !== null && n.range !== undefined ? n.range.toFixed(2) : "—"} sub="PTS" />
          <Cell lbl="Bars" val={String(intra.length)} sub="15M TODAY" />
        </div>
        {intra.length > 1 ? (
          <div style={{ marginTop: 10 }}>
            <AreaChart values={intra.map((x) => x.close)} dates={intra.map((x) => x.time)} label="NIFTY" height={150} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
              <span>{intra[0].time}</span>
              <span>{intra[Math.floor(intra.length / 2)].time}</span>
              <span>{intra[intra.length - 1].time} IST</span>
            </div>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 11.5, margin: "10px 0 0" }}>
            NO INTRADAY BARS YET — NIFTY OPENS 09:15 IST. GAP AND CONFIRM PANELS STAY DASHED UNTIL THEN.
          </p>
        )}
      </div>

      <BreadthPanel snap={snap} />

      <div className="grid grid-2">
        <MoversTable rows={snap.breadth?.gainers ?? []} side="gainers" />
        <MoversTable rows={snap.breadth?.losers ?? []} side="losers" />
      </div>

      <SlotGrid snap={snap} />
      <LogPanel />
    </div>
  );
}

const fmt = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !isFinite(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: dp });

const legSub = (snap: OpeningSnap, key: string) => {
  const l = snap.predict?.legs.find((x) => x.key === key);
  if (!l) return "—";
  if (l.tail) return "TAIL — REJECTED";
  if (l.chg === null) return "NO TAPE";
  if (l.stale) return `${f2(l.chg, "%")} · STALE ×¼`;
  if (l.priorOnly) return `${f2(l.chg, "%")} · PRIOR CLOSE`;
  if (l.deadbanded) return `${f2(l.chg, "%")} · DEADBAND 0`;
  return f2(l.chg, "%");
};

/* ---------------- logged snapshots ---------------- */

function LogPanel() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("iss.opening.log");
      setRows(raw ? JSON.parse(raw) : []);
    } catch {
      setRows([]);
    }
  }, []);
  const recent = useMemo(() => rows.slice(-14).reverse(), [rows]);
  return (
    <div className="panel">
      <p className="p-head">Captured slots — {rows.length} stored locally</p>
      {!recent.length ? (
        <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
          NO SNAPSHOTS LOGGED YET — USE `LOG SNAPSHOT` IN THE LIVE DESK TO RECORD THE CALL AT EACH SLOT,
          THEN COMPARE THE LOGGED CALLS AGAINST THE REALISED GAP HERE.
        </p>
      ) : (
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th>WHEN</th><th>SLOT</th><th style={{ textAlign: "right" }}>EDGE</th><th>CALL</th><th style={{ textAlign: "right" }}>P(UP)</th><th style={{ textAlign: "right" }}>GAP %</th><th style={{ textAlign: "right" }}>NIFTY</th></tr></thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td className="faint" style={{ fontSize: 11 }}>{r.at ?? "—"}</td>
                  <td>{r.slot ?? "—"}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(r.edge)}>{r.edge === null || r.edge === undefined ? "—" : f2(r.edge, "")}</td>
                  <td><span className={`badge ${r.verdict === "GREEN" ? "ok" : r.verdict === "RED" ? "bad" : "fnc"}`}>{r.verdict ?? "—"}</span></td>
                  <td style={{ textAlign: "right" }}>{r.prob !== null && r.prob !== undefined ? `${(r.prob * 100).toFixed(0)}%` : "—"}</td>
                  <td style={{ textAlign: "right" }} className={toneClass(r.gap)}>{f2(r.gap)}</td>
                  <td style={{ textAlign: "right" }}>{fmt(r.nifty, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- scorecard tab ---------------- */

function ScorecardTab() {
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

/* ---------------- page ---------------- */

export default function OpeningPage() {
  const [tab, setTab] = useState<"live" | "score">("live");
  const [snap, setSnap] = useState<OpeningSnap | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [ticker, setTicker] = useState("RELIANCE.NS");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOut, setAiOut] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/opening");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "snapshot failed");
      setSnap(j);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setTicker(store.getTicker());
  }, []);

  const askAI = async () => {
    if (!snap?.predict) return;
    const p = snap.predict;
    const fc = snap.forecast;
    const legs = p.legs
      .map((l) => `${l.short}=${l.chg === null ? (l.tail ? "TAIL_REJECTED" : "NO_TAPE") : `${l.chg.toFixed(2)}% (vote ${l.vote?.toFixed(2) ?? "—"}, weight ${l.applied.toFixed(3)}${l.stale ? ", stale x1/4" : ""}${l.priorOnly ? ", prior close" : ""})`}`)
      .join(", ");
    const groups = Object.entries(p.groups ?? {})
      .map(([g, e]) => `${g}=${e && e.edge !== null ? e.edge.toFixed(3) : "—"}`)
      .join(", ");
    const facts = [
      `TARGET=${snap.target ?? "—"}`,
      `PHASE=${snap.phase ?? "—"}`,
      `CALL=${p.verdict} EDGE=${p.edge ?? "—"} CONF=${p.confidence} COVERAGE=${p.coverage} STALE_SHARE=${p.staleShare} LEGS=${p.legsUsed}/${p.legCount}`,
      `REGIME=${p.regime ?? "—"} BAND=${p.band ?? "—"} GATE=±${p.gate ?? "0.25"}% FORECAST CONFLICT=${p.conflict ? "YES" : "NO"}`,
      fc ? `FORECAST_GAP=${fc.expectedGapPct ?? "—"}% (${fc.expectedGapPts ?? "—"} PTS) P_UP=${fc.probUp} P_DIRECTIONAL=${fc.probDirectional}` : "FORECAST: UNAVAILABLE",
      fc ? `FORECAST_MODEL: GAP = ${fc.interceptPct} + ${fc.slopePctPerEdge} x EDGE, RESIDUAL_SD=${fc.residualSdPct}%` : "",
      snap.model ? `MODEL_VALIDATION: ${snap.model.sessions} SESSIONS (${snap.model.sample}), OOS SIGN AGREE ${snap.model.oosSignAgreement}% VS ${snap.model.oosBenchmark}% BENCHMARK, SPREAD ${snap.model.oosSpreadPct}%` : "",
      `INDIA_VIX=${snap.vix?.last ?? "—"} (${snap.vix?.chg !== null && snap.vix?.chg !== undefined ? `${snap.vix.chg.toFixed(2)}%` : "—"})`,
      `NIFTY_OPEN_GAP=${snap.gap?.gapPct !== null && snap.gap?.gapPct !== undefined ? `${snap.gap.gapPct.toFixed(2)}%` : "NOT_OPENED"}`,
      snap.confirm?.forecastErrPct !== null && snap.confirm?.forecastErrPct !== undefined ? `FORECAST_ERROR=${snap.confirm.forecastErrPct.toFixed(2)}% (${snap.confirm.forecastErrPts} PTS)` : "",
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

  return (
    <>
      <CommandBar ticker={ticker} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <button className={`pill${tab === "live" ? " active" : ""}`} onClick={() => setTab("live")}>● LIVE DESK</button>
            <button className={`pill${tab === "score" ? " active" : ""}`} onClick={() => setTab("score")}>ACCURACY SCORECARD</button>
            <button className="ghost" style={{ marginLeft: "auto" }} onClick={load} disabled={loading}>
              {loading ? "LOADING…" : "↻ REFRESH"}
            </button>
          </div>
          {err && (
            <p className="neg" style={{ marginTop: 8 }}>
              ERR: {err} <button className="ghost" onClick={load}>RETRY</button>
            </p>
          )}
        </div>
        {tab === "live" && (snap ? <LiveTab snap={snap} /> : !err && (
          <div className="panel"><p className="muted" style={{ margin: 0 }}>PULLING OVERNIGHT TAPE + ASIA OPEN…</p></div>
        ))}
        {tab === "score" && <ScorecardTab />}
        {aiOut && (
          <div className="panel">
            <p className="p-head">AI analyst</p>
            <p style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{aiOut}</p>
          </div>
        )}
        {snap && !aiOut && (
          <div className="panel">
            <button className="btn" onClick={askAI} disabled={aiLoading || !snap.predict}>
              {aiLoading ? "ANALYSING…" : "RUN AI ON THIS CALL"}
            </button>
          </div>
        )}
      </main>
      <StatusBar extra="PRE" />
    </>
  );
}
