"use client";

import { useState } from "react";

// Shared terminal chart kit — pure SVG, no dependencies.
// Amber-on-black, tabular numerals, square panels.

const W = 640;

export function useHoverIndex(count: number) {
  const [hover, setHover] = useState<number | null>(null);
  return {
    hover,
    bind: {
      onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const i = Math.round((x / Math.max(rect.width, 1)) * (count - 1));
        setHover(Math.max(0, Math.min(count - 1, i)));
      },
      onMouseLeave: () => setHover(null),
    },
  };
}

export function HoverTip({ idx, count, date, rows }: {
  idx: number; count: number; date?: string;
  rows: Array<{ label: string; color: string; text: string }>;
}) {
  const left = (idx / Math.max(count - 1, 1)) * 100;
  const flip = left > 62;
  return (
    <div
      className="chart-tip"
      style={{ left: `${left}%`, transform: flip ? "translateX(calc(-100% - 14px))" : "translateX(14px)" }}
    >
      {date && <div className="chart-tip-date">{date}</div>}
      {!date && <div className="chart-tip-date">BAR {idx + 1}/{count}</div>}
      {rows.map((r) => (
        <div key={r.label} className="chart-tip-row">
          <span style={{ color: r.color }}>■</span><span>{r.label}</span><strong>{r.text}</strong>
        </div>
      ))}
    </div>
  );
}

function lastOf(vals: (number | null)[]): number | null {
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (v !== null && v !== undefined && isFinite(v)) return v;
  }
  return null;
}

// Drop leading periods where every series is null (feeds cap history,
// leaving a dead first column/segment that looks broken).
function trimLead<T>(vals: (number | null)[][], extras: T[]): { vals: (number | null)[][]; extras: T[] } {
  let s = 0;
  const n = Math.max(...vals.map((v) => v.length), 0);
  while (s < n && vals.every((v) => v[s] === null || v[s] === undefined || !isFinite(v[s] as number))) s++;
  if (s === 0) return { vals, extras };
  return { vals: vals.map((v) => v.slice(s)), extras: extras.slice(s) };
}

function segments(vals: (number | null)[], mn: number, mx: number, H: number, pad = 8): string[] {
  const segs: string[] = [];
  let cur: string[] = [];
  vals.forEach((v, i) => {
    if (v === null || v === undefined || !isFinite(v)) {
      if (cur.length > 1) segs.push(cur.join(" "));
      cur = [];
      return;
    }
    const x = ((i / Math.max(vals.length - 1, 1)) * W).toFixed(1);
    const y = (H - pad - ((v - mn) / (mx - mn || 1)) * (H - pad * 2)).toFixed(1);
    cur.push(`${x},${y}`);
  });
  if (cur.length > 1) segs.push(cur.join(" "));
  return segs;
}

export function ChartPanel({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <p className="p-head">{title} {right && <span className="faint">— {right}</span>}</p>
      {children}
    </div>
  );
}

export function LineChart({ series, height = 140, yFmt = (v: number) => v.toFixed(0), xLabels, dates }: {
  series: Array<{ label: string; color: string; values: (number | null)[]; dashed?: boolean }>;
  height?: number;
  yFmt?: (v: number) => string;
  xLabels?: [string, string, string];
  dates?: string[];
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && isFinite(v));
  if (!all.length) return <p className="muted">NO SERIES.</p>;
  const trimmed = trimLead(
    series.map((s) => s.values),
    series[0].values.map((_, i) => i)
  );
  const tseries = series.map((s, si) => ({ ...s, values: trimmed.vals[si] }));
  const tdates = dates?.slice(series[0].values.length - trimmed.vals[0].length);
  const trimmedOff = series[0].values.length - trimmed.vals[0].length;
  const xl: [string, string, string] | undefined =
    xLabels && trimmedOff === 0
      ? xLabels
      : tdates && tdates.length
        ? [tdates[0] ?? "", tdates[Math.floor(tdates.length / 2)] ?? "", tdates[tdates.length - 1] ?? ""]
        : xLabels;
  const mn = Math.min(...all), mx = Math.max(...all);
  const n = Math.max(...tseries.map((s) => s.values.length));
  const { hover, bind } = useHoverIndex(n);
  const yOf = (v: number) => height - 8 - ((v - mn) / (mx - mn || 1)) * (height - 16);
  const xOf = (i: number) => (i / Math.max(n - 1, 1)) * W;
  const showDots = n <= 12;
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none" {...bind}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="#1e1e24" strokeWidth="1" />)}
          {tseries.map((s) => segments(s.values, mn, mx, height).map((d, i) => (
            <polyline key={`${s.label}${i}`} points={d} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "5 3" : undefined} strokeLinejoin="round" strokeLinecap="round" />
          )))}
          {showDots && tseries.map((s) =>
            s.values.map((v, i) => {
              if (v === null || !isFinite(v)) return null;
              return <circle key={`${s.label}${i}`} cx={xOf(i)} cy={yOf(v)} r="5" fill={s.color} stroke="#0c0c0e" strokeWidth="2" vectorEffect="non-scaling-stroke" />;
            })
          )}
          {hover !== null && (
            <g>
              <line x1={xOf(hover)} x2={xOf(hover)} y1="0" y2={height} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
              {tseries.map((s) => {
                const v = s.values[hover];
                if (v === null || v === undefined || !isFinite(v)) return null;
                return <circle key={s.label} cx={xOf(hover)} cy={yOf(v)} r="4.5" fill={s.color} stroke="#000" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />;
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <HoverTip
            idx={hover} count={n} date={tdates?.[hover]}
            rows={tseries.map((s) => {
              const v = s.values[hover];
              return { label: s.label, color: s.color, text: v === null || v === undefined || !isFinite(v) ? "—" : yFmt(v) };
            })}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4 }} className="faint">
        <span>▲ {yFmt(mx)}</span>
        <span>{xl ? `${xl[0]} → ${xl[2]}` : yFmt((mn + mx) / 2)}</span>
        <span>▼ {yFmt(mn)}</span>
      </div>
      <div className="pills" style={{ marginTop: 8, gap: 8 }}>
        {tseries.map((s) => {
          const lv = lastOf(s.values);
          return <span key={s.label} className="badge" style={{ color: s.color }}>■ {s.label} {lv === null ? "—" : yFmt(lv)}</span>;
        })}
      </div>
    </div>
  );
}

export function AreaChart({ values, height = 120, color = "#ffb000", fill = "rgba(255,160,40,0.12)", fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 }), label = "VALUE", dates }: {
  values: (number | null)[]; height?: number; color?: string; fill?: string; fmt?: (v: number) => string;
  label?: string; dates?: string[];
}) {
  const tl = trimLead([values], values.map((_, i) => i));
  const vals = tl.vals[0];
  const tdates = dates?.slice(values.length - vals.length);
  const f = vals.filter((v): v is number => v !== null && isFinite(v));
  if (f.length < 2) return <p className="muted">NO SERIES.</p>;
  const mn = Math.min(...f), mx = Math.max(...f);
  const n = vals.length;
  const { hover, bind } = useHoverIndex(n);
  const pts = vals.map((v, i) => {
    const vv = v === null || !isFinite(v) ? f[0] : v;
    return `${((i / Math.max(n - 1, 1)) * W).toFixed(1)},${(height - 6 - ((vv - mn) / (mx - mn || 1)) * (height - 12)).toFixed(1)}`;
  });
  const hv = hover !== null ? vals[hover] : null;
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none" {...bind}>
          <polygon points={`0,${height} ${pts.join(" ")} ${W},${height}`} fill={fill} />
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.8" />
          {hover !== null && (
            <g>
              <line x1={(hover / Math.max(n - 1, 1)) * W} x2={(hover / Math.max(n - 1, 1)) * W} y1="0" y2={height} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
              {hv !== null && isFinite(hv) && (
                <circle cx={(hover / Math.max(n - 1, 1)) * W} cy={height - 6 - ((hv - mn) / (mx - mn || 1)) * (height - 12)} r="4" fill={color} stroke="#000" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              )}
            </g>
          )}
        </svg>
        {hover !== null && (
          <HoverTip
            idx={hover} count={n} date={tdates?.[hover]}
            rows={[{ label, color, text: hv === null || !isFinite(hv as number) ? "—" : fmt(hv as number) }]}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
        <span>LO {fmt(mn)}</span><span>LAST {fmt(f[f.length - 1])}</span><span>HI {fmt(mx)}</span>
      </div>
    </div>
  );
}

export function BarChart({ values, labels, height = 120, posColor = "#00d664", negColor = "#ff453a" }: {
  values: (number | null)[]; labels?: string[]; height?: number; posColor?: string; negColor?: string;
}) {
  const f = values.filter((v): v is number => v !== null && isFinite(v));
  if (!f.length) return <p className="muted">NO SERIES.</p>;
  const tl = trimLead([values], (labels ?? values.map((_, i) => String(i))));
  const vals = tl.vals[0];
  const tlabels = labels ? (tl.extras as string[]) : undefined;
  const mx = Math.max(...f, 0), mn = Math.min(...f, 0);
  const span = mx - mn || 1;
  const zeroY = 6 + (mx / span) * (height - 12);
  const bw = W / vals.length;
  const peak = f.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), f[0]);
  const { hover, bind } = useHoverIndex(vals.length);
  const hv = hover !== null ? vals[hover] : null;
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none" {...bind}>
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#3a3a42" strokeWidth="1" />
          {vals.map((v, i) => {
            if (v === null || !isFinite(v)) return null;
            const h = Math.max(2, (Math.abs(v) / span) * (height - 12));
            const y = v >= 0 ? zeroY - h : zeroY;
            return <rect key={i} x={i * bw + 1} y={y} width={Math.max(1.5, bw - 2)} height={h} rx="2.5" fill={v >= 0 ? posColor : negColor} opacity={hover === null || hover === i ? 0.92 : 0.3} />;
          })}
          {hover !== null && (
            <line x1={(hover + 0.5) * bw} x2={(hover + 0.5) * bw} y1="0" y2={height} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
          )}
        </svg>
        {hover !== null && (
          <HoverTip
            idx={hover} count={vals.length} date={tlabels?.[hover]}
            rows={[{ label: "BAR", color: "#ffa028", text: hv === null || !isFinite(hv as number) ? "—" : (hv as number).toLocaleString("en-IN", { maximumFractionDigits: 2 }) }]}
          />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4 }} className="faint">
        <span>PEAK {peak.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span><span>N={f.length}</span>
      </div>
      {tlabels && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }} className="faint">
          <span>{tlabels[0]}</span><span>{tlabels[Math.floor(tlabels.length / 2)]}</span><span>{tlabels[tlabels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

export function GroupedBars({ series, periods, height = 150, fmt = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 0 }) }: {
  series: Array<{ label: string; color: string; values: (number | null)[] }>;
  periods?: string[]; height?: number; fmt?: (v: number) => string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && isFinite(v));
  if (!all.length) return <p className="muted">NO SERIES.</p>;
  const tl = trimLead(
    series.map((s) => s.values),
    series[0].values.map((_, i) => i)
  );
  const tseries = series.map((s, si) => ({ ...s, values: tl.vals[si] }));
  const tperiods = periods?.slice(series[0].values.length - tl.vals[0].length);
  const mx = Math.max(...all, 0), mn = Math.min(...all, 0);
  const span = mx - mn || 1;
  const zeroY = 6 + (mx / span) * (height - 12);
  const n = Math.max(...tseries.map((s) => s.values.length));
  const gw = W / n;
  const bw = Math.max(2, (gw - 8) / Math.max(tseries.length, 1));
  const { hover, bind } = useHoverIndex(n);
  return (
    <div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none" {...bind}>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} stroke="#1e1e24" strokeWidth="1" />)}
          <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="#3a3a42" strokeWidth="1" />
          {tseries.map((s, si) =>
            s.values.map((v, i) => {
              if (v === null || !isFinite(v)) return null;
              const h = Math.max(2, (Math.abs(v) / span) * (height - 12));
              const y = v >= 0 ? zeroY - h : zeroY;
              const x = i * gw + 4 + si * bw;
              return <rect key={`${si}-${i}`} x={x} y={y} width={Math.max(1.5, bw - 2)} height={h} rx="2.5" fill={s.color} opacity={hover === null || hover === i ? 0.92 : 0.28} />;
            })
          )}
          {hover !== null && (
            <line x1={(hover + 0.5) * gw} x2={(hover + 0.5) * gw} y1="0" y2={height} stroke="#ffa028" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
          )}
        </svg>
        {hover !== null && (
          <HoverTip
            idx={hover} count={n} date={tperiods?.[hover]}
            rows={tseries.map((s) => {
              const v = s.values[hover];
              return { label: s.label, color: s.color, text: v === null || !isFinite(v as number) ? "—" : fmt(v as number) };
            })}
          />
        )}
      </div>
      {tperiods && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 4 }} className="faint">
          <span>{tperiods[0]}</span><span>{tperiods[Math.floor(tperiods.length / 2)]}</span><span>{tperiods[tperiods.length - 1]}</span>
        </div>
      )}
      <div className="pills" style={{ marginTop: 8, gap: 8 }}>
        {tseries.map((s) => {
          const lv = lastOf(s.values);
          return <span key={s.label} className="badge" style={{ color: s.color }}>■ {s.label} {lv === null ? "—" : fmt(lv)}</span>;
        })}
      </div>
    </div>
  );
}

export function HBars({ rows, height = 18 }: {  rows: Array<{ label: string; value: number; display?: string; color?: string }>;
  height?: number;
}) {
  const mx = Math.max(...rows.map((r) => Math.abs(r.value)), 1e-9);
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "150px 1fr 90px", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
          <div style={{ height, background: "#1a1a1e", borderRadius: 2 }}>
            <div style={{ width: `${(Math.abs(r.value) / mx) * 100}%`, height: "100%", background: r.color ?? (r.value >= 0 ? "#00d664" : "#ff453a"), borderRadius: 2 }} />
          </div>
          <strong style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.display ?? r.value.toFixed(2)}</strong>
        </div>
      ))}
    </div>
  );
}

export function Histogram({ values, bins = 20, height = 110, color = "#ffa028", prebinned }: {
  values?: number[]; bins?: number; height?: number; color?: string;
  prebinned?: { counts: number[]; edges: number[] };
}) {
  let counts: number[] = [];
  let lo = 0, hi = 0;
  if (prebinned && prebinned.counts.length) {
    counts = prebinned.counts;
    lo = prebinned.edges[0] ?? 0;
    hi = prebinned.edges[prebinned.edges.length - 1] ?? 0;
  } else {
    const f = (values ?? []).filter(isFinite);
    if (f.length < 5) return <p className="muted">NO DISTRIBUTION.</p>;
    lo = Math.min(...f); hi = Math.max(...f);
    counts = new Array(bins).fill(0);
    for (const v of f) {
      let b = Math.floor(((v - lo) / (hi - lo || 1)) * bins);
      if (b >= bins) b = bins - 1;
      if (b < 0) b = 0;
      counts[b]++;
    }
  }
  const mx = Math.max(...counts, 1);
  const bw = W / counts.length;
  const totalN = counts.reduce((a, b) => a + b, 0);
  let mean = NaN;
  if (prebinned && prebinned.counts.length) {
    let sw = 0, sx = 0;
    prebinned.counts.forEach((c, i) => {
      const mid = ((prebinned.edges[i] ?? 0) + (prebinned.edges[i + 1] ?? prebinned.edges[i] ?? 0)) / 2;
      sx += mid * c; sw += c;
    });
    mean = sw ? sx / sw : NaN;
  } else {
    const f2 = (values ?? []).filter(isFinite);
    mean = f2.length ? f2.reduce((a, b) => a + b, 0) / f2.length : NaN;
  }
  const meanX = isFinite(mean) ? ((mean - lo) / (hi - lo || 1)) * W : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: "100%", height }} preserveAspectRatio="none">
        {counts.map((c, i) => {
          const h = Math.max(1, (c / mx) * (height - 8));
          return <rect key={i} x={i * bw + 0.5} y={height - 4 - h} width={Math.max(1, bw - 1)} height={h} fill={color} opacity="0.8" />;
        })}
        {meanX !== null && <line x1={meanX} x2={meanX} y1="0" y2={height} stroke="#00c8ff" strokeWidth="1.5" strokeDasharray="4 3" />}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }} className="faint">
        <span>{lo.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        <span>N={totalN}{isFinite(mean) ? ` · MEAN ${mean.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""}</span>
        <span>{hi.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

export function Donut({ slices, size = 130, thickness = 24, unit = "%" }: {
  slices: Array<{ label: string; value: number; color: string }>;
  size?: number; thickness?: number; unit?: string;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
  let a = -Math.PI / 2;
  const r = size / 2, ir = r - thickness, cx = size / 2, cy = size / 2;
  const segs = slices.filter((s) => s.value > 0).map((s) => {
    const a0 = a, a1 = a + (s.value / total) * Math.PI * 2;
    a = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang: number, rr: number) => `${(cx + rr * Math.cos(ang)).toFixed(1)},${(cy + rr * Math.sin(ang)).toFixed(1)}`;
    return { d: `M${p(a0, r)} A${r},${r} 0 ${large},1 ${p(a1, r)} L${p(a1, ir)} A${ir},${ir} 0 ${large},0 ${p(a0, ir)} Z`, color: s.color, label: s.label, value: s.value };
  });
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segs.map((s, i) => <path key={i} d={s.d} fill={s.color} opacity="0.9"><title>{s.label}: {typeof s.value === "number" ? s.value.toFixed(1) : s.value}{unit} ({total ? ((s.value / total) * 100).toFixed(1) : "—"}% of total)</title></path>)}
        <text x={cx} y={cy + 5} fontSize="13" fill="#f5f5f4" textAnchor="middle" fontWeight="700">{total >= 100 ? Math.round(total).toLocaleString("en-IN") : total.toFixed(1)}</text>
      </svg>
      <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }} title={`${s.label}: ${typeof s.value === "number" ? s.value.toFixed(1) : s.value}${unit}`}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2 }} />
            <span className="muted">{s.label}</span>
            <strong>{typeof s.value === "number" ? s.value.toFixed(1) : s.value}{unit}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EquityDrawdown({ closes, height = 110 }: { closes: number[]; height?: number }) {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i - 1] !== 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] : 0);
  if (rets.length < 10) return null;
  const eq = [100];
  for (const r of rets) eq.push(eq[eq.length - 1] * (1 + r));
  let peak = eq[0];
  const dd = eq.map((v) => {
    if (v > peak) peak = v;
    return ((v - peak) / peak) * 100;
  });
  const ddMn = Math.min(...dd);
  const eqEnd = eq[eq.length - 1];
  const ddEnd = dd[dd.length - 1];
  return (
    <div className="grid grid-2">
      <div>
        <p className="p-head">Growth of ₹100 → {eqEnd.toFixed(1)}</p>
        <AreaChart values={eq} height={height} />
      </div>
      <div>
        <p className="p-head">Underwater — worst {ddMn.toFixed(1)}% · now {ddEnd.toFixed(1)}%</p>
        <AreaChart values={dd} height={height} color="#ff453a" fill="rgba(255,69,58,0.15)" fmt={(v) => `${v.toFixed(1)}%`} />
      </div>
    </div>
  );
}
