"use client";

// Pairs / stat-arb terminal — functions PR (27) and ARB (48).
//
// This replaces a single-pair, returns-OLS toy. The anatomy follows the rest of
// the terminal: cells strip -> p-head panels -> verdict banner -> faint unit
// footnotes. Every panel has loading / empty / error + retry. The radar and the
// walk-forward book load in parallel and fail open with a named reason.
//
// THE ONE IDEA THE DESK HAS TO GET RIGHT: every number carries the side of the
// formation/OOS split it came from. A formation-window p-value is not a result,
// it is an input; an out-of-sample Sharpe is the only performance figure on this
// screen. Panels are labelled IN-SAMPLE or OUT-OF-SAMPLE accordingly and the
// static-baseline comparison is always shown next to the adaptive one, because
// "is the adaptive machinery worth it" is the actual question a trader asks.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { BarChart, LineChart } from "@/components/charts";
import { funcCode } from "@/lib/terminal";
import { store } from "@/lib/store";
import { useDeskFetch } from "@/lib/useDeskFetch";
import { LegInput } from "@/components/QuantDesks";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { downloadCSV } from "@/components/ModuleDesks";
import type { PairDetail, PairRow, SignalRow } from "@/lib/pairsResearch";
import type { PerfStats } from "@/lib/pairs";

const ID = "27";
const DASH = "—";

// ------------------------------------------------------------------ formats

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function num(v: number | null | undefined, d = 2): string {
  return isNum(v) ? v.toFixed(d) : DASH;
}

function pct(v: number | null | undefined, d = 1): string {
  return isNum(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}%` : DASH;
}

function tone(v: number | null | undefined): string {
  if (!isNum(v) || v === 0) return "";
  return v > 0 ? "pos" : "neg";
}

function inr(v: number | null | undefined): string {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${a.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** Infinity half-life is a real answer (it never reverts), not a missing value. */
function hl(v: number | null | undefined): string {
  if (v === Infinity) return "NEVER";
  if (!isNum(v)) return DASH;
  return `${v.toFixed(1)}d`;
}

const STAGE_TONE: Record<string, string> = {
  TRIGGERED: "var(--green)",
  "ON DECK": "var(--amber)",
  FLOATING: "var(--sub)",
  "EXIT ZONE": "var(--faint)",
  "BEYOND STOP": "var(--red)",
};

/**
 * Shown before the first scan answers, so the rail is never an empty strip.
 * Mirrors PAIR_SECTORS — when the payload arrives its own list wins, and the
 * dedupe keeps a key from appearing twice.
 */
const SECTOR_FALLBACK = ["Banks", "IT", "Auto", "Pharma", "FMCG", "Metals", "Energy", "Finance", "Defence"];

// Spread decision levels, shared by the thermometer and the copy describing it
// so the drawn threshold and the stated threshold can never drift apart.
const ENTRY_Z = 2;
const STOP_Z = 3.2;
/** Mirrors P.JUMP_PCT — a one-bar move at or beyond this is flagged, not traded. */
const P_JUMP_PCT = 30;
/** Mirrors P.ROLLING_OLS_WIN — the window the rolling hedge comparison uses. */
const P_ROLLING_WIN = 60;

// -------------------------------------------------------------------- hooks

type Leg<T> = import("@/lib/useDeskFetch").Leg<T>;

// -------------------------------------------------------------- primitives

function Head({ right }: { right?: string }) {
  return (
    <div className="panel panel-glow">
      <p className="p-head">
        {ID} · {funcCode(ID)} &lt;GO&gt;
        {right ? <span className="faint"> — {right}</span> : null}
      </p>
      <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0 0" }}>
        PAIRS SELECTED ON A FORMATION WINDOW · TRADED OUT-OF-SAMPLE · FROZEN HEDGE · COSTS + STOP + TIME-STOP +
        COOLDOWN · BH-FDR ACROSS THE UNIVERSE
      </p>
    </div>
  );
}

function Pills<T extends string>({ opts, val, set }: { opts: readonly T[]; val: T; set: (v: T) => void }) {
  return (
    <div className="pills">
      {opts.map((o) => (
        <button key={o} className={`pill${o === val ? " active" : ""}`} onClick={() => set(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Cells({ items }: { items: Array<{ l: string; v: string; s?: string; c?: string }> }) {
  return (
    <div className="cells">
      {items.map((c) => (
        <div className="cell" key={c.l}>
          <div className="lbl">{c.l}</div>
          <div className={`val ${c.c ?? ""}`} style={{ fontSize: 15 }}>
            {c.v}
          </div>
          {c.s ? <div className="sub">{c.s}</div> : null}
        </div>
      ))}
    </div>
  );
}

function LegBar({ err, loading, retry, hint = "WORKING" }: { err?: string; loading?: boolean; retry?: () => void; hint?: string }) {
  if (err) {
    return (
      <p className="neg" style={{ fontSize: 12.5 }}>
        {err}{" "}
        {retry ? (
          <button className="ghost" onClick={retry}>
            ↻ RETRY
          </button>
        ) : null}
      </p>
    );
  }
  if (loading) return <span className="muted" style={{ fontSize: 12 }}>{hint}…</span>;
  return null;
}

function Foot({ children }: { children: React.ReactNode }) {
  return (
    <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.6, margin: "10px 0 0 0" }}>
      {children}
    </p>
  );
}

/** Small stateful AI runner; output is cleared whenever the prompt changes. */
function AIRun({ prompt, label }: { prompt: string; label: string }) {
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setOut(""), [prompt]);
  async function run() {
    if (!prompt) return;
    setBusy(true);
    setOut("");
    try {
      setOut(
        await chatComplete(
          [
            { role: "system", content: aiSystem.pairs() },
            { role: "user", content: `${prompt} ${NO_INVENT}` },
          ],
          { apiKey: store.getORKey(), model: store.getORModel() }
        )
      );
    } catch (e) {
      setOut(`AI ERR: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="toolbar">
        <button className="btn" onClick={run} disabled={busy || !prompt}>
          {busy ? "RUNNING…" : label}
        </button>
        {!prompt && <span className="faint" style={{ fontSize: 11 }}>LOAD THE RADAR FIRST</span>}
      </div>
      {out && <pre className="ai" style={{ marginTop: 8 }}>{out}</pre>}
    </div>
  );
}

function StatsTable({ label, s, note }: { label: string; s: PerfStats | null; note?: string }) {
  if (!s) return null;
  return (
    <div>
      <div className="kv"><span className="muted">{label}</span><strong style={{ fontSize: 11.5 }}>{note ?? "NET OF COSTS"}</strong></div>
      <div className="kv"><span className="muted">Return</span><strong className={tone(s.ReturnPct)}>{pct(s.ReturnPct)}</strong></div>
      <div className="kv"><span className="muted">CAGR</span><strong className={tone(s.CAGRpct)}>{pct(s.CAGRpct)}</strong></div>
      <div className="kv"><span className="muted">Sharpe</span><strong className={tone(s.Sharpe)}>{num(s.Sharpe)}</strong></div>
      <div className="kv"><span className="muted">Sortino</span><strong className={tone(s.Sortino)}>{num(s.Sortino)}</strong></div>
      <div className="kv"><span className="muted">Max DD</span><strong className="neg">{pct(s.MaxDDpct)}</strong></div>
      <div className="kv"><span className="muted">Trades</span><strong>{s.Trades || DASH}</strong></div>
      <div className="kv"><span className="muted">Win rate</span><strong>{isNum(s.WinRatePct) ? `${s.WinRatePct.toFixed(0)}%` : DASH}</strong></div>
      <div className="kv"><span className="muted">Profit factor</span><strong>{isNum(s.ProfitFactor) ? num(s.ProfitFactor) : DASH}</strong></div>
      <div className="kv"><span className="muted">Avg hold</span><strong>{isNum(s.AvgHold) ? `${s.AvgHold.toFixed(1)} bars` : DASH}</strong></div>
    </div>
  );
}

// ------------------------------------------------------------------ payload

interface RadarPayload {
  sector: string;
  sectors: string[];
  /** True when this payload came from the 60s server-side scan cache. */
  cached?: boolean;
  params: {
    FORMATION_FRAC: number;
    TRAIN_WINDOW: number;
    TEST_STEP: number;
    STOP_Z: number;
    ENTRY_Z: number;
    EXIT_Z: number;
    ON_DECK_FRAC: number;
    COST_BPS_PER_SIDE: number;
    FDR_ALPHA: number;
    HL_MIN: number;
    HL_MAX: number;
    MIN_OBS: number;
    TOTAL_CAPITAL: number;
    CAPITAL_PER_LEG: number;
    RISK_PER_TRADE_PCT: number;
    MAX_CONCURRENT: number;
    KALMAN_DELTA: number;
  };
  formationDate: string;
  selected: string[];
  relaxed: boolean;
  notes: string[];
  dropped: Array<{ pair: string; bars: number }>;
  failedSymbols: Array<{ symbol: string; why: string }>;
  pairsTested: number;
  symbolsRequested: number;
  symbolsRead: number;
  rows: PairRow[];
  signals: SignalRow[];
  actionable: SignalRow[];
  onDeck: SignalRow[];
  /**
   * The same signals partitioned by DECISION rather than by data shape.
   * `rejected` is the bucket that matters: pairs past the entry threshold that a
   * filter still refused — the trades a z-score-only model would have taken.
   */
  board: {
    passed: SignalRow[];
    rejected: SignalRow[];
    onDeck: SignalRow[];
    stretched: SignalRow[];
  };
  /** Data-integrity scan: what could not be read, and what looked wrong. */
  quality: {
    symbolsRequested: number;
    symbolsRead: number;
    failedSymbols: Array<{ symbol: string; why: string }>;
    droppedPairs: Array<{ pair: string; why: string }>;
    jumps: Array<{ symbol: string; date: string; pct: number; pairs: string[] }>;
    lastBar: string | null;
    barRange: [number, number] | null;
  };
  overlaps: Array<{ symbol: string; signals: number }>;
  portfolio: {
    dates: string[];
    ret: number[];
    active: number[];
    stats: PerfStats;
    ci: [number, number];
    probNegative: number;
    stress: Array<{ delay: number; cost: number; stats: PerfStats }>;
    tradeCount: number;
  } | null;
  walkParams: Array<{ pair: string; lookback: number; entry: number; exit: number; timeStop: number; halfLife: number; trainSharpe: number }>;
  /** Whether today's session is folded into the series, and whether it is still open. */
  live: {
    applied: boolean;
    sessionDate: string | null;
    partial: boolean;
    symbolsUpdated: number;
    symbolsRewritten: number;
    symbolsTotal: number;
    noTickLegs: number;
    note: string;
  };
}

// ==================================================================== radar

function RadarPanel() {
  const [sector, setSector] = useState("ALL");
  const { data, err, loading, reload } = useDeskFetch<RadarPayload>(`/api/pairs/radar?sector=${encodeURIComponent(sector)}`);
  const [picked, setPicked] = useState<string | null>(null);

  const p = data?.params;
  const confirmed = data?.rows.filter((r) => r.status === "CONFIRMED").length ?? 0;
  const probable = data?.rows.filter((r) => r.status === "PROBABLE").length ?? 0;

  const prompt = useMemo(() => {
    if (!data) return "";
    const top = data.signals
      .slice(0, 10)
      .map((s) => `${s.pair} Z=${s.z.toFixed(2)} ${s.stage} ${s.action} CONV=${s.conviction}`);
    return [
      `UNIVERSE ${data.sector}: ${data.rows.length} PAIR(S) SCREENED, ${data.symbolsRead}/${data.symbolsRequested} SYMBOLS READ.`,
      `SESSION: ${data.live.note}`,
      `FORMATION WINDOW ENDS ${data.formationDate}; EVERYTHING AFTER IT IS OUT-OF-SAMPLE.`,
      `CONFIRMED ${confirmed}, PROBABLE ${probable}, SELECTED FOR THE BASKET ${data.selected.length}${data.relaxed ? " (RELAXED FALLBACK)" : ""}.`,
      data.portfolio
        ? `BASKET OUT-OF-SAMPLE: RETURN ${pct(data.portfolio.stats.ReturnPct)}, SHARPE ${num(data.portfolio.stats.Sharpe)}, MAXDD ${pct(data.portfolio.stats.MaxDDpct)}, ${data.portfolio.tradeCount} TRADES, BOOTSTRAP SHARPE 90% CI [${num(data.portfolio.ci[0])}, ${num(data.portfolio.ci[1])}], P(Sharpe<=0) ${num(data.portfolio.probNegative, 0)}%.`
        : "BASKET EMPTY.",
      `LIVE SIGNALS: ${top.join(" | ")}.`,
      `COSTS ${p?.COST_BPS_PER_SIDE} BPS/SIDE, ENTRY |Z|>=${p?.ENTRY_Z}, STOP |Z|>=${p?.STOP_Z}, EXIT |Z|<=${p?.EXIT_Z}.`,
    ].join(" ");
  }, [data, confirmed, probable, p]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">PAIR UNIVERSE</p>
        <Pills opts={["ALL", ...SECTOR_FALLBACK, ...(data?.sectors ?? []).filter((s) => !SECTOR_FALLBACK.includes(s))]} val={sector} set={setSector} />
        <div style={{ marginTop: 8 }}>
          <LegBar err={err} loading={loading} retry={reload} hint="SCREENING UNIVERSE · ADF + FDR · WALK-FORWARD" />
        </div>
        {data && (
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0 0" }}>
            {data.pairsTested} PAIR(S) · {data.symbolsRead}/{data.symbolsRequested} SYMBOLS READ · FORMATION WINDOW
            ENDS {data.formationDate || DASH}
            {data.cached ? " · CACHED SCAN (UNDER 60s OLD — SELECTION CANNOT HAVE MOVED)" : ""}
            {data.dropped.length ? ` · ${data.dropped.length} DROPPED FOR SHORT HISTORY` : ""}
            {data.failedSymbols.length ? ` · ${data.failedSymbols.length} SYMBOL(S) FAILED TO LOAD` : ""}
          </p>
        )}
      </div>

      {data?.notes.map((n) => (
        <p key={n} className="warn" style={{ fontSize: 11.5, margin: 0 }}>{n}</p>
      ))}

      {data && (
        <>
          {/* Data integrity goes first, above every statistic below it. A spread
              built across an unhealed split or demerger looks superbly
              cointegrated, so this is the panel that decides how much of the rest
              of the screen to believe. */}
          <QualityPanel q={data.quality} />

          <Cells
            items={[
              { l: "Screened", v: String(data.rows.length), s: "PAIRS" },
              { l: "Confirmed", v: String(confirmed), s: "Q<=0.10 IN BOTH WINDOWS", c: confirmed ? "pos" : "" },
              { l: "Decayed", v: String(probable), s: "PASSED, RELATION WEAKENED", c: probable ? "neg" : "" },
              { l: "In basket", v: String(data.selected.length), s: data.relaxed ? "RELAXED FALLBACK" : "PASSED ALL GATES", c: data.relaxed ? "neg" : "pos" },
              { l: "Actionable", v: String(data.actionable.length), s: "PASS EVERY GATE", c: data.actionable.length ? "pos" : "" },
              { l: "On deck", v: String(data.onDeck.length), s: `${(p?.ON_DECK_FRAC ?? 0) * 100}% OF ENTRY` },
            ]}
          />

          {/* Session state. Without this the desk silently reads one day stale,
              which is the single most misleading thing a live screen can do. */}
          <div
            className={data.live.partial ? "panel panel-glow" : "panel"}
            style={{ padding: "8px 12px" }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="p-head" style={{ margin: 0 }}>
                SESSION
              </span>
              <strong style={{ color: data.live.partial ? "var(--amber)" : "var(--green)" }}>
                {data.live.partial ? "OPEN — LIVE" : data.live.applied ? "CLOSED — SETTLED" : "PRE-OPEN"}
              </strong>
              <span className="muted" style={{ fontSize: 11.5 }}>
                LAST BAR {data.live.sessionDate || DASH} · {data.live.symbolsUpdated}/{data.live.symbolsTotal}{" "}
                LEGS ON THAT SESSION
                {data.live.symbolsRewritten
                  ? ` · ${data.live.symbolsRewritten} WRITTEN IN FROM THE LIVE TAPE`
                  : ""}
                {data.live.noTickLegs ? ` · ${data.live.noTickLegs} WITHOUT A LAST-PRICE STAMP` : ""}
              </span>
              <span className="faint" style={{ fontSize: 10.5, marginLeft: "auto" }}>
                {data.live.partial ? "FIGURES WILL MOVE UNTIL THE CLOSE" : "FINAL FOR THE SESSION"}
              </span>
            </div>
            <p className="faint" style={{ fontSize: 10.5, margin: "5px 0 0" }}>
              {data.live.note}
            </p>
          </div>

          {/* Partitioned decisions replace the flat signal dump as the primary
              surface: the actionable list alone cannot answer "what did the
              filters refuse?", which is the question that matters. */}
          <DecisionBoard board={data.board} p={p} />

          {!!data.actionable.length && (
            <div className="panel">
              <p className="p-head">Actionable — every gate passed</p>
              <div className="scrollx">
                <table className="plain">
                  <thead>
                    <tr>
                      <th>Pair</th><th>Status</th><th>Action</th>
                      <th style={{ textAlign: "right" }}>Z</th><th style={{ textAlign: "right" }}>HL</th>
                      <th style={{ textAlign: "right" }}>OOS Sharpe</th><th style={{ textAlign: "right" }}>Conv</th>
                      <th style={{ textAlign: "right" }}>Depth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.actionable.map((s) => (
                      <tr key={s.pair}>
                        <td>{s.pair}</td>
                        <td className={s.status === "CONFIRMED" ? "pos" : ""}>{s.status}</td>
                        <td>{s.action}</td>
                        <td style={{ textAlign: "right" }} className={Math.abs(s.z) > 2 ? "neg" : ""}>{s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}</td>
                        <td style={{ textAlign: "right" }}>{hl(s.halfLife)}</td>
                        <td style={{ textAlign: "right" }} className={tone(s.oosSharpe)}>{num(s.oosSharpe)}</td>
                        <td style={{ textAlign: "right" }}><strong>{s.conviction}</strong></td>
                        <td style={{ textAlign: "right" }}>
                          <button className="ghost" onClick={() => setPicked(`${s.a}|${s.b}`)}>DEEP DIVE</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!data.overlaps.length && (
                <p className="warn" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
                  OVERLAP — {data.overlaps.map((o) => `${o.symbol} (${o.signals})`).join(", ")} APPEARS IN MORE THAN
                  ONE LIVE SIGNAL. THOSE TRADES ARE PARTLY THE SAME BET: SIZE THEM AS ONE, NOT TWO.
                </p>
              )}
              {data.actionable[0]?.ticket && <TicketPanel t={data.actionable[0].ticket} p={p} pair={data.actionable[0].pair} />}
            </div>
          )}

          <div className="panel">
            <p className="p-head">Deviation thermometer — live Z across the universe</p>
            <Thermometer signals={data.signals} />
            <Foot>
              BARS ARE THE SPREAD Z-SCORE, NOT A TRADE. EACH BAR GROWS OUTWARD FROM THE MEAN: RIGHT WHEN LEG A HAS
              DRIFTED RICH AGAINST LEG B, LEFT WHEN IT HAS DRIFTED CHEAP. THE SHADED BANDS BEYOND ±{ENTRY_Z} ARE THE
              ENTRY ZONES AND ±{STOP_Z} IS THE STOP LINE — INSIDE THE SHADED BAND THE SPREAD IS STRETCHED, OUTSIDE IT
              IS MERELY WIDE. THE "TIERS" COLUMN IS THE CONVICTION SCORE (0-100), A RANKING DEVICE ONLY — NOT A
              PROBABILITY AND NOT A P-SIZE.
            </Foot>
          </div>

          {data.portfolio && <PortfolioPanel pf={data.portfolio} dates={data.portfolio.dates} />}
          <OosRankingPanel data={data} />
          <SelectionPanel data={data} />

          <div className="panel">
            <p className="p-head">Live signals — all pairs, every gate outcome</p>
            <div className="scrollx">
              <table className="plain">
                <thead>
                  <tr>
                    <th>Pair</th><th>Stage</th><th>Momentum</th>
                    <th style={{ textAlign: "right" }}>Z</th>
                    <th style={{ textAlign: "right" }}>A px</th><th style={{ textAlign: "right" }}>Trig A</th><th style={{ textAlign: "right" }}>Move A</th>
                    <th style={{ textAlign: "right" }}>B px</th><th style={{ textAlign: "right" }}>Trig B</th><th style={{ textAlign: "right" }}>Move B</th>
                    <th style={{ textAlign: "right" }}>β</th><th style={{ textAlign: "right" }}>HL</th><th style={{ textAlign: "right" }}>Hurst</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {data.signals.slice(0, 60).map((s) => (
                    <tr key={s.pair} className={picked === `${s.a}|${s.b}` ? "active" : ""}>
                      <td>
                        <button className="ghost" style={{ padding: "2px 6px", fontSize: 11 }} onClick={() => setPicked(`${s.a}|${s.b}`)}>
                          {s.pair}
                        </button>
                      </td>
                      <td style={{ color: STAGE_TONE[s.stage] }}>{s.stage}</td>
                      <td className={s.momentum === "APPROACHING" ? "neg" : s.momentum === "COOLING" ? "pos" : ""}>{s.momentum}</td>
                      <td style={{ textAlign: "right" }} className={Math.abs(s.z) > p?.STOP_Z! ? "neg" : ""}>
                        {s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}
                      </td>
                      <td style={{ textAlign: "right" }}>{s.priceA.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }}>{s.trigA.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }} className={tone(s.moveAPct)}>{pct(s.moveAPct, 2)}</td>
                      <td style={{ textAlign: "right" }}>{s.priceB.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }}>{s.trigB.toFixed(1)}</td>
                      <td style={{ textAlign: "right" }} className={tone(s.moveBPct)}>{pct(s.moveBPct, 2)}</td>
                      <td style={{ textAlign: "right" }}>{num(s.beta)}</td>
                      <td style={{ textAlign: "right" }}>{hl(s.halfLife)}</td>
                      <td style={{ textAlign: "right" }}>{num(s.hurst)}</td>
                      <td style={{ textAlign: "left" }} className="warn">{[...s.hard, ...s.soft].join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Foot>
              TRIG_A IS THE PRICE OF A THAT TRIGGERS ENTRY WITH B UNCHANGED; TRIG_B IS THE SAME FOR B. MOVE IS THE
              SIGNED DISTANCE STILL TO TRAVEL. HURST IS THE R/S EXPONENT AND IS A DIAGNOSTIC ONLY — ON A
              STATIONARY RESIDUAL IT READS NEAR 1 EVEN FOR A FAST-REVERTING SPREAD, SO IT IS NOT USED AS A GATE.
              THE GATE IS THE HALF-LIFE.
            </Foot>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button
                className="ghost"
                onClick={() =>
                  downloadCSV(
                    `pairs_signals_${data.sector}_${data.formationDate}`,
                    ["PAIR", "STATUS", "Z", "STAGE", "MOMENTUM", "ACTION", "PRICE_A", "TRIG_A", "MOVE_A_PCT", "PRICE_B", "TRIG_B", "MOVE_B_PCT", "BETA", "HALFLIFE", "HURST", "OOS_SHARPE", "CONVICTION", "FLAGS"],
                    data.signals.map((s) => [s.pair, s.status, s.z.toFixed(3), s.stage, s.momentum, s.action, s.priceA, s.trigA, s.moveAPct.toFixed(2), s.priceB, s.trigB, s.moveBPct.toFixed(2), s.beta, isNum(s.halfLife) ? s.halfLife.toFixed(1) : "INF", s.hurst, s.oosSharpe, s.conviction, [...s.hard, ...s.soft].join(" ")])
                  )
                }
              >
                EXPORT SIGNALS CSV
              </button>
            </div>
          </div>

          <div className="panel">
            <p className="p-head">AI read — universe</p>
            <AIRun prompt={prompt} label="RUN AI ON THE BOOK" />
          </div>
        </>
      )}

      {picked && <DeepDivePanel key={picked} a={picked.split("|")[0]} b={picked.split("|")[1]} onClose={() => setPicked(null)} />}
    </div>
  );
}

function TicketPanel({ t, p, pair }: { t: NonNullable<SignalRow["ticket"]>; p: RadarPayload["params"] | undefined; pair: string }) {
  return (
    <div className="panel" style={{ marginTop: 10, borderColor: "var(--amber-line-hard)" }}>
      <p className="p-head">Order ticket — {pair} · highest conviction</p>
      <div className="cells">
        <div className="cell"><div className="lbl">Leg A</div><div className="val" style={{ fontSize: 14 }}>{t.legAVerb} {t.qtyA}</div><div className="sub">{inr(t.notionalA)}</div></div>
        <div className="cell"><div className="lbl">Leg B</div><div className="val" style={{ fontSize: 14 }}>{t.legBVerb} {t.qtyB}</div><div className="sub">{inr(t.notionalB)}</div></div>
        <div className="cell"><div className="lbl">Gross</div><div className="val" style={{ fontSize: 15 }}>{inr(t.gross)}</div><div className="sub">BOTH LEGS</div></div>
        <div className="cell"><div className="lbl">At target</div><div className="val pos" style={{ fontSize: 15 }}>{inr(t.profitTarget)}</div><div className="sub">Z BACK TO EXIT</div></div>
        <div className="cell"><div className="lbl">At stop</div><div className="val neg" style={{ fontSize: 15 }}>{inr(t.lossStop)}</div><div className="sub">|Z| {p?.STOP_Z}</div></div>
        <div className="cell"><div className="lbl">R:R</div><div className="val" style={{ fontSize: 15 }}>{num(t.rewardRisk)}</div><div className="sub">{t.timeStop}-BAR TIME-STOP</div></div>
      </div>
      <Foot>
        SIZED TO RISK {p?.RISK_PER_TRADE_PCT ?? "—"}% OF {inr(p?.TOTAL_CAPITAL ?? NaN)} IF THE STOP IS HIT, CAPPED AT{" "}
        {inr(p?.CAPITAL_PER_LEG ?? NaN)} ON LEG A. ESTIMATED COSTS {inr(t.costs)} AT {p?.COST_BPS_PER_SIDE} BPS/SIDE —
        ALREADY INSIDE THE BACKTEST, SHOWN HERE SO THE TICKET IS NOT READ AS GROSS. {t.note}
      </Foot>
    </div>
  );
}

/**
 * Diverging z-score strip.
 *
 * Built as a DOM grid rather than a stretched SVG on purpose. The chart
 * components use `preserveAspectRatio="none"`, which is right for a line series
 * (the geometry is abstract) but wrong here: it scales the 9px tick text along
 * with the bars, so on a full-width panel the labels inflate to ~20px, collide
 * with the bars, and the negative value labels land on top of the fills. Real
 * text in a fixed column cannot do any of that, and it stays legible at any
 * panel width.
 *
 * Scale is centred on the spread mean: bars grow outward from zero, the ±2 entry
 * bands are shaded, and ±3.2 (the stop line) is drawn as a hard tick.
 */
function Thermometer({ signals }: { signals: SignalRow[] }) {
  const rows = signals.slice(0, 28);
  if (!rows.length) return <p className="muted">NO PAIR PRODUCED A USABLE SPREAD MODEL.</p>;
  const TICK = ENTRY_Z;
  const STOP = STOP_Z;
  // Round the domain out to a clean 0.5 so the axis ticks land on round numbers
  // and two panels side by side share a scale.
  //
  // The domain is floored at the STOP line on purpose. The entry and stop
  // thresholds are this desk's actual decision levels, so the axis has to show
  // them whatever the data does — and without the floor, a quiet universe
  // (domain 3.0 vs a stop at 3.2) pushes the band edges past the track and the
  // shading gradient inverts, flooding the whole row.
  const peak = Math.max(STOP, ...rows.map((s) => Math.abs(s.z)));
  const domain = Math.ceil(peak * 1.1 * 2) / 2;
  // Position of a z on the track, as a % of total width from the left edge.
  const posOf = (z: number) => 50 + (z / domain) * 50;
  // Bands run from the stop line in to the entry line, on each side.
  const negEdge = posOf(-STOP);
  const negEntry = posOf(-TICK);
  const posEntry = posOf(TICK);
  const posEdge = posOf(STOP);
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {/* axis legend — the same ticks that are drawn on every track */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "186px 1fr 64px 58px",
          gap: 8,
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--sub)",
          textTransform: "uppercase",
          marginBottom: 2,
        }}
      >
        <span>SPREAD</span>
        <div style={{ position: "relative", height: 12 }}>
          {[STOP, TICK, 0, -TICK, -STOP].map((z) => (
            <span
              key={z}
              style={{
                position: "absolute",
                // Ticks sit exactly on the track edge when the domain equals the
                // stop line, so pull the outermost labels inward to stay legible.
                left: `${posOf(z)}%`,
                transform:
                  z === STOP
                    ? "translateX(-95%)"
                    : z === -STOP
                      ? "translateX(-5%)"
                      : "translateX(-50%)",
                whiteSpace: "nowrap",
              }}
            >
              {z > 0 ? `+${z}` : z}
            </span>
          ))}
        </div>
        <span style={{ textAlign: "right" }}>Z</span>
        <span style={{ textAlign: "right" }}>TIERS</span>
      </div>

      {rows.map((s) => {
        // Severity is a function of |z|, never of the sign. Testing `z >= TICK`
        // on its own leaves every negative z permanently grey, so a pair short at
        // -3.1 — past the stop line — renders as calmer than one long at +2.1.
        const mag = Math.abs(s.z);
        const c =
          mag >= STOP ? "var(--red)" : mag >= TICK ? "var(--green)" : mag >= 1.25 ? "var(--amber)" : "var(--sub)";
        const z = Math.max(-domain, Math.min(domain, s.z));
        const end = posOf(z);
        const left = Math.min(50, end);
        const width = Math.abs(end - 50);
        return (
          <div
            key={s.pair}
            style={{
              display: "grid",
              gridTemplateColumns: "186px 1fr 64px 58px",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <span
              title={s.pair}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {s.pair}
            </span>
            <div
              style={{
                position: "relative",
                height: 13,
                background: "var(--track)",
                borderRadius: 2,
                overflow: "hidden",
              }}
              title={`Z ${s.z.toFixed(2)} — PREVIOUS ${s.zPrev.toFixed(2)}`}
            >
              {/* entry zones: beyond ±ENTRY the spread is tradeable, out to the stop */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(to right,
                    color-mix(in srgb, var(--green) 14%, transparent) 0% ${negEdge}%,
                    color-mix(in srgb, var(--red) 14%, transparent) ${negEdge}% ${negEntry}%,
                    transparent ${negEntry}% ${posEntry}%,
                    color-mix(in srgb, var(--green) 14%, transparent) ${posEntry}% ${posEdge}%,
                    transparent ${posEdge}% 100%)`,
                }}
              />
              {/* mean */}
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--grid)" }} />
              {/* entry ticks */}
              {[TICK, -TICK].map((t) => (
                <div
                  key={t}
                  style={{
                    position: "absolute",
                    left: `${posOf(t)}%`,
                    top: 0,
                    bottom: 0,
                    width: 1,
                    background: "var(--sub)",
                    opacity: 0.6,
                  }}
                />
              ))}
              {/* the bar itself, growing outward from the mean */}
              <div
                style={{
                  position: "absolute",
                  left: `${left}%`,
                  width: `${width}%`,
                  top: 2,
                  bottom: 2,
                  background: c,
                  borderRadius: 1,
                }}
              />
            </div>
            <strong style={{ textAlign: "right", color: c, fontVariantNumeric: "tabular-nums" }}>
              {s.z.toFixed(2)}
            </strong>
            <span className="muted" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {s.conviction}
            </span>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
        TOP {rows.length} OF {signals.length} SHOWN, WIDEST ABSOLUTE Z FIRST. THE AXIS IS SHARED BY EVERY ROW, SO BAR
        LENGTHS ARE COMPARABLE DOWN THE COLUMN.
      </p>
    </div>
  );
}

function PortfolioPanel({ pf, dates }: { pf: NonNullable<RadarPayload["portfolio"]>; dates: string[] }) {
  const eq = useMemo(() => {
    let v = 1;
    return pf.ret.map((r) => (v *= 1 + r));
  }, [pf.ret]);
  const monthly = useMemo(() => {
    const m = new Map<string, number>();
    pf.ret.forEach((r, i) => {
      const d = dates[i] ?? "";
      const key = d.slice(0, 7);
      if (!key) return;
      m.set(key, (m.get(key) ?? 1) * (1 + r));
    });
    return [...m.entries()].map(([k, v]) => [k, (v - 1) * 100] as [string, number]);
  }, [pf.ret, dates]);
  const activeDays = pf.active.filter((a) => a > 0).length;
  return (
    <div className="grid" style={{ gap: 10 }}>
      <div className="panel">
        <p className="p-head">Out-of-sample basket — pairs selected on the formation window only</p>
        <Cells
          items={[
            { l: "Return", v: pct(pf.stats.ReturnPct), s: "NET OF COSTS", c: tone(pf.stats.ReturnPct) },
            { l: "CAGR", v: pct(pf.stats.CAGRpct), s: "OUT-OF-SAMPLE", c: tone(pf.stats.CAGRpct) },
            { l: "Sharpe", v: num(pf.stats.Sharpe), s: `CI [${num(pf.ci[0])}, ${num(pf.ci[1])}]`, c: tone(pf.stats.Sharpe) },
            { l: "Max DD", v: pct(pf.stats.MaxDDpct), s: "PEAK-TROUGH", c: "neg" },
            { l: "Trades", v: String(pf.tradeCount), s: `${pf.stats.AvgHold ? pf.stats.AvgHold.toFixed(0) : "—"} BARS AVG` },
            { l: "P(Sharpe≤0)", v: isNum(pf.probNegative) ? `${pf.probNegative.toFixed(0)}%` : DASH, s: "BLOCK BOOTSTRAP", c: pf.probNegative > 50 ? "neg" : "pos" },
          ]}
        />
        {pf.ci[0] <= 0 && (
          <p className="warn" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
            THE 90% BOOTSTRAP INTERVAL FOR THE SHARPE INCLUDES ZERO — THE OUT-OF-SAMPLE EDGE IS NOT DISTINGUISHABLE
            FROM NOISE AT THIS SAMPLE SIZE. READ THE TRADE COUNT BEFORE THE SHARPE.
          </p>
        )}
        <Foot>
          EQUAL-RISK BASKET: EACH ACTIVE PAIR TAKES 1/MAX({pf.active.length ? "8" : "8"}, #ACTIVE) OF THE BOOK, SO A PAIR
          DOES NOT GET MORE CAPITAL BECAUSE IT HAPPENS TO TRADE ALONE. INVESTED {(activeDays / Math.max(pf.dates.length, 1) * 100).toFixed(0)}% OF
          BARS. THE BOOTSTRAP IS BLOCK-BASED (10-BAR BLOCKS) BECAUSE PAIR RETURNS AUTOCORRELATE — AN I.I.D.
          BOOTSTRAP WOULD UNDERSTATE THE INTERVAL.
        </Foot>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Basket equity — out-of-sample, rebased to 1.0</p>
          <Area values={eq} />
          <Foot>STRATEGY COMPOUNDS {eq[eq.length - 1]?.toFixed(3)}× FROM THE START OF THE OUT-OF-SAMPLE WINDOW.</Foot>
        </div>
        <div className="panel">
          <p className="p-head">Monthly basket return (%)</p>
          <BarChart
            values={monthly.map((m) => m[1])}
            labels={monthly.map((m) => m[0].slice(2))}
            height={120}
            posColor="var(--amber)"
            negColor="var(--red)"
            desk={funcCode(ID)}
          />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Stress — same positions, harsher assumptions</p>
        <div className="scrollx">
          <table className="plain">
            <thead>
              <tr><th>Scenario</th><th style={{ textAlign: "right" }}>Delay</th><th style={{ textAlign: "right" }}>Cost/side</th><th style={{ textAlign: "right" }}>Return</th><th style={{ textAlign: "right" }}>Sharpe</th><th style={{ textAlign: "right" }}>Max DD</th></tr>
            </thead>
            <tbody>
              {pf.stress.map((s) => (
                <tr key={`${s.delay}-${s.cost}`}>
                  <td>{s.delay === 0 && s.cost === pf.stress[0]?.cost ? "BASELINE" : "STRESSED"}</td>
                  <td style={{ textAlign: "right" }}>{s.delay} bar{s.delay === 1 ? "" : "s"}</td>
                  <td style={{ textAlign: "right" }}>{s.cost} bps</td>
                  <td style={{ textAlign: "right" }} className={tone(s.stats.ReturnPct)}>{pct(s.stats.ReturnPct)}</td>
                  <td style={{ textAlign: "right" }} className={tone(s.stats.Sharpe)}>{num(s.stats.Sharpe)}</td>
                  <td style={{ textAlign: "right" }} className="neg">{pct(s.stats.MaxDDpct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Foot>
          A STRATEGY THAT DIES AT ONE EXTRA BAR OF DELAY OR DOUBLE COSTS WAS AN ARTEFACT OF THE FILL ASSUMPTION,
          NOT AN EDGE. THESE FOUR ROWS ARE THE SAME POSITIONS RE-PRICED — NO RE-OPTIMISATION, SO THE COMPARISON IS
          CLEAN.
        </Foot>
      </div>
    </div>
  );
}

/**
 * Data integrity, before any statistic is derived from it.
 *
 * The jump scan earns its place because its failure mode flatters: a pair whose
 * spread straddles an unhealed demerger looks superbly cointegrated, so the
 * scanner would otherwise hand back a confident pair built on a price step.
 */
function QualityPanel({ q }: { q: RadarPayload["quality"] }) {
  const clean = !q.jumps.length && !q.failedSymbols.length;
  return (
    <div className={q.jumps.length ? "panel panel-glow" : "panel"}>
      <p className="p-head">Data integrity — read before trusting any number below</p>
      <Cells
        items={[
          { l: "Symbols read", v: `${q.symbolsRead}/${q.symbolsRequested}`, s: "UNIVERSE" },
          { l: "Last bar", v: q.lastBar ?? DASH, s: q.lastBar ? "NEWEST ACROSS UNIVERSE" : "NO DATA" },
          {
            l: "Bar depth",
            v: q.barRange ? `${q.barRange[0]}-${q.barRange[1]}` : DASH,
            s: "SHORTEST-LONGEST",
          },
          {
            l: "Failed loads",
            v: String(q.failedSymbols.length),
            s: q.failedSymbols.length ? "SEE BELOW" : "NONE",
            c: q.failedSymbols.length ? "neg" : "pos",
          },
          {
            l: "Pairs dropped",
            v: String(q.droppedPairs.length),
            s: q.droppedPairs.length ? "SHORT HISTORY" : "NONE",
          },
          {
            l: "Price jumps",
            v: String(q.jumps.length),
            s: q.jumps.length ? "CORPORATE ACTION?" : "NONE",
            c: q.jumps.length ? "neg" : "pos",
          },
        ]}
      />

      {!!q.jumps.length && (
        <>
          <p className="warn" style={{ fontSize: 11.5, margin: "10px 0 6px" }}>
            ONE-BAR MOVES AT OR BEYOND {P_JUMP_PCT}% — SPLIT, BONUS ISSUE OR DEMERGER, NOT A TRADING DAY. THE DESK
            TRADES ADJUSTED CLOSE, WHICH HEALS ORDINARY SPLITS BUT USUALLY NOT DEMERGERS. EVERY PAIR NAMED BELOW
            HAS A SPREAD BUILT ACROSS A PRICE LEVEL THAT IS NOT COMPARABLE WITH ITSELF. READ THEIR STATISTICS AS
            UNRELIABLE UNTIL THE JUMP IS CONFIRMED AS A GENUINE MOVE.
          </p>
          <div className="scrollx" style={{ maxHeight: 220, overflowY: "auto" }}>
            <table className="plain">
              <thead>
                <tr>
                  <th>Symbol</th><th>Date</th>
                  <th style={{ textAlign: "right" }}>1-bar move</th>
                  <th>Pairs affected</th>
                </tr>
              </thead>
              <tbody>
                {q.jumps.map((j) => (
                  <tr key={`${j.symbol}|${j.date}`}>
                    <td>{j.symbol}</td>
                    <td>{j.date}</td>
                    <td style={{ textAlign: "right" }} className="neg">
                      {j.pct >= 0 ? "+" : ""}
                      {j.pct.toFixed(1)}%
                    </td>
                    <td className="faint">{j.pairs.length ? j.pairs.join(", ") : DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!!q.failedSymbols.length && (
        <p className="faint" style={{ fontSize: 11, margin: "10px 0 0" }}>
          <strong style={{ color: "var(--red)" }}>FAILED TO LOAD:</strong>{" "}
          {q.failedSymbols.map((f) => `${f.symbol} (${f.why})`).join(", ")}
        </p>
      )}
      {!!q.droppedPairs.length && (
        <p className="faint" style={{ fontSize: 11, margin: "4px 0 0" }}>
          <strong>DROPPED FOR SHORT HISTORY:</strong>{" "}
          {q.droppedPairs.map((d) => `${d.pair} — ${d.why}`).join(" · ")}
        </p>
      )}
      {clean && (
        <Foot>
          NO CORPORATE-ACTION JUMPS AT OR BEYOND {P_JUMP_PCT}%, AND EVERY SYMBOL LOADED. SERIES ARE ADJUSTED CLOSE,
          SO SPLITS AND BONUS ISSUES ARE ALREADY NORMALISED AWAY.
        </Foot>
      )}
    </div>
  );
}

/**
 * The four decisions, partitioned. *
 * A single wide table of every pair answers "what does the engine think" but not
 * "what should I do". This splits the radar by what a trader can act on, and the
 * second bucket is the one that earns the panel: pairs that cleared the entry
 * threshold and were refused anyway. Those are precisely the trades a z-score-only
 * model takes, so naming them is the difference between a filter and a decoration.
 */
function DecisionBoard({ board, p }: { board: RadarPayload["board"]; p: RadarPayload["params"] | undefined }) {
  const total = board.passed.length + board.rejected.length + board.onDeck.length + board.stretched.length;
  if (!total) return null;

  // A tier below the amber panel head, so the four buckets read as sub-sections
  // of one panel rather than competing with its title.
  const SUBHEAD: CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--sub)",
    margin: "14px 0 6px",
  };

  const Flag = ({ s }: { s: SignalRow }) => {
    const all = [...s.hard, ...s.soft];
    return all.length ? (
      <span className="faint" style={{ fontSize: 11 }}>
        {all.join(", ")}
      </span>
    ) : (
      <span className="pos">CLEAN</span>
    );
  };

  return (
    <div className="panel">
      <p className="p-head">Decision board — what to do, in four buckets</p>

      {/* 1. Trade these. */}
      <h4 style={{ ...SUBHEAD, marginTop: 2 }}>
        1 · PASSES EVERY GATE — TRADE THESE ({board.passed.length})
      </h4>
      {board.passed.length ? (
        <div className="scrollx">
          <table className="plain">
            <thead>
              <tr>
                <th>Pair</th><th>Action</th>
                <th style={{ textAlign: "right" }}>Z</th>
                <th style={{ textAlign: "right" }}>HL</th>
                <th style={{ textAlign: "right" }}>OOS Sharpe</th>
                <th style={{ textAlign: "right" }}>Conv</th>
                <th style={{ textAlign: "right" }}>A px</th>
                <th style={{ textAlign: "right" }}>Trig A</th>
                <th style={{ textAlign: "right" }}>B px</th>
                <th style={{ textAlign: "right" }}>Trig B</th>
              </tr>
            </thead>
            <tbody>
              {board.passed.map((s) => (
                <tr key={s.pair}>
                  <td>{s.pair}</td>
                  <td className="pos">{s.action}</td>
                  <td style={{ textAlign: "right" }} className={Math.abs(s.z) > ENTRY_Z ? "neg" : ""}>
                    {s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right" }}>{hl(s.halfLife)}</td>
                  <td style={{ textAlign: "right" }} className={tone(s.oosSharpe)}>{num(s.oosSharpe)}</td>
                  <td style={{ textAlign: "right" }}><strong>{s.conviction}</strong></td>
                  <td style={{ textAlign: "right" }}>{s.priceA.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{s.trigA.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{s.priceB.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{s.trigB.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
          NOTHING. NO PAIR IS PAST THE ENTRY THRESHOLD <em>AND</em> CLEAR OF EVERY GATE AT ONCE. THAT IS THE EXPECTED
          STATE, NOT A FAULT — SEE BUCKET 2 FOR WHAT WAS REFUSED.
        </p>
      )}

      {/* 2. The false positives. */}
      <h4 style={SUBHEAD}>
        2 · PAST ENTRY BUT REFUSED BY A GATE — THE TRADES A Z-SCORE-ONLY MODEL WOULD TAKE ({board.rejected.length})
      </h4>
      {board.rejected.length ? (
        <>
          <div className="scrollx">
            <table className="plain">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th style={{ textAlign: "right" }}>Z</th>
                  <th style={{ textAlign: "right" }}>HL</th>
                  <th style={{ textAlign: "right" }}>Hurst</th>
                  <th>What refused it</th>
                </tr>
              </thead>
              <tbody>
                {board.rejected.map((s) => (
                  <tr key={s.pair}>
                    <td>{s.pair}</td>
                    <td style={{ textAlign: "right" }} className="neg">{s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }}>{hl(s.halfLife)}</td>
                    <td style={{ textAlign: "right" }}>{num(s.hurst)}</td>
                    <td><Flag s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
            THESE ARE PAST ±{(p?.ENTRY_Z ?? ENTRY_Z).toFixed(2)} RIGHT NOW AND WERE REFUSED ANYWAY. A MODEL THAT
            SIZED ON |Z| ALONE IS LONG THESE. THE FIRST FLAG IS THE ONE THAT REFUSED IT.
          </p>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>NONE — NOTHING PAST ENTRY WAS REFUSED.</p>
      )}

      {/* 3. Watch list with the exact price that would fire it. */}
      <h4 style={SUBHEAD}>3 · ON DECK — APPROACHING ENTRY, NOT YET IN IT ({board.onDeck.length})</h4>
      {board.onDeck.length ? (
        <div className="scrollx">
          <table className="plain">
            <thead>
              <tr>
                <th>Pair</th><th>Momentum</th>
                <th style={{ textAlign: "right" }}>Z</th>
                <th style={{ textAlign: "right" }}>A px</th>
                <th style={{ textAlign: "right" }}>Trig A</th>
                <th style={{ textAlign: "right" }}>Move A</th>
                <th style={{ textAlign: "right" }}>B px</th>
                <th style={{ textAlign: "right" }}>Trig B</th>
                <th style={{ textAlign: "right" }}>Move B</th>
                <th style={{ textAlign: "right" }}>Conv</th>
              </tr>
            </thead>
            <tbody>
              {board.onDeck.map((s) => (
                <tr key={s.pair}>
                  <td>{s.pair}</td>
                  <td className={s.momentum === "APPROACHING" ? "" : "faint"}>{s.momentum}</td>
                  <td style={{ textAlign: "right" }}>{s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{s.priceA.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }} className="pos">{s.trigA.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{pct(s.moveAPct)}</td>
                  <td style={{ textAlign: "right" }}>{s.priceB.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }} className="pos">{s.trigB.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{pct(s.moveBPct)}</td>
                  <td style={{ textAlign: "right" }}><strong>{s.conviction}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
          NO FILTERED PAIR IN THE ON-DECK BAND (|Z| BETWEEN {(p?.ON_DECK_FRAC ?? 0.625) * (p?.ENTRY_Z ?? ENTRY_Z)} AND{" "}
          {(p?.ENTRY_Z ?? ENTRY_Z).toFixed(2)} WITH EVERY GATE CLEAR).
        </p>
      )}

      {/* 4. Do not chase. */}
      <h4 style={SUBHEAD}>
        4 · STRETCHED PAST THE STOP — DO NOT CHASE, THE RELATIONSHIP MAY BE BREAKING ({board.stretched.length})
      </h4>
      {board.stretched.length ? (
        <>
          <div className="scrollx">
            <table className="plain">
              <thead>
                <tr>
                  <th>Pair</th><th>Would-be action</th>
                  <th style={{ textAlign: "right" }}>Z</th>
                  <th style={{ textAlign: "right" }}>Room to stop</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {board.stretched.map((s) => (
                  <tr key={s.pair}>
                    <td>{s.pair}</td>
                    <td className="faint">{s.action}</td>
                    <td style={{ textAlign: "right" }} className="neg">{s.z >= 0 ? "+" : ""}{s.z.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }} className="neg">
                      {(s.stop - Math.abs(s.z)).toFixed(2)}σ
                    </td>
                    <td><Flag s={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 10.5, margin: "6px 0 0" }}>
            THE ACTION COLUMN IS WHAT THE ENGINE WOULD PRINT IF YOU ENTERED HERE. IT IS SHOWN TO BE SUPPRESSED, NOT
            TAKEN: A SPREAD THIS FAR FROM ITS MEAN IS EITHER ABOUT TO REVERT HARD OR IS NO LONGER MEAN-REVERTING, AND
            THE DISTRIBUTION CANNOT TELL YOU WHICH. ROOM TO STOP IS THE GAP BETWEEN HERE AND ±{(p?.STOP_Z ?? STOP_Z)};
            AT OR BELOW ZERO THE STOP IS ALREADY THROUGH YOU.
          </p>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>NONE STRETCHED.</p>
      )}
    </div>
  );
}

/**
 * Pairs ranked by realised out-of-sample Sharpe.
 *
 * Shown because it is the answer to "what would have worked", and hidden behind a
 * warning because it is also the most overfittable number on the desk: ranking
 * N pairs by their own backtest and then trading the top of that list is
 * selection on the test set. The basket above avoids it by choosing on the
 * formation window only, and this table exists to be compared against that
 * basket — not to be traded from.
 */
function OosRankingPanel({ data }: { data: RadarPayload }) {
  const ranked = useMemo(
    () =>
      data.rows
        .filter((r) => isNum(r.oos?.Sharpe))
        .sort((a, b) => (b.oos!.Sharpe ?? 0) - (a.oos!.Sharpe ?? 0))
        .slice(0, 10),
    [data.rows]
  );
  if (!ranked.length) return null;
  // How many of the best-performing pairs the formation-window selection actually
  // caught. This is the number worth arguing about: a formation-only rule that
  // ignores the leaders is not necessarily broken, because the leaders are
  // partly luck — but a rule that catches none of them is not selecting.
  const caught = ranked.filter((r) => r.inPortfolio).length;
  return (
    <div className="panel">
      <p className="p-head">Top pairs by out-of-sample Sharpe — research only, do not trade this list</p>
      <div className="scrollx">
        <table className="plain">
          <thead>
            <tr>
              <th>#</th><th>Pair</th><th>Status</th>
              <th style={{ textAlign: "right" }}>q live</th>
              <th style={{ textAlign: "right" }}>OOS Sharpe</th>
              <th style={{ textAlign: "right" }}>OOS return</th>
              <th style={{ textAlign: "right" }}>OOS trades</th>
              <th>In basket</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => (
              <tr key={`${r.a}|${r.b}`}>
                <td className="faint">{i + 1}</td>
                <td>{r.a} vs {r.b}</td>
                <td className={r.status === "CONFIRMED" ? "pos" : r.status === "PROBABLE" ? "" : "faint"}>
                  {r.status}
                </td>
                <td style={{ textAlign: "right" }}>{isNum(r.qLive) ? r.qLive.toFixed(3) : DASH}</td>
                <td style={{ textAlign: "right" }} className={tone(r.oos?.Sharpe)}>
                  {num(r.oos?.Sharpe)}
                </td>
                <td style={{ textAlign: "right" }}>{pct(r.oos?.ReturnPct)}</td>
                <td style={{ textAlign: "right" }}>{r.oos?.Trades ?? DASH}</td>
                <td className={r.inPortfolio ? "pos" : "faint"}>{r.inPortfolio ? "YES" : DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="warn" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
        RANKED ACROSS ALL {data.rows.length} PAIRS, NOT ONLY THE BASKET — SO THIS LIST CAN SHOW WHAT THE SELECTION
        MISSED, WHICH IS THE ONLY REASON IT IS WORTH READING. SELECTION BIAS IS THE POINT OF THE WARNING: RANKING
        PAIRS BY THEIR OWN BACKTEST AND THEN TRADING THE WINNERS PUTS THE TEST SET BACK INTO THE SELECTION. WITH{" "}
        {data.rows.length} PAIRS TESTED AT p&lt;0.05, ~{Math.round(data.rows.length * 0.05)} PASS BY CHANCE ALONE, SO
        THE HEAD OF THIS LIST IS EXPECTED TO LOOK GOOD REGARDLESS OF SKILL. THE FORMATION-WINDOW BASKET ABOVE CAUGHT{" "}
        {caught} OF THESE {ranked.length} WITHOUT EVER LOOKING AT THIS RANKING — THAT MISS RATE IS THE HONEST PRICE OF
        NOT CHEATING, AND IT IS WHAT THE BASKET'S OWN SHARPE IS BEING PAID FOR.
      </p>
    </div>
  );
}

function SelectionPanel({ data }: { data: RadarPayload }) {
  return (
    <div className="panel">
      <p className="p-head">Screening table — what each gate said, per pair</p>
      <div className="scrollx" style={{ maxHeight: 420, overflowY: "auto" }}>
        <table className="plain">
          <thead>
            <tr>
              <th>Pair</th><th>Status</th><th>In basket</th>
              <th style={{ textAlign: "right" }}>p form</th><th style={{ textAlign: "right" }}>q FDR</th><th style={{ textAlign: "right" }}>p live</th>
              <th style={{ textAlign: "right" }}>Leg A p</th><th style={{ textAlign: "right" }}>Leg B p</th>
              <th style={{ textAlign: "right" }}>HL form</th><th style={{ textAlign: "right" }}>HL live</th>
              <th style={{ textAlign: "right" }}>q live</th>
              <th style={{ textAlign: "right" }}>β coin</th><th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.a}|${r.b}`} className={r.inPortfolio ? "active" : ""}>
                <td>{r.a} vs {r.b}</td>
                <td className={r.status === "CONFIRMED" ? "pos" : r.status === "PROBABLE" ? "" : "faint"}>{r.status}</td>
                <td>{r.inPortfolio ? "YES" : "—"}</td>
                <td style={{ textAlign: "right" }}>{isNum(r.pForm) ? r.pForm.toFixed(3) : DASH}</td>
                <td style={{ textAlign: "right" }}>{isNum(r.qForm) ? r.qForm.toFixed(3) : DASH}</td>
                <td style={{ textAlign: "right" }}>{isNum(r.pLive) ? r.pLive.toFixed(3) : DASH}</td>
                <td style={{ textAlign: "right" }} className={r.levelA < 0.05 ? "neg" : ""}>{isNum(r.levelA) ? r.levelA.toFixed(2) : DASH}</td>
                <td style={{ textAlign: "right" }} className={r.levelB < 0.05 ? "neg" : ""}>{isNum(r.levelB) ? r.levelB.toFixed(2) : DASH}</td>
                <td style={{ textAlign: "right" }}>{hl(r.halfLifeForm)}</td>
                <td style={{ textAlign: "right" }}>{hl(r.halfLifeLive)}</td>
                <td style={{ textAlign: "right" }} className={isNum(r.qLive) && r.qLive <= 0.1 ? "pos" : ""}>
                  {isNum(r.qLive) ? r.qLive.toFixed(3) : DASH}
                </td>
                <td style={{ textAlign: "right" }}>{num(r.cointegratingSlope)}</td>
                <td style={{ textAlign: "left" }} className="faint">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Foot>
        THE FOUR GATES ARE IN ORDER: (1) THE ENGLE-GRANGER RESIDUAL TEST REJECTS A UNIT ROOT AFTER FDR ACROSS THE
        WHOLE UNIVERSE; (2) NEITHER LEG REJECTS A UNIT ROOT ON ITS OWN — WITHOUT THIS A PAIR OF TRENDING SHARES
        PASSES ON DRIFT ALONE; (3) THE FORMATION-WINDOW HALF-LIFE SITS IN 3-40 BARS; (4) THE RELATION STILL
        COINTEGRATES IN THE LIVE WINDOW. FDR MATTERS BECAUSE {data.rows.length} RAW TESTS AT p&lt;0.05 WOULD THROW
        ~{Math.round(data.rows.length * 0.05)} FALSE POSITIVES BY CHANCE ALONE.
      </Foot>
      {!!data.walkParams.length && (
        <div style={{ marginTop: 8 }}>
          <p className="p-head">Live walk-forward parameters per pair</p>
          <div className="scrollx">
            <table className="plain">
              <thead>
                <tr><th>Pair</th><th style={{ textAlign: "right" }}>Lookback</th><th style={{ textAlign: "right" }}>Entry</th><th style={{ textAlign: "right" }}>Exit</th><th style={{ textAlign: "right" }}>Time-stop</th><th style={{ textAlign: "right" }}>Train Sharpe</th></tr>
              </thead>
              <tbody>
                {data.walkParams.map((w) => (
                  <tr key={w.pair}>
                    <td>{w.pair}</td>
                    <td style={{ textAlign: "right" }}>{w.lookback}d</td>
                    <td style={{ textAlign: "right" }}>{w.entry}</td>
                    <td style={{ textAlign: "right" }}>{w.exit}</td>
                    <td style={{ textAlign: "right" }}>{w.timeStop}d</td>
                    <td style={{ textAlign: "right" }} className={tone(w.trainSharpe)}>{num(w.trainSharpe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Foot>
            RE-OPTIMISED EVERY {data.params.TEST_STEP} BARS ON A TRAILING {data.params.TRAIN_WINDOW}-BAR WINDOW, AND
            SHRUNK BACK TO THE DEFAULT UNLESS A GRID POINT BEAT IT BY A MARGIN. THAT MARGIN IS THE REGULARISER —
            WITHOUT IT, WALK-FORWARD ON A SMALL GRID IS JUST IN-SAMPLE FITTING REPEATED ON A DELAY.
          </Foot>
        </div>
      )}
    </div>
  );
}

// ================================================================ deep dive

function DeepDivePanel({ a, b, onClose }: { a: string; b: string; onClose: () => void }) {
  const { data, err, loading, reload } = useDeskFetch<{ ok: boolean; detail: PairDetail; params: RadarPayload["params"] }>(
    `/api/pairs/pair?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
  );
  const d = data?.detail;
  const adaptiveBeatsStatic = d ? d.adaptiveOos.Sharpe > d.baselineOos.Sharpe : false;

  return (
    <div className="panel panel-glow">
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <p className="p-head" style={{ margin: 0 }}>DEEP DIVE — {a} vs {b}</p>
        <button className="ghost" style={{ marginLeft: "auto", padding: "3px 8px" }} onClick={onClose}>✕ CLOSE</button>
      </div>
      <LegBar err={err} loading={loading} retry={reload} hint="WALK-FORWARD" />
      {d && (
        <>
          <Cells
            items={[
              { l: "OOS Sharpe", v: num(d.adaptiveOos.Sharpe), s: "WALK-FORWARD", c: tone(d.adaptiveOos.Sharpe) },
              { l: "Static Sharpe", v: num(d.baselineOos.Sharpe), s: "v1 BASELINE", c: tone(d.baselineOos.Sharpe) },
              { l: "OOS Return", v: pct(d.adaptiveOos.ReturnPct), s: "NET OF COSTS", c: tone(d.adaptiveOos.ReturnPct) },
              { l: "Max DD", v: pct(d.adaptiveOos.MaxDDpct), s: "OUT-OF-SAMPLE", c: "neg" },
              { l: "Trades", v: String(d.adaptiveOos.Trades || DASH), s: `${isNum(d.adaptiveOos.AvgHold) ? d.adaptiveOos.AvgHold.toFixed(0) : "—"} BARS AVG` },
              { l: "OOS starts", v: d.formationEnd.slice(0, 7), s: "FORMATION ENDS" },
            ]}
          />
          <p className={adaptiveBeatsStatic ? "pos" : "warn"} style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
            {adaptiveBeatsStatic
              ? `ADAPTIVE BEATS THE STATIC BASELINE OUT-OF-SAMPLE (${num(d.adaptiveOos.Sharpe)} vs ${num(d.baselineOos.Sharpe)}) — THE KALMAN HEDGE AND RE-OPTIMISED THRESHOLDS ARE EARNING THEIR KEEP.`
              : `ADAPTIVE DOES NOT BEAT THE STATIC BASELINE OUT-OF-SAMPLE (${num(d.adaptiveOos.Sharpe)} vs ${num(d.baselineOos.Sharpe)}). THE MACHINERY IS NOT PAYING FOR ITSELF ON THIS PAIR — WHICH IS A RESULT, NOT A BUG.`}
          </p>
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div className="panel">
              <p className="p-head">Walk-forward vs static — same out-of-sample window</p>
              <StatsTable label="STATIC OLS, ±2.0/0.5, NO TUNING" s={d.baselineOos} note="OUT-OF-SAMPLE" />
              <div style={{ height: 8 }} />
              <StatsTable label="KALMAN HEDGE, WALK-FORWARD" s={d.adaptiveOos} note="OUT-OF-SAMPLE" />
              <div style={{ height: 8 }} />
              <StatsTable label="STATIC, FULL HISTORY" s={d.baselineFull} note="IN-SAMPLE — SHOWN ONLY TO BEAT DOWN" />
              <Foot>
                THE THIRD ROW IS THE NUMBER A NAIVE BACKTEST WOULD HAVE PRINTED. IT LOOKS BETTER BECAUSE THE
                ENTRY/EXIT THRESHOLDS WERE CHOSEN ON THE SAME DATA — THAT GAP IS EXACTLY WHAT THE FIRST TWO ROWS
                ARE CORRECTING FOR.
              </Foot>
            </div>
            <div className="panel">
              <p className="p-head">Out-of-sample equity, rebased to 1.0</p>
              <Area
                series={[
                  { label: "WALK-FORWARD", color: "var(--amber)", values: d.equityAdaptive },
                  { label: "STATIC v1", color: "var(--sub)", values: d.equityStatic },
                ]}
              />
            </div>
          </div>
          <div className="panel" style={{ marginTop: 10 }}>
            <p className="p-head">Z-score — walk-forward model vs the static model</p>
            <Area
              series={[
                { label: "WALK-FORWARD Z", color: "var(--amber)", values: d.zTail },
                { label: "STATIC Z", color: "var(--sub)", values: d.staticZTail },
              ]}
              fmt={(v) => v.toFixed(2)}
            />
            <Foot>LAST {d.zTail.length} BARS. FLAT LINES AT ±{data?.params.ENTRY_Z} ARE THE ENTRY THRESHOLD, DASHED AT ±{data?.params.STOP_Z} THE STOP.</Foot>
          </div>
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div className="panel">
              <p className="p-head">Hedge ratio — Kalman vs rolling OLS vs fit-once</p>
              <Area
                series={[
                  { label: "KALMAN (TRADED)", color: "var(--sec)", values: d.betaTail },
                  { label: `ROLLING OLS-${P_ROLLING_WIN}`, color: "var(--amber)", values: d.rollingBetaTail },
                  ...(d.staticBeta === null
                    ? []
                    : [{ label: "FIT ONCE", color: "var(--sub)", values: d.staticBeta === null ? [] : new Array(d.rollingBetaTail.length).fill(d.staticBeta) }]),
                ]}
                fmt={(v) => v.toFixed(2)}
              />
              <Foot>
                THREE WAYS TO ESTIMATE THE SAME RATIO. THE FIT-ONCE LINE IS WHAT A MODEL THAT REGRESSES ONCE AND STOPS
                WOULD USE THROUGHOUT; ROLLING OLS-{P_ROLLING_WIN} IS WHAT A HAND-ROLLED PAIR SCRIPT USES AND IT CHATTERS
                ON NOISE; KALMAN IS THE ONE THIS DESK TRADES, ONE BAR LAGGED SO THE SPREAD AT BAR t DEPENDS ONLY ON
                INFORMATION AVAILABLE AT t-1. THE VALUE OF ADAPTATION IS THE GAP BETWEEN THE AMBER AND GREY LINES.
              </Foot>
            </div>
            <div className="panel">
              <p className="p-head">Spread (log residual)</p>
              <Area values={d.spreadTail} color="var(--green)" fmt={(v) => v.toFixed(4)} label="SPREAD" />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="ghost"
              onClick={() =>
                downloadCSV(
                  `trades_${a.replace(/\W/g, "")}_${b.replace(/\W/g, "")}`,
                  ["ENTRY", "EXIT", "SIDE", "BARS", "PNL_PCT"],
                  d.trades.map((t) => [t.entry, t.exit, t.side, t.bars, (t.pnl * 100).toFixed(3)])
                )
              }
            >
              EXPORT TRADES CSV
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ charts

function Area({ values, series, fmt, label, color }: {
  values?: (number | null)[];
  series?: Array<{ label: string; color: string; values: (number | null)[] }>;
  fmt?: (v: number) => string;
  label?: string;
  color?: string;
}) {
  if (series?.length) {
    return (
      <LineChart
        series={series}
        height={150}
        yFmt={fmt ?? ((v) => v.toFixed(2))}
        desk={funcCode(ID)}
      />
    );
  }
  if (!values) return null;
  return (
    <LineChart
      series={[{ label: label ?? "VALUE", color: color ?? "var(--amber)", values }]}
      height={140}
      yFmt={fmt ?? ((v) => v.toFixed(2))}
      desk={funcCode(ID)}
    />
  );
}

// ===================================================================== desk

type Mode = "RADAR" | "PAIR";
const MODES = ["RADAR", "PAIR"] as const;

export function PairDesk({ symbol }: { symbol: string }) {
  const [mode, setMode] = useState<Mode>("RADAR");
  const [a, setA] = useState(symbol);
  const [b, setB] = useState("^NSEI");
  const [deep, setDeep] = useState<[string, string] | null>(null);

  useEffect(() => setA(symbol), [symbol]);

  const open = useCallback((x: string, y: string) => {
    setA(x);
    setB(y);
    setDeep([x, y]);
  }, []);

  return (
    <div className="grid" style={{ gap: 10 }}>
      <Head />
      <div className="toolbar">
        <Pills opts={MODES} val={mode} set={setMode} />
        <span className="faint" style={{ fontSize: 10.5, marginLeft: "auto", textAlign: "right" }}>
          {mode === "RADAR"
            ? "SCREEN → SELECT ON FORMATION → TRADE OUT-OF-SAMPLE"
            : "ONE PAIR, WALK-FORWARD vs THE STATIC BASELINE"}
        </span>
      </div>

      {mode === "RADAR" && <RadarPanel />}

      {mode === "PAIR" && (
        <div className="panel">
          <p className="p-head">Pick a pair</p>
          <div className="toolbar">
            <input className="box" value={a} onChange={(e) => setA(e.target.value.toUpperCase())} placeholder="LEG A — HDFCBANK" aria-label="Leg A" />
            <input className="box" value={b} onChange={(e) => setB(e.target.value.toUpperCase())} placeholder="LEG B — ICICIBANK" aria-label="Leg B" />
            <button className="btn" onClick={() => open(a, b)} disabled={!a.trim() || !b.trim() || a === b}>
              RUN PAIR
            </button>
          </div>
          {!deep && <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>TYPE TWO SYMBOLS. BOTH MUST SHARE AT LEAST {400} TRADING DAYS OF HISTORY.</p>}
          {deep && <div style={{ marginTop: 10 }}><DeepDivePanel a={deep[0]} b={deep[1]} onClose={() => setDeep(null)} /></div>}
        </div>
      )}
    </div>
  );
}