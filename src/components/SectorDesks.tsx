"use client";

import { useEffect, useMemo, useState } from "react";
import { SECTORS, sectorOf } from "@/lib/sectors";
import { HBars, HoverTip, useHoverIndex } from "./charts";

interface SectorRow {
  sym: string; price: number; day: number | null;
  m21: number | null; m63: number | null; m126: number | null; m252: number | null;
  vol: number | null; dd: number | null; beta: number | null;
  above50: boolean | null; above200: boolean | null;
  rsr: number | null; rsm: number | null;
}
interface SectorData {
  sector: string; sectorName: string; period: string; periodLabel: string;
  universe: number; count: number; forSymbol: string | null;
  breadth: { b50: number | null; b200: number | null };
  avgBeta: number | null; secTotal: number | null; nifTotal: number | null;
  excess: number | null; rows: SectorRow[];
  curve: { sector: number[]; nifty: number[]; dates?: string[] };
}

const PERIODS = ["1M", "3M", "6M", "1Y"] as const;
const short = (s: string) => s.replace(".NS", "");
const fmtM = (v: unknown) => (typeof v === "number" && isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
const momKey: Record<string, keyof SectorRow> = { "1M": "m21", "3M": "m63", "6M": "m126", "1Y": "m252" };

function useSector(sector: string, period: string, nonce: number) {
  const [data, setData] = useState<SectorData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr("");
    fetch(`/api/sector?sector=${encodeURIComponent(sector)}&period=${encodeURIComponent(period)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "sector failed");
        if (alive) setData(j);
      })
      .catch((e) => { if (alive) setErr(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [sector, period, nonce]);
  return { data, err, loading };
}

function Curve({ sec, nif, dates }: { sec: number[]; nif: number[]; dates?: string[] }) {
  const n = Math.min(sec.length, nif.length);
  const { hover, bind } = useHoverIndex(n);
  if (n < 5) return <p className="muted">NO CURVE.</p>;
  const s = sec.slice(-n), b = nif.slice(-n);
  const lo = Math.min(...s, ...b), hi = Math.max(...s, ...b);
  const W = 600, H = 120;
  const X = (i: number) => (i / (n - 1)) * W;
  const Y = (v: number) => H - 8 - ((v - lo) / (hi - lo || 1)) * (H - 16);
  const pts = (a: number[]) => a.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const hi2 = hover !== null ? hover + (sec.length - n) : null;
  const sv = hi2 !== null ? sec[hi2] : null;
  const bv = hi2 !== null ? nif[hi2] : null;
  const ex = sv !== null && bv !== null ? sv - bv : null;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} preserveAspectRatio="none" {...bind}>
        <line x1="0" x2={W} y1={Y(0)} y2={Y(0)} stroke="#26262b" strokeWidth="1" />
        <polyline points={pts(b)} fill="none" stroke="#a1a1aa" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={pts(s)} fill="none" stroke="#ffa028" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        {hover !== null && (
          <g>
            <line x1={X(hover)} x2={X(hover)} y1="0" y2={H} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {sv !== null && <circle cx={X(hover)} cy={Y(sv)} r="3.5" fill="#ffa028" />}
            {bv !== null && <circle cx={X(hover)} cy={Y(bv)} r="3.5" fill="#a1a1aa" />}
          </g>
        )}
      </svg>
      {hover !== null && sv !== null && bv !== null && ex !== null && (
        <HoverTip
          idx={hover} count={n} date={dates?.[hi2 ?? 0] ?? `BAR ${(hi2 ?? 0) + 1}/${sec.length}`}
          rows={[
            { label: "SECTOR", color: "#ffa028", text: `${sv >= 0 ? "+" : ""}${sv.toFixed(2)}%` },
            { label: "NIFTY", color: "#a1a1aa", text: `${bv >= 0 ? "+" : ""}${bv.toFixed(2)}%` },
            { label: "EXCESS", color: ex >= 0 ? "#00d664" : "#ff453a", text: `${ex >= 0 ? "+" : ""}${ex.toFixed(2)}pp` },
          ]}
        />
      )}
    </div>
  );
}

// JdK-lite rotation: x = RS-Ratio, y = RS-Momentum, centre 100/100.
function Quad({ rows, hot }: { rows: SectorRow[]; hot: string }) {
  const pts = rows.filter((r) => r.rsr !== null && r.rsm !== null) as Array<SectorRow & { rsr: number; rsm: number }>;
  if (pts.length < 3) return <p className="muted">NO ROTATION READ.</p>;
  const xs = pts.map((p) => p.rsr), ys = pts.map((p) => p.rsm);
  const loX = Math.min(98, ...xs), hiX = Math.max(102, ...xs);
  const loY = Math.min(98, ...ys), hiY = Math.max(102, ...ys);
  const W = 420, H = 300;
  const X = (v: number) => ((v - loX) / (hiX - loX || 1)) * (W - 16) + 8;
  const Y = (v: number) => H - 14 - ((v - loY) / (hiY - loY || 1)) * (H - 28);
  const q = (x: number, y: number, t: string) => (
    <text x={x} y={y} fontSize="10" fill="#5b5b62" textAnchor="middle" fontWeight="700">{t}</text>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }}>
      <line x1={X(100)} x2={X(100)} y1="6" y2={H - 14} stroke="#26262b" />
      <line x1="8" x2={W - 8} y1={Y(100)} y2={Y(100)} stroke="#26262b" />
      {q((X(100) + W - 8) / 2, 20, "LEADING")}
      {q((8 + X(100)) / 2, 20, "WEAKENING")}
      {q((8 + X(100)) / 2, H - 20, "LAGGING")}
      {q((X(100) + W - 8) / 2, H - 20, "IMPROVING")}
      {pts.map((p) => {
        const isHot = p.sym === hot;
        return (
          <g key={p.sym}>
            <title>{short(p.sym)} · RS {p.rsr.toFixed(1)} / {p.rsm.toFixed(1)}</title>
            <circle cx={X(p.rsr)} cy={Y(p.rsm)} r={isHot ? 6 : 4} fill={isHot ? "#ffa028" : p.rsr >= 100 && p.rsm >= 100 ? "#00d664" : p.rsr < 100 && p.rsm < 100 ? "#ff453a" : "#a1a1aa"} opacity="0.9" />
            <text x={X(p.rsr) + 7} y={Y(p.rsm) + 3} fontSize="9" fill={isHot ? "#ffa028" : "#a1a1aa"} fontWeight={isHot ? 700 : 400}>{short(p.sym)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function SectorDesk({ symbol, onOpen }: { symbol: string; onOpen?: (funcId: string, symbol: string) => void }) {
  const auto = sectorOf(symbol) ?? "6";
  const [sector, setSector] = useState(auto);
  const [period, setPeriod] = useState<string>("1Y");
  const [nonce, setNonce] = useState(0);
  useEffect(() => { setSector(sectorOf(symbol) ?? "6"); }, [symbol]);
  const { data, err, loading } = useSector(sector, period, nonce);
  const mk = momKey[period] ?? "m252";

  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => (b[mk] as number | null ?? -Infinity) - (a[mk] as number | null ?? -Infinity));
  }, [data, mk]);

  // Hot-ticker rotation read + sector dispersion.
  const hot = data?.rows.find((r) => r.sym === symbol) ?? null;
  const hotRank = hot ? ranked.findIndex((r) => r.sym === symbol) + 1 : null;
  const hotQuad = !hot || hot.rsr === null || hot.rsm === null ? null
    : hot.rsr >= 100 && hot.rsm >= 100 ? "LEADING" : hot.rsr >= 100 ? "WEAKENING" : hot.rsm >= 100 ? "IMPROVING" : "LAGGING";
  const momVals = ranked.map((r) => r[mk] as number | null).filter((v): v is number => v !== null);
  const spread = momVals.length >= 2 ? Math.max(...momVals) - Math.min(...momVals) : null;
  const lead = ranked[0] ?? null, lag = ranked.length ? ranked[ranked.length - 1] : null;

  function openPeer(sym: string) {
    if (onOpen) onOpen("1", sym);
    else window.location.href = `/module/1?symbol=${encodeURIComponent(sym)}`;
  }

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Sector rotation — {data ? data.sectorName.toUpperCase() : "…"} · {data?.periodLabel.toUpperCase() ?? ""}{symbol ? ` · FOR ${short(symbol)}` : ""}</p>
        <div className="toolbar">
          <select className="box" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
            {Object.entries(SECTORS).map(([k, s]) => (
              <option key={k} value={k}>{s.name.toUpperCase()} ({s.tickers.length})</option>
            ))}
          </select>
          <div className="pills">
            {PERIODS.map((p) => (
              <button key={p} className={`pill${period === p ? " active" : ""}`} onClick={() => setPeriod(p)}>{p}</button>
            ))}
          </div>
          {loading && <span className="muted">SCANNING SECTOR…</span>}
        </div>
        {err && <p className="neg">ERR: {err} <button className="ghost" style={{ marginLeft: 6 }} onClick={() => setNonce((n) => n + 1)}>RETRY</button></p>}
        {data && (
          <div className="cells" style={{ marginTop: 10 }}>
            <div className="cell"><div className="lbl">Sector {data.period}</div><div className={`val ${(data.secTotal ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{data.secTotal !== null ? `${data.secTotal >= 0 ? "+" : ""}${data.secTotal.toFixed(2)}%` : "—"}</div><div className="sub">eq-weight {data.count} sec</div></div>
            <div className="cell"><div className="lbl">Nifty {data.period}</div><div className={`val ${(data.nifTotal ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{data.nifTotal !== null ? `${data.nifTotal >= 0 ? "+" : ""}${data.nifTotal.toFixed(2)}%` : "—"}</div><div className="sub">benchmark</div></div>
            <div className="cell"><div className="lbl">Excess</div><div className={`val ${(data.excess ?? 0) >= 0 ? "pos" : "neg"}`} style={{ fontSize: 16 }}>{data.excess !== null ? `${data.excess >= 0 ? "+" : ""}${data.excess.toFixed(2)}pp` : "—"}</div><div className="sub">sector − nifty</div></div>
            <div className="cell"><div className="lbl">Breadth 50D</div><div className="val" style={{ fontSize: 16 }}>{data.breadth.b50 !== null ? `${data.breadth.b50.toFixed(0)}%` : "—"}</div><div className="sub">above MA50</div></div>
            <div className="cell"><div className="lbl">Breadth 200D</div><div className="val" style={{ fontSize: 16 }}>{data.breadth.b200 !== null ? `${data.breadth.b200.toFixed(0)}%` : "—"}</div><div className="sub">above MA200</div></div>
            <div className="cell"><div className="lbl">Avg beta 60D</div><div className="val" style={{ fontSize: 16 }}>{data.avgBeta !== null && data.avgBeta !== undefined ? Number(data.avgBeta).toFixed(2) : "—"}</div><div className="sub">vs nifty</div></div>
          </div>
        )}
        {data && (
          <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
            {hotQuad && hot ? <><span className={hotQuad === "LEADING" ? "pos" : hotQuad === "LAGGING" ? "neg" : "sec"}>{short(symbol)}: {hotQuad}</span> · RANK {hotRank}/{ranked.length} · RS {hot.rsr !== null ? hot.rsr.toFixed(1) : "—"}/{hot.rsm !== null ? hot.rsm.toFixed(1) : "—"}</> : <>{short(symbol)}: NO ROTATION READ</>}
            {lead && lag && lead.sym !== lag.sym && (
              <> · <span className="pos">▲ {short(lead.sym)} {fmtM(lead[mk])}</span> · <span className="neg">▼ {short(lag.sym)} {fmtM(lag[mk])}</span>{spread !== null ? <> · SPREAD {spread.toFixed(1)}pp</> : null}</>
            )}
          </p>
        )}
      </div>

      {data && (
        <>
          <div className="duo">
            <div className="panel">
              <p className="p-head">Sector vs Nifty — {data.period} cumulative %</p>
              <Curve sec={data.curve.sector} nif={data.curve.nifty} dates={data.curve.dates} />
              <div className="muted" style={{ fontSize: 11.5 }}><span style={{ color: "#ffa028" }}>— {data.sectorName.toUpperCase()} EQ-WT</span>{"  "}<span style={{ color: "#a1a1aa" }}>— NIFTY 50</span></div>
            </div>
            <div className="panel">
              <p className="p-head">Rotation quadrant — RS ratio × momentum</p>
              <Quad rows={data.rows} hot={symbol} />
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 0 }}>LEADING = own it · WEAKENING = trim · LAGGING = avoid · IMPROVING = watchlist.</p>
            </div>
          </div>

          <div className="panel">
            <p className="p-head">Peer momentum — {data.period} %</p>
            <HBars rows={ranked.map((r) => {
              const v = r[mk] as number | null;
              return {
                label: `${r.sym === symbol ? "◆ " : ""}${short(r.sym)}`,
                value: v ?? 0,
                display: v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` : "—",
                color: r.sym === symbol ? "#ffa028" : (v ?? 0) >= 0 ? "#00d664" : "#ff453a",
              };
            })} />
          </div>

          <div className="panel" style={{ overflowX: "auto" }}>
            <p className="p-head">Peer board — {data.count} securities · {onOpen ? "CLICK OPENS IN THIS PANEL" : "CLICK OPENS DESK"}</p>
            <table className="plain">
              <thead><tr><th>#</th><th>SEC</th><th style={{ textAlign: "right" }}>PX ₹</th><th style={{ textAlign: "right" }}>DAY %</th><th style={{ textAlign: "right" }}>1M</th><th style={{ textAlign: "right" }}>3M</th><th style={{ textAlign: "right" }}>6M</th><th style={{ textAlign: "right" }}>1Y</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>BETA</th><th style={{ textAlign: "right" }}>RS</th><th style={{ textAlign: "right" }}>TREND</th></tr></thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr
                    key={r.sym}
                    style={{ cursor: "pointer", ...(r.sym === symbol ? { background: "rgba(255,160,40,0.07)" } : undefined) }}
                    onClick={() => openPeer(r.sym)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPeer(r.sym); } }}
                    tabIndex={0}
                    title={`${short(r.sym)} — OPEN TECHNICALS ${onOpen ? "HERE" : "IN FULL PAGE"}`}
                  >
                    <td className="faint">{i + 1}</td>
                    <td><span className="sec">{r.sym === symbol ? "◆ " : ""}{short(r.sym)}</span></td>
                    <td style={{ textAlign: "right" }}>{r.price.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                    <td style={{ textAlign: "right" }}>{r.day !== null ? <span className={r.day >= 0 ? "pos" : "neg"}>{r.day >= 0 ? "+" : ""}{r.day.toFixed(2)}</span> : "—"}</td>
                    {([r.m21, r.m63, r.m126, r.m252] as Array<number | null>).map((v, j) => (
                      <td key={j} style={{ textAlign: "right" }}>{v !== null ? <span className={v >= 0 ? "pos" : "neg"}>{v >= 0 ? "+" : ""}{v.toFixed(1)}</span> : "—"}</td>
                    ))}
                    <td style={{ textAlign: "right" }}>{r.vol !== null ? r.vol.toFixed(1) : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.beta ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.rsr !== null ? r.rsr.toFixed(0) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={r.above50 ? "pos" : "neg"} title="ABOVE MA50">{r.above50 === null ? "—" : r.above50 ? "▲" : "▼"}</span>{" "}
                      <span className={r.above200 ? "pos" : "neg"} title="ABOVE MA200">{r.above200 === null ? "—" : r.above200 ? "▲" : "▼"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 11.5 }}>MOM = log-compounded. RS = Nifty-relative strength (100 = neutral). TREND = above MA50 / MA200. ◆ = your ticker.</p>
          </div>
        </>
      )}
    </div>
  );
}
