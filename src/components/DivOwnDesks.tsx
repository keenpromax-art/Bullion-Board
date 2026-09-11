"use client";

import { useEffect, useState } from "react";
import { LineChart, BarChart, Donut } from "./charts";
import { ScreenerDesk } from "./ModuleDesks";

/* ---------------- dividend desk (DVD) ---------------- */

type DivTab = "PAYOUTS" | "SPLITS" | "BOARD";

export function DVDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<DivTab>("PAYOUTS");

  useEffect(() => {
    let alive = true;
    setData(null); setErr("");
    fetch(`/api/dividends?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "dividends failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol]);

  if (err) return <div className="panel"><p className="neg">DVD ERR: {err}</p></div>;
  if (!data) return <div className="panel"><p className="muted">PULLING DIVIDEND LEDGER TO IPO…</p></div>;

  const annualAsc = [...(data.annual ?? [])].reverse();
  const g = (v: number | null) =>
    v === null || v === undefined ? "—" : <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">
          Dividend/Split summary — {symbol} · {data.currency} · {data.count} payouts
          {data.yearRange ? ` · ${data.yearRange[0]}→${data.yearRange[1]}` : ""}
        </p>
        <div className="cells">
          <div className="cell"><div className="lbl">TTM yield</div><div className="val pos">{data.ttmYieldPct?.toFixed(2)}%</div><div className="sub">₹{data.ttmTotal?.toLocaleString("en-IN")} TTM</div></div>
          <div className="cell"><div className="lbl">Indicated yield</div><div className="val">{data.indicatedYieldPct?.toFixed(2)}%</div><div className="sub">₹{data.indicated} annualized</div></div>
          <div className="cell"><div className="lbl">1Y growth</div><div className="val">{g(data.growth1Y)}</div><div className="sub">TTM vs prior</div></div>
          <div className="cell"><div className="lbl">3Y growth</div><div className="val">{g(data.growth3Y)}</div><div className="sub">3Y vs prior 3Y</div></div>
          <div className="cell"><div className="lbl">Last price</div><div className="val">{data.currency} {data.price?.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div><div className="sub">payout base</div></div>
          <div className="cell"><div className="lbl">Frequency</div><div className="val" style={{ fontSize: 16 }}>{data.freq}</div><div className="sub">{data.ttmCount} TTM payouts</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Annual payouts ₹ — with yearly growth</p>
          <BarChart values={annualAsc.map((a: any) => a.total)} labels={annualAsc.map((a: any) => String(a.year))} height={110} posColor="#ffa028" negColor="#ffa028" />
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          {(["PAYOUTS", "SPLITS", "BOARD"] as DivTab[]).map((t) => (
            <button key={t} className={`pill${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
              {t === "PAYOUTS" ? `PAYOUTS (${data.count})` : t === "SPLITS" ? `SPLITS (${(data.splits ?? []).length})` : "YIELD BOARD"}
            </button>
          ))}
        </div>
      </div>

      {tab === "PAYOUTS" && (
        <div className="grid grid-2">
          <div className="panel">
            <p className="p-head">Payout history — ex-date · as-reported (unadjusted)</p>
            <div style={{ maxHeight: 380, overflowY: "auto" }}>
              <table className="plain">
                <thead><tr><th>EX DATE</th><th style={{ textAlign: "right" }}>AMOUNT {data.currency}</th><th style={{ textAlign: "right" }}>TYPE</th></tr></thead>
                <tbody>
                  {(data.dividends ?? []).map((d: any, i: number) => (
                    <tr key={i}>
                      <td>{d.date}</td>
                      <td style={{ textAlign: "right" }} className="pos">+{d.amount}</td>
                      <td style={{ textAlign: "right" }}><span className="badge">REGULAR CASH</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data.dividends ?? []).length === 0 && <p className="muted">NO PAYOUTS ON FEED.</p>}
          </div>
          <div className="panel">
            <p className="p-head">Annual totals + growth</p>
            <table className="plain">
              <thead><tr><th>YEAR</th><th style={{ textAlign: "right" }}>TOTAL ₹</th><th style={{ textAlign: "right" }}>#</th><th style={{ textAlign: "right" }}>GROWTH</th></tr></thead>
              <tbody>
                {(data.annual ?? []).map((a: any) => (
                  <tr key={a.year}>
                    <td><strong>{a.year}</strong></td>
                    <td style={{ textAlign: "right" }}>{a.total.toLocaleString("en-IN")}</td>
                    <td style={{ textAlign: "right" }}>{a.count}</td>
                    <td style={{ textAlign: "right" }}>{g(a.growth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "SPLITS" && (
        <div className="panel">
          <p className="p-head">Splits & bonuses — prices already split-adjusted</p>
          <table className="plain">
            <thead><tr><th>DATE</th><th style={{ textAlign: "right" }}>RATIO</th><th style={{ textAlign: "right" }}>TYPE</th></tr></thead>
            <tbody>
              {(data.splits ?? []).map((s: any, i: number) => (
                <tr key={i}>
                  <td>{s.date}</td>
                  <td style={{ textAlign: "right" }}><span className="badge fnc">{s.ratio}</span></td>
                  <td style={{ textAlign: "right" }}><span className="badge">STOCK SPLIT</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.splits ?? []).length === 0 && <p className="muted">NO SPLITS ON FEED.</p>}
        </div>
      )}

      {tab === "BOARD" && <ScreenerDesk kind="dividend" />}
    </div>
  );
}

/* ---------------- ownership desk (OWN) ---------------- */

const HOLDER_COLORS: Record<string, string> = {
  PROMOTER: "#ffa028", FII: "#00d664", DII: "#8f7bff", PUBLIC: "#5b5b62", GOVT: "#00c8ff",
};

function pickHolder(rows: Array<{ label: string; values: (number | null)[] }>, cands: string[]) {
  const hit = rows.find((r) => cands.some((c) => r.label.toLowerCase().includes(c)));
  if (!hit) return null;
  return hit;
}

export function OwnDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<{
    periods: string[]; rows: Array<{ label: string; values: (number | null)[] }>;
    latest: Record<string, number | null>; qoq: Record<string, number | null>;
  } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null); setErr("");
    fetch(`/api/ownership?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "ownership failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol]);

  if (err) return <div className="panel"><p className="neg">OWN ERR: {err}</p></div>;
  if (!data) return <div className="panel"><p className="muted">PULLING HOLDER LEDGER…</p></div>;

  const groups: Array<{ key: string; label: string; cands: string[] }> = [
    { key: "PROMOTER", label: "Promoters", cands: ["promoter"] },
    { key: "FII", label: "FIIs", cands: ["fii"] },
    { key: "DII", label: "DII", cands: ["dii"] },
    { key: "PUBLIC", label: "Public", cands: ["public"] },
    { key: "GOVT", label: "Government", cands: ["government"] },
  ];
  const series = groups
    .map((g) => ({ ...g, row: pickHolder(data.rows, g.cands) }))
    .filter((g) => g.row && g.row.values.some((v) => v !== null && v > 0));
  const x3: [string, string, string] = [
    data.periods[0] ?? "", data.periods[Math.floor(data.periods.length / 2)] ?? "", data.periods[data.periods.length - 1] ?? "",
  ];

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Ownership — {symbol} · latest {data.periods[data.periods.length - 1] ?? ""} · QoQ Δpp</p>
        <div className="cells">
          {series.map((g) => {
            const vals = (g.row!.values.filter((v): v is number => v !== null) as number[]);
            const last = vals.length ? vals[vals.length - 1] : null;
            const dq = data.qoq[g.row!.label] ?? null;
            return (
              <div className="cell" key={g.key}>
                <div className="lbl">{g.label}</div>
                <div className="val">{last !== null ? `${last.toFixed(2)}%` : "—"}</div>
                <div className="sub">{dq === null ? "QoQ —" : <span className={dq >= 0 ? "pos" : "neg"}>{dq >= 0 ? "+" : ""}{dq.toFixed(2)}pp</span>}</div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <p className="p-head">Holder mix — latest</p>
            <Donut slices={series.map((g) => {
              const vals = g.row!.values.filter((v): v is number => v !== null);
              return { label: g.key, value: vals.length ? vals[vals.length - 1] : 0, color: HOLDER_COLORS[g.key] ?? "#5b5b62" };
            })} />
          </div>
          <div>
            <p className="p-head">Mix trend — quarterly %</p>
            <LineChart
              series={series.map((g) => ({ label: g.key, color: HOLDER_COLORS[g.key] ?? "#5b5b62", values: g.row!.values }))}
              height={150} yFmt={(v) => `${v.toFixed(0)}%`} dates={data.periods} xLabels={x3}
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Full holder ledger % + QoQ Δpp</p>
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th></th>{data.periods.map((p) => <th key={p} style={{ textAlign: "right" }}>{p}</th>)}<th style={{ textAlign: "right" }}>QOQ Δ</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.label}>
                  <td><strong>{r.label}</strong></td>
                  {r.values.map((v, i) => (
                    <td key={i} style={{ textAlign: "right" }}>{v === null ? "—" : v.toFixed(2)}</td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    {(() => {
                      const d = data.qoq[r.label];
                      return d === null || d === undefined ? "—" : <span className={d >= 0 ? "pos" : "neg"}>{d >= 0 ? "+" : ""}{d.toFixed(2)}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>
          NAMED HOLDERS (INSTITUTIONS/INSIDERS/GEOGRAPHY) NEED EXCHANGE FILINGS FEEDS — NOT ON FREE DATA. PATTERN + TREND ABOVE IS COMPLETE.
        </p>
      </div>
    </div>
  );
}
