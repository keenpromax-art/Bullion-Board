"use client";

// Guided Home — the flagship screen, and the new visual identity.
//
// DESIGNED PHONE-FIRST. One asset owns the first screen (large identity, large
// price, large chart). Secondary indices sit below it as small tiles. The market
// map replaces a table of sector rows with sized, tinted tiles so the SHAPE of
// the session is legible before a single number is read.
//
// Everything is one payload from /api/guided/home. Nothing here is invented:
// when a tile has no reading it says so, and the footer reports exactly how
// much of the feed came back.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import GuidedShell from "./GuidedShell";
import { store } from "@/lib/store";

interface HomePayload {
  indexes: Array<{ sym: string; label: string; short: string; last: number | null; chg: number | null }>;
  sectors: Array<{ key: string; name: string; chg: number | null; reported: number; of: number; best: { sym: string; chg: number } | null }>;
  gainers: Array<{ sym: string; last: number | null; chg: number | null }>;
  losers: Array<{ sym: number | string; last: number | null; chg: number | null }>;
  spark: number[];
  summary: {
    index: number | null; vix: number | null;
    sectorsUp: number; sectorsDown: number; sectorsTotal: number; sectorMean: number | null;
  };
  degraded: { indexes: number; sectors: string[]; moversReported: number; moversTotal: number };
}

const px = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !isFinite(v)
    ? "—"
    : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const sign = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const dir = (v: number | null | undefined) =>
  v === null || v === undefined || !isFinite(v) ? "flat" : v > 0 ? "pos" : v < 0 ? "neg" : "flat";

/** Tint strength from the move, so the map reads as a gradient of conviction. */
function heatStyle(chg: number | null): React.CSSProperties {
  if (chg === null || !isFinite(chg)) {
    return { background: "var(--g-heat-0)", color: "var(--g-text-3)" };
  }
  const t = Math.min(1, Math.abs(chg) / 1.4);
  const base = chg >= 0 ? "var(--g-heat-up)" : "var(--g-heat-down)";
  // Mixed solid over the canvas: no CSS gradients anywhere in this product.
  // The INK is --g-text in both themes, never a hardcoded white. A fixed #fff
  // was correct on dark and invisible on light: at the 31% mix this threshold
  // sits at, the light cell is #b0e2cc and white type on it measures 1.5:1.
  // --g-text is pale on a dark-tinted cell and near-black on a pale one, which
  // is the right answer on both sides of the mix without a second threshold.
  return {
    background: `color-mix(in srgb, ${base} ${Math.round(14 + t * 40)}%, var(--g-surface))`,
    color: "var(--g-text)",
  };
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) {
    return <div className="gx-hero-spark gx-skel" aria-hidden />;
  }
  const W = 100, H = 30;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * W;
    const y = H - 1 - ((v - lo) / span) * (H - 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const stroke = up ? "var(--g-pos)" : "var(--g-neg)";
  const last = values[values.length - 1]!;
  const lastY = H - 1 - ((last - lo) / span) * (H - 2);
  return (
    <svg className="gx-hero-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      role="img" aria-label={`${values.length}-session path, ${up ? "up" : "down"} over the period`}>
      <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill={stroke} opacity="0.12" />
      <polyline points={pts.join(" ")} fill="none" stroke={stroke} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <circle cx={W - 0.6} cy={lastY.toFixed(2)} r="1.8" fill={stroke} />
    </svg>
  );
}

export default function GuidedHome() {
  const [d, setD] = useState<HomePayload | null>(null);
  const [err, setErr] = useState("");
  const [ticker, setTicker] = useState("");

  useEffect(() => {
    setTicker(store.getTicker());
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/guided/home");
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "home feed failed");
        if (alive) setD(j);
      } catch (e: any) {
        if (alive) setErr(e.message || "home feed failed");
      }
    })();
    return () => { alive = false; };
  }, []);

  const nifty = d?.indexes.find((i) => i.short === "NIFTY") ?? null;
  const tiles = useMemo(
    () => (d?.indexes ?? []).filter((i) => i.short !== "NIFTY").slice(0, 4),
    [d]
  );
  const sectors = useMemo(() => (d?.sectors ?? []).slice(0, 12), [d]);

  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();

  // Today's read, derived ONLY from the numbers already on screen.
  const reads = useMemo(() => {
    if (!d) return [] as Array<{ icon: string; t: string; d: string }>;
    const out: Array<{ icon: string; t: string; d: string }> = [];
    const lead = sectors.filter((s) => s.chg !== null).sort((a, b) => b.chg! - a.chg!)[0];
    const lag = sectors.filter((s) => s.chg !== null).sort((a, b) => a.chg! - b.chg!)[0];
    if (lead && lead.chg! > 0) {
      out.push({ icon: "▲", t: `${lead.name} leads the market`, d: `Averaging ${lead.reported} of ${lead.of} constituents, it is up ${lead.chg!.toFixed(2)}% today.` });
    }
    if (lag && lag.chg! < 0) {
      out.push({ icon: "▼", t: `${lag.name} is the weak spot`, d: `Down ${Math.abs(lag.chg!).toFixed(2)}% on ${lag.reported} of ${lag.of} constituents reporting.` });
    }
    if (d.summary.vix !== null) {
      const v = d.summary.vix;
      out.push({
        icon: v > 0 ? "◆" : "◇",
        t: v > 0 ? "Volatility is rising" : v < 0 ? "Volatility is easing" : "Volatility is flat",
        d: `India VIX ${sign(v)} today. A rising number means a wider expected range in the next session, not a direction.`,
      });
    }
    if (d.summary.sectorsTotal) {
      out.push({
        icon: "◐",
        t: `${d.summary.sectorsUp} of ${d.summary.sectorsTotal} sectors higher`,
        d: `Equal-weight average across the sectors reporting today is ${sign(d.summary.sectorMean)}.`,
      });
    }
    return out.slice(0, 4);
  }, [d]);

  return (
    <GuidedShell title="Today" ticker={ticker}>
      {/* The greeting opens the screen ONCE. It used to also appear inside the
          hero's loading fallback, which printed the same two lines twice before
          the data arrived. */}
      <header className="gx-full">
        <p className="gx-eyebrow">{greeting}</p>
        <h1 className="gx-h1">Here&apos;s what matters today</h1>
      </header>

      {/* ---- hero: one asset owns the first screen ---- */}
      {nifty ? (
        <section className="gx-hero gx-full">
          <div className="gx-hero-top">
            <div className="gx-hero-id">
              <div className="gx-hero-name">{nifty.label}</div>
              <div className="gx-hero-meta">{nifty.sym} · NSE</div>
            </div>
            <Link className="gx-chip" href="/g/markets">Details</Link>
          </div>

          <div className={`g-num gx-hero-px gx-${dir(nifty.chg)}`}>{px(nifty.last)}</div>

          <div className="gx-hero-delta">
            <span className={`g-num gx-hero-abs gx-${dir(nifty.chg)}`}>
              {nifty.chg === null ? "—" : `${nifty.chg >= 0 ? "+" : ""}${((nifty.last ?? 0) * nifty.chg / 100).toFixed(2)}`}
            </span>
            <span className={`g-num gx-hero-pct gx-${dir(nifty.chg)}`}>{sign(nifty.chg)}</span>
            <span className="gx-status" style={{ marginLeft: "auto" }}>
              <span className={`gx-dot${nifty.chg !== null ? " live" : ""}`} aria-hidden />
              {nifty.chg === null ? "No live print" : "Live"}
            </span>
          </div>

          <Spark values={d?.spark ?? []} up={(nifty.chg ?? 0) >= 0} />

          <div className="gx-chips">
            <Link className="gx-chip" href="/g/markets">All markets</Link>
            <Link className="gx-chip" href="/opening">Opening desk</Link>
            <Link className="gx-chip" href="/g/options">Options</Link>
          </div>
        </section>
      ) : (
        <section className="gx-hero gx-full" aria-busy="true">
          <div className="gx-skel" style={{ height: 22, width: 140 }} />
          <div className="gx-skel" style={{ height: 46, width: "60%" }} />
          <div className="gx-hero-spark gx-skel" />
        </section>
      )}

      {/* ---- secondary indices ---- */}
      <section className="gx-full">
        <div className="gx-card-head">
          <h2 className="gx-h3">Market pulse</h2>
          <Link className="gx-chip" href="/g/markets">See all</Link>
        </div>
        {tiles.length ? (
          <div className="gx-tiles">
            {tiles.map((i) => (
              <Link key={i.sym} className="gx-tile" href={`/s/${encodeURIComponent(i.sym)}`}>
                <span className="gx-tile-name">{i.short}</span>
                <span className={`g-num gx-tile-px gx-${dir(i.chg)}`}>{px(i.last)}</span>
                <span className={`g-num gx-tile-chg gx-${dir(i.chg)}`}>{sign(i.chg)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="gx-tiles">
            {[0, 1, 2, 3].map((k) => <div key={k} className="gx-tile gx-skel" style={{ height: 92 }} />)}
          </div>
        )}
      </section>

      {/* ---- the market map ---- */}
      <section className="gx-card gx-full">
        <div className="gx-card-head">
          <h2 className="gx-h2">Market map</h2>
          <span className="gx-status">
            <span className="gx-dot live" aria-hidden />
            {d ? `${d.summary.sectorsUp} up · ${d.summary.sectorsDown} down` : "loading"}
          </span>
        </div>
        <p className="gx-lede" style={{ marginTop: -4 }}>
          Each tile is a sector, equal-weighted across the companies that reported. Depth of colour is the size of
          the move, not the market capitalisation of the sector.
        </p>

        {sectors.length ? (
          <div className="gx-heat" style={{ marginTop: 14 }}>
            {sectors.map((s) => (
              <div key={s.key} className="gx-heat-cell" style={heatStyle(s.chg)}
                title={`${s.name}: ${sign(s.chg)} across ${s.reported} of ${s.of} constituents`}>
                <span className="gx-heat-name">{s.name}</span>
                <span className="g-num gx-heat-val">{sign(s.chg)}</span>
                <span className="gx-heat-foot">
                  {s.chg === null ? "NO READ" : `${s.reported}/${s.of} names`}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="gx-heat" style={{ marginTop: 14 }}>
            {Array.from({ length: 12 }, (_, k) => (
              <div key={k} className="gx-heat-cell gx-skel" style={{ minHeight: 74 }} />
            ))}
          </div>
        )}

        {d && d.degraded.sectors.length > 0 && (
          <p className="gx-empty" style={{ marginTop: 12 }}>
            No live reading for {d.degraded.sectors.join(", ")}. Those tiles are shown empty rather than dropped,
            so the map keeps its shape.
          </p>
        )}
      </section>

      {/* ---- what is happening, in words ---- */}
      <section className="gx-card gx-full">
        <div className="gx-card-head"><h2 className="gx-h2">Today&apos;s highlights</h2></div>
        {reads.length ? (
          <div className="gx-reads">
            {reads.map((r, k) => (
              <div className="gx-read" key={k}>
                <span className={`gx-read-icon gx-${dir(k % 2 === 0 ? 1 : -1)}`} aria-hidden>{r.icon}</span>
                <div>
                  <div className="gx-read-t">{r.t}</div>
                  <div className="gx-read-d">{r.d}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="gx-empty">Reading the tape…</p>
        )}
      </section>

      {/* ---- movers ---- */}
      <section className="gx-card gx-full">
        <div className="gx-card-head"><h2 className="gx-h2">Biggest movers</h2></div>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {([["Gainers", d?.gainers], ["Losers", d?.losers]] as const).map(([title, rows]) => (
            <div key={title}>
              <p className="gx-eyebrow">{title}</p>
              {rows && rows.length ? (
                <div className="gx-reads">
                  {rows.map((r: any) => (
                    <Link className="gx-read" key={String(r.sym)} href={`/s/${encodeURIComponent(String(r.sym))}`}
                      style={{ textDecoration: "none", color: "inherit" }}>
                      <span className="gx-read-icon" aria-hidden />
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span className="gx-read-t" style={{ textTransform: "replace(.NS, '')" }}>{String(r.sym).replace(".NS", "")}</span>
                        <span className={`g-num gx-read-d gx-${dir(r.chg)}`} style={{ marginLeft: "auto" }}>{sign(r.chg)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="gx-empty">No live movers.</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {err && (
        <section className="gx-card gx-full">
          <h2 className="gx-h3">Couldn&apos;t load the market</h2>
          <p className="gx-empty">{err}</p>
        </section>
      )}

      {d && (d.degraded.indexes > 0 || d.degraded.moversReported < d.degraded.moversTotal) && (
        <p className="gx-empty gx-full">
          Data check: {d.degraded.indexes} of {d.indexes.length} indices and {d.degraded.moversReported} of{" "}
          {d.degraded.moversTotal} mover names returned a live print. Everything shown without a number is
          genuinely missing, not zero.
        </p>
      )}
    </GuidedShell>
  );
}