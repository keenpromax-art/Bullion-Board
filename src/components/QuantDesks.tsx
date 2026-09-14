"use client";

import { useEffect, useState } from "react";
import { sma, rsi, last, logReturns, hurst, pctReturns } from "@/lib/indicators";
import { historicalVol, volRegime } from "@/lib/options";
import { ewmaVol, maxDrawdown } from "@/lib/risk";
import { chatComplete, aiSystem, NO_INVENT } from "@/lib/ai";
import { store } from "@/lib/store";
import { BarChart, LineChart, HBars, Histogram, AreaChart } from "./charts";
import { MCFan } from "./ChartDesks";
import { mulberry32 } from "@/lib/utils";

function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

function Spark({ data, h = 64 }: { data: number[]; h?: number }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data), mx = Math.max(...data);
  const W = 300;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * W).toFixed(1)},${(h - 4 - ((v - mn) / (mx - mn || 1)) * (h - 8)).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: "100%", height: h }} preserveAspectRatio="none">
      <title>{data.length ? `LAST ${data[data.length - 1].toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""}</title>
      <polyline points={pts} fill="none" stroke={up ? "#00d664" : "#ff453a"} strokeWidth="1.8" />
    </svg>
  );
}

/* ---------------- volatility term structure ---------------- */

export function VolTerm({ closes }: { closes: number[] }) {
  if (closes.length < 60) return null;
  const lr = logReturns(closes);
  const h10 = historicalVol(lr, 10), h30 = historicalVol(lr, 30), h252 = historicalVol(lr);
  const ew = ewmaVol(pctReturns(closes));
  const ewLast = ew[ew.length - 1] * Math.sqrt(252) * 100;
  return (
    <div className="panel">
      <p className="p-head">Vol term — annualised</p>
      <KV k="HV 10D" v={`${(h10 * 100).toFixed(1)}%`} />
      <KV k="HV 30D" v={`${(h30 * 100).toFixed(1)}%`} />
      <KV k="HV 252D" v={`${(h252 * 100).toFixed(1)}%`} />
      <KV k="EWMA NOW" v={`${ewLast.toFixed(1)}%`} />
      <KV k="REGIME" v={volRegime(h10, h252)} cls={volRegime(h10, h252).includes("EXPAND") ? "neg" : volRegime(h10, h252).includes("COMPRESS") ? "pos" : ""} />
    </div>
  );
}

/* ---------------- ML dossier ---------------- */

const ML_SPEC: Record<string, { name: string; arch: string; inputs: string }> = {
  "7": { name: "XGB SIGNAL", arch: "GBDT ×5 + LOGISTIC STACK", inputs: "RSI/MACD/ADX/BB/OBV LAGS + VOL" },
  "9": { name: "QUANT ENSEMBLE", arch: "ENSEMBLE MEAN + GARCH CAL", inputs: "RET MOMENTS + VOL CLUSTERING" },
  "10": { name: "ARIMA-LSTM META", arch: "ARIMA + LSTM META MIXER", inputs: "SEQ WINDOWS + RESIDUALS" },
  "54": { name: "ALPHA AUTOENCODER", arch: "BOTTLENECK AE, LATENT FACTORS", inputs: "ENGINEERED SIGNAL PANEL" },
  "55": { name: "GARCH-LSTM HYBRID", arch: "GARCH FEATS → LSTM/TRANS/TCN", inputs: "RET + VOL + RANGE FEATS" },
  "56": { name: "DUAL-HEAD TRANSFORMER", arch: "TRANSFORMER + NLL UNCERTAINTY", inputs: "POS-ENCODED WINDOWS" },
  "58": { name: "FEDERATED SWARM", arch: "8 NODES + BYZANTINE FILTER", inputs: "MOM/MR/TREND/OBV/AUTOCORR/VOL/SR" },
  "59": { name: "NEURAL ODE", arch: "LATENT ODE TIME SERIES", inputs: "SCALED WINDOWS" },
  "61": { name: "RL AGENT", arch: "POLICY AGENT, DISCRETE ACTS", inputs: "STATE = TECH SNAPSHOT" },
};

export function MLDossier({ id, closes }: { id: string; closes: number[] }) {
  const spec = ML_SPEC[id] ?? { name: "ML DESK", arch: "ENSEMBLE", inputs: "TECH SNAPSHOT" };
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  if (closes.length < 60) return null;
  const e20 = last<number>(sma(closes, 20)) ?? 0;
  const e50 = last<number>(sma(closes, 50)) ?? 0;
  const r = last<number>(rsi(closes, 14)) ?? 50;
  const lr = logReturns(closes);
  const hv = historicalVol(lr, 30);
  const hu = hurst(closes.slice(-150));
  const dd = maxDrawdown(closes).pct;
  const trend = e20 > e50 ? "UP" : "DOWN";

  async function critic() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.quantCritic() },
        { role: "user", content: `${spec.name} ${spec.arch}. LIVE FEATS: TREND ${trend} RSI ${r.toFixed(1)} HV30 ${(hv * 100).toFixed(1)}% HURST ${hu.toFixed(2)} DD ${dd.toFixed(1)}%. TASK: OVERFIT RISK + WHEN IT BREAKS + 1 GUARDRAIL. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="panel panel-glow">
      <p className="p-head">{spec.name} — live feature snapshot</p>
      <KV k="ARCH" v={spec.arch} />
      <KV k="INPUTS" v={spec.inputs} />
      <KV k="TREND 20/50" v={trend} cls={trend === "UP" ? "pos" : "neg"} />
      <KV k="RSI 14" v={r.toFixed(1)} />
      <KV k="HV 30D" v={`${(hv * 100).toFixed(1)}%`} />
      <KV k="HURST" v={hu.toFixed(2)} cls={hu > 0.55 ? "pos" : hu < 0.45 ? "neg" : ""} />
      <KV k="MAX DD" v={`${dd.toFixed(1)}%`} cls="neg" />
      <p className="muted" style={{ fontSize: 11.5 }}>GPU TRAINING RUNS OFF-TERMINAL — THIS DOSSIER + CRITIC IS THE LIVE DESK SURFACE.</p>
      <div><button className="btn" onClick={critic} disabled={aiLoading}>{aiLoading ? "RUNNING…" : "RUN MODEL CRITIC"}</button></div>
      {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
    </div>
  );
}

/* ---------------- pairs ---------------- */

export function PairDesk({ symbol }: { symbol: string }) {
  const [a, setA] = useState(symbol);
  const [b, setB] = useState("^NSEI");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setA(symbol); }, [symbol]);

  async function run(ca = a, cb = b) {
    setLoading(true); setData(null);
    try {
      const r = await fetch(`/api/pair?symbolA=${encodeURIComponent(ca)}&symbolB=${encodeURIComponent(cb)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "pair failed");
      setData(j);
    } catch { setData({ error: true }); }
    finally { setLoading(false); }
  }

  useEffect(() => { run(a, b); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Pairs — OLS hedge · half-life · z</p>
        <div className="toolbar">
          <input className="box" value={a} onChange={(e) => setA(e.target.value.toUpperCase())} placeholder="LEG A…" />
          <input className="box" value={b} onChange={(e) => setB(e.target.value.toUpperCase())} placeholder="LEG B…" />
          <button className="btn" onClick={() => run()}>RUN</button>
        </div>
        {loading && <p className="muted">FITTING HEDGE…</p>}
        {data && !data.error && (
          <>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">Hedge β</div><div className="val">{data.hedge}</div><div className="sub">A per B</div></div>
              <div className="cell"><div className="lbl">Corr</div><div className="val">{data.corr}</div><div className="sub">1Y</div></div>
              <div className="cell"><div className="lbl">Half-life</div><div className="val">{data.halfLifeDays ?? "∞"} </div><div className="sub">days</div></div>
              <div className="cell"><div className="lbl">Z 60D</div><div className={`val ${Math.abs(data.z60) > 2 ? "neg" : ""}`}>{data.z60 >= 0 ? "+" : ""}{data.z60}</div><div className="sub">spread</div></div>
              <div className="cell"><div className="lbl">Hurst</div><div className="val">{data.hurst}</div><div className="sub">leg A</div></div>
              <div className="cell"><div className="lbl">Signal</div><div className="val" style={{ fontSize: 14 }}>{data.signal}</div><div className="sub">|z|&gt;2</div></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <p className="p-head">Spread tail — last {data.spreadTail?.length ? Number(data.spreadTail[data.spreadTail.length - 1]).toFixed(2) : "—"}</p>
              <Spark data={data.spreadTail ?? []} />
            </div>
            <div style={{ marginTop: 10 }}>
              <p className="p-head">X: {data.symB} · Y: {data.symA} + hedge β {data.hedge}</p>
              {(() => {
                const A: number[] = data.aTail ?? [];
                const B: number[] = data.bTail ?? [];
                if (A.length < 10 || B.length < 10) return null;
                const n2 = Math.min(A.length, B.length);
                const a = A.slice(-n2), b = B.slice(-n2);
                const ma = a.reduce((s, v) => s + v, 0) / n2;
                const mb = b.reduce((s, v) => s + v, 0) / n2;
                const W2 = 620, H2 = 170;
                const x0 = Math.min(...b), x1 = Math.max(...b);
                const y0 = Math.min(...a), y1 = Math.max(...a);
                const X = (v: number) => 30 + ((v - x0) / (x1 - x0 || 1)) * (W2 - 40);
                const Y = (v: number) => H2 - 14 - ((v - y0) / (y1 - y0 || 1)) * (H2 - 28);
                const hh = data.hedge ?? 0;
                const int = ma - hh * mb;
                return (
                  <svg viewBox={`0 0 ${W2} ${H2}`} style={{ width: "100%", height: H2 }}>
                    {b.map((v, i) => <circle key={i} cx={X(v)} cy={Y(a[i])} r="4" fill="transparent"><title>{data.symB}: {v.toLocaleString("en-IN", { maximumFractionDigits: 1 })} · {data.symA}: {a[i].toLocaleString("en-IN", { maximumFractionDigits: 1 })}</title></circle>)}
                    {b.map((v, i) => <circle key={`d${i}`} cx={X(v)} cy={Y(a[i])} r="2" fill="#8f7bff" opacity="0.7" pointerEvents="none" />)}
                    <line x1={X(x0)} y1={Y(int + hh * x0)} x2={X(x1)} y2={Y(int + hh * x1)} stroke="#ffa028" strokeWidth="1.5" />
                  </svg>
                );
              })()}
            </div>
          </>
        )}
        {data?.error && <p className="neg">PAIR FAILED — CHECK SYMBOLS.</p>}
      </div>
    </div>
  );
}

/* ---------------- single-factor attribution (market model) ---------------- */

export function FactorDesk({ symbol }: { symbol: string }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [a, b] = await Promise.all([
          fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`).then((r) => r.json()),
          fetch(`/api/history?symbol=%5ENSEI&range=3y&interval=1d`).then((r) => r.json()),
        ]);
        const ca: number[] = (a.bars ?? []).map((x: any) => x.close);
        const cb: number[] = (b.bars ?? []).map((x: any) => x.close);
        const n = Math.min(ca.length, cb.length);
        const ra: number[] = [], rb: number[] = [];
        for (let i = 1; i < n; i++) {
          ra.push(Math.log(ca[ca.length - n + i] / ca[ca.length - n + i - 1]));
          rb.push(Math.log(cb[cb.length - n + i] / cb[cb.length - n + i - 1]));
        }
        const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
        const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
        let cov = 0, vb = 0, va = 0;
        for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); vb += (rb[i] - mb) ** 2; va += (ra[i] - ma) ** 2; }
        const beta = vb ? cov / vb : 0;
        const alphaD = ma - beta * mb;
        const r2 = va && vb ? (cov * cov) / (va * vb) : 0;
        const te = Math.sqrt(ra.reduce((s, v, i) => s + (v - beta * rb[i]) ** 2, 0) / ra.length) * Math.sqrt(252) * 100;
        const up = ra.filter((_, i) => rb[i] > 0);
        const upB = rb.filter((v) => v > 0);
        const dn = ra.filter((_, i) => rb[i] < 0);
        const dnB = rb.filter((v) => v < 0);
        if (alive) setData({
          beta, alphaAnn: (Math.exp(alphaD * 252) - 1) * 100, r2: r2 * 100, te,
          upCap: upB.length ? (up.reduce((s, v) => s + v, 0) / upB.reduce((s, v) => s + v, 0)) * 100 : null,
          dnCap: dnB.length ? (dn.reduce((s, v) => s + v, 0) / dnB.reduce((s, v) => s + v, 0)) * 100 : null,
          n: ra.length, alphaD,
          sample: ra.map((v, i) => ({ x: rb[i] * 100, y: v * 100 })).filter((_, i) => i % 4 === 0).slice(-160),
        });
      } catch { if (alive) setData({ error: true }); }
    })();
    return () => { alive = false; };
  }, [symbol]);

  if (!data) return <div className="panel"><p className="muted">FITTING MARKET MODEL VS NIFTY…</p></div>;
  if (data.error) return <div className="panel"><p className="neg">FACTOR FIT FAILED.</p></div>;
  return (
    <div className="panel panel-glow">
      <p className="p-head">Market model — {symbol} vs NIFTY 50 · N={data.n}D</p>
      <div className="cells">
        <div className="cell"><div className="lbl">Beta</div><div className="val">{data.beta.toFixed(2)}</div><div className="sub">mkt sensitivity</div></div>
        <div className="cell"><div className="lbl">Alpha ann</div><div className={`val ${data.alphaAnn >= 0 ? "pos" : "neg"}`}>{data.alphaAnn >= 0 ? "+" : ""}{data.alphaAnn.toFixed(1)}%</div><div className="sub">excess</div></div>
        <div className="cell"><div className="lbl">R²</div><div className="val">{data.r2.toFixed(0)}%</div><div className="sub">mkt-driven</div></div>
        <div className="cell"><div className="lbl">Track err</div><div className="val">{data.te.toFixed(1)}%</div><div className="sub">ann</div></div>
        <div className="cell"><div className="lbl">Up capture</div><div className="val">{data.upCap !== null ? `${data.upCap.toFixed(0)}%` : "—"}</div><div className="sub">up days</div></div>
        <div className="cell"><div className="lbl">Down capture</div><div className="val">{data.dnCap !== null ? `${data.dnCap.toFixed(0)}%` : "—"}</div><div className="sub">down days</div></div>
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>SINGLE-FACTOR MARKET MODEL ON FREE DATA — FULL FAMA-FRENCH 3F NEEDS A FACTOR FEED.</p>
      {data.sample?.length > 10 && (
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Daily % — X: NIFTY · Y: {symbol} + β {data.beta?.toFixed(2)} line</p>
          {(() => {
            const pts: Array<{ x: number; y: number }> = data.sample;
            const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs);
            const y0 = Math.min(...ys), y1 = Math.max(...ys);
            const W2 = 620, H2 = 170;
            const X = (v: number) => 30 + ((v - x0) / (x1 - x0 || 1)) * (W2 - 40);
            const Y = (v: number) => H2 - 14 - ((v - y0) / (y1 - y0 || 1)) * (H2 - 28);
            const b = data.beta ?? 0, ad = (data.alphaD ?? 0) * 100;
            return (
              <svg viewBox={`0 0 ${W2} ${H2}`} style={{ width: "100%", height: H2 }}>
                {pts.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="4" fill="transparent"><title>NIFTY {p.x.toFixed(2)}% · {symbol} {p.y.toFixed(2)}%</title></circle>)}
                {pts.map((p, i) => <circle key={`d${i}`} cx={X(p.x)} cy={Y(p.y)} r="2" fill="#8f7bff" opacity="0.6" pointerEvents="none" />)}
                <line x1={X(x0)} y1={Y(ad + b * x0)} x2={X(x1)} y2={Y(ad + b * x1)} stroke="#ffa028" strokeWidth="1.5" />
              </svg>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ---------------- merton jump-diffusion desk ---------------- */

function gaussFactory(rand: () => number) {
  let spare: number | null = null;
  return (): number => {
    if (spare !== null) { const v = spare; spare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

const pct1 = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export function MertonDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<Array<{ date: string; close: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [horizon, setHorizon] = useState(63);
  const SIMS = 500;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=2y&interval=1d`)
      .then((r) => r.json())
      .then((j) => { if (alive) setBars(((j.bars ?? []) as any[]).map((b) => ({ date: b.date, close: b.close }))); })
      .catch(() => { if (alive) setBars([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  const model = (() => {
    if (bars.length < 60) return null;
    const closes = bars.map((b) => b.close);
    const lr = logReturns(closes);
    const n = lr.length;
    const mean = lr.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(lr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    const years = n / 252;
    // Jump detection: |daily move − mean| beyond 3σ
    const isJump = lr.map((r) => Math.abs(r - mean) > 3 * sd);
    const jumps = lr.filter((_, i) => isJump[i]);
    const calm = lr.filter((_, i) => !isJump[i]);
    const lam = jumps.length / years;
    const muJ = jumps.length ? jumps.reduce((a, b) => a + b, 0) / jumps.length : 0;
    const sigJ = jumps.length > 1 ? Math.sqrt(jumps.reduce((s, v) => s + (v - muJ) ** 2, 0) / (jumps.length - 1)) : 0;
    const muD = (mean - (lam / 252) * muJ) * 252; // compensator: same mean as GBM
    const sigD = (calm.length > 1
      ? Math.sqrt(calm.reduce((s, v) => s + (v - calm.reduce((a, b) => a + b, 0) / calm.length) ** 2, 0) / (calm.length - 1))
      : sd) * Math.sqrt(252);
    const sigTot = sd * Math.sqrt(252);
    const jumpVarShare = sigTot > 0 ? (lam * (sigJ * sigJ + muJ * muJ)) / (sigTot * sigTot) * 100 : 0;
    const skew = sd > 0 ? lr.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n : 0;
    const kurt = sd > 0 ? lr.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3 : 0;

    const S0 = closes[closes.length - 1];
    const muD_d = muD / 252, sigD_d = sigD / Math.sqrt(252);
    const muG_d = mean, sigG_d = sd;
    const run = (lamY: number, seed: number) => {
      const rand = gaussFactory(mulberry32(seed));
      const gbm: number[][] = [], mj: number[][] = [];
      for (let s = 0; s < SIMS; s++) {
        const pg = [S0], pm = [S0];
        for (let d = 0; d < horizon; d++) {
          const z1 = rand(), z2 = rand();
          pg.push(pg[d] * Math.exp(muG_d - 0.5 * sigG_d * sigG_d + sigG_d * z1));
          let jump = 0;
          if (rand() < lamY / 252) {
            const zj = rand();
            jump = muJ + sigJ * zj;
          }
          pm.push(pm[d] * Math.exp(muD_d - 0.5 * sigD_d * sigD_d + sigD_d * z2 + jump));
        }
        gbm.push(pg); mj.push(pm);
      }
      return { gbm, mj };
    };
    const base = run(lam, 42);
    const q = (arr: number[], p: number) => {
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * s.length)))];
    };
    const ends = (paths: number[][]) => paths.map((p) => p[p.length - 1]);
    const eG = ends(base.gbm), eM = ends(base.mj);
    const es = (arr: number[]) => {
      const s = [...arr].sort((a, b) => a - b);
      const tail = s.slice(0, Math.max(1, Math.floor(s.length * 0.05)));
      return tail.reduce((a, b) => a + b, 0) / tail.length;
    };
    const stats = (arr: number[]) => ({
      p1: q(arr, 1), p5: q(arr, 5), p50: q(arr, 50), p95: q(arr, 95),
      pLoss: (arr.filter((v) => v < S0).length / arr.length) * 100,
      es5: es(arr),
    });
    // λ sensitivity: half / base / double jump intensity
    const sens = [0.5, 1, 2].map((f) => {
      const r = run(lam * f, 1000 + Math.round(f * 10));
      const e = ends(r.mj);
      return { f, ...stats(e) };
    });
    return {
      S0, muAnn: mean * 252 * 100, sigTot: sigTot * 100, sigD: sigD * 100,
      lam, nJumps: jumps.length, muJ: muJ * 100, sigJ: sigJ * 100,
      jumpVarShare, skew, kurt, hurstV: hurst(closes.slice(-150)),
      hv30: historicalVol(lr.slice(-30)) * 100,
      gbm: base.gbm.filter((_, i) => i % 8 === 0).slice(0, 60).map((p) => p.filter((_, d) => d % 3 === 0)),
      mj: base.mj.filter((_, i) => i % 8 === 0).slice(0, 60).map((p) => p.filter((_, d) => d % 3 === 0)),
      gStats: stats(eG), mStats: stats(eM), eG, eM, sens,
    };
  })();

  if (loading) return <div className="panel"><p className="muted">CALIBRATING JUMPS…</p></div>;
  if (!model) return <div className="panel"><p className="neg">NEED 60+ DAILY BARS FOR CALIBRATION.</p></div>;
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">
          Merton calibration — {symbol} · {model.nJumps} jumps found
          <span className="faint"> · horizon</span>
        </p>
        <div className="toolbar" style={{ marginBottom: 10 }}>
          {[21, 63, 126, 252].map((h) => (
            <button key={h} className={`pill${horizon === h ? " active" : ""}`} onClick={() => setHorizon(h)}>{h}D</button>
          ))}
          <span className="faint" style={{ fontSize: 11, alignSelf: "center" }}>{SIMS} PATHS × {horizon}D · SEED 42</span>
        </div>
        <div className="cells">
          <div className="cell"><div className="lbl">Total vol σ</div><div className="val">{model.sigTot.toFixed(1)}%</div><div className="sub">ann · HV30 {model.hv30.toFixed(1)}%</div></div>
          <div className="cell"><div className="lbl">Diffusive σ</div><div className="val">{model.sigD.toFixed(1)}%</div><div className="sub">ex-jumps</div></div>
          <div className="cell"><div className="lbl">Jump λ</div><div className="val">{model.lam.toFixed(1)}/yr</div><div className="sub">{model.nJumps} events</div></div>
          <div className="cell"><div className="lbl">Jump μ / σ</div><div className="val" style={{ fontSize: 15 }}>{pct1(model.muJ)} / {model.sigJ.toFixed(2)}%</div><div className="sub">per event</div></div>
          <div className="cell"><div className="lbl">Jump var share</div><div className="val">{model.jumpVarShare.toFixed(0)}%</div><div className="sub">of total var</div></div>
          <div className="cell"><div className="lbl">Skew / Kurt</div><div className="val" style={{ fontSize: 15 }}>{model.skew.toFixed(2)} / {model.kurt.toFixed(2)}</div><div className="sub">H {model.hurstV.toFixed(2)}</div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">GBM fan — no jumps · P5–P95 {inr(model.gStats.p5)}–{inr(model.gStats.p95)}</p>
          <MCFan paths={model.gbm} />
        </div>
        <div className="panel">
          <p className="p-head">Merton fan — λ {model.lam.toFixed(1)}/yr · P5–P95 {inr(model.mStats.p5)}–{inr(model.mStats.p95)}</p>
          <MCFan paths={model.mj} />
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Terminal distribution — {horizon}D</p>
          <Histogram values={model.eM} bins={22} height={120} color="#ffa028" />
          <p className="muted" style={{ fontSize: 11.5 }}>MERTON ENDS · FAT LEFT TAIL VS GBM</p>
          <Histogram values={model.eG} bins={22} height={80} color="#5b5b62" />
          <p className="muted" style={{ fontSize: 11.5 }}>GBM ENDS (SAME MEAN)</p>
        </div>
        <div className="panel">
          <p className="p-head">Tail read — spot {inr(model.S0)}</p>
          <table className="plain">
            <thead><tr><th></th><th style={{ textAlign: "right" }}>GBM</th><th style={{ textAlign: "right" }}>MERTON</th></tr></thead>
            <tbody>
              <tr><td><strong>P1 (crash)</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p1)}</td><td style={{ textAlign: "right" }} className="neg">{inr(model.mStats.p1)}</td></tr>
              <tr><td><strong>P5</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p5)}</td><td style={{ textAlign: "right" }}>{inr(model.mStats.p5)}</td></tr>
              <tr><td><strong>P50</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.p50)}</td><td style={{ textAlign: "right" }}>{inr(model.mStats.p50)}</td></tr>
              <tr><td><strong>P(loss)</strong></td><td style={{ textAlign: "right" }}>{model.gStats.pLoss.toFixed(0)}%</td><td style={{ textAlign: "right" }}>{model.mStats.pLoss.toFixed(0)}%</td></tr>
              <tr><td><strong>ES 5%</strong></td><td style={{ textAlign: "right" }}>{inr(model.gStats.es5)}</td><td style={{ textAlign: "right" }} className="neg">{inr(model.mStats.es5)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">λ sensitivity — halve/double jump intensity</p>
        <table className="plain">
          <thead><tr><th>λ ×</th><th style={{ textAlign: "right" }}>P5</th><th style={{ textAlign: "right" }}>P50</th><th style={{ textAlign: "right" }}>P95</th></tr></thead>
          <tbody>
            {model.sens.map((s) => (
              <tr key={s.f}>
                <td><strong>{s.f}×</strong></td>
                <td style={{ textAlign: "right" }}>{inr(s.p5)}</td>
                <td style={{ textAlign: "right" }}>{inr(s.p50)}</td>
                <td style={{ textAlign: "right" }}>{inr(s.p95)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- intraday day desk ---------------- */

export function DayDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=1d&interval=5m`)
      .then((r) => r.json())
      .then((j) => { if (alive) setBars(j.bars ?? []); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol]);

  if (loading) return <div className="panel"><p className="muted">TAPING TODAY…</p></div>;
  if (!bars.length) return <div className="panel"><p className="neg">NO INTRADAY TAPE (MKT CLOSED OR FEED GAP).</p></div>;
  const n = bars.length;
  const times = bars.map((b: any, i: number) => {
    if (b.time) {
      const d = new Date((b.time + 19800) * 1000);
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    }
    return `#${i + 1}`;
  });
  const x3: [string, string, string] = [times[0] ?? "", times[Math.floor(n / 2)] ?? "", times[n - 1] ?? ""];
  const closes = bars.map((b) => b.close);
  const typical = bars.map((b) => (b.high + b.low + b.close) / 3);
  const vol = bars.map((b) => b.volume || 0);
  const totV = vol.reduce((a, b) => a + b, 0);

  // Session VWAP series + ±1σ bands (12-print rolling dispersion)
  let cpv = 0, cv = 0;
  const vwapS: (number | null)[] = typical.map((t, i) => {
    cpv += t * vol[i]; cv += vol[i];
    return cv ? cpv / cv : null;
  });
  const sd = typical.map((_, i) => {
    const w = typical.slice(Math.max(0, i - 11), i + 1);
    const m = w.reduce((a, b) => a + b, 0) / w.length;
    return Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length);
  });
  const up1 = vwapS.map((v, i) => (v === null ? null : v + sd[i]));
  const lo1 = vwapS.map((v, i) => (v === null ? null : v - sd[i]));

  // Delta proxy: volume signed by close-location-value, cumulated
  const delta = bars.map((b) => {
    const r = b.high - b.low;
    const clv = r ? ((b.close - b.low) - (b.high - b.close)) / r : 0;
    return clv * (b.volume || 0);
  });
  let cdAcc = 0;
  const cumD = delta.map((d) => (cdAcc += d));
  const cumDLast = cumD[cumD.length - 1] ?? 0;

  const last = closes[n - 1];
  const open = bars[0].open;
  const hi = Math.max(...bars.map((b) => b.high));
  const lo = Math.min(...bars.map((b) => b.low));
  const vwap = vwapS[n - 1] ?? last;

  // Initial balance: first 12 prints ≈ opening hour
  const ibBars = bars.slice(0, 12);
  const ibH = Math.max(...ibBars.map((b) => b.high));
  const ibL = Math.min(...ibBars.map((b) => b.low));
  const ibPos = last > ibH ? "ABOVE IB" : last < ibL ? "BELOW IB" : "INSIDE IB";

  // Volume profile across 14 price levels → POC + 70% value area
  const NB = 14;
  const bins = new Array(NB).fill(0);
  bars.forEach((b) => {
    const v = b.volume || 0;
    if (!v || hi === lo) return;
    for (let k = 0; k < NB; k++) {
      const e0 = lo + ((hi - lo) * k) / NB, e1 = lo + ((hi - lo) * (k + 1)) / NB;
      const ov = Math.max(0, Math.min(b.high, e1) - Math.max(b.low, e0));
      bins[k] += v * (ov / ((b.high - b.low) || 1));
    }
  });
  if (hi === lo) bins[Math.floor(NB / 2)] = totV;
  const totP = bins.reduce((a, b) => a + b, 0) || 1;
  const pocI = bins.indexOf(Math.max(...bins));
  const pocPx = lo + ((hi - lo) * (pocI + 0.5)) / NB;
  let vaLo = pocI, vaHi = pocI, vaV = bins[pocI];
  while (vaV < totP * 0.7 && (vaLo > 0 || vaHi < NB - 1)) {
    const l = vaLo > 0 ? bins[vaLo - 1] : -1;
    const h = vaHi < NB - 1 ? bins[vaHi + 1] : -1;
    if (h >= l && vaHi < NB - 1) { vaHi++; vaV += bins[vaHi]; }
    else if (vaLo > 0) { vaLo--; vaV += bins[vaLo]; }
    else break;
  }
  const pxAt = (k: number) => lo + ((hi - lo) * (k + 0.5)) / NB;

  const avgV = totV / Math.max(n, 1);
  const bigCount = vol.filter((v) => v > 2 * avgV).length;
  const f1 = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Tape — {symbol} · 5M · {n} prints · {last >= vwap ? "ABOVE VWAP" : "BELOW VWAP"}</p>
        <div className="cells">
          <div className="cell"><div className="lbl">Last</div><div className={`val ${last >= vwap ? "pos" : "neg"}`}>{f1(last)}</div><div className="sub">vs VWAP</div></div>
          <div className="cell"><div className="lbl">VWAP</div><div className="val">{f1(vwap)}</div><div className="sub">session</div></div>
          <div className="cell"><div className="lbl">POC</div><div className="val">{f1(pocPx)}</div><div className="sub">heaviest level</div></div>
          <div className="cell"><div className="lbl">Open</div><div className="val">{f1(open)}</div><div className="sub">day</div></div>
          <div className="cell"><div className="lbl">High / Low</div><div className="val" style={{ fontSize: 15 }}>{f1(hi)} / {f1(lo)}</div><div className="sub">range</div></div>
          <div className="cell"><div className="lbl">IB {ibPos}</div><div className="val" style={{ fontSize: 15 }}>{f1(ibH)} / {f1(ibL)}</div><div className="sub">first-hour box</div></div>
          <div className="cell"><div className="lbl">Day chg</div><div className={`val ${last >= open ? "pos" : "neg"}`}>{(((last - open) / open) * 100).toFixed(2)}%</div><div className="sub">open→last</div></div>
          <div className="cell"><div className="lbl">Cum Δ</div><div className={`val ${cumDLast >= 0 ? "pos" : "neg"}`}>{cumDLast >= 0 ? "+" : ""}{(cumDLast / 1e6).toFixed(2)}M</div><div className="sub">signed flow</div></div>
          <div className="cell"><div className="lbl">Volume</div><div className="val">{(totV / 1e6).toFixed(1)}M</div><div className="sub">{bigCount} big prints</div></div>
        </div>

        <div style={{ marginTop: 10 }}>
          <p className="p-head">Price + VWAP ±1σ + IB box</p>
          <LineChart
            series={[
              { label: "CLOSE", color: "#ffb000", values: closes },
              { label: "VWAP", color: "#ffa028", values: vwapS },
              { label: "+1σ", color: "#5b5b62", values: up1, dashed: true },
              { label: "−1σ", color: "#5b5b62", values: lo1, dashed: true },
              { label: "IBH", color: "#00d664", values: closes.map(() => ibH), dashed: true },
              { label: "IBL", color: "#ff453a", values: closes.map(() => ibL), dashed: true },
            ]}
            height={170} yFmt={(v) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            dates={times} xLabels={x3}
          />
        </div>

        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div>
            <p className="p-head">Cumulative Δ — tape pressure</p>
            <LineChart
              series={[{ label: "CUM Δ", color: cumDLast >= 0 ? "#00d664" : "#ff453a", values: cumD }]}
              height={110} yFmt={(v) => `${(v / 1e6).toFixed(2)}M`} dates={times} xLabels={x3}
            />
          </div>
          <div>
            <p className="p-head">Volume profile — POC {f1(pocPx)}</p>
            <HBars
              rows={bins.map((v, k) => ({
                label: f1(pxAt(k)),
                value: v,
                display: `${(v / 1e6).toFixed(2)}M`,
                color: k === pocI ? "#ffa028" : k >= vaLo && k <= vaHi ? "#8f7bff" : "#5b5b62",
              })).reverse()}
            />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <p className="p-head">Volume tape — gray bars, big prints flagged</p>
          <BarChart values={vol} labels={times} height={70} posColor="#5b5b62" negColor="#5b5b62" />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Print tape — signed Δ per 5M · ⚡ = &gt;2× avg print</p>
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          <table className="plain">
            <thead><tr><th>TIME</th><th style={{ textAlign: "right" }}>O</th><th style={{ textAlign: "right" }}>H</th><th style={{ textAlign: "right" }}>L</th><th style={{ textAlign: "right" }}>C</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>VWAP</th><th style={{ textAlign: "right" }}>Δ</th></tr></thead>
            <tbody>
              {bars.map((b, i) => {
                const big = vol[i] > 2 * avgV;
                return (
                  <tr key={i} style={big ? { background: "rgba(255,160,40,0.07)" } : undefined}>
                    <td>{times[i]}{big ? " ⚡" : ""}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.open)}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.high)}</td>
                    <td style={{ textAlign: "right" }}>{f1(b.low)}</td>
                    <td style={{ textAlign: "right" }}><span className={b.close >= b.open ? "pos" : "neg"}>{f1(b.close)}</span></td>
                    <td style={{ textAlign: "right" }}>{(vol[i] / 1e6).toFixed(2)}M</td>
                    <td style={{ textAlign: "right" }}>{vwapS[i] === null ? "—" : f1(vwapS[i] as number)}</td>
                    <td style={{ textAlign: "right" }}><span className={delta[i] >= 0 ? "pos" : "neg"}>{delta[i] >= 0 ? "+" : ""}{(delta[i] / 1e3).toFixed(0)}k</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------------- rolling risk desk (module 23, stripped) ---------------- */
// Advanced rolling risk on 3Y daily + Nifty benchmark: vol term structures,
// Sharpe/Sortino, beta/correlation, drawdown episodes, VaR/CVaR, AI analyst.

export function RollingRiskDesk({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [bench, setBench] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(""); setBars([]); setBench([]);
    Promise.all([
      fetch(`/api/history?symbol=${encodeURIComponent(symbol)}&range=3y&interval=1d`).then((r) => r.json()),
      fetch(`/api/history?symbol=${encodeURIComponent("^NSEI")}&range=3y&interval=1d`).then((r) => r.json()).catch(() => null),
    ])
      .then(([a, b]) => {
        if (!alive) return;
        if (a.error) throw new Error(a.error);
        setBars(a.bars ?? []);
        if (b && !b.error) setBench(b.bars ?? []);
      })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [symbol]);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: aiSystem.rollingRisk() },
        { role: "user", content: `SEC ${symbol}. 3Y ROLLING VOL/SHARPE/BETA/DD/VAR ON TAPE. TASK: REGIME CALL + 3 RISKS + HEDGE NOTE. ${NO_INVENT}` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (err) return <div className="panel"><p className="neg">ROLLING RISK ERR: {err} (FEED THROTTLED — RETRY)</p></div>;
  if (bars.length < 130) return <div className="panel"><p className="muted">BUILDING 3Y ROLLING RISK FOR {symbol}…</p></div>;

  // Align symbol + benchmark dates
  const bMap = new Map<string, number>();
  bench.forEach((b: any) => { if (typeof b.close === "number") bMap.set(b.date, b.close); });
  const dates: string[] = [];
  const closes: number[] = [];
  const bcloses: number[] = [];
  bars.forEach((b: any) => {
    if (typeof b.close !== "number") return;
    dates.push(b.date);
    closes.push(b.close);
    bcloses.push(bMap.get(b.date) ?? NaN);
  });
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  const brets: number[] = [];
  for (let i = 1; i < bcloses.length; i++) brets.push(bcloses[i - 1] && isFinite(bcloses[i - 1]) && isFinite(bcloses[i]) ? (bcloses[i] - bcloses[i - 1]) / bcloses[i - 1] : NaN);
  const rdates = dates.slice(1);
  const RF = 0.065 / 252;

  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const std = (a: number[]) => {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  };
  const roll = (w: number, fn: (win: number[]) => number): (number | null)[] =>
    rets.map((_, i) => (i + 1 < w ? null : fn(rets.slice(i + 1 - w, i + 1))));
  const rollVol = (w: number) => roll(w, (a) => std(a) * Math.sqrt(252) * 100);
  const rollSharpe = (w: number) => roll(w, (a) => { const s = std(a); return s > 0 ? (mean(a) - RF) / s * Math.sqrt(252) : null as unknown as number; });
  const rollSortino = (w: number) => roll(w, (a) => {
    const ex = a.map((v) => v - RF);
    const neg = ex.filter((v) => v < 0);
    const ds = neg.length > 1 ? std(neg) : std(a);
    return ds > 0 ? (mean(ex) / ds) * Math.sqrt(252) : 0;
  });
  const rollBeta = (w: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = rets.slice(i + 1 - w, i + 1);
    const b = brets.slice(i + 1 - w, i + 1);
    if (b.some((v) => !isFinite(v))) return null;
    const ms = mean(s), mb = mean(b);
    let cov = 0, vb = 0;
    for (let k = 0; k < w; k++) { cov += (s[k] - ms) * (b[k] - mb); vb += (b[k] - mb) * (b[k] - mb); }
    return vb > 0 ? cov / vb : null;
  });
  const rollCorr = (w: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = rets.slice(i + 1 - w, i + 1);
    const b = brets.slice(i + 1 - w, i + 1);
    if (b.some((v) => !isFinite(v))) return null;
    const ms = mean(s), mb = mean(b);
    let cov = 0, vs = 0, vb = 0;
    for (let k = 0; k < w; k++) { cov += (s[k] - ms) * (b[k] - mb); vs += (s[k] - ms) * (s[k] - ms); vb += (b[k] - mb) * (b[k] - mb); }
    return vs > 0 && vb > 0 ? cov / Math.sqrt(vs * vb) : null;
  });
  const rollVaR = (w: number, q: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = [...rets.slice(i + 1 - w, i + 1)].sort((a, b) => a - b);
    return s[Math.floor(q * (s.length - 1))] * 100;
  });
  const rollCVaR = (w: number, q: number): (number | null)[] => rets.map((_, i) => {
    if (i + 1 < w) return null;
    const s = [...rets.slice(i + 1 - w, i + 1)].sort((a, b) => a - b);
    const k = Math.max(1, Math.floor(q * s.length));
    const tail = s.slice(0, k);
    return (tail.reduce((a, b) => a + b, 0) / tail.length) * 100;
  });

  const vol21 = rollVol(21), vol63 = rollVol(63), vol126 = rollVol(126);
  const sh63 = rollSharpe(63), sh126 = rollSharpe(126), so63 = rollSortino(63);
  const beta63 = rollBeta(63), corr63 = rollCorr(63);
  const var95 = rollVaR(63, 0.05), cvar95 = rollCVaR(63, 0.05);

  // Drawdown + episodes (≥2% to register)
  const eq = [100];
  for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
  let runPeak = eq[0], runPeakI = 0, runTrough = eq[0], runTroughI = 0;
  interface Ep { peak: string; trough: string; rec: string; depth: number; days: number; open: boolean }
  const eps: Ep[] = [];
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] >= runPeak) {
      const depth = ((runTrough - runPeak) / runPeak) * 100;
      if (depth <= -2) eps.push({ peak: dates[runPeakI] ?? "", trough: dates[runTroughI] ?? "", rec: dates[i] ?? "", depth, days: i - runPeakI, open: false });
      runPeak = eq[i]; runPeakI = i; runTrough = eq[i]; runTroughI = i;
    } else if (eq[i] < runTrough) { runTrough = eq[i]; runTroughI = i; }
  }
  const curDD = ((eq[eq.length - 1] - runPeak) / runPeak) * 100;
  if (curDD <= -2) eps.push({ peak: dates[runPeakI] ?? "", trough: dates[runTroughI] ?? "", rec: "OPEN", depth: curDD, days: eq.length - 1 - runPeakI, open: true });
  const ddSeries = eq.map((v, i) => {
    let pk = eq[0];
    for (let k = 1; k <= i; k++) if (eq[k] > pk) pk = eq[k];
    return ((v - pk) / pk) * 100;
  });
  const worst = Math.min(...ddSeries);
  const top = [...eps].sort((a, b) => a.depth - b.depth).slice(0, 5);

  const lastV = (a: (number | null)[]) => { for (let i = a.length - 1; i >= 0; i--) { const v = a[i]; if (v !== null && isFinite(v)) return v; } return null; };
  const f1 = (v: number | null, suf = "") => (v === null ? "—" : `${v.toFixed(2)}${suf}`);
  const lv63 = lastV(vol63), ls63 = lastV(sh63), lso = lastV(so63), lb = lastV(beta63), lv = lastV(var95);
  const regime = lv63 !== null && vol126[vol126.length - 1] ? (lv63 > (lastV(vol126) ?? 0) * 1.2 ? "HEATING UP" : lv63 < (lastV(vol126) ?? 0) * 0.8 ? "COOLING OFF" : "NORMAL") : "—";
  const shortD = rdates.map((d) => d.slice(2, 7));
  const x3: [string, string, string] = [shortD[0] ?? "", shortD[Math.floor(shortD.length / 2)] ?? "", shortD[shortD.length - 1] ?? ""];
  const hasBench = bench.length > 50;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">{symbol} — rolling risk verdict · 63D window · 3Y tape</p>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Vol 63D</div><div className="val">{lv63 === null ? "—" : `${lv63.toFixed(1)}%`}</div><div className="sub">annualised</div></div>
          <div className="cell"><div className="lbl">Sharpe 63D</div><div className={`val ${(ls63 ?? 0) >= 1 ? "pos" : (ls63 ?? 0) < 0 ? "neg" : ""}`}>{f1(ls63)}</div><div className="sub">good &gt;1</div></div>
          <div className="cell"><div className="lbl">Sortino 63D</div><div className={`val ${(lso ?? 0) >= 1 ? "pos" : (lso ?? 0) < 0 ? "neg" : ""}`}>{f1(lso)}</div><div className="sub">downside</div></div>
          <div className="cell"><div className="lbl">Beta Nifty</div><div className="val">{lb === null ? "—" : lb.toFixed(2)}</div><div className="sub">63D</div></div>
          <div className="cell"><div className="lbl">VaR95 D</div><div className="val neg">{lv === null ? "—" : `${lv.toFixed(2)}%`}</div><div className="sub">daily</div></div>
          <div className="cell"><div className="lbl">Drawdown</div><div className={`val ${curDD < -10 ? "neg" : ""}`}>{worst.toFixed(1)}% / {curDD.toFixed(1)}%</div><div className="sub">worst / now</div></div>
          <div className="cell"><div className="lbl">Regime</div><div className={`val ${regime.includes("HEAT") ? "neg" : regime.includes("COOL") ? "pos" : ""}`} style={{ fontSize: 13 }}>{regime}</div><div className="sub">vol term</div></div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Vol term-structure — ann % (21/63/126D)</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => `${v.toFixed(1)}%`} series={[
            { label: "HV21", color: "#00c8ff", values: vol21 },
            { label: "HV63", color: "#ffa028", values: vol63 },
            { label: "HV126", color: "#5b5b62", values: vol126 },
          ]} />
        </div>
        <div className="panel">
          <p className="p-head">Risk-adjusted — rolling Sharpe/Sortino</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[
            { label: "SH63", color: "#ffa028", values: sh63 },
            { label: "SH126", color: "#5b5b62", values: sh126 },
            { label: "SO63", color: "#00d664", values: so63 },
          ]} />
          <p className="faint" style={{ fontSize: 11 }}>GUIDES: +1 GOOD · 0 BREAK-EVEN · RF 6.5%.</p>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Beta & correlation vs Nifty — 63D</p>
          {hasBench ? (
            <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[
              { label: "BETA", color: "#ffa028", values: beta63 },
              { label: "CORR", color: "#00c8ff", values: corr63 },
            ]} />
          ) : <p className="muted">BENCHMARK LEG THROTTLED — RETRY.</p>}
        </div>
        <div className="panel">
          <p className="p-head">Tail — rolling VaR95 / CVaR95 % daily</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => `${v.toFixed(2)}%`} series={[
            { label: "VAR95", color: "#ff453a", values: var95 },
            { label: "CVAR95", color: "#8f7bff", values: cvar95 },
          ]} />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Underwater — worst {worst.toFixed(1)}% · now {curDD.toFixed(1)}%</p>
        <AreaChart values={ddSeries} height={110} color="#ff453a" fill="rgba(255,69,58,0.15)" fmt={(v) => `${v.toFixed(1)}%`} label="DD" dates={rdates} />
      </div>

      <div className="panel">
        <p className="p-head">Drawdown episodes — top 5 by depth (≥2%)</p>
        {top.length ? (
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>PEAK</th><th style={{ textAlign: "left" }}>TROUGH</th><th style={{ textAlign: "left" }}>RECOVERY</th><th style={{ textAlign: "right" }}>DEPTH</th><th style={{ textAlign: "right" }}>DAYS</th></tr></thead>
              <tbody>
                {top.map((e, i) => (
                  <tr key={i}>
                    <td><strong>{e.peak}</strong></td>
                    <td>{e.trough}</td>
                    <td>{e.open ? <span className="neg">OPEN</span> : e.rec}</td>
                    <td style={{ textAlign: "right" }} className="neg">{e.depth.toFixed(1)}%</td>
                    <td style={{ textAlign: "right" }}>{e.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">NO ≥2% EPISODES IN WINDOW.</p>}
      </div>

      <div className="panel">
        <p className="p-head">AI analyst — RR</p>
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </div>
    </div>
  );
}


