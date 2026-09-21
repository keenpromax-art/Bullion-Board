"use client";

// Formatted desk output — renders every /api/analysis extra payload as
// terminal tables. No raw JSON ever reaches the screen.

import { fmtNum, fmtPct } from "@/lib/utils";
import { MCFan } from "./ChartDesks";
import { Histogram } from "./charts";

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

function Tbl({ head, rows }: { head: string[]; rows: (string | { t: string; cls?: string })[][] }) {
  return (
    <table className="plain">
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => {
              const t = typeof c === "string" ? c : c.t;
              const cls = typeof c === "string" ? undefined : c.cls;
              return <td key={j} className={cls} style={j > 0 ? { textAlign: "right" } : undefined}>{t}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const n2 = (v: unknown) => fmtNum(typeof v === "number" ? v : NaN);
const n3 = (v: unknown) => fmtNum(typeof v === "number" ? v : NaN, 3);

// ---- Shared desk error rendering (module pages + workspace panels) ----
// Feed errors must never be mislabelled: an unknown ticker (typo) is NOT
// throttling, and throttling is NOT an unknown ticker.

export interface DeskErr {
  message: string;
  code?: string;
  suggestion?: string;
}

export function toDeskErr(e: unknown, payload?: { code?: string; suggestion?: string }): DeskErr {
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "fetch failed";
  const code = (e as { code?: string } | null)?.code ?? payload?.code;
  const suggestion = (e as { suggestion?: string } | null)?.suggestion ?? payload?.suggestion;
  return { message, code, suggestion };
}

export function classifyDeskErr(err: DeskErr | string): "unknown" | "throttled" | "other" {
  const code = typeof err === "string" ? "" : (err.code ?? "");
  const msg = typeof err === "string" ? err : err.message;
  if (code === "UNKNOWN_SYMBOL" || /UNKNOWN TICKER/.test(msg)) return "unknown";
  if (/429|502|503|THROTT|RATE LIMIT|NETWORK|TIMEOUT|ABORT|FETCH FAILED/i.test(msg)) return "throttled";
  return "other";
}

// Honest error panel: unknown tickers offer the resolved symbol, throttled
// feeds offer retry — never the twain confused.
export function DeskError({ err, onRetry, onPick }: {
  err: DeskErr | string;
  onRetry?: () => void;
  onPick?: (sym: string) => void;
}) {
  const norm: DeskErr = typeof err === "string" ? { message: err } : err;
  const kind = classifyDeskErr(norm);
  return (
    <div>
      <p className="neg" style={{ marginBottom: kind === "unknown" && norm.suggestion ? 8 : 0 }}>
        {kind === "throttled" ? `${norm.message} (FEED THROTTLED — RETRY)` : norm.message}
      </p>
      {(kind === "unknown" && norm.suggestion && onPick) || onRetry ? (
        <div className="toolbar" style={{ marginTop: 8 }}>
          {kind === "unknown" && norm.suggestion && onPick && (
            <button className="btn" onClick={() => onPick?.(norm.suggestion!)}>LOAD {norm.suggestion}</button>
          )}
          {onRetry && <button className="ghost" onClick={onRetry}>RETRY</button>}
        </div>
      ) : null}
    </div>
  );
}

// Amber notice when the server resolved a typo/company name (APPL → AAPL)
// instead of erroring.
export function ResolutionNote({ from, to }: { from: string; to: string }) {
  return (
    <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
      SHOWING <strong style={{ color: "var(--amber)" }}>{to}</strong> FOR {from} — RESOLVED VIA YAHOO SEARCH · WRONG SECURITY? EDIT TICKER
    </p>
  );
}

export default function DeskOutput({ extra }: { extra: any }) {
  if (!extra || typeof extra !== "object") return null;
  const sections: React.ReactNode[] = [];
  let k = 0;

  if (extra.signal) {
    const c = extra.confluence ?? {};
    sections.push(
      <div key={k++} className="panel">
        <p className="p-head">Signal — confluence desk</p>
        <p style={{ margin: "0 0 8px 0" }}>
          <span className={`badge ${String(extra.signal).includes("BULL") ? "ok" : String(extra.signal).includes("BEAR") ? "bad" : "fnc"}`}>{extra.signal}</span>
        </p>
        <Tbl
          head={["LEG", "READING"]}
          rows={[
            ["RSI 14", n2(c.rsi)],
            ["MACD HIST", n3(c.macdHist)],
            ["ADX", n2(c.adx)],
          ]}
        />
        {c.note && <p className="muted" style={{ fontSize: 11.5 }}>{c.note}</p>}
      </div>
    );
  }

  if (extra.monteCarlo || extra.kelly) {
    const mc = extra.monteCarlo ?? {};
    const kl = extra.kelly ?? {};
    sections.push(
      <div key={k++} className="panel">
        <p className="p-head">Monte Carlo — 63-day fan · seed 42</p>
        <Tbl
          head={["P5", "P50", "P95"]}
          rows={[[fmtINR(mc.p5), fmtINR(mc.p50), fmtINR(mc.p95)]]}
        />
        <MCFan paths={(mc.paths ?? []) as number[][]} />
        <div style={{ marginTop: 10 }}>
          <Tbl
            head={["EDGE", "VALUE"]}
            rows={[
              ["WIN RATE", fmtPct((kl.winRate ?? NaN) * 100, false)],
              ["AVG WIN / LOSS", `${n3(kl.avgWin)} / ${n3(kl.avgLoss)}`],
              ["KELLY F", n3(kl.kellyF)],
              ["PROFIT FACTOR", n2(kl.profitFactor)],
              ["CALMAR", extra.calmar === null || extra.calmar === undefined ? "—" : n2(extra.calmar)],
            ]}
          />
        </div>
      </div>
    );
  }

  if (extra.options) {
    const o = extra.options;
    const rec = o.recommended ?? {};
    const g = rec.greeks ?? {};
    const atmC = o.atmCall ?? {};
    const atmP = o.atmPut ?? {};
    sections.push(
      <div key={k++} className="panel">
        <p className="p-head">Options — vol regime + Greeks</p>
        <KV k="HV 10 / 30 / 252" v={`${fmtPct((o.hv10 ?? NaN) * 100, false)} / ${fmtPct((o.hv30 ?? NaN) * 100, false)} / ${fmtPct((o.hv252 ?? NaN) * 100, false)}`} />
        <KV k="REGIME" v={String(o.regime ?? "—")} cls={String(o.regime ?? "").includes("EXPAND") ? "neg" : String(o.regime ?? "").includes("COMPRESS") ? "pos" : ""} />
        <KV k="TREND BIAS" v={n2(o.trendBias)} cls={(o.trendBias ?? 0) >= 0 ? "pos" : "neg"} />
        <KV k="EXP MOVE ±1SD" v={fmtINR(o.expectedMove1sd)} />
        <KV k="SIDE" v={String(o.side ?? "—")} />
        <div style={{ marginTop: 10 }}>
          <Tbl
            head={["ATM", "PX", "DELTA", "GAMMA", "THETA/D", "VEGA", "P(ITM)"]}
            rows={[
              ["CALL", n2(atmC.price), n3(atmC.delta), n3(atmC.gamma), n3(atmC.theta), n2(atmC.vega), fmtPct((atmC.probITM ?? NaN) * 100, false)],
              ["PUT", n2(atmP.price), n3(atmP.delta), n3(atmP.gamma), n3(atmP.theta), n2(atmP.vega), fmtPct((atmP.probITM ?? NaN) * 100, false)],
            ]}
          />
        </div>
        {rec.strike !== undefined && (
          <p style={{ margin: "10px 0 0 0", fontSize: 13 }}>
            REC <span className="sec">{o.side} {Math.round(rec.strike)}</span>
            <span className="muted"> · Δ {n3(g.delta)} · PX {n2(g.price)} · P(ITM) {fmtPct((g.probITM ?? NaN) * 100, false)}</span>
          </p>
        )}
      </div>
    );
  }

  const fe = extra.fundamentalExamples;
  if (fe) {
    const p = fe.piotroski;
    const a = fe.altman;
    const b = fe.beneish;
    const d = fe.dcf;
    const r = fe.reverseDcf;
    sections.push(
      <div key={k++} className="grid grid-2">
        {p && (
          <div className="panel">
            <p className="p-head">Piotroski F — {p.score}/9 · {p.interpretation}</p>
            <Tbl
              head={["CHECK", "DETAIL", ""]}
              rows={(p.checks ?? []).map((c: any) => [
                c.label,
                c.detail,
                c.pass ? { t: "✓ PASS", cls: "pos" } : { t: "✗ FAIL", cls: "neg" },
              ])}
            />
          </div>
        )}
        {a && (
          <div className="grid" style={{ gap: 10 }}>
            <div className="panel">
              <p className="p-head">Altman Z — {n2(a.zScore)} · {a.zone}</p>
              <Tbl head={["X1", "X2", "X3", "X4", "X5"]} rows={[[n3(a.X1), n3(a.X2), n3(a.X3), n3(a.X4), n3(a.X5)]]} />
            </div>
            {b && (
              <div className="panel">
                <p className="p-head">Beneish M — {n2(b.mScore)}</p>
                <KV k="RISK" v={b.risk} cls={String(b.risk).includes("HIGH") ? "neg" : String(b.risk).includes("LOW") ? "pos" : ""} />
              </div>
            )}
            {d && !d.error && (
              <div className="panel">
                <p className="p-head">Monte-Carlo DCF / sh</p>
                <Tbl head={["P10", "P25", "P50", "P75", "P90"]} rows={[[fmtINR(d.p10), fmtINR(d.p25), fmtINR(d.p50), fmtINR(d.p75), fmtINR(d.p90)]]} />
                <KV k="MEAN ± SD" v={`${fmtINR(d.mean)} ± ${fmtINR(d.std)}`} />
                <KV k="PATHS" v={String(d.nPaths ?? "—")} />
                {d.histCounts?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Histogram prebinned={{ counts: d.histCounts, edges: d.histEdges ?? [] }} height={90} />
                  </div>
                )}
              </div>
            )}
            {r && !r.error && (
              <div className="panel">
                <p className="p-head">Reverse DCF</p>
                <KV k="IMPLIED G" v={fmtPct(r.impliedGrowthPct, false)} />
                <KV k="VERDICT" v={r.verdict} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (extra.pairNote) {
    sections.push(
      <div key={k++} className="panel">
        <p className="p-head">Pairs desk</p>
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{extra.pairNote}</p>
      </div>
    );
  }

  if (sections.length === 0) return null;
  return <>{sections}</>;
}

function fmtINR(v: unknown): string {
  return typeof v === "number" && isFinite(v)
    ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
    : "—";
}
