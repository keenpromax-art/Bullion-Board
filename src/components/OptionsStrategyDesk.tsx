"use client";

import { useMemo, useState } from "react";
import { logReturns } from "@/lib/indicators";
import { historicalVol, volRegime, trendBias } from "@/lib/options";
import {
  buildAllStrategies, detectBias, pnlAt, RISK_FREE,
  type StrategyResult,
} from "@/lib/strategyEngine";
import { blackScholes } from "@/lib/options";

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

function fmtINR(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp })}`;
}
function fmtPct(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}%`;
}
function fmtN(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return v.toFixed(dp);
}

function PayoffChart({ s, spot, sd1, lot }: { s: StrategyResult; spot: number; sd1: number; lot: number }) {
  const W = 640, H = 220, PAD = 10;
  const xs = s.xs, pnls = s.pnls.map((p) => p * lot);
  if (!xs.length) return null;
  const lo = xs[0], hi = xs[xs.length - 1];
  let mn = Math.min(...pnls, 0), mx = Math.max(...pnls, 0);
  if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
  const padY = (mx - mn) * 0.08;
  mx += padY; mn -= padY;
  const X = (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
  const Y = (v: number) => H - PAD - ((v - mn) / (mx - mn)) * (H - PAD * 2);
  const pts = xs.map((x, i) => `${X(x).toFixed(1)},${Y(pnls[i]).toFixed(1)}`).join(" ");
  const zeroY = Y(0);
  const spotX = X(Math.min(Math.max(spot, lo), hi));
  const up = pnls[pnls.length - 1] >= pnls[0];
  // profit-zone path
  const zonePts = `M ${X(lo).toFixed(1)},${zeroY.toFixed(1)} L ${pts.split(" ").join(" L ")} L ${X(hi).toFixed(1)},${zeroY.toFixed(1)} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} preserveAspectRatio="none">
        {/* ±1SD band */}
        <rect x={X(Math.max(spot - sd1, lo))} y={PAD} width={Math.max(X(Math.min(spot + sd1, hi)) - X(Math.max(spot - sd1, lo)), 0)} height={H - PAD * 2} fill="rgba(255,160,40,0.07)" />
        <path d={zonePts} fill={up ? "rgba(0,214,100,0.10)" : "rgba(255,69,58,0.10)"} />
        <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="#5b5b62" strokeWidth="1" strokeDasharray="5 4" />
        <polyline points={pts} fill="none" stroke={pnls[pnls.length - 1] >= 0 || Math.max(...pnls) > 0 ? "#ffa028" : "#ff453a"} strokeWidth="2" />
        {/* breakevens */}
        {s.breakevens.map((be, i) => (
          <g key={i}>
            <line x1={X(be)} x2={X(be)} y1={PAD} y2={H - PAD} stroke="#8f7bff" strokeWidth="1" strokeDasharray="3 3" />
            <text x={X(be)} y={H - 2} fontSize="9" fill="#8f7bff" textAnchor="middle">BE {Math.round(be).toLocaleString("en-IN")}</text>
          </g>
        ))}
        {/* spot */}
        <line x1={spotX} x2={spotX} y1={PAD} y2={H - PAD} stroke="#f5f5f4" strokeWidth="1.2" />
        <text x={spotX + 4} y={PAD + 10} fontSize="10" fill="#f5f5f4" fontWeight="700">SPOT {Math.round(spot).toLocaleString("en-IN")}</text>
        {/* strikes */}
        {s.legs.map((l, i) => (
          <g key={i}>
            <line x1={X(Math.min(Math.max(l.strike, lo), hi))} x2={X(Math.min(Math.max(l.strike, lo), hi))} y1={H - 34} y2={H - PAD} stroke={l.action === "buy" ? "#00d664" : "#ff453a"} strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      <div className="pills" style={{ marginTop: 4 }}>
        <span className="badge fnc">■ PAYOFF ×{lot}</span>
        <span className="badge ok">— ZERO</span>
        <span className="badge">▒ ±1SD {fmtINR(spot - sd1)} – {fmtINR(spot + sd1)}</span>
        <span className="badge bad">┆ BE</span>
        <span className="badge ok">綠 BUY LEG</span>
        <span className="badge bad">紅 SELL LEG</span>
      </div>
    </div>
  );
}

export default function OptionsStrategyDesk({ symbol, data }: { symbol: string; data: any }) {
  const closes: number[] = useMemo(() => (data?.bars ?? []).map((b: any) => b.close), [data]);
  const ind = data?.indicators ?? {};
  const risk = data?.risk ?? {};
  const opt = data?.extra?.options ?? {};
  const spot: number = data?.quote?.regularMarketPrice ?? data?.price ?? 0;

  const [dte, setDte] = useState(30);
  const [ivOv, setIvOv] = useState<string>("");
  const [lot, setLot] = useState(1);
  const [lotSize, setLotSize] = useState(50);
  const [filter, setFilter] = useState<"ALL" | "DEBIT" | "CREDIT" | "VOL" | "NEUTRAL">("ALL");
  const [selName, setSelName] = useState<string | null>(null);

  const calc = useMemo(() => {
    if (!closes.length || !spot) return null;
    const lr = logReturns(closes);
    const hv10 = historicalVol(lr, 10);
    const hv30 = historicalVol(lr, 30);
    const hv252 = historicalVol(lr);
    const tb = trendBias(closes);
    const ivNum = ivOv.trim() === "" ? null : Number(ivOv);
    const bias = detectBias({
      closes, hv10, hv30, hv252, trendBias01: tb,
      rsi: isFinite(ind.rsi) ? ind.rsi : null,
      macdHist: isFinite(ind.macdHist) ? ind.macdHist : null,
      adx: isFinite(ind.adx) ? ind.adx : null,
      hurst: isFinite(risk.hurst) ? risk.hurst : null,
      ivOverridePct: ivNum && ivNum > 0 ? ivNum : null,
    });
    const sigma = (ivNum && ivNum > 0 ? ivNum / 100 : bias.ivPct / 100) || hv30 || hv252 || 0.3;
    const strats = buildAllStrategies({ spot, sigma, dte, bias });
    const expMove = spot * sigma * Math.sqrt(Math.max(dte, 1) / 365);
    return { hv10, hv30, hv252, tb, bias, sigma, strats, expMove, regime: volRegime(hv10, hv252) };
  }, [closes, spot, ind.rsi, ind.macdHist, ind.adx, risk.hurst, dte, ivOv]);

  const visible = useMemo(() => {
    if (!calc) return [];
    if (filter === "ALL") return calc.strats;
    const map: Record<string, string> = { DEBIT: "Debit", CREDIT: "Credit", VOL: "Volatility", NEUTRAL: "Neutral" };
    return calc.strats.filter((s) => s.category === map[filter]);
  }, [calc, filter]);

  const sel: StrategyResult | null = useMemo(() => {
    if (!calc) return null;
    if (selName) return calc.strats.find((s) => s.name === selName) ?? calc.strats[0] ?? null;
    return calc.strats[0] ?? null;
  }, [calc, selName]);

  if (!calc || !sel) return <div className="panel"><p className="muted">INSUFFICIENT DATA FOR STRATEGY ENGINE.</p></div>;

  const { bias, hv10, hv30, hv252, regime, expMove, sigma } = calc;
  const mult = Math.max(lot, 1) * Math.max(lotSize, 1);
  const bearish = bias.trendLabel.includes("Bear");
  const bullish = bias.trendLabel.includes("Bull");

  const scen = [-0.03, -0.01, 0, 0.01, 0.03].map((m) => ({ m, px: spot * (1 + m), pnl: pnlAt(sel, spot * (1 + m)) * lot }));
  const sdScen = [
    { label: "-1SD", px: spot - expMove, pnl: pnlAt(sel, spot - expMove) * lot },
    { label: "+1SD", px: spot + expMove, pnl: pnlAt(sel, spot + expMove) * lot },
  ];

  const netPerLot = sel.netPremium * mult;
  const aggGreeks = sel.legs.reduce(
    (a, l) => {
      const g = l.greeks;
      const sgn = l.action === "buy" ? 1 : -1;
      return {
        delta: a.delta + (g ? g.delta * sgn * l.qty : 0),
        theta: a.theta + (g ? g.theta * sgn * l.qty : 0),
        vega: a.vega + (g ? g.vega * sgn * l.qty : 0),
        gamma: a.gamma + (g ? g.gamma * sgn * l.qty : 0),
      };
    },
    { delta: 0, theta: 0, vega: 0, gamma: 0 }
  );

  return (
    <>
      {/* controls */}
      <div className="panel panel-glow">
        <p className="p-head">Strategy creator — {symbol} · spot {fmtINR(spot)} · regime engine</p>
        <div className="toolbar" style={{ flexWrap: "wrap" }}>
          <label className="muted" style={{ fontSize: 12 }}>DTE
            <select className="box" value={dte} onChange={(e) => setDte(Number(e.target.value))} style={{ marginLeft: 6 }}>
              {[7, 14, 21, 30, 45, 60].map((d) => <option key={d} value={d}>{d}D</option>)}
            </select>
          </label>
          <label className="muted" style={{ fontSize: 12 }}>IV % OVERRIDE
            <input className="box" value={ivOv} onChange={(e) => setIvOv(e.target.value)} placeholder={`${bias.ivPct.toFixed(1)}`} style={{ width: 80, marginLeft: 6 }} />
          </label>
          <label className="muted" style={{ fontSize: 12 }}>LOTS
            <input className="box" type="number" min={1} value={lot} onChange={(e) => setLot(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64, marginLeft: 6 }} />
          </label>
          <label className="muted" style={{ fontSize: 12 }}>QTY/LOT
            <input className="box" type="number" min={1} value={lotSize} onChange={(e) => setLotSize(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, marginLeft: 6 }} />
          </label>
          <span className="muted" style={{ fontSize: 12 }}>×{mult.toLocaleString("en-IN")} SH</span>
          {(["ALL", "DEBIT", "CREDIT", "VOL", "NEUTRAL"] as const).map((f) => (
            <button key={f} className={filter === f ? "btn" : "ghost"} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          PRICED WITH BLACK-SCHOLES · σ {(sigma * 100).toFixed(1)}% · R {(RISK_FREE * 100).toFixed(1)}% · T {(Math.max(dte, 1) / 365).toFixed(3)}Y ·
          PAYOFF AT EXPIRY · PREMIUMS ARE THEORETICAL — SKIP IF BROKER IV &gt; 20% RICH
        </div>
      </div>

      {/* regime read */}
      <div className="grid grid-3">
        <div className="panel">
          <p className="p-head">Bias — current scenario</p>
          <div style={{ marginBottom: 8 }}>
            <span className={`badge ${bullish ? "ok" : bearish ? "bad" : "fnc"}`} style={{ fontSize: 14, padding: "7px 12px" }}>{bias.trendLabel.toUpperCase()}</span>
          </div>
          <KV k="BIAS SCORE" v={`${bias.biasScore >= 0 ? "+" : ""}${bias.biasScore.toFixed(1)}`} cls={bias.biasScore >= 0 ? "pos" : "neg"} />
          <KV k="MOM 5D" v={fmtPct(bias.momentum5dPct)} cls={bias.momentum5dPct >= 0 ? "pos" : "neg"} />
          <KV k="VS MA20 / MA50" v={`${fmtPct(bias.priceVsMA20Pct, 1)} / ${fmtPct(bias.priceVsMA50Pct, 1)}`} />
          <KV k="RSI / ADX" v={`${fmtN(bias.rsi, 1)} / ${fmtN(bias.adx, 1)}`} />
          <KV k="MACD HIST" v={fmtN(bias.macdHist, 3)} cls={(bias.macdHist ?? 0) >= 0 ? "pos" : "neg"} />
          <KV k="HURST" v={fmtN(bias.hurst, 3)} />
        </div>
        <div className="panel">
          <p className="p-head">Vol — term + IV</p>
          <KV k="HV 10 / 30 / 252" v={`${(hv10 * 100).toFixed(1)} / ${(hv30 * 100).toFixed(1)} / ${(hv252 * 100).toFixed(1)}`} />
          <KV k="HV REGIME" v={regime} cls={regime.includes("EXPAND") ? "neg" : regime.includes("COMPRESS") ? "pos" : ""} />
          <KV k="IV USED" v={`${bias.ivPct.toFixed(1)}% · ${bias.ivRegime.toUpperCase()}`} cls={bias.ivRegime === "Low" ? "pos" : bias.ivRegime !== "Normal" ? "neg" : ""} />
          <KV k="VOL EXPANDING" v={bias.volExpanding ? "YES" : "NO"} cls={bias.volExpanding ? "neg" : "pos"} />
          <KV k="EXP MOVE ±1SD" v={`${fmtINR(expMove)} · ${((expMove / spot) * 100).toFixed(1)}%`} />
          <KV k="RANGE" v={`${fmtINR(spot - expMove, 0)} – ${fmtINR(spot + expMove, 0)}`} />
        </div>
        <div className="panel panel-glow">
          <p className="p-head">Desk approach</p>
          <p style={{ margin: "0 0 8px 0", fontSize: 13, lineHeight: 1.5 }}><span className="sec">{bias.approach.toUpperCase()}</span></p>
          <KV k="ATM CALL" v={opt.atmCall ? `${fmtINR(opt.atmCall.price)} · Δ ${fmtN(opt.atmCall.delta, 3)}` : "—"} />
          <KV k="ATM PUT" v={opt.atmPut ? `${fmtINR(opt.atmPut.price)} · Δ ${fmtN(opt.atmPut.delta, 3)}` : "—"} />
          <KV k="PICKED" v={sel ? `${sel.name.toUpperCase()} · ${sel.score.toFixed(0)}/100` : "—"} cls="sec" />
          <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
            {bearish ? "BEAR tilt — put spreads / bear-call credit favoured; outright calls penalised." : bullish ? "BULL tilt — call spreads / bull-put credit favoured; outright puts penalised." : "NEUTRAL — income / pin strategies score highest; outright buying bleeds theta."}
            {bias.ivRegime !== "Low" && bias.ivRegime !== "Normal" ? " HIGH IV — outright buying penalised, spreads/credit boosted." : ""}
          </p>
        </div>
      </div>

      {/* top-3 */}
      <div className="panel">
        <p className="p-head">Top-3 for this regime — click to inspect</p>
        <div className="grid grid-3">
          {calc.strats.slice(0, 3).map((s, i) => (
            <button
              key={s.name}
              onClick={() => setSelName(s.name)}
              style={{
                textAlign: "left", cursor: "pointer", background: sel.name === s.name ? "rgba(255,160,40,0.10)" : "var(--panel-2)",
                border: sel.name === s.name ? "1px solid var(--amber)" : "1px solid var(--grid)", borderRadius: 3, padding: 12, color: "inherit", fontFamily: "inherit",
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>#{i + 1} · {s.category.toUpperCase()} · {s.biasSuitedFor.toUpperCase()}</div>
              <div style={{ fontSize: 16, fontWeight: 700, margin: "4px 0" }}>★ {s.name}</div>
              <div style={{ fontSize: 12 }}><span className="sec">{s.score.toFixed(0)}/100</span><span className="muted"> · P(profit) {(s.probProfit * 100).toFixed(0)}% · R/R {s.riskReward === Infinity ? "∞" : s.riskReward.toFixed(1)}</span></div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{s.description}</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>
                <span className={s.netPremium > 0 ? "neg" : "pos"}>{s.netPremium > 0 ? `DEBIT ${fmtINR(s.netPremium * mult)}` : s.netPremium < 0 ? `CREDIT ${fmtINR(-s.netPremium * mult)}` : "ZERO COST"}</span>
                <span className="muted"> · MAX {s.maxProfitUnlimited ? "∞" : fmtINR(s.maxProfit * mult)} / {s.maxLossUnlimited ? "∞" : fmtINR(Math.abs(s.maxLoss * mult))}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* selected detail */}
      <div className="panel panel-glow">
        <p className="p-head">Selected — {sel.name} · {sel.category.toUpperCase()} · suits {sel.biasSuitedFor.toUpperCase()}</p>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px 0" }}>{sel.description}</p>
        <div className="cells" style={{ marginBottom: 10 }}>
          <div className="cell"><div className="lbl">Score</div><div className="val sec" style={{ fontSize: 20 }}>{sel.score.toFixed(0)}/100</div><div className="sub">regime fit</div></div>
          <div className="cell"><div className="lbl">{sel.netPremium > 0 ? "Net debit" : "Net credit"}</div><div className={`val ${sel.netPremium > 0 ? "neg" : "pos"}`} style={{ fontSize: 17 }}>{fmtINR(Math.abs(netPerLot))}</div><div className="sub">×{mult.toLocaleString("en-IN")} sh</div></div>
          <div className="cell"><div className="lbl">Max profit</div><div className="val pos" style={{ fontSize: 17 }}>{sel.maxProfitUnlimited ? "∞" : fmtINR(sel.maxProfit * mult)}</div><div className="sub">at expiry</div></div>
          <div className="cell"><div className="lbl">Max loss</div><div className="val neg" style={{ fontSize: 17 }}>{sel.maxLossUnlimited ? "∞ UNHEDGED" : fmtINR(Math.abs(sel.maxLoss * mult))}</div><div className="sub">defined?</div></div>
          <div className="cell"><div className="lbl">Breakeven(s)</div><div className="val" style={{ fontSize: 13 }}>{sel.breakevens.length ? sel.breakevens.map((b) => Math.round(b * mult / mult).toLocaleString("en-IN")).join(" · ") : "—"}</div><div className="sub">{sel.breakevens.length ? sel.breakevens.map((b) => `${(((b - spot) / spot) * 100).toFixed(1)}%`).join(" · ") : "no cross in ±30%"}</div></div>
          <div className="cell"><div className="lbl">P(profit) / R:R</div><div className="val" style={{ fontSize: 17 }}>{(sel.probProfit * 100).toFixed(0)}% <span className="muted" style={{ fontSize: 12 }}>/ {sel.riskReward === Infinity ? "∞" : sel.riskReward.toFixed(1)}</span></div><div className="sub">of ±30% range</div></div>
        </div>
        <PayoffChart s={sel} spot={spot} sd1={expMove} lot={lot} />
        {(sel.scoreReasons.length > 0 || sel.scoreWarnings.length > 0) && (
          <div className="grid grid-2" style={{ marginTop: 10 }}>
            <div>
              {sel.scoreReasons.map((r, i) => <p key={i} className="pos" style={{ fontSize: 12, margin: "3px 0" }}>+ {r}</p>)}
            </div>
            <div>
              {sel.scoreWarnings.map((w, i) => <p key={i} className="neg" style={{ fontSize: 12, margin: "3px 0" }}>⚠ {w}</p>)}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Legs + Greeks — per share · BSM</p>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th>LEG</th><th style={{ textAlign: "right" }}>STRIKE</th><th style={{ textAlign: "right" }}>PREM</th><th style={{ textAlign: "right" }}>Δ</th><th style={{ textAlign: "right" }}>Γ</th><th style={{ textAlign: "right" }}>Θ/D</th><th style={{ textAlign: "right" }}>VEGA</th><th style={{ textAlign: "right" }}>P(ITM)</th></tr></thead>
              <tbody>
                {sel.legs.map((l, i) => (
                  <tr key={i}>
                    <td><span className={l.action === "buy" ? "pos" : "neg"}><strong>{l.action.toUpperCase()}</strong></span> {l.qty}× {l.optionType}</td>
                    <td style={{ textAlign: "right" }}>{Math.round(l.strike).toLocaleString("en-IN")}</td>
                    <td style={{ textAlign: "right" }}>{fmtINR(l.premium)}</td>
                    <td style={{ textAlign: "right" }}>{fmtN(l.greeks?.delta, 3)}</td>
                    <td style={{ textAlign: "right" }}>{fmtN(l.greeks?.gamma, 4)}</td>
                    <td style={{ textAlign: "right" }}>{fmtN(l.greeks?.theta, 2)}</td>
                    <td style={{ textAlign: "right" }}>{fmtN(l.greeks?.vega, 2)}</td>
                    <td style={{ textAlign: "right" }}>{l.greeks ? `${(l.greeks.probITM * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>NET ({sel.legs.length} LEGS)</strong></td>
                  <td style={{ textAlign: "right" }}>—</td>
                  <td style={{ textAlign: "right" }}><strong>{sel.netPremium > 0 ? `-${fmtINR(sel.netPremium)}` : `+${fmtINR(-sel.netPremium)}`}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{fmtN(aggGreeks.delta, 3)}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{fmtN(aggGreeks.gamma, 4)}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{fmtN(aggGreeks.theta, 2)}</strong></td>
                  <td style={{ textAlign: "right" }}><strong>{fmtN(aggGreeks.vega, 2)}</strong></td>
                  <td style={{ textAlign: "right" }}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11.5 }}>
            NET Δ {fmtN(aggGreeks.delta, 3)} ≈ {fmtINR(Math.abs(aggGreeks.delta * mult))}/₹1 MOVE · Θ {fmtN(aggGreeks.theta * mult, 1)}/DAY · VEGA {fmtN(aggGreeks.vega * mult, 1)}/1% IV
          </p>
        </div>
        <div className="panel">
          <p className="p-head">Scenario P&L — expiry · ×{lot} lot(s)</p>
          <table className="plain">
            <thead><tr><th>MOVE</th><th style={{ textAlign: "right" }}>SPOT_T</th><th style={{ textAlign: "right" }}>P&L</th><th style={{ textAlign: "right" }}>RET ON RISK</th></tr></thead>
            <tbody>
              {scen.map((r) => {
                const riskCap = Math.abs(sel.maxLoss * mult) || Math.abs(netPerLot) || 1;
                return (
                  <tr key={r.m}>
                    <td><strong>{r.m === 0 ? "SPOT" : `${r.m > 0 ? "+" : ""}${(r.m * 100).toFixed(0)}%`}</strong></td>
                    <td style={{ textAlign: "right" }}>{fmtINR(r.px)}</td>
                    <td style={{ textAlign: "right" }} className={r.pnl >= 0 ? "pos" : "neg"}><strong>{r.pnl >= 0 ? "+" : "−"}{fmtINR(Math.abs(r.pnl)).slice(1) === "—" ? "—" : `${fmtINR(Math.abs(r.pnl))}`}</strong></td>
                    <td style={{ textAlign: "right" }} className={r.pnl >= 0 ? "pos" : "neg"}>{((r.pnl / riskCap) * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
              {sdScen.map((r) => (
                <tr key={r.label}>
                  <td><span className="badge fnc">{r.label}</span></td>
                  <td style={{ textAlign: "right" }}>{fmtINR(r.px)}</td>
                  <td style={{ textAlign: "right" }} className={r.pnl >= 0 ? "pos" : "neg"}><strong>{fmtINR(r.pnl)}</strong></td>
                  <td style={{ textAlign: "right" }} className="muted">68% BAND</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11.5 }}>
            STOP: EXIT IF PREMIUM −50% OR {sel.category === "Credit" ? "SPOT CROSSES SHORT STRIKE" : "Δ DROPS BELOW 0.15"}. DO NOT HOLD WINNERS TO ZERO — SCALE AT +100%.
          </p>
        </div>
      </div>

      {/* all strategies */}
      <div className="panel">
        <p className="p-head">All strategies ranked — {visible.length} · {dte}DTE · σ {(sigma * 100).toFixed(1)}%</p>
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th>#</th><th>STRATEGY</th><th>TYPE</th><th style={{ textAlign: "right" }}>SCORE</th><th style={{ textAlign: "right" }}>DEBIT/CREDIT ×{mult.toLocaleString("en-IN")}</th><th style={{ textAlign: "right" }}>MAX P</th><th style={{ textAlign: "right" }}>MAX L</th><th style={{ textAlign: "right" }}>BE</th><th style={{ textAlign: "right" }}>P%</th><th style={{ textAlign: "right" }}>R:R</th></tr></thead>
            <tbody>
              {visible.map((s, i) => (
                <tr key={s.name} style={s.name === sel.name ? { background: "rgba(255,160,40,0.10)" } : undefined}>
                  <td className="faint">{i + 1}</td>
                  <td><button className="ghost" onClick={() => setSelName(s.name)} style={{ padding: "2px 6px" }}><strong className={s.name === sel.name ? "sec" : ""}>{(i < 3 ? "★ " : "") + s.name.toUpperCase()}</strong></button><div className="faint" style={{ fontSize: 10.5 }}>{s.biasSuitedFor}</div></td>
                  <td><span className="badge fnc">{s.category.toUpperCase()}</span></td>
                  <td style={{ textAlign: "right" }}><strong className={s.score >= 70 ? "pos" : s.score < 45 ? "neg" : "sec"}>{s.score.toFixed(0)}</strong></td>
                  <td style={{ textAlign: "right" }} className={s.netPremium > 0 ? "neg" : "pos"}>{s.netPremium > 0 ? `-${fmtINR(Math.abs(s.netPremium * mult))}` : `+${fmtINR(Math.abs(s.netPremium * mult))}`}</td>
                  <td style={{ textAlign: "right" }} className="pos">{s.maxProfitUnlimited ? "∞" : fmtINR(s.maxProfit * mult)}</td>
                  <td style={{ textAlign: "right" }} className="neg">{s.maxLossUnlimited ? "∞" : fmtINR(Math.abs(s.maxLoss * mult))}</td>
                  <td style={{ textAlign: "right" }}>{s.breakevens.length ? s.breakevens.map((b) => Math.round(b).toLocaleString("en-IN")).join(" / ") : "—"}</td>
                  <td style={{ textAlign: "right" }}>{(s.probProfit * 100).toFixed(0)}%</td>
                  <td style={{ textAlign: "right" }}>{s.riskReward === Infinity ? "∞" : s.riskReward.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>
          RANKED BY REGIME SCORE (IV FIT + R/R + P% + DTE + BREAKEVEN + COST). ★ = TOP-3 FOR {bias.trendLabel.toUpperCase()} + {bias.ivRegime.toUpperCase()} IV.
          SHORT STRADDLE/STRANGLE SHOW ∞ LOSS — HEDGE WITH WINGS BEFORE SIZING.
        </p>
      </div>

      {/* execution */}
      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Execution — {sel.name}</p>
          {sel.legs.map((l, i) => (
            <KV key={i} k={`LEG ${i + 1} ${l.action.toUpperCase()} ${l.qty}× ${Math.round(l.strike).toLocaleString("en-IN")} ${l.optionType}`} v={`${fmtINR(l.premium * mult)} LOT PREM`} cls={l.action === "buy" ? "neg" : "pos"} />
          ))}
          <KV k="NET" v={sel.netPremium > 0 ? `PAY ${fmtINR(netPerLot)} (MAX LOSS CAPPED)` : `RECEIVE ${fmtINR(-netPerLot)} (MARGIN + DEFINED WINGS)`} cls={sel.netPremium > 0 ? "neg" : "pos"} />
          <KV k="ADJUST" v={sel.category === "Credit" ? "ROLL TESTED SHORT +7D / CLOSE AT 50% MAX PROFIT" : "SCALE 50% AT +100% · TRAIL REST TO BREAKEVEN"} />
          <KV k="SKIP IF" v="BROKER PREM > 20% OVER THEO OR IV SPIKE > +5PTS" cls="neg" />
        </div>
        <div className="panel">
          <p className="p-head">Why this fits now</p>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px 0" }}>
            SPOT {fmtINR(spot)} · {bias.trendLabel.toUpperCase()} (BIAS {bias.biasScore.toFixed(0)}) · {regime} · IV {bias.ivPct.toFixed(1)}% {bias.ivRegime.toUpperCase()} ·
            RSI {fmtN(bias.rsi, 0)} · ADX {fmtN(bias.adx, 0)} · ±1SD {fmtINR(expMove)} · {dte}DTE
          </p>
          {sel.scoreReasons.slice(0, 5).map((r, i) => <p key={i} className="pos" style={{ fontSize: 12, margin: "3px 0" }}>✓ {r}</p>)}
          {sel.scoreWarnings.slice(0, 4).map((w, i) => <p key={i} className="neg" style={{ fontSize: 12, margin: "3px 0" }}>⚠ {w}</p>)}
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            RULES: {bias.ivRegime === "Low" ? "BUY PREMIUM — cheap gamma, avoid naked selling." : bias.ivRegime === "Normal" ? "SPREADS — cap theta/vega, keep debit < 1.5% spot." : "SELL PREMIUM — never buy outright; use credit/defined-risk wings."}
            {dte < 14 ? " <14DTE — halve size, gamma trap." : ""}
          </p>
        </div>
      </div>
    </>
  );
}

export function StrategyGreeksCheck({ spot, dte, sigma }: { spot: number; dte: number; sigma: number }) {
  void spot; void dte; void sigma;
  return null;
}

export function atmGreeksRow(spot: number, dte: number, sigma: number) {
  const T = Math.max(dte, 1) / 365;
  return {
    call: blackScholes(spot, spot, T, RISK_FREE, sigma, "CALL"),
    put: blackScholes(spot, spot, T, RISK_FREE, sigma, "PUT"),
  };
}
