"use client";

import { useEffect, useState } from "react";
import { CommandBar, StatusBar } from "@/components/TerminalChrome";
import { AreaChart, HBars } from "@/components/charts";
import { store } from "@/lib/store";

function downloadCSV(name: string, header: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([[header, ...rows].map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const f2 = (v: number | null | undefined, suffix = "") =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;

function Cell({ lbl, val, sub, cls }: { lbl: string; val: string; sub?: string; cls?: string }) {
  return <div className="cell"><div className="lbl">{lbl}</div><div className={`val ${cls ?? ""}`}>{val}</div>{sub && <div className="sub">{sub}</div>}</div>;
}

/* ---------------- live tab ---------------- */

function LiveTab({ snap }: { snap: any }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const sc = snap.score ?? {};
  const verdict = sc.verdict ?? "NO_DATA";
  const b = snap.breadth ?? {};
  const rows: any[] = b.rows ?? [];
  const tup = (v: any): [number, number, number] => [Number(v?.[0] ?? 0), Number(v?.[1] ?? 0), Number(v?.[2] ?? 0)];
  const seg = (label: string, v: [number, number, number]): [string, [number, number, number]] => [label, v];
  const segs = [
    seg("NIFTY 50", tup(b.matrix?.nifty50 ?? [b.adv ?? 0, b.dec ?? 0, b.unc ?? 0])),
    seg("NIFTY 500", tup(b.matrix?.n500)),
    seg("MIDCAP 150", tup(b.matrix?.midcap)),
    seg("SMALLCAP 250", tup(b.matrix?.smallcap)),
    seg("TOTAL MKT", tup(b.matrix?.total)),
  ].filter(([, v]) => v[0] + v[1] + v[2] > 0);

  const filtered = rows.filter((r) => {
    if (search && !String(r.symbol).toUpperCase().includes(search.toUpperCase())) return false;
    if (status === "Adv" && r.status !== "Advance") return false;
    if (status === "Dec" && r.status !== "Decline") return false;
    if (status === "Unch" && r.status !== "Unchanged") return false;
    return true;
  });

  const intra: any[] = snap.intraday ?? [];
  const n = snap.nifty ?? {};

  function logSnapshot() {
    try {
      const raw = window.localStorage.getItem("iss.opening.log");
      const log = raw ? JSON.parse(raw) : [];
      log.push({
        at: snap.fetchedAtIST, slot: snap.currentSlot,
        score: sc.value, verdict, nifty: n.last, niftyChg: n.chg,
      });
      window.localStorage.setItem("iss.opening.log", JSON.stringify(log.slice(-500)));
      alert(`LOGGED ${snap.currentSlot} → ${verdict} (${log.length} ROWS STORED)`);
    } catch { alert("LOG FAILED (QUOTA?)"); }
  }

  return (
    <div className="grid">
      <div className={`panel panel-glow`} style={{ borderColor: verdict === "GREEN" ? "rgba(0,214,100,0.5)" : verdict === "RED" ? "rgba(255,69,58,0.5)" : undefined }}>
        <p className="p-head">Pre-market verdict — {snap.currentSlot} IST</p>
        <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.5px" }} className={verdict === "GREEN" ? "pos" : verdict === "RED" ? "neg" : "neutral"}>
            {verdict === "GREEN" ? "● LIKELY GREEN OPEN" : verdict === "RED" ? "● LIKELY RED OPEN" : verdict === "FLAT" ? "● MIXED / FLAT OPEN" : "○ NO DATA"}
          </span>
          <span className="muted">SCORE {sc.value !== null && sc.value !== undefined ? `${sc.value >= 0 ? "+" : ""}${sc.value}/${sc.n}` : "—"}</span>
          <button className="ghost" style={{ marginLeft: "auto" }} onClick={logSnapshot}>LOG SNAPSHOT</button>
        </div>
        <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0 0" }}>
          LOAD {snap.fetchedAtIST} · US {snap.usDate ?? "—"} · SGX {snap.sgxDate ?? "—"} · NIFTY {snap.niftyDate ?? "—"}
        </p>
      </div>

      <div className="panel">
        <p className="p-head">Global cues & volatility</p>
        <div className="cells">
          <Cell lbl="NASDAQ" val={snap.nasdaq?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} sub={`${f2(snap.nasdaq?.chg, "%")} · ${snap.usDate ?? ""}`} cls={(snap.nasdaq?.chg ?? 0) >= 0 ? "pos" : "neg"} />
          <Cell lbl="DOW" val={snap.dow?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} sub={`${f2(snap.dow?.chg, "%")}`} cls={(snap.dow?.chg ?? 0) >= 0 ? "pos" : "neg"} />
          <Cell lbl="SGX STI" val={snap.sgx?.last?.toLocaleString("en-IN", { maximumFractionDigits: 0 }) ?? "—"} sub={`${f2(snap.sgx?.chg, "%")} · NIFTY PROXY`} cls={(snap.sgx?.chg ?? 0) >= 0 ? "pos" : "neg"} />
          <Cell lbl="INDIA VIX" val={snap.vix !== null && snap.vix !== undefined ? snap.vix.toFixed(2) : "—"} sub={snap.vixCond ?? ""} cls={snap.vixCond === "VOLATILE" ? "neg" : "pos"} />
          <Cell lbl="GLOBAL CUE" val={snap.globalCue?.source ?? "—"} sub={`${f2(snap.globalCue?.chg, "%")}${snap.globalCue?.fallback ? " · PROXY" : ""}`} />
          <Cell lbl="SLOT" val={snap.currentSlot ?? "—"} sub="CAPTURE GRID" />
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Nifty 50 — OHLC + intraday path</p>
        <div className="cells">
          <Cell lbl="Last" val={n.last?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"} sub={`${f2(n.chg, "%")}`} cls={(n.chg ?? 0) >= 0 ? "pos" : "neg"} />
          <Cell lbl="Open" val={n.open?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"} />
          <Cell lbl="High" val={n.high?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"} sub="day" />
          <Cell lbl="Low" val={n.low?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"} sub="day" />
          <Cell lbl="Range" val={n.range?.toFixed(2) ?? "—"} sub="pts" />
          <Cell lbl="Bars" val={String(intra.length)} sub="1H today" />
        </div>
        {intra.length > 1 && (
          <div style={{ marginTop: 10 }}>
            <AreaChart values={intra.map((x) => x.close)} dates={intra.map((x) => x.time)} label="NIFTY" height={150} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
              <span>{intra[0].time}</span><span>{intra[Math.floor(intra.length / 2)].time}</span><span>{intra[intra.length - 1].time} IST</span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <p className="p-head">Signal build — every vote that makes the score</p>
        <table className="plain">
          <thead><tr><th>SIGNAL</th><th style={{ textAlign: "right" }}>READING</th><th style={{ textAlign: "right" }}>VOTE</th></tr></thead>
          <tbody>
            {(sc.signals ?? []).map((s: any) => (
              <tr key={s.name}>
                <td><strong>{s.name}</strong></td>
                <td style={{ textAlign: "right" }}>{s.value === null || s.value === undefined ? "—" : typeof s.value === "number" ? s.value.toFixed(2) : s.value}</td>
                <td style={{ textAlign: "right" }}><span className={s.vote > 0 ? "pos" : s.vote < 0 ? "neg" : ""}>{s.vote === null ? "—" : s.vote > 0 ? "+1" : s.vote < 0 ? "−1" : "0"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <p className="p-head">Market breadth — {b.source === "NSE" ? "NSE OFFICIAL" : "YAHOO FALLBACK"} · A/D</p>
        <HBars rows={[
          { label: "ADVANCES", value: b.adv ?? 0, display: String(b.adv ?? 0), color: "#00d664" },
          { label: "DECLINES", value: b.dec ?? 0, display: String(b.dec ?? 0), color: "#ff453a" },
          { label: "UNCHANGED", value: b.unc ?? 0, display: String(b.unc ?? 0), color: "#5b5b62" },
        ]} />
        <div style={{ marginTop: 10 }}>
          <table className="plain">
            <thead><tr><th>SEGMENT</th><th style={{ textAlign: "right" }}>ADV</th><th style={{ textAlign: "right" }}>DEC</th><th style={{ textAlign: "right" }}>UNCH</th><th style={{ textAlign: "right" }}>NET</th></tr></thead>
            <tbody>
              {segs.map(([label, v]) => (
                <tr key={label}>
                  <td><strong>{label}</strong></td>
                  <td style={{ textAlign: "right" }} className="pos">{v[0].toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }} className="neg">{v[1].toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }}>{v[2].toLocaleString("en-IN")}</td>
                  <td style={{ textAlign: "right" }}><span className={v[0] - v[1] >= 0 ? "pos" : "neg"}>{v[0] - v[1] >= 0 ? "+" : ""}{(v[0] - v[1]).toLocaleString("en-IN")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="panel">
          <p className="p-head">Top gainers</p>
          <table className="plain">
            <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th></tr></thead>
            <tbody>
              {(b.gainers ?? []).map((r: any) => (
                <tr key={r.symbol}><td><span className="sec">{r.symbol}</span></td><td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td><td style={{ textAlign: "right" }} className="pos">+{r.chgPct?.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <p className="p-head">Top losers</p>
          <table className="plain">
            <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th></tr></thead>
            <tbody>
              {(b.losers ?? []).map((r: any) => (
                <tr key={r.symbol}><td><span className="sec">{r.symbol}</span></td><td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td><td style={{ textAlign: "right" }} className="neg">{r.chgPct?.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <p className="p-head">Breadth explorer — {rows.length} securities</p>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <input className="box" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="SEARCH SYMBOL…" style={{ flex: 1 }} />
          {["All", "Adv", "Dec", "Unch"].map((s) => (
            <button key={s} className={`pill${status === s ? " active" : ""}`} onClick={() => setStatus(s)}>{s.toUpperCase()}</button>
          ))}
          <button className="ghost" onClick={() => downloadCSV(
            "breadth.csv", ["SYMBOL", "LAST", "CHG_PCT", "VOLUME", "VALUE_CR", "STATUS"],
            filtered.map((r: any) => [r.symbol, r.last, r.chgPct, r.volume, r.valueCr, r.status])
          )}>↓ CSV</button>
        </div>
        <div className="scrollx">
          <table className="plain">
            <thead><tr><th>SEC</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>CHG %</th><th style={{ textAlign: "right" }}>VOL</th><th style={{ textAlign: "right" }}>VAL ₹ CR</th><th style={{ textAlign: "right" }}>STATUS</th></tr></thead>
            <tbody>
              {filtered.slice(0, 120).map((r: any) => (
                <tr key={r.symbol}>
                  <td><span className="sec">{r.symbol}</span></td>
                  <td style={{ textAlign: "right" }}>{r.last?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                  <td style={{ textAlign: "right" }}><span className={r.chgPct >= 0 ? "pos" : "neg"}>{r.chgPct >= 0 ? "+" : ""}{r.chgPct?.toFixed(2)}</span></td>
                  <td style={{ textAlign: "right" }}>{r.volume ? r.volume.toLocaleString("en-IN") : "—"}</td>
                  <td style={{ textAlign: "right" }}>{r.valueCr ? r.valueCr.toLocaleString("en-IN") : "—"}</td>
                  <td style={{ textAlign: "right" }}><span className={r.status === "Advance" ? "pos" : r.status === "Decline" ? "neg" : ""}>{r.status.toUpperCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>SHOWING {Math.min(120, filtered.length)} OF {filtered.length} · FOR STUDY ONLY, NOT ADVICE.</p>
      </div>

      <div className="panel">
        <p className="p-head">Capture grid</p>
        <div className="pills">
          {(snap.slots ?? []).map((s: string) => (
            <span key={s} className={`badge${s === snap.currentSlot ? " fnc" : ""}`}>{s === snap.currentSlot ? `▶ ${s}` : s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- history tab ---------------- */

function HistoryTab() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [hDate, setHDate] = useState("");
  const [hBars, setHBars] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/opening/history?days=250")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "history failed");
        setData(j);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    fetch("/api/history?symbol=%5ENSEI&range=1mo&interval=1h")
      .then((r) => r.json())
      .then((j) => {
        const bars = (j.bars ?? []).map((b: any) => {
          const ist = new Date((b.time + 19800) * 1000);
          return {
            ...b,
            istDate: ist.toISOString().slice(0, 10),
            istTime: `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`,
          };
        });
        const dates = [...new Set(bars.map((b: any) => b.istDate))] as string[];
        const pick = hDate || dates[dates.length - 1] || "";
        if (!hDate && pick) setHDate(pick);
        setHBars(bars.filter((b: any) => b.istDate === pick));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hDate === ""]);

  function pickDate(d: string) {
    setHDate(d);
    fetch("/api/history?symbol=%5ENSEI&range=1mo&interval=1h")
      .then((r) => r.json())
      .then((j) => {
        const bars = (j.bars ?? []).map((b: any) => {
          const ist = new Date((b.time + 19800) * 1000);
          return { ...b, istDate: ist.toISOString().slice(0, 10), istTime: `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}` };
        });
        setHBars(bars.filter((b: any) => b.istDate === d));
      })
      .catch(() => {});
  }

  const dayRows: any[] = (data?.rows ?? []).slice(0, 60);
  const hCloses = hBars.map((b) => b.close);
  const hOpen = hCloses.length ? hBars[0].open : null;

  return (
    <div className="grid">
      <div className="panel panel-glow">
        <p className="p-head">Accuracy scorecard — 09:00 signal vs day return · zero lookahead</p>
        {err && <p className="neg">ERR: {err}</p>}
        {!data && !err && <p className="muted">BACKFILLING 250 SESSIONS…</p>}
        {data && (
          <div className="cells">
            <div className="cell"><div className="lbl">Evaluated days</div><div className="val">{data.evaluated}</div><div className="sub">of {data.days}</div></div>
            <div className="cell"><div className="lbl">Win rate</div><div className={`val ${data.winRate >= 50 ? "pos" : "neg"}`}>{data.winRate}%</div><div className="sub">{data.hits} hits</div></div>
            <div className="cell"><div className="lbl">Avg on GREEN</div><div className="val">{data.avgGreen !== null ? `${data.avgGreen >= 0 ? "+" : ""}${data.avgGreen.toFixed(2)}%` : "—"}</div><div className="sub">bullish days</div></div>
            <div className="cell"><div className="lbl">Avg on RED</div><div className="val">{data.avgRed !== null ? `${data.avgRed.toFixed(2)}%` : "—"}</div><div className="sub">bearish days</div></div>
            <div className="cell"><div className="lbl">O/N agreement</div><div className="val">{data.agreePct}%</div><div className="sub">{data.agreeN} pairs</div></div>
            <div className="cell"><div className="lbl">Signals</div><div className="val" style={{ fontSize: 13 }}>NDQ+DOW+SGX</div><div className="sub">no breadth hist</div></div>
          </div>
        )}
      </div>

      {data && (
        <div className="panel">
          <p className="p-head">Date-wise 09:00 vs close — latest 60</p>
          <div className="scrollx">
            <table className="plain">
              <thead><tr><th>DATE</th><th style={{ textAlign: "right" }}>SCORE</th><th>VERDICT</th><th style={{ textAlign: "right" }}>DAY %</th><th>OUTCOME</th></tr></thead>
              <tbody>
                {dayRows.map((r: any) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td style={{ textAlign: "right" }}>{r.score !== null ? `${r.score >= 0 ? "+" : ""}${r.score}` : "—"}</td>
                    <td><span className={`badge ${r.verdict === "GREEN" ? "ok" : r.verdict === "RED" ? "bad" : "fnc"}`}>{r.verdict}</span></td>
                    <td style={{ textAlign: "right" }}><span className={r.dayRet !== null && r.dayRet >= 0 ? "pos" : "neg"}>{r.dayRet !== null ? `${r.dayRet >= 0 ? "+" : ""}${r.dayRet.toFixed(2)}` : "—"}</span></td>
                    <td style={{ fontSize: 12 }}>{r.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <p className="p-head">Hourly tracker — pick a session</p>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <input className="box" value={hDate} onChange={(e) => pickDate(e.target.value)} placeholder="YYYY-MM-DD" style={{ maxWidth: 160 }} />
          <span className="muted" style={{ fontSize: 12 }}>1H BARS · LAST ~30 DAYS ONLY (FEED LIMIT)</span>
        </div>
        {hCloses.length > 1 ? (
          <>
            <AreaChart values={hCloses} dates={hBars.map((b: any) => b.istTime)} label="NIFTY" height={150} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
              <span>{hBars[0]?.istTime}</span><span>{hBars[Math.floor(hBars.length / 2)]?.istTime}</span><span>{hBars[hBars.length - 1]?.istTime} IST</span>
            </div>
            <table className="plain" style={{ marginTop: 8 }}>
              <thead><tr><th>IST</th><th style={{ textAlign: "right" }}>LAST</th><th style={{ textAlign: "right" }}>FROM OPEN %</th></tr></thead>
              <tbody>
                {hBars.map((b: any) => (
                  <tr key={b.istTime}>
                    <td>{b.istTime}</td>
                    <td style={{ textAlign: "right" }}>{b.close?.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
                    <td style={{ textAlign: "right" }}><span className={b.close >= hOpen ? "pos" : "neg"}>{hOpen ? `${(((b.close - hOpen) / hOpen) * 100).toFixed(2)}` : "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="muted">NO HOURLY BARS FOR THIS DATE — PICK A RECENT TRADING DAY.</p>
        )}
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function OpeningPage() {
  const [tab, setTab] = useState<"live" | "hist">("live");
  const [snap, setSnap] = useState<any>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true); setErr("");
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

  useEffect(() => { load(); setTicker(store.getTicker()); }, []);
  const [ticker, setTicker] = useState("RELIANCE.NS");

  return (
    <>
      <CommandBar ticker={ticker} onTicker={() => {}} />
      <main className="container grid">
        <div className="panel">
          <div className="toolbar">
            <button className={`pill${tab === "live" ? " active" : ""}`} onClick={() => setTab("live")}>● LIVE DESK</button>
            <button className={`pill${tab === "hist" ? " active" : ""}`} onClick={() => setTab("hist")}>ACCURACY + HISTORY</button>
            <button className="ghost" style={{ marginLeft: "auto" }} onClick={load} disabled={loading}>{loading ? "LOADING…" : "↻ REFRESH"}</button>
          </div>
          {err && <p className="neg" style={{ marginTop: 8 }}>ERR: {err} <button className="ghost" onClick={load}>RETRY</button></p>}
        </div>
        {tab === "live" && (snap ? <LiveTab snap={snap} /> : !err && <div className="panel"><p className="muted">PULLING PRE-MARKET TAPE…</p></div>)}
        {tab === "hist" && <HistoryTab />}
      </main>
      <StatusBar extra="PRE" />
    </>
  );
}
