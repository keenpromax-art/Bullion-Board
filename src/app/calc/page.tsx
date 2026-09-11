"use client";

import { useState } from "react";
import { store } from "@/lib/store";
import { kelly } from "@/lib/risk";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";

type Tab = "SIP" | "CAGR" | "KELLY" | "POS" | "PIVOT" | "YTM" | "EXPIRY";

const f2 = (v: number) => isFinite(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--sub)" }}>{label}
      <input className="box" value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" />
    </label>
  );
}

function lastThursday(y: number, m: number): Date {
  const d = new Date(y, m + 1, 0);
  while (d.getDay() !== 4) d.setDate(d.getDate() - 1);
  return d;
}

export default function CalcPage() {
  const [tab, setTab] = useState<Tab>("SIP");
  const [sipP, setSipP] = useState("10000");
  const [sipY, setSipY] = useState("10");
  const [sipR, setSipR] = useState("12");
  const [cS, setCS] = useState("100");
  const [cE, setCE] = useState("200");
  const [cY, setCY] = useState("5");
  const [kW, setKW] = useState("55");
  const [kA, setKA] = useState("8");
  const [kL, setKL] = useState("5");
  const [pE, setPE] = useState("100000");
  const [pR, setPR] = useState("1");
  const [pS, setPS] = useState("20");
  const [pH, setPH] = useState("1500");
  const [pL, setPL] = useState("1400");
  const [pC, setPC] = useState("1475");
  const [yP, setYP] = useState("980");
  const [yF, setYF] = useState("1000");
  const [yC, setYC] = useState("7");
  const [yN, setYN] = useState("5");

  const P = parseFloat(sipP), Y = parseFloat(sipY), R = parseFloat(sipR) / 100;
  const n = Math.round(Y * 12), r = R / 12;
  const sipFV = P > 0 && n > 0 && r > 0 ? P * ((Math.pow(1 + r, n) - 1) / r) * (1 + r) : NaN;

  const cs = parseFloat(cS), ce = parseFloat(cE), cy = parseFloat(cY);
  const cagr = cs > 0 && ce > 0 && cy > 0 ? Math.pow(ce / cs, 1 / cy) - 1 : NaN;

  const kw = parseFloat(kW) / 100, kaw = parseFloat(kA), kal = Math.abs(parseFloat(kL));
  const kellyF = kw > 0 && kw < 1 && kaw > 0 && kal > 0 ? kelly(kw, kaw, kal) : NaN;

  const pe = parseFloat(pE), pr = parseFloat(pR) / 100, ps = parseFloat(pS);
  const shares = pe > 0 && pr > 0 && ps > 0 ? Math.floor((pe * pr) / ps) : NaN;

  const H = parseFloat(pH), L = parseFloat(pL), C = parseFloat(pC);
  const P2 = (H + L + C) / 3;
  const piv = H > 0 && L > 0 && C > 0 ? { R3: 2 * P2 + (H - 2 * L), R2: P2 + (H - L), R1: 2 * P2 - L, PP: P2, S1: 2 * P2 - H, S2: P2 - (H - L), S3: 2 * P2 - (2 * H - L) } : null;
  const fib = H > L && L > 0 ? [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((f) => ({ f, v: H - (H - L) * f })) : null;

  const yp = parseFloat(yP), yf = parseFloat(yF), yc = parseFloat(yC), yn = parseFloat(yN);
  const ytm = yp > 0 && yf > 0 && yn > 0 ? ((yc / 100) * yf + (yf - yp) / yn) / ((yf + yp) / 2) : NaN;

  const now = new Date();
  let ey = now.getFullYear(), em = now.getMonth();
  if (lastThursday(ey, em).getTime() < now.getTime()) { em++; if (em > 11) { em = 0; ey++; } }
  const exp = lastThursday(ey, em);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / 86400000);

  return (
    <>
      <CommandBar ticker={store.getTicker()} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel panel-glow">
          <p className="p-head">Desk calculators</p>
          <div className="pills">
            {(["SIP", "CAGR", "KELLY", "POS", "PIVOT", "YTM", "EXPIRY"] as Tab[]).map((t) => (
              <button key={t} className={`pill${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>

        {tab === "SIP" && (
          <div className="panel">
            <p className="p-head">SIP — future value</p>
            <div className="grid grid-3">
              <Field label="MONTHLY ₹" value={sipP} onChange={setSipP} />
              <Field label="YEARS" value={sipY} onChange={setSipY} />
              <Field label="RETURN % P.A." value={sipR} onChange={setSipR} />
            </div>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">Invested</div><div className="val">₹{f2(P * n)}</div></div>
              <div className="cell"><div className="lbl">Future value</div><div className="val pos">₹{f2(sipFV)}</div></div>
              <div className="cell"><div className="lbl">Gains</div><div className="val">{f2(sipFV - P * n)}</div></div>
            </div>
          </div>
        )}

        {tab === "CAGR" && (
          <div className="panel">
            <p className="p-head">CAGR</p>
            <div className="grid grid-3">
              <Field label="START" value={cS} onChange={setCS} />
              <Field label="END" value={cE} onChange={setCE} />
              <Field label="YEARS" value={cY} onChange={setCY} />
            </div>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">CAGR</div><div className="val pos">{isFinite(cagr) ? `${(cagr * 100).toFixed(2)}%` : "—"}</div></div>
              <div className="cell"><div className="lbl">Multiple</div><div className="val">{cs > 0 && ce > 0 ? `${(ce / cs).toFixed(2)}×` : "—"}</div></div>
            </div>
          </div>
        )}

        {tab === "KELLY" && (
          <div className="panel">
            <p className="p-head">Kelly fraction — f* = p − q/b</p>
            <div className="grid grid-3">
              <Field label="WIN RATE %" value={kW} onChange={setKW} />
              <Field label="AVG WIN %" value={kA} onChange={setKA} />
              <Field label="AVG LOSS % (+)" value={kL} onChange={setKL} />
            </div>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">Full Kelly</div><div className="val">{isFinite(kellyF) ? `${(kellyF * 100).toFixed(1)}%` : "—"}</div></div>
              <div className="cell"><div className="lbl">Half Kelly</div><div className="val">{isFinite(kellyF) ? `${(kellyF * 50).toFixed(1)}%` : "—"}</div></div>
              <div className="cell"><div className="lbl">Note</div><div className="val" style={{ fontSize: 13 }}>{kellyF <= 0 ? "NO EDGE — SKIP" : "SIZE EVERY BET"}</div></div>
            </div>
          </div>
        )}

        {tab === "POS" && (
          <div className="panel">
            <p className="p-head">Position size — risk stop</p>
            <div className="grid grid-3">
              <Field label="EQUITY ₹" value={pE} onChange={setPE} />
              <Field label="RISK %" value={pR} onChange={setPR} />
              <Field label="STOP DIST ₹" value={pS} onChange={setPS} />
            </div>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">Risk ₹</div><div className="val">{f2(pe * (pr / 100))}</div></div>
              <div className="cell"><div className="lbl">Shares</div><div className="val">{isFinite(shares) ? shares.toLocaleString("en-IN") : "—"}</div></div>
            </div>
          </div>
        )}

        {tab === "PIVOT" && (
          <div className="panel">
            <p className="p-head">Floor pivots + Fibonacci (prior H/L/C)</p>
            <div className="grid grid-3">
              <Field label="HIGH" value={pH} onChange={setPH} />
              <Field label="LOW" value={pL} onChange={setPL} />
              <Field label="CLOSE" value={pC} onChange={setPC} />
            </div>
            <div className="grid grid-2" style={{ marginTop: 10 }}>
              <div>
                <table className="plain">
                  <thead><tr><th>LEVEL</th><th style={{ textAlign: "right" }}>PX</th></tr></thead>
                  <tbody>
                    {piv && (["R3", "R2", "R1", "PP", "S1", "S2", "S3"] as const).map((k) => (
                      <tr key={k}><td><strong className={k === "PP" ? "sec" : k.startsWith("R") ? "pos" : "neg"}>{k}</strong></td><td style={{ textAlign: "right" }}>{piv[k].toFixed(1)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <table className="plain">
                  <thead><tr><th>FIB</th><th style={{ textAlign: "right" }}>PX</th></tr></thead>
                  <tbody>
                    {fib?.map((x) => (
                      <tr key={x.f}><td>{(x.f * 100).toFixed(1)}%</td><td style={{ textAlign: "right" }}>{x.v.toFixed(1)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === "YTM" && (
          <div className="panel">
            <p className="p-head">Bond YTM (approx)</p>
            <div className="grid grid-4">
              <Field label="PRICE" value={yP} onChange={setYP} />
              <Field label="FACE" value={yF} onChange={setYF} />
              <Field label="COUPON %" value={yC} onChange={setYC} />
              <Field label="YEARS" value={yN} onChange={setYN} />
            </div>
            <div className="cells" style={{ marginTop: 10 }}>
              <div className="cell"><div className="lbl">YTM</div><div className="val">{isFinite(ytm) ? `${(ytm * 100).toFixed(2)}%` : "—"}</div></div>
              <div className="cell"><div className="lbl">Current yield</div><div className="val">{yp > 0 && yf > 0 ? `${(((yc / 100) * yf) / yp * 100).toFixed(2)}%` : "—"}</div></div>
            </div>
          </div>
        )}

        {tab === "EXPIRY" && (
          <div className="panel">
            <p className="p-head">Monthly expiry — classic last-Thursday cycle</p>
            <div className="cells">
              <div className="cell"><div className="lbl">Next expiry</div><div className="val">{exp.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</div></div>
              <div className="cell"><div className="lbl">Days left</div><div className="val">{daysLeft}</div><div className="sub">calendar days</div></div>
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>INDEX WEEKLIES FOLLOW EXCHANGE CIRCULARS — VERIFY ON NSE BEFORE TRADING WEEKLIES.</p>
          </div>
        )}
      </main>
      <StatusBar extra="CALC" />
    </>
  );
}
