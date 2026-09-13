"use client";

// Risk Terminal (module 22 full view) — the 12-point market-risk spec.
// Feeds: Yahoo prices/macros/options-proxy(NSE chain)/news/estimates +
// statements. Anything Yahoo lacks is an explicit NEEDS panel.

import { useEffect, useState } from "react";
import { rsi, macd, adx, ema, sma, atr, hurst, pctReturns } from "@/lib/indicators";
import { blackScholes } from "@/lib/options";
import { calcAltmanZ } from "@/lib/fundamentals";
import { chatComplete } from "@/lib/ai";
import { store } from "@/lib/store";
import { LineChart, GroupedBars, BarChart, AreaChart, HBars, Histogram } from "./charts";
import { MCFan } from "./ChartDesks";
import { mulberry32 } from "@/lib/utils";

type Num = number | null;

const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const RF = 0.065;

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const std = (a: number[]) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
};
const lastV = (a: (Num)[]): Num => {
  for (let i = a.length - 1; i >= 0; i--) { const v = a[i]; if (v !== null && isFinite(v as number)) return v; }
  return null;
};
const betaOf = (s: number[], b: number[]): Num => {
  const n = Math.min(s.length, b.length);
  if (n < 10) return null;
  const ms = mean(s), mb = mean(b);
  let cov = 0, vb = 0;
  for (let k = 0; k < n; k++) { cov += (s[k] - ms) * (b[k] - mb); vb += (b[k] - mb) * (b[k] - mb); }
  return vb > 0 ? cov / vb : null;
};
const corrOf = (s: number[], b: number[]): Num => {
  const n = Math.min(s.length, b.length);
  if (n < 10) return null;
  const ms = mean(s), mb = mean(b);
  let cov = 0, vs = 0, vb = 0;
  for (let k = 0; k < n; k++) { cov += (s[k] - ms) * (b[k] - mb); vs += (s[k] - ms) * (s[k] - ms); vb += (b[k] - mb) * (b[k] - mb); }
  return vs > 0 && vb > 0 ? cov / Math.sqrt(vs * vb) : null;
};
const retsOf = (closes: number[]): number[] => {
  const o: number[] = [];
  for (let i = 1; i < closes.length; i++) o.push(closes[i - 1] ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  return o;
};
function fitGARCH(r: number[]): { a: number; b: number; omega: number; ll: number } {
  const m = mean(r);
  const d = r.map((v) => v - m);
  const v0 = d.reduce((s, v) => s + v * v, 0) / d.length;
  let best = { a: 0.08, b: 0.9, omega: v0 * 0.02, ll: -Infinity };
  for (let a = 0.02; a <= 0.2; a += 0.02) {
    for (let b = 0.7; b <= 0.96; b += 0.02) {
      if (a + b >= 0.999) continue;
      const om = v0 * (1 - a - b);
      let v = v0, ll = 0, ok = true;
      for (const x of d) {
        if (v <= 0) { ok = false; break; }
        ll += -0.5 * (Math.log(2 * Math.PI * v) + (x * x) / v);
        v = om + a * x * x + b * v;
      }
      if (ok && ll > best.ll) best = { a, b, omega: om, ll };
    }
  }
  return best;
}

function Sec({ id, no, title, src, children }: { id: string; no: string; title: string; src: string; children: React.ReactNode }) {
  return (
    <div className="panel" id={id}>
      <p className="p-head">{no} · {title} <span className="faint">— {src}</span></p>
      {children}
    </div>
  );
}
function Dead({ items, need }: { items: string[]; need: string }) {
  return (
    <div className="panel">
      <p className="p-head">Not on feed</p>
      {items.map((d) => (
        <div key={d} className="fnrow dead">
          <span className="faint" style={{ minWidth: 26 }}>·</span>
          <span style={{ flex: 1 }}><strong className="faint">{d.toUpperCase()}</strong></span>
          <span className="badge bad">{need}</span>
        </div>
      ))}
    </div>
  );
}
function KV({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="kv"><span className="muted">{k}</span><strong className={cls}>{v}</strong></div>;
}

const NAV: Array<[string, string]> = [
  ["rk-mkt", "MKT"], ["rk-vol", "VOL"], ["rk-tail", "TAIL"], ["rk-dd", "DD"],
  ["rk-adj", "ADJ"], ["rk-liq", "LIQ"], ["rk-trend", "TREND"], ["rk-credit", "CREDIT"],
  ["rk-ev", "EVENTS"], ["rk-opt", "OPTIONS"], ["rk-sent", "SENTIMENT"], ["rk-sim", "SIM"],
];

export function RiskTerminal({ symbol }: { symbol: string }) {
  const [bars, setBars] = useState<any[]>([]);
  const [macros, setMacros] = useState<Record<string, any[]>>({});
  const [quote, setQuote] = useState<any>(null);
  const [stm, setStm] = useState<any>(null);
  const [est, setEst] = useState<any>(null);
  const [evts, setEvts] = useState<any>(null);
  const [news, setNews] = useState<any>(null);
  const [chain, setChain] = useState<any>(null);
  const [chain2, setChain2] = useState<any>(null);
  const [err, setErr] = useState("");
  const [ewmaL, setEwmaL] = useState(0.94);
  const [posINR, setPosINR] = useState("1000000");
  const [horizon, setHorizon] = useState("63");
  const [stopP, setStopP] = useState("10");
  const [takeP, setTakeP] = useState("20");
  const [simM, setSimM] = useState<"GBM" | "BOOT" | "GARCH">("GBM");
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setErr(""); setBars([]); setMacros({}); setChain(null); setChain2(null);
    const H = (s: string, range: string) =>
      fetch(`/api/history?symbol=${encodeURIComponent(s)}&range=${range}&interval=1d`).then((r) => r.json()).catch(() => null);
    Promise.all([H(symbol, "3y"), H("^NSEI", "2y"), H("USDINR=X", "2y"), H("CL=F", "2y"), H("^TNX", "2y")]).then(([a, n, f, c, t]) => {
      if (!alive) return;
      if (a?.error) { setErr(a.error); return; }
      setBars(a.bars ?? []);
      const m: Record<string, any[]> = {};
      if (n && !n.error) m.nifty = n.bars ?? [];
      if (f && !f.error) m.fx = f.bars ?? [];
      if (c && !c.error) m.crude = c.bars ?? [];
      if (t && !t.error) m.tnx = t.bars ?? [];
      setMacros(m);
    });
    fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setQuote(j); }).catch(() => {});
    fetch(`/api/statements?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setStm(j); }).catch(() => {});
    fetch(`/api/estimates?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setEst(j); }).catch(() => {});
    fetch(`/api/events?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((j) => { if (alive && !j.error) setEvts(j); }).catch(() => {});
    fetch(`/api/news?symbol=${encodeURIComponent(symbol)}&feed=company`).then((r) => r.json()).then((j) => { if (alive && !j.error) setNews(j); }).catch(() => {});
    const base = symbol.replace(/\.NS$|\.BO$/, "");
    fetch(`/api/ochain/expiry?symbol=${encodeURIComponent(base)}`).then((r) => r.json()).then((j) => {
      if (!alive || !j?.expiries?.length) return;
      const ex0 = j.expiries[0], ex1 = j.expiries[1];
      fetch(`/api/ochain/chain?symbol=${encodeURIComponent(base)}&expiry=${encodeURIComponent(ex0)}&mode=stock`).then((r) => r.json()).then((c) => { if (alive && !c.error) setChain(c); }).catch(() => {});
      if (ex1) fetch(`/api/ochain/chain?symbol=${encodeURIComponent(base)}&expiry=${encodeURIComponent(ex1)}&mode=stock`).then((r) => r.json()).then((c) => { if (alive && !c.error) setChain2(c); }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, [symbol]);

  async function askAI() {
    setAiLoading(true); setAiOut("");
    try {
      const txt = await chatComplete([
        { role: "system", content: "You are a terminal risk officer. Function RSK (Risk Assessment). Reply in terse uppercase terminal lines." },
        { role: "user", content: `SEC ${symbol}. FULL RISK STACK ON TAPE. TOP 3 RISKS + POSITION SIZE NOTE + HEDGE.` },
      ], { apiKey: store.getORKey(), model: store.getORModel() });
      setAiOut(txt);
    } catch (e: any) {
      setAiOut(`AI ERR: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  if (err) return <div className="panel"><p className="neg">RISK ERR: {err} (FEED THROTTLED — RETRY)</p></div>;
  if (bars.length < 130) return <div className="panel"><p className="muted">BUILDING RISK TERMINAL FOR {symbol}…</p></div>;

  const dates = bars.map((b: any) => b.date as string);
  const closes = bars.map((b: any) => b.close as number);
  const highs = bars.map((b: any) => b.high as number);
  const lows = bars.map((b: any) => b.low as number);
  const vols = bars.map((b: any) => b.volume as number);
  const rets = retsOf(closes);
  const rdates = dates.slice(1);
  const shortD = rdates.map((d) => d.slice(2, 7));
  const x3: [string, string, string] = [shortD[0] ?? "", shortD[Math.floor(shortD.length / 2)] ?? "", shortD[shortD.length - 1] ?? ""];
  const px = closes[closes.length - 1];
  const pos = Math.max(0, parseFloat(posINR) || 0);
  const H = Math.max(5, Math.min(252, parseInt(horizon) || 63));

  const mmap = (key: string) => {
    const m = new Map<string, number>();
    (macros[key] ?? []).forEach((b: any) => { if (typeof b.close === "number") m.set(b.date, b.close); });
    return closes.map((_, i) => m.get(dates[i]) ?? NaN);
  };
  const mrets = (key: string) => {
    const c = mmap(key);
    const o: number[] = [];
    for (let i = 1; i < c.length; i++) o.push(c[i - 1] && isFinite(c[i - 1]) && isFinite(c[i]) ? (c[i] - c[i - 1]) / c[i - 1] : NaN);
    return o;
  };
  const al = (a: number[], b: number[]) => {
    const s: number[] = [], m: number[] = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (isFinite(b[i])) { s.push(a[i]); m.push(b[i]); }
    return { s, m };
  };

  // ---- §1 market ----
  const rollW = (w: number, fn: (s: number[], b: number[]) => Num, key = "nifty"): (Num)[] => {
    const { s, m } = al(rets, mrets(key));
    return rets.map((_, i) => {
      if (i + 1 < w) return null;
      const ss = rets.slice(Math.max(0, i + 1 - w), i + 1);
      const bb = m.slice(Math.max(0, i + 1 - w), i + 1);
      void s;
      return fn(ss, bb);
    });
  };
  const b30 = rollW(30, betaOf), b90 = rollW(90, betaOf), b252 = rollW(252, betaOf);
  const b63 = rollW(63, betaOf), c63 = rollW(63, corrOf);
  const w252 = 252;
  const rs252 = rets.slice(-w252), { m: bn252 } = al(rets, mrets("nifty"));
  const bnW = bn252.slice(-w252);
  const beta252 = betaOf(rs252, bnW);
  const corr252 = corrOf(rs252, bnW);
  const r2 = corr252 !== null ? corr252 * corr252 : null;
  const annR = rs252.length ? (rs252.reduce((a, b) => a + b, 0) / rs252.length) * 252 : NaN;
  const annB = bnW.length ? (bnW.reduce((a, b) => a + b, 0) / bnW.length) * 252 : NaN;
  const alpha = beta252 !== null && isFinite(annR) && isFinite(annB) ? annR - (RF + beta252 * (annB - RF)) : null;
  const active = rs252.map((v, i) => v - (bnW[i] ?? 0));
  const te = std(active) * Math.sqrt(252);
  const ir = std(active) > 0 ? (mean(active) / std(active)) * Math.sqrt(252) : null;
  const corrRows = ["nifty", "fx", "crude", "tnx"].map((k) => {
    const { m } = al(rets, mrets(k));
    const w = m.slice(-63), sw = rets.slice(-63);
    const w2 = m.slice(-252), sw2 = rets.slice(-252);
    return { k: k.toUpperCase(), c63: corrOf(sw, w), c252: corrOf(sw2, w2), n: m.length };
  });

  // ---- §2 vol ----
  const hv = (w: number) => std(rets.slice(-w)) * Math.sqrt(252) * 100;
  const ewmaPath = (lam: number) => {
    const out: number[] = [];
    let v = rets.slice(0, 30).reduce((s, x) => s + x * x, 0) / 30;
    for (const r of rets) { v = lam * v + (1 - lam) * r * r; out.push(Math.sqrt(v) * Math.sqrt(252) * 100); }
    return out;
  };
  const ewPath = ewmaPath(ewmaL);
  const g = fitGARCH(rets.slice(-750));
  const gl = rets[rets.length - 1] - mean(rets);
  let gv = g.omega + g.a * gl * gl + g.b * (gl * gl);
  gv = g.omega / (1 - g.a - g.b);
  const garchF = [1, 5, 21].map((k) => {
    const v = g.omega / (1 - g.a - g.b) + Math.pow(g.a + g.b, k) * (gv - g.omega / (1 - g.a - g.b));
    return Math.sqrt(Math.max(v, 0)) * Math.sqrt(252) * 100;
  });
  const hv30roll = rets.map((_, i) => (i + 1 < 30 ? null : std(rets.slice(i - 29, i + 1)) * Math.sqrt(252) * 100));
  const vov = (() => {
    const f = hv30roll.filter((x): x is number => x !== null).slice(-126);
    return f.length > 10 ? (std(f) / mean(f)) * 100 : null;
  })();
  const hvNow = { h10: hv(10), h30: hv(30), h90: hv(90), h252: hv(252) };
  const regimeNow = hvNow.h30 > hvNow.h252 * 1.25 ? "CRISIS" : hvNow.h30 < hvNow.h252 * 0.7 ? "COMPRESSED" : "NORMAL";
  // regime states + transitions over 1y
  const states = ["CRISIS", "TREND", "COMPRESSED", "NORMAL"];
  const ax = adx(highs, lows, closes, 14).adx;
  const hu = hurst(closes);
  const stateAt = (i: number): string => {
    const v30 = i >= 30 ? std(rets.slice(i - 29, i + 1)) * Math.sqrt(252) * 100 : NaN;
    const v252 = i >= 252 ? std(rets.slice(i - 251, i + 1)) * Math.sqrt(252) * 100 : NaN;
    const a = ax[i];
    if (isFinite(v30) && isFinite(v252) && v30 > v252 * 1.4) return "CRISIS";
    if (a !== null && a !== undefined && (a as number) > 25) return "TREND";
    if (isFinite(v30) && isFinite(v252) && v30 < v252 * 0.65) return "COMPRESSED";
    return "NORMAL";
  };
  const trans: number[][] = states.map(() => states.map(() => 0));
  const seq = rets.map((_, i) => stateAt(i + 1)).slice(-252);
  for (let i = 1; i < seq.length; i++) trans[states.indexOf(seq[i - 1])][states.indexOf(seq[i])]++;
  const transP = trans.map((row) => {
    const s = row.reduce((a, b) => a + b, 0) || 1;
    return row.map((v) => v / s);
  });
  void hu;

  // ---- §3 tail ----
  const q = (arr: number[], p: number) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(p * (s.length - 1))];
  };
  const w63 = rets.slice(-63);
  const mu63 = mean(w63), sd63 = std(w63);
  const NINV = { "0.95": 1.645, "0.99": 2.326 } as const;
  const varRow = (conf: 0.95 | 0.99, days: number): (Num)[] => {
    const z = NINV[String(conf) as "0.95" | "0.99"];
    const param = (-(mu63 * days - z * sd63 * Math.sqrt(days))) * 100;
    const h = -q(w63, 1 - conf) * 100 * (days === 1 ? 1 : Math.sqrt(days));
    return [param, h, null];
  };
  const mcQ = (conf: number, days: number): Num => {
    const rnd = mulberry32(42);
    const sims: number[] = [];
    for (let s = 0; s < 4000; s++) {
      let p = 1;
      for (let d = 0; d < days; d++) {
        const u1 = Math.max(rnd(), 1e-9), u2 = rnd();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        p *= 1 + mu63 + sd63 * z;
      }
      sims.push((p - 1) * 100);
    }
    sims.sort((a, b) => a - b);
    return -sims[Math.floor((1 - conf) * (sims.length - 1))];
  };
  const skew = (() => {
    const m = mean(w63), s = std(w63);
    return s > 0 ? w63.reduce((a, v) => a + Math.pow((v - m) / s, 3), 0) / w63.length : NaN;
  })();
  const kurt = (() => {
    const m = mean(w63), s = std(w63);
    return s > 0 ? w63.reduce((a, v) => a + Math.pow((v - m) / s, 4), 0) / w63.length - 3 : NaN;
  })();
  const jb = (63 / 6) * (skew * skew + (kurt * kurt) / 4);
  const hill = (() => {
    const losses = w63.map((v) => -v).sort((a, b) => b - a);
    const k = Math.max(5, Math.floor(losses.length * 0.1));
    const tail = losses.slice(0, k);
    const xk = tail[tail.length - 1];
    if (xk <= 0) return NaN;
    return k / tail.reduce((s, x) => s + Math.log(x / xk), 0);
  })();
  const rollSum = (w: number) => rets.map((_, i) => (i + 1 < w ? null : rets.slice(i + 1 - w, i + 1).reduce((a, b) => a + b, 0) * 100));
  const worst1 = Math.min(...rets) * 100, worst5 = Math.min(...rollSum(5).filter((x): x is number => x !== null)), worst21 = Math.min(...rollSum(21).filter((x): x is number => x !== null));
  const crudeBeta = betaOf(rets.slice(-252), al(rets, mrets("crude")).m.slice(-252));
  const scen = [
    { label: "WORST 1M REPLAY", shock: worst21 / 100 },
    { label: "HYPOTHETICAL −10%", shock: -0.1 },
    { label: "HYPOTHETICAL −20%", shock: -0.2 },
    { label: "2008-STYLE −30%", shock: -0.3 },
    { label: "CRUDE +30% × β", shock: crudeBeta !== null ? 0.3 * crudeBeta : NaN },
  ];

  // ---- §4 drawdown ----
  const eq = [100];
  for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
  let pk = eq[0], pkI = 0, tr = eq[0], trI = 0;
  interface Ep { peak: string; rec: string; depth: number; days: number; open: boolean }
  const eps: Ep[] = [];
  for (let i = 1; i < eq.length; i++) {
    if (eq[i] >= pk) {
      const d = ((tr - pk) / pk) * 100;
      if (d <= -2) eps.push({ peak: dates[pkI] ?? "", rec: dates[i] ?? "", depth: d, days: i - pkI, open: false });
      pk = eq[i]; pkI = i; tr = eq[i]; trI = i;
    } else if (eq[i] < tr) { tr = eq[i]; trI = i; }
  }
  void trI;
  const curDD = ((eq[eq.length - 1] - pk) / pk) * 100;
  const ddDays = eq.length - 1 - pkI;
  if (curDD <= -2) eps.push({ peak: dates[pkI] ?? "", rec: "OPEN", depth: curDD, days: ddDays, open: true });
  const ddS = eq.map((v, i) => {
    let p = eq[0];
    for (let k = 1; k <= i; k++) if (eq[k] > p) p = eq[k];
    return ((v - p) / p) * 100;
  });
  const mdd = Math.min(...ddS);
  const freq = [5, 10, 20, 30].map((t) => eps.filter((e) => e.depth <= -t).length);
  const ulcer = Math.sqrt(ddS.reduce((s, v) => s + v * v, 0) / ddS.length);
  const pain = Math.abs(ddS.reduce((s, v) => s + v, 0) / ddS.length);
  const cagrEq = eq.length > 252 ? Math.pow(eq[eq.length - 1] / 100, 252 / (eq.length - 1)) - 1 : NaN;
  const calmar = mdd ? cagrEq / Math.abs(mdd / 100) : null;
  const recF = mdd ? ((eq[eq.length - 1] / 100 - 1) * 100) / Math.abs(mdd) : null;

  // ---- §5 adjusted ----
  const downside = (a: number[]) => {
    const ex = a.map((v) => v - RF / 252);
    const neg = ex.filter((v) => v < 0);
    return neg.length > 1 ? std(neg) : std(a);
  };
  const SH = (mean(rets) - RF / 252) / std(rets) * Math.sqrt(252);
  const SO = (mean(rets) - RF / 252) / downside(rets) * Math.sqrt(252);
  const TR = beta252 ? ((mean(rets) * 252 - RF) / beta252) : null;
  const OM = (() => {
    const g = rets.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const l = Math.abs(rets.filter((v) => v < 0).reduce((a, b) => a + b, 0));
    return l > 0 ? g / l : null;
  })();
  const ST = (() => {
    const ann = ddS.filter((_, i) => i % 21 === 0);
    const neg = ann.filter((v) => v < 0);
    const avgDD = neg.length ? Math.abs(neg.reduce((a, b) => a + b, 0) / neg.length) : NaN;
    return avgDD > 0 && isFinite(cagrEq) ? (cagrEq * 100) / avgDD : null;
  })();
  const shRoll = rets.map((_, i) => (i + 1 < 63 ? null : ((mean(rets.slice(i - 62, i + 1)) - RF / 252) / std(rets.slice(i - 62, i + 1))) * Math.sqrt(252)));

  // ---- §6 liquidity ----
  const adv = (w: number) => {
    const vv = vols.slice(-w), cc = closes.slice(-w);
    return vv.reduce((s, v, i) => s + v * cc[i], 0) / w;
  };
  const adv20 = adv(20), adv90 = adv(90);
  const spreadLive = quote?.bid && quote?.ask ? ((quote.ask - quote.bid) / quote.ask) * 10000 : null;
  const csProxy = (() => {
    const n = Math.min(63, rets.length);
    let s = 0;
    for (let i = closes.length - n; i < closes.length; i++) {
      const h = highs[i], l = lows[i], c = closes[i];
      if (h > l && c > 0) s += (h - l) / c;
    }
    return (s / n) * 10000;
  })();
  const amihud = (() => {
    const n = Math.min(63, rets.length);
    let s = 0, k = 0;
    for (let i = closes.length - n; i < closes.length; i++) {
      const inr = vols[i] * closes[i];
      if (inr > 0) { s += Math.abs(rets[i - 1] ?? 0) / (inr / 1e7); k++; }
    }
    return k ? s / k : null;
  })();

  // ---- §7 trend ----
  const rsi14 = rsi(closes, 14);
  const mc = macd(closes);
  const axV = adx(highs, lows, closes, 14);
  const ma20 = sma(closes, 20), ma50 = sma(closes, 50), ma200 = sma(closes, 200);
  const huLast = (() => { const h = hurst(closes); return isFinite(h) ? h : null; })();
  const aroon = (up: boolean, p = 25): (Num)[] => closes.map((_, i) => {
    if (i < p) return null;
    const w = closes.slice(i - p + 1, i + 1);
    const ext = up ? Math.max(...w) : Math.min(...w);
    const k = up ? w.lastIndexOf(ext) : w.lastIndexOf(ext);
    return ((k + 1) / p) * 100;
  });
  const arU = aroon(true), arD = aroon(false);
  const divs: string[] = [];
  for (let i = closes.length - 63; i < closes.length; i++) {
    if (i < 20) continue;
    const ph = Math.max(...closes.slice(i - 20, i + 1));
    const rh = Math.max(...(rsi14.slice(i - 20, i + 1).map((v) => v ?? -Infinity)));
    if (closes[i] >= ph && (rsi14[i] ?? 0) < rh - 5) { divs.push(`BEARISH ${(dates[i] ?? "").slice(5)} PX new high, RSI fading`); break; }
  }
  for (let i = closes.length - 63; i < closes.length; i++) {
    if (i < 20) continue;
    const pl = Math.min(...closes.slice(i - 20, i + 1));
    const rl = Math.min(...(rsi14.slice(i - 20, i + 1).map((v) => v ?? Infinity)));
    if (closes[i] <= pl && (rsi14[i] ?? 100) > rl + 5) { divs.push(`BULLISH ${(dates[i] ?? "").slice(5)} PX new low, RSI firming`); break; }
  }
  const lastCross = (a: (Num)[], b: (Num)[]): string => {
    for (let i = a.length - 1; i > 1; i--) {
      const a0 = a[i], a1 = a[i - 1], b0 = b[i], b1 = b[i - 1];
      if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
      if (a1 <= b1 && a0 > b0) return `BULL ${(dates[i] ?? "").slice(0, 10)}`;
      if (a1 >= b1 && a0 < b0) return `BEAR ${(dates[i] ?? "").slice(0, 10)}`;
    }
    return "NONE IN RANGE";
  };
  const gCross = (() => {
    for (let i = ma50.length - 1; i > Math.max(1, ma50.length - 63); i--) {
      const a0 = ma50[i], a1 = ma50[i - 1], b0 = ma200[i], b1 = ma200[i - 1];
      if (a0 === null || a1 === null || b0 === null || b1 === null) continue;
      if (a1 <= b1 && a0 > b0) return `GOLDEN ${(dates[i] ?? "").slice(0, 10)}`;
      if (a1 >= b1 && a0 < b0) return `DEATH ${(dates[i] ?? "").slice(0, 10)}`;
    }
    return "NONE 63D";
  })();
  const huShift = (() => {
    const prev = hurst(closes.slice(0, -63));
    if (!isFinite(prev) || huLast === null) return "—";
    return (prev > 0.5) !== (huLast > 0.5) ? "REGIME SHIFT" : "STABLE";
  })();

  // ---- §8 credit ----
  const st = stm as any;
  const srow = (t: any, c: string[]): Num[] => {
    if (!t) return [];
    const lows = t.rows.map((r: any) => ({ r, l: nn(r.label) }));
    for (const cc of c) {
      const e = lows.find((x: any) => x.l === nn(cc));
      if (e) return e.r.values;
    }
    for (const cc of c) {
      const all = lows.filter((x: any) => x.l.includes(nn(cc)));
      if (all.length) { all.sort((a: any, b: any) => a.r.label.length - b.r.label.length); return all[0].r.values; }
    }
    return [];
  };
  const L1 = (a: Num[]) => (a.length ? (a[a.length - 1] as Num) : null);
  const deNow = (() => { const d = L1(srow(st?.bs, ["total debt"])); const e = L1(srow(st?.bs, ["stockholders equity", "total equity gross minority interest"])); return d !== null && e ? d / e : null; })();
  const ndEbitda = (() => {
    const nd = L1(srow(st?.bs, ["net debt"])); const eb = L1(srow(st?.pl, ["ebitda"]));
    return nd !== null && eb ? nd / eb : null;
  })();
  const intCov = (() => {
    const e = L1(srow(st?.pl, ["ebit"])); const ie = L1(srow(st?.pl, ["interest expense"]));
    return e !== null && ie ? e / Math.abs(ie || 1) : null;
  })();
  const altZ = (() => {
    if (!st || !quote?.marketCap) return null;
    const A = (c: string[]) => L1(srow(st.bs, c));
    const E = (c: string[]) => L1(srow(st.pl, c));
    const ta = A(["total assets"]), tl = A(["total liabilities net minority interest", "total liabilities"]);
    const wc = A(["working capital"]) ?? (A(["current assets"]) !== null && A(["current liabilities"]) !== null ? (A(["current assets"]) as number) - (A(["current liabilities"]) as number) : null);
    if (ta === null || tl === null || wc === null) return null;
    return calcAltmanZ({
      niC: 0, retainedC: A(["retained earnings"]) ?? 0, ebitC: E(["ebit"]) ?? 0,
      workingCapital: wc, totalAssets: ta, totalLiab: tl,
      revenueC: E(["total revenue", "operating revenue"]) ?? 0, marketCap: quote.marketCap,
    });
  })();
  const epsVol = (() => {
    const n = srow(st?.pl, ["net income"]);
    const g: number[] = [];
    for (let i = 1; i < n.length; i++) { const a = n[i] as Num, b = n[i - 1] as Num; if (a !== null && b) g.push((a - b) / Math.abs(b)); }
    return g.length > 1 ? std(g) * 100 : null;
  })();

  // ---- §10 options ----
  const opt = (() => {
    if (!chain?.rows?.length) return null;
    const rows = chain.rows as any[];
    const U = chain.underlying || px;
    const T = 19 / 365, r = 0.065;
    const totCEV = rows.reduce((s, x) => s + (x.ceVol || 0), 0);
    const totPEV = rows.reduce((s, x) => s + (x.peVol || 0), 0);
    const totCEOI = rows.reduce((s, x) => s + (x.ceOI || 0), 0);
    const totPEOI = rows.reduce((s, x) => s + (x.peOI || 0), 0);
    let mp = 0, mpLoss = Infinity;
    for (const s of rows) {
      let loss = 0;
      for (const o of rows) {
        loss += (o.ceOI || 0) * Math.max(0, s.strike - o.strike) + (o.peOI || 0) * Math.max(0, o.strike - s.strike);
      }
      if (loss < mpLoss) { mpLoss = loss; mp = s.strike; }
    }
    const withDelta = rows.map((x) => {
      const sig = (x.ceIV || x.peIV || 0) / 100;
      let dc = NaN, dp = NaN;
      if (sig > 0) {
        try {
          const gc = blackScholes(U, x.strike, T, r, sig, "CALL");
          const gp = blackScholes(U, x.strike, T, r, sig, "PUT");
          if (gc) dc = gc.delta;
          if (gp) dp = gp.delta;
        } catch { /* keep NaN */ }
      }
      return { ...x, dc, dp };
    });
    const near = (arr: any[], key: string, t: number) => arr.reduce((a: any, b: any) => (Math.abs((a[key] ?? 9) - t) < Math.abs((b[key] ?? 9) - t) ? a : b), arr[0]);
    const put25 = near(withDelta.filter((x) => isFinite(x.dp) && x.dp < 0), "dp", -0.25);
    const call25 = near(withDelta.filter((x) => isFinite(x.dc) && x.dc > 0), "dc", 0.25);
    const atm = near(withDelta, "strike", U);
    const smile = withDelta.filter((x) => (x.ceIV || 0) > 0).map((x) => ({ k: x.strike, v: x.ceIV }));
    // Breeden-Litzenberger indicative density from call LTPs
    let dens: Array<{ k: number; v: number }> = [];
    try {
      const cs = withDelta.filter((x) => x.ceLTP > 0).sort((a, b) => a.strike - b.strike);
      const raw = cs.map((x, i) => {
        if (i === 0 || i === cs.length - 1) return { k: x.strike, v: 0 };
        const d2 = (cs[i + 1].ceLTP - 2 * x.ceLTP + cs[i - 1].ceLTP) / Math.pow((cs[i + 1].strike - cs[i - 1].strike) / 2, 2);
        return { k: x.strike, v: Math.exp(r * T) * Math.max(0, d2) };
      });
      const sm = raw.map((p, i) => ({ k: p.k, v: (raw[Math.max(0, i - 1)].v + p.v + raw[Math.min(raw.length - 1, i + 1)].v) / 3 }));
      const tot = sm.reduce((s, p) => s + p.v, 0) || 1;
      dens = sm.map((p) => ({ k: p.k, v: (p.v / tot) * 100 }));
    } catch { dens = []; }
    const iv2 = chain2?.rows?.length ? (() => {
      const r2x = chain2.rows as any[];
      const a = near(r2x, "strike", chain2.underlying || px);
      return (a?.ceIV || a?.peIV || 0) as number;
    })() : 0;
    return { totCEV, totPEV, totCEOI, totPEOI, mp, put25, call25, atm, smile, dens, iv2, U, expiry: chain.expiry, expiry2: chain2?.expiry };
  })();

  // ---- §12 sim ----
  const sim = (() => {
    const mu = mean(rets), sd = std(rets);
    const rnd = mulberry32(42);
    const zn = () => {
      const u1 = Math.max(rnd(), 1e-9), u2 = rnd();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
    const paths: number[][] = [];
    const ends: number[] = [];
    const N = 200;
    for (let s = 0; s < 2000; s++) {
      let p = px;
      const path = [p];
      let gv2 = sd * sd;
      for (let d = 0; d < H; d++) {
        let r: number;
        if (simM === "GBM") r = mu + sd * zn();
        else if (simM === "BOOT") r = rets[Math.floor(rnd() * rets.length)];
        else { gv2 = g.omega + g.a * Math.pow(rets[rets.length - 1] - mu, 2) * 0 + g.a * gv2 * 0 + g.b * gv2 + g.a * Math.pow(zn() * Math.sqrt(gv2), 2) * 0 + g.a * 0; r = mu + Math.sqrt(gv2) * zn(); gv2 = g.omega + g.a * Math.pow(r - mu, 2) + g.b * gv2; }
        p *= 1 + r;
        path.push(p);
      }
      if (simM === "GARCH") { /* evolved above */ }
      paths.push(path.filter((_, i) => i % Math.max(1, Math.floor(H / 63)) === 0));
      ends.push(p);
    }
    ends.sort((a, b) => a - b);
    const pct = (p: number) => ends[Math.floor((p / 100) * (ends.length - 1))];
    const loss = ends.filter((e) => e < px).length / ends.length;
    const stopPx = px * (1 - (parseFloat(stopP) || 0) / 100);
    const takePx = px * (1 + (parseFloat(takeP) || 0) / 100);
    // backtest: fan from H days ago
    const past = closes.slice(0, -H);
    const pr = retsOf(past);
    const pmu = mean(pr), psd = std(pr);
    const r2b = mulberry32(7);
    const bends: number[] = [];
    for (let s = 0; s < 1000; s++) {
      let p = past[past.length - 1];
      for (let d = 0; d < H; d++) {
        const u1 = Math.max(r2b(), 1e-9), u2 = r2b();
        p *= 1 + pmu + psd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      }
      bends.push(p);
    }
    bends.sort((a, b) => a - b);
    const b50 = bends[Math.floor(0.5 * (bends.length - 1))];
    const bErr = ((px - b50) / b50) * 100;
    return {
      paths: paths.slice(0, 60), ends,
      p5: pct(5), p10: pct(10), p25: pct(25), p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95),
      loss, pStop: ends.filter((e) => e <= stopPx).length / ends.length,
      pTake: ends.filter((e) => e >= takePx).length / ends.length,
      stopPx, takePx, b50, bErr,
    };
  })();

  const f2 = (v: Num, suf = "") => (v === null || !isFinite(v as number) ? "—" : `${(v as number).toFixed(2)}${suf}`);
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  return (
    <div className="grid">
      <div className="panel panel-glow stmt-toolbar">
        <div className="pills">
          {NAV.map(([id, l]) => (
            <button key={id} className="pill" style={{ fontSize: 10.5, padding: "4px 8px" }}
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{l}</button>
          ))}
        </div>
      </div>

      <Sec id="rk-mkt" no="§1" title="Market & price risk — 1Y unless noted" src="yahoo prices + macros">
        <div className="cells">
          <div className="cell"><div className="lbl">Beta Nifty 252D</div><div className="val">{beta252 === null ? "—" : beta252.toFixed(2)}</div><div className="sub">sensitivity</div></div>
          <div className="cell"><div className="lbl">Alpha (Jensen) ann</div><div className={`val ${(alpha ?? 0) >= 0 ? "pos" : "neg"}`}>{alpha === null ? "—" : `${(alpha * 100).toFixed(1)}%`}</div><div className="sub">vs Nifty</div></div>
          <div className="cell"><div className="lbl">R² beta reg</div><div className="val">{r2 === null ? "—" : r2.toFixed(2)}</div><div className="sub">market-explained</div></div>
          <div className="cell"><div className="lbl">Tracking err</div><div className="val">{isFinite(te) ? `${(te * 100).toFixed(1)}%` : "—"}</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">Info ratio</div><div className={`val ${(ir ?? 0) >= 0 ? "pos" : "neg"}`}>{ir === null || !isFinite(ir) ? "—" : ir.toFixed(2)}</div><div className="sub">active/TE</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Rolling beta vs Nifty — 30/90/252D</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[
            { label: "B30", color: "#00c8ff", values: b30 },
            { label: "B90", color: "#ffa028", values: b90 },
            { label: "B252", color: "#5b5b62", values: b252 },
          ]} />
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Correlation matrix — 63D / 252D</p>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>VS</th><th style={{ textAlign: "right" }}>CORR 63D</th><th style={{ textAlign: "right" }}>CORR 252D</th><th style={{ textAlign: "right" }}>N</th></tr></thead>
              <tbody>
                {corrRows.map((r) => (
                  <tr key={r.k}><td><strong>{r.k === "NIFTY" ? "NIFTY 50" : r.k === "FX" ? "USD/INR" : r.k === "CRUDE" ? "CRUDE (O2C)" : "US 10Y"}</strong></td>
                    <td style={{ textAlign: "right" }}>{r.c63 === null ? "—" : r.c63.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }}>{r.c252 === null ? "—" : r.c252.toFixed(2)}</td>
                    <td style={{ textAlign: "right" }} className="faint">{r.n}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 11 }}>SECTOR-INDEX BETA + CUSTOM MULTI-FACTOR BENCHMARK NEED SECTOR-INDEX FEED.</p>
        </div>
      </Sec>

      <Sec id="rk-vol" no="§2" title="Volatility analytics" src="tape + NSE chain">
        <div className="cells">
          <div className="cell"><div className="lbl">HV 10D</div><div className="val">{hvNow.h10.toFixed(1)}%</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">HV 30D</div><div className="val">{hvNow.h30.toFixed(1)}%</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">HV 90D</div><div className="val">{hvNow.h90.toFixed(1)}%</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">HV 252D</div><div className="val">{hvNow.h252.toFixed(1)}%</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">GARCH 1/5/21D</div><div className="val">{garchF.map((v) => v.toFixed(1)).join(" / ")}%</div><div className="sub">α {g.a.toFixed(2)} β {g.b.toFixed(2)}</div></div>
          <div className="cell"><div className="lbl">Regime</div><div className={`val ${regimeNow === "CRISIS" ? "neg" : regimeNow === "COMPRESSED" ? "pos" : ""}`} style={{ fontSize: 13 }}>{regimeNow}</div><div className="sub">vol state</div></div>
        </div>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <span className="faint" style={{ fontSize: 11 }}>EWMA λ</span>
          {[0.9, 0.94, 0.97].map((l) => (
            <button key={l} className={`pill${ewmaL === l ? " active" : ""}`} onClick={() => setEwmaL(l)}>{l.toFixed(2)}</button>
          ))}
          <span className="faint" style={{ fontSize: 11 }}>NOW {ewPath.length ? `${ewPath[ewPath.length - 1].toFixed(1)}%` : "—"}</span>
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div><p className="p-head">HV term 10/30/90D + EWMA</p>
            <LineChart dates={rdates} xLabels={x3} yFmt={(v) => `${v.toFixed(1)}%`} series={[
              { label: "HV10", color: "#00c8ff", values: rets.map((_, i) => (i + 1 < 10 ? null : std(rets.slice(i - 9, i + 1)) * Math.sqrt(252) * 100)) },
              { label: "HV30", color: "#ffa028", values: rets.map((_, i) => (i + 1 < 30 ? null : std(rets.slice(i - 29, i + 1)) * Math.sqrt(252) * 100)) },
              { label: "EWMA", color: "#00d664", values: ewPath },
            ]} />
          </div>
          <div><p className="p-head">Realized vs implied term</p>
            <HBars rows={[
              { label: "HV10", value: hvNow.h10, display: `${hvNow.h10.toFixed(1)}%`, color: "#5b5b62" },
              { label: "HV30", value: hvNow.h30, display: `${hvNow.h30.toFixed(1)}%`, color: "#00c8ff" },
              { label: "HV90", value: hvNow.h90, display: `${hvNow.h90.toFixed(1)}%`, color: "#00d664" },
              ...(chain ? [{ label: `IV ${chain.expiry}`, value: (() => { const a = chain.rows.reduce((x: any, y: any) => (Math.abs(y.strike - chain.underlying) < Math.abs(x.strike - chain.underlying) ? y : x), chain.rows[0]); return (a.ceIV || a.peIV || 0) as number; })(), display: `${(() => { const a = chain.rows.reduce((x: any, y: any) => (Math.abs(y.strike - chain.underlying) < Math.abs(x.strike - chain.underlying) ? y : x), chain.rows[0]); return (a.ceIV || a.peIV || 0) as number; })().toFixed(1)}%`, color: "#ffa028" }] : []),
              ...(chain2 ? [{ label: `IV ${chain2.expiry}`, value: (() => { const a = chain2.rows.reduce((x: any, y: any) => (Math.abs(y.strike - chain2.underlying) < Math.abs(x.strike - chain2.underlying) ? y : x), chain2.rows[0]); return (a.ceIV || a.peIV || 0) as number; })(), display: `${(() => { const a = chain2.rows.reduce((x: any, y: any) => (Math.abs(y.strike - chain2.underlying) < Math.abs(x.strike - chain2.underlying) ? y : x), chain2.rows[0]); return (a.ceIV || a.peIV || 0) as number; })().toFixed(1)}%`, color: "#8f7bff" }] : []),
            ]} />
            <p className="faint" style={{ fontSize: 11 }}>IV−HV = VOL RISK PREMIUM · IV HISTORY NEEDS ARCHIVE FEED (NO PERCENTILE).</p>
          </div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div><p className="p-head">Vol smile — IV vs strike ({chain?.expiry ?? "—"})</p>
            {chain ? (
              <LineChart
                dates={chain.rows.filter((x: any) => x.ceIV > 0).map((x: any) => String(x.strike))}
                yFmt={(v) => `${v.toFixed(1)}%`}
                series={[{ label: "IV", color: "#ffa028", values: chain.rows.filter((x: any) => x.ceIV > 0).map((x: any) => x.ceIV as number) }]}
              />
            ) : <p className="muted">CHAIN THROTTLED — RETRY.</p>}
          </div>
          <div><p className="p-head">Regime transitions — 1Y probabilities</p>
            <div className="scrollx">
              <table className="plain">
                <thead><tr><th></th>{states.map((s) => <th key={s} style={{ textAlign: "right", fontSize: 10 }}>{s.slice(0, 4)}</th>)}</tr></thead>
                <tbody>
                  {states.map((s, i) => (
                    <tr key={s}><td><strong style={{ fontSize: 11 }}>{s.slice(0, 4)}</strong></td>{transP[i].map((v, j) => <td key={j} style={{ textAlign: "right" }}>{(v * 100).toFixed(0)}%</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 11 }}>VOL-OF-VOL (HV30 DISPERSION) {vov === null ? "—" : `${vov.toFixed(1)}%`}.</p>
          </div>
        </div>
      </Sec>

      <Sec id="rk-tail" no="§3" title="Tail risk & distribution — 63D window" src="tape + Monte Carlo">
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>METRIC</th><th style={{ textAlign: "right" }}>PARAMETRIC</th><th style={{ textAlign: "right" }}>HISTORICAL</th><th style={{ textAlign: "right" }}>MONTE CARLO</th></tr></thead>
            <tbody>
              {([["VaR 95% 1D", 0.95, 1], ["VaR 99% 1D", 0.99, 1], ["VaR 95% 10D", 0.95, 10], ["VaR 99% 10D", 0.99, 10]] as Array<[string, 0.95 | 0.99, number]>).map(([l, c, d]) => {
                const v = varRow(c, d);
                return <tr key={l}><td><strong>{l}</strong></td><td style={{ textAlign: "right" }} className="neg">−{Math.abs(v[0] ?? NaN).toFixed(2)}%</td><td style={{ textAlign: "right" }} className="neg">−{Math.abs(v[1] ?? NaN).toFixed(2)}%</td><td style={{ textAlign: "right" }} className="neg">−{Math.abs(mcQ(c, d) ?? NaN).toFixed(2)}%</td></tr>;
              })}
              <tr><td><strong>CVaR 95% 1D</strong></td><td style={{ textAlign: "right" }} colSpan={3}>{(() => {
                const s = [...w63].sort((a, b) => a - b); const k = Math.max(1, Math.floor(0.05 * s.length));
                const c = (s.slice(0, k).reduce((a, b) => a + b, 0) / k) * 100;
                return <span className="neg">−{Math.abs(c).toFixed(2)}%</span>;
              })()}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">Skew</div><div className="val">{isFinite(skew) ? skew.toFixed(2) : "—"}</div><div className="sub">asymmetry</div></div>
          <div className="cell"><div className="lbl">Ex kurtosis</div><div className="val">{isFinite(kurt) ? kurt.toFixed(2) : "—"}</div><div className="sub">fat tails</div></div>
          <div className="cell"><div className="lbl">Jarque-Bera</div><div className={`val ${jb > 5.99 ? "neg" : "pos"}`}>{isFinite(jb) ? jb.toFixed(1) : "—"}</div><div className="sub">normal if &lt;6</div></div>
          <div className="cell"><div className="lbl">EVT tail α</div><div className="val">{isFinite(hill) ? hill.toFixed(2) : "—"}</div><div className="sub">Hill, lower=fatter</div></div>
          <div className="cell"><div className="lbl">Worst 1D/1W/1M</div><div className="val neg">{worst1.toFixed(1)} / {worst5.toFixed(1)} / {worst21.toFixed(1)}%</div><div className="sub">history</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Stress replay on ₹{Math.round(pos).toLocaleString("en-IN")} position</p>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <label className="faint" style={{ fontSize: 11 }}>POSITION ₹ <input className="box" value={posINR} onChange={(e) => setPosINR(e.target.value)} inputMode="numeric" style={{ width: 130, padding: "5px 8px" }} /></label>
          </div>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th style={{ textAlign: "left" }}>SCENARIO</th><th style={{ textAlign: "right" }}>SHOCK</th><th style={{ textAlign: "right" }}>P&L ₹</th></tr></thead>
              <tbody>
                {scen.map((s) => (
                  <tr key={s.label}><td><strong>{s.label}</strong></td>
                    <td style={{ textAlign: "right" }}>{isFinite(s.shock) ? `${(s.shock * 100).toFixed(1)}%` : "—"}</td>
                    <td style={{ textAlign: "right" }} className="neg">{isFinite(s.shock) ? `−${inr(Math.abs(pos * s.shock))}` : "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Sec>

      <Sec id="rk-dd" no="§4" title="Drawdown analytics" src="3Y tape">
        <div className="cells">
          <div className="cell"><div className="lbl">Now</div><div className={`val ${curDD < -10 ? "neg" : ""}`}>{curDD.toFixed(1)}% · {ddDays}d</div><div className="sub">depth + duration</div></div>
          <div className="cell"><div className="lbl">Max DD</div><div className="val neg">{mdd.toFixed(1)}%</div><div className="sub">3Y</div></div>
          <div className="cell"><div className="lbl">Calmar</div><div className="val">{calmar !== null && isFinite(calmar) ? calmar.toFixed(2) : "—"}</div><div className="sub">CAGR/maxDD</div></div>
          <div className="cell"><div className="lbl">Ulcer idx</div><div className="val">{ulcer.toFixed(1)}%</div><div className="sub">depth+duration</div></div>
          <div className="cell"><div className="lbl">Pain ratio</div><div className="val">{pain.toFixed(1)}%</div><div className="sub">avg DD</div></div>
          <div className="cell"><div className="lbl">Recovery f</div><div className="val">{recF !== null && isFinite(recF) ? recF.toFixed(2) : "—"}</div><div className="sub">gain/maxDD</div></div>
        </div>
        <div className="scrollx" style={{ marginTop: 8 }}>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>FREQ</th><th style={{ textAlign: "right" }}>&gt;5%</th><th style={{ textAlign: "right" }}>&gt;10%</th><th style={{ textAlign: "right" }}>&gt;20%</th><th style={{ textAlign: "right" }}>&gt;30%</th></tr></thead>
            <tbody><tr><td><strong>Episodes 3Y</strong></td>{freq.map((f, i) => <td key={i} style={{ textAlign: "right" }}>{f}</td>)}</tr></tbody>
          </table>
        </div>
        <div style={{ marginTop: 8 }}>
          <p className="p-head">Underwater</p>
          <AreaChart values={ddS.filter((_, i) => i % 2 === 0)} height={100} color="#ff453a" fill="rgba(255,69,58,0.15)" fmt={(v) => `${v.toFixed(1)}%`} label="DD" />
        </div>
        <div className="scrollx" style={{ marginTop: 8 }}>
          <table className="plain">
            <thead><tr><th style={{ textAlign: "left" }}>PEAK</th><th style={{ textAlign: "left" }}>RECOVERY</th><th style={{ textAlign: "right" }}>DEPTH</th><th style={{ textAlign: "right" }}>DAYS</th></tr></thead>
            <tbody>
              {[...eps].sort((a, b) => a.depth - b.depth).slice(0, 6).map((e, i) => (
                <tr key={i}><td><strong>{e.peak}</strong></td><td>{e.open ? <span className="neg">OPEN</span> : e.rec}</td>
                  <td style={{ textAlign: "right" }} className="neg">{e.depth.toFixed(1)}%</td><td style={{ textAlign: "right" }}>{e.days}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Sec>

      <Sec id="rk-adj" no="§5" title="Risk-adjusted returns" src="3Y tape">
        <div className="cells">
          <div className="cell"><div className="lbl">Sharpe</div><div className={`val ${SH >= 1 ? "pos" : SH < 0 ? "neg" : ""}`}>{isFinite(SH) ? SH.toFixed(2) : "—"}</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">Sortino</div><div className={`val ${SO >= 1 ? "pos" : SO < 0 ? "neg" : ""}`}>{isFinite(SO) ? SO.toFixed(2) : "—"}</div><div className="sub">ann</div></div>
          <div className="cell"><div className="lbl">Treynor</div><div className="val">{TR !== null && isFinite(TR) ? `${(TR * 100).toFixed(1)}%` : "—"}</div><div className="sub">per beta</div></div>
          <div className="cell"><div className="lbl">Omega</div><div className="val">{OM !== null && isFinite(OM) ? OM.toFixed(2) : "—"}</div><div className="sub">gain/loss</div></div>
          <div className="cell"><div className="lbl">Sterling</div><div className="val">{ST !== null && isFinite(ST) ? ST.toFixed(2) : "—"}</div><div className="sub">CAGR/avgDD</div></div>
          <div className="cell"><div className="lbl">Calmar</div><div className="val">{calmar !== null && isFinite(calmar) ? calmar.toFixed(2) : "—"}</div><div className="sub">CAGR/maxDD</div></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="p-head">Rolling Sharpe 63D</p>
          <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(2)} series={[{ label: "SH63", color: "#ffa028", values: shRoll }]} />
        </div>
      </Sec>

      <Sec id="rk-liq" no="§6" title="Liquidity risk" src="tape + quote">
        <div className="cells">
          <div className="cell"><div className="lbl">ADV 20D</div><div className="val">₹{(adv20 / 1e7).toFixed(0)} Cr</div><div className="sub">daily value</div></div>
          <div className="cell"><div className="lbl">ADV 90D</div><div className="val">₹{(adv90 / 1e7).toFixed(0)} Cr</div><div className="sub">daily value</div></div>
          <div className="cell"><div className="lbl">Spread live</div><div className="val">{spreadLive === null ? "—" : `${spreadLive.toFixed(1)} bps`}</div><div className="sub">bid/ask</div></div>
          <div className="cell"><div className="lbl">Spread proxy</div><div className="val">{csProxy.toFixed(1)} bps</div><div className="sub">63D range</div></div>
          <div className="cell"><div className="lbl">Amihud</div><div className="val">{amihud === null ? "—" : amihud.toFixed(3)}</div><div className="sub">|r|/₹Cr</div></div>
        </div>
        <p className="faint" style={{ fontSize: 11 }}>MODEL: 20% DAILY PARTICIPATION · IMPACT ≈ ½ SPREAD + 10% × √PARTICIPATION · {pos > 0 ? `₹${Math.round(pos).toLocaleString("en-IN")} = ${adv20 > 0 ? (pos / adv20).toFixed(1) : "—"}× ADV20 → ≈${adv20 > 0 ? Math.max(1, Math.ceil(pos / (adv20 * 0.2))) : "—"} DAYS` : "SET POSITION IN §3"}.</p>
      </Sec>

      <Sec id="rk-trend" no="§7" title="Momentum & trend risk" src="tape indicators">
        <div className="cells">
          <div className="cell"><div className="lbl">RSI 14</div><div className="val">{(() => { const v = lastV(rsi14); return v === null ? "—" : v.toFixed(1); })()}</div><div className="sub">{divs.length ? divs[0].split(" ")[0] + " DIV" : "no divergence"}</div></div>
          <div className="cell"><div className="lbl">ADX / DI+/DI−</div><div className="val">{(() => { const a = lastV(axV.adx), p = lastV(axV.pdi), m = lastV(axV.mdi); return a === null ? "—" : `${a.toFixed(0)} / ${(p ?? NaN).toFixed(0)} / ${(m ?? NaN).toFixed(0)}`; })()}</div><div className="sub">trend strength</div></div>
          <div className="cell"><div className="lbl">MA 20/50/200</div><div className="val" style={{ fontSize: 12 }}>{(() => { const a = lastV(ma20), b = lastV(ma50), c = lastV(ma200); return a === null ? "—" : `${Math.round(a).toLocaleString("en-IN")} / ${b === null ? "—" : Math.round(b).toLocaleString("en-IN")} / ${c === null ? "—" : Math.round(c).toLocaleString("en-IN")}`; })()}</div><div className="sub">{gCross}</div></div>
          <div className="cell"><div className="lbl">Hurst</div><div className="val">{huLast === null ? "—" : huLast.toFixed(3)}</div><div className="sub">{huShift}</div></div>
          <div className="cell"><div className="lbl">MACD cross</div><div className="val" style={{ fontSize: 12 }}>{lastCross(mc.line, mc.signal)}</div><div className="sub">hist trend</div></div>
          <div className="cell"><div className="lbl">ATR 14</div><div className="val">{(() => { const a = atr(highs, lows, closes, 14); const v = lastV(a); return v === null ? "—" : `₹${v.toFixed(0)}`; })()}</div><div className="sub">stop gauge</div></div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div><p className="p-head">ADX + DI+/DI−</p>
            <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(0)} series={[
              { label: "ADX", color: "#ffa028", values: axV.adx },
              { label: "DI+", color: "#00d664", values: axV.pdi },
              { label: "DI−", color: "#ff453a", values: axV.mdi },
            ]} />
          </div>
          <div><p className="p-head">Aroon up/down 25D</p>
            <LineChart dates={rdates} xLabels={x3} yFmt={(v) => v.toFixed(0)} series={[
              { label: "AROON-UP", color: "#00d664", values: arU },
              { label: "AROON-DN", color: "#ff453a", values: arD },
            ]} />
          </div>
        </div>
        {divs.length > 0 && <p className="neg" style={{ fontSize: 12 }}>DIVERGENCE: {divs.join(" · ")}</p>}
      </Sec>

      <Sec id="rk-credit" no="§8" title="Fundamental / credit overlay" src="statements + quote">
        <div className="cells">
          <div className="cell"><div className="lbl">Debt / Equity</div><div className="val">{deNow === null ? "—" : deNow.toFixed(2)}</div><div className="sub">leverage</div></div>
          <div className="cell"><div className="lbl">Net D / EBITDA</div><div className="val">{ndEbitda === null ? "—" : ndEbitda.toFixed(2)}</div><div className="sub">payback</div></div>
          <div className="cell"><div className="lbl">Int coverage</div><div className="val">{intCov === null ? "—" : `${intCov.toFixed(1)}x`}</div><div className="sub">EBIT/interest</div></div>
          <div className="cell"><div className="lbl">Altman Z</div><div className="val">{altZ ? altZ.zScore.toFixed(2) : "—"}</div><div className="sub">{altZ ? altZ.zone : ""}</div></div>
          <div className="cell"><div className="lbl">Earnings vol</div><div className="val">{epsVol === null ? "—" : `${epsVol.toFixed(1)}%`}</div><div className="sub">NI growth σ</div></div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Dead items={["Credit rating & outlook", "CDS spread (market-implied credit)"]} need="NEEDS RATINGS FEED" />
        </div>
      </Sec>

      <Sec id="rk-ev" no="§9" title="Event & calendar risk" src="estimates + events">
        <div className="cells">
          <div className="cell"><div className="lbl">Next earnings</div><div className="val" style={{ fontSize: 13 }}>{est?.nextEarnings ?? "—"}</div><div className="sub">{est?.nextEarnings ? `${Math.max(0, Math.ceil((Date.parse(est.nextEarnings) - Date.now()) / 864e5))}D AWAY` : "unknown"}</div></div>
          <div className="cell"><div className="lbl">TTM yield</div><div className="val">{evts ? `${evts.ttmYieldPct ?? "—"}%` : "—"}</div><div className="sub">{evts ? `${evts.payoutsTTM ?? 0} payouts` : ""}</div></div>
          <div className="cell"><div className="lbl">Splits 5Y</div><div className="val">{evts ? (evts.splits?.length ?? 0) : "—"}</div><div className="sub">corp actions</div></div>
          <div className="cell"><div className="lbl">Last dividend</div><div className="val" style={{ fontSize: 12 }}>{evts?.dividends?.[0] ? `${evts.dividends[0].date} ₹${evts.dividends[0].amount}` : "—"}</div><div className="sub">ex-date leg</div></div>
        </div>
        <div style={{ marginTop: 8 }}>
          <Dead items={["Historical earnings-day moves", "Nifty rebalancing windows", "Buyback/split pipeline", "RBI / budget / Fed macro overlay"]} need="NEEDS CALENDAR FEED" />
        </div>
      </Sec>

      <Sec id="rk-opt" no="§10" title={`Options market signals — ${chain ? `${chain.expiry} · U ₹${chain.underlying}` : "no chain"}`} src="NSE chain">
        {!opt ? <p className="muted">CHAIN THROTTLED OR NO EXPIRY — RETRY.</p> : (
          <>
            <div className="cells">
              <div className="cell"><div className="lbl">PCR vol</div><div className="val">{opt.totCEV ? (opt.totPEV / opt.totCEV).toFixed(2) : "—"}</div><div className="sub">put/call vol</div></div>
              <div className="cell"><div className="lbl">PCR OI</div><div className="val">{opt.totCEOI ? (opt.totPEOI / opt.totCEOI).toFixed(2) : "—"}</div><div className="sub">put/call OI</div></div>
              <div className="cell"><div className="lbl">Max pain</div><div className="val">₹{opt.mp.toLocaleString("en-IN")}</div><div className="sub">pin level</div></div>
              <div className="cell"><div className="lbl">25Δ skew</div><div className="val">{opt.put25 && opt.call25 ? `${(((opt.put25.peIV || 0) - (opt.call25.ceIV || 0))).toFixed(1)}pp` : "—"}</div><div className="sub">put−call IV</div></div>
              <div className="cell"><div className="lbl">ATM IV</div><div className="val">{opt.atm ? `${((opt.atm.ceIV || opt.atm.peIV || 0)).toFixed(1)}%` : "—"}</div><div className="sub">@ {opt.atm?.strike}</div></div>
            </div>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <div><p className="p-head">OI concentration — top strikes</p>
                <div className="scrollx">
                  <table className="plain">
                    <thead><tr><th style={{ textAlign: "right" }}>STRIKE</th><th style={{ textAlign: "right" }}>CE OI</th><th style={{ textAlign: "right" }}>PE OI</th></tr></thead>
                    <tbody>
                      {[...opt.dens].map(() => null)}
                      {[...chain.rows].sort((a: any, b: any) => (b.ceOI + b.peOI) - (a.ceOI + a.peOI)).slice(0, 6).map((x: any) => (
                        <tr key={x.strike}><td style={{ textAlign: "right" }}><strong>{x.strike}</strong>{x.strike === opt.mp ? <span className="sec"> ●MP</span> : ""}</td>
                          <td style={{ textAlign: "right" }}>{(x.ceOI / 1000).toFixed(0)}k</td><td style={{ textAlign: "right" }}>{(x.peOI / 1000).toFixed(0)}k</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div><p className="p-head">Implied expiry density (indicative)</p>
                {opt.dens.length ? (
                  <BarChart values={opt.dens.map((d) => d.v)} labels={opt.dens.map((d) => String(d.k))} height={110} posColor="#ffa028" negColor="#ffa028" />
                ) : <p className="muted">NO DENSITY.</p>}
              </div>
            </div>
          </>
        )}
      </Sec>

      <Sec id="rk-sent" no="§11" title="Sentiment & news risk" src="news wire + street">
        <div className="cells">
          <div className="cell"><div className="lbl">Bull / bear</div><div className="val">{news ? `${news.bull ?? 0} / ${news.bear ?? 0}` : "—"}</div><div className="sub">of {news?.count ?? 0} stories</div></div>
          <div className="cell"><div className="lbl">7D tilt</div><div className="val">{sent7d()}</div><div className="sub">bull/bear new</div></div>
          <div className="cell"><div className="lbl">Street buys</div><div className="val">{est?.recommendation ? `${(est.recommendation.strongBuy ?? 0) + (est.recommendation.buy ?? 0)}` : "—"}</div><div className="sub">SB+buy count</div></div>
          <div className="cell"><div className="lbl">30D rev</div><div className="val">{est?.earningsTrend?.[0] ? `+${est.earningsTrend[0].epsRevisions?.up30d ?? 0}/−${est.earningsTrend[0].epsRevisions?.down30d ?? 0}` : "—"}</div><div className="sub">EPS revisions</div></div>
        </div>
        {est?.recommendation && (
          <div style={{ marginTop: 8 }}>
            <HBars rows={[
              { label: "STRONG BUY", value: est.recommendation.strongBuy ?? 0, display: String(est.recommendation.strongBuy ?? 0), color: "#00d664" },
              { label: "BUY", value: est.recommendation.buy ?? 0, display: String(est.recommendation.buy ?? 0), color: "#00c8ff" },
              { label: "HOLD", value: est.recommendation.hold ?? 0, display: String(est.recommendation.hold ?? 0), color: "#ffa028" },
              { label: "SELL+", value: (est.recommendation.sell ?? 0) + (est.recommendation.strongSell ?? 0), display: String((est.recommendation.sell ?? 0) + (est.recommendation.strongSell ?? 0)), color: "#ff453a" },
            ]} />
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <Dead items={["Short interest / days-to-cover"]} need="NEEDS SHORT FEED (N/A NSE)" />
        </div>
      </Sec>

      <Sec id="rk-sim" no="§12" title={`Monte Carlo — ${H}d fan · ${simM} · seed 42`} src="tape + GARCH fit">
        <div className="toolbar" style={{ marginBottom: 8 }}>
          {(["GBM", "BOOT", "GARCH"] as const).map((m) => (
            <button key={m} className={`pill${simM === m ? " active" : ""}`} onClick={() => setSimM(m)}>{m === "GBM" ? "GBM" : m === "BOOT" ? "BOOTSTRAP" : "GARCH"}</button>
          ))}
          <label className="faint" style={{ fontSize: 11 }}>DAYS <input className="box" value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" style={{ width: 60, padding: "5px 8px" }} /></label>
          <label className="faint" style={{ fontSize: 11 }}>STOP % <input className="box" value={stopP} onChange={(e) => setStopP(e.target.value)} inputMode="decimal" style={{ width: 60, padding: "5px 8px" }} /></label>
          <label className="faint" style={{ fontSize: 11 }}>TAKE % <input className="box" value={takeP} onChange={(e) => setTakeP(e.target.value)} inputMode="decimal" style={{ width: 60, padding: "5px 8px" }} /></label>
        </div>
        <div className="scrollx">
          <table className="plain">
            <thead><tr>{["P5", "P10", "P25", "P50", "P75", "P90", "P95"].map((h) => <th key={h} style={{ textAlign: "right" }}>{h}</th>)}</tr></thead>
            <tbody><tr>{[sim.p5, sim.p10, sim.p25, sim.p50, sim.p75, sim.p90, sim.p95].map((v, i) => <td key={i} style={{ textAlign: "right" }}>{inr(v)}</td>)}</tr></tbody>
          </table>
        </div>
        <div className="cells" style={{ marginTop: 8 }}>
          <div className="cell"><div className="lbl">P(loss)</div><div className="val neg">{(sim.loss * 100).toFixed(1)}%</div><div className="sub">ends below px</div></div>
          <div className="cell"><div className="lbl">P(stop)</div><div className="val neg">{(sim.pStop * 100).toFixed(1)}%</div><div className="sub">≤ {inr(sim.stopPx)}</div></div>
          <div className="cell"><div className="lbl">P(take)</div><div className="val pos">{(sim.pTake * 100).toFixed(1)}%</div><div className="sub">≥ {inr(sim.takePx)}</div></div>
          <div className="cell"><div className="lbl">Backtest</div><div className={`val ${Math.abs(sim.bErr) < 5 ? "pos" : "neg"}`}>{sim.bErr >= 0 ? "+" : ""}{sim.bErr.toFixed(1)}%</div><div className="sub">last fan P50 err</div></div>
        </div>
        <div style={{ marginTop: 8 }}>
          <MCFan paths={sim.paths} />
        </div>
        <p className="faint" style={{ fontSize: 11 }}>2000 PATHS · {simM === "GBM" ? "LOGNORMAL μ/σ" : simM === "BOOT" ? "RESAMPLED HISTORY" : `GARCH α${g.a.toFixed(2)} β${g.b.toFixed(2)}`} · BACKTEST = FAN FROM {H}D AGO VS ACTUAL.</p>
      </Sec>

      <Sec id="rk-ai" no="§AI" title="AI risk officer" src="chat">
        <div className="toolbar">
          <button className="btn" onClick={askAI} disabled={aiLoading}>{aiLoading ? "RUNNING…" : `RUN AI ON ${symbol}`}</button>
        </div>
        {aiOut && <pre className="ai" style={{ marginTop: 10 }}>{aiOut}</pre>}
      </Sec>
    </div>
  );

  function sent7d(): string {
    if (!news?.items?.length) return "—";
    const cut = Date.now() - 7 * 864e5;
    let a = 0, b = 0;
    for (const it of news.items) {
      const t = Date.parse(it.published ?? "");
      if (!isFinite(t) || t < cut) continue;
      const s = typeof it.score === "number" ? it.score : 0;
      if (s > 0) a++; else if (s < 0) b++;
    }
    if (!a && !b) return "QUIET 7D";
    return `${a}↑ ${b}↓`;
  }
}
